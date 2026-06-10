// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC20Minimal {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

interface IEscrowChallengeHooks {
    function markChallenged(uint256 jobId) external;
    function refundForChallenge(uint256 jobId) external;
    function unfreezeForChallenge(uint256 jobId) external;
}

contract ProofMarketChallengeManager {
    enum ChallengeType {
        SourceNotFound,
        LocatorInvalid,
        ExcerptMismatch,
        NumericMismatch,
        CoverageMiss
    }

    enum ChallengeResult {
        Pending,
        ProviderFault,
        ProviderNotFault
    }

    struct Challenge {
        uint256 challengeId;
        uint256 jobId;
        ChallengeType challengeType;
        bytes32 challengeHash;
        ChallengeResult result;
        address challenger;
        address provider;
    }

    uint256 public constant BPS_DENOMINATOR = 10_000;

    uint256 public nextChallengeId = 1;
    address public owner;
    address public resolver;
    address public treasury;
    address public escrow;
    IERC20Minimal public token;

    uint256 public minStake;
    uint256 public challengeDeposit;
    uint256 public slashBps;
    uint256 public slashRewardBps;

    mapping(uint256 => Challenge) public challenges;
    mapping(address => uint256) public stake;
    mapping(address => uint256) public activeChallenges;

    event EscrowSet(address indexed escrow);
    event StakeDeposited(address indexed provider, uint256 amount, uint256 totalStake);
    event StakeWithdrawn(address indexed provider, uint256 amount, uint256 remainingStake);
    event ChallengeOpened(
        uint256 indexed challengeId,
        uint256 indexed jobId,
        ChallengeType challengeType,
        bytes32 challengeHash,
        address indexed challenger,
        address provider
    );
    event ChallengeResolved(
        uint256 indexed challengeId,
        ChallengeResult result,
        uint256 slashAmount,
        uint256 challengerPayout,
        uint256 treasuryPayout
    );

    constructor(
        address token_,
        address resolver_,
        address treasury_,
        uint256 minStake_,
        uint256 challengeDeposit_,
        uint256 slashBps_,
        uint256 slashRewardBps_
    ) {
        require(token_ != address(0), "token required");
        require(resolver_ != address(0), "resolver required");
        require(treasury_ != address(0), "treasury required");
        require(slashBps_ <= BPS_DENOMINATOR, "slashBps too high");
        require(slashRewardBps_ <= BPS_DENOMINATOR, "slashRewardBps too high");

        owner = msg.sender;
        token = IERC20Minimal(token_);
        resolver = resolver_;
        treasury = treasury_;
        minStake = minStake_;
        challengeDeposit = challengeDeposit_;
        slashBps = slashBps_;
        slashRewardBps = slashRewardBps_;
    }

    function setEscrow(address escrow_) external {
        require(msg.sender == owner, "only owner");
        require(escrow == address(0), "escrow already set");
        require(escrow_ != address(0), "escrow required");

        escrow = escrow_;
        emit EscrowSet(escrow_);
    }

    function depositStake(uint256 amount) external {
        require(amount > 0, "amount required");

        stake[msg.sender] += amount;
        require(
            token.transferFrom(msg.sender, address(this), amount),
            "stake transfer failed"
        );

        emit StakeDeposited(msg.sender, amount, stake[msg.sender]);
    }

    function withdrawStake(uint256 amount) external {
        require(amount > 0, "amount required");
        require(activeChallenges[msg.sender] == 0, "active challenge pending");
        require(stake[msg.sender] >= amount, "insufficient stake");

        stake[msg.sender] -= amount;
        require(token.transfer(msg.sender, amount), "stake transfer failed");

        emit StakeWithdrawn(msg.sender, amount, stake[msg.sender]);
    }

    function hasMinStake(address provider) external view returns (bool) {
        return stake[provider] >= minStake;
    }

    function openChallenge(
        uint256 jobId,
        ChallengeType challengeType,
        bytes32 challengeHash,
        address provider
    ) external returns (uint256 challengeId) {
        require(escrow != address(0), "escrow not set");
        require(jobId > 0, "job required");
        require(challengeHash != bytes32(0), "challenge hash required");
        require(provider != address(0), "provider required");
        require(stake[provider] > 0, "provider has no stake");

        challengeId = nextChallengeId++;
        challenges[challengeId] = Challenge({
            challengeId: challengeId,
            jobId: jobId,
            challengeType: challengeType,
            challengeHash: challengeHash,
            result: ChallengeResult.Pending,
            challenger: msg.sender,
            provider: provider
        });
        activeChallenges[provider] += 1;

        // Lock the challenger's deposit in this contract.
        require(
            token.transferFrom(msg.sender, address(this), challengeDeposit),
            "deposit transfer failed"
        );

        // Freeze the escrowed job until the challenge is resolved.
        IEscrowChallengeHooks(escrow).markChallenged(jobId);

        emit ChallengeOpened(
            challengeId,
            jobId,
            challengeType,
            challengeHash,
            msg.sender,
            provider
        );
    }

    function resolve(uint256 challengeId, ChallengeResult result) external {
        Challenge storage challenge = challenges[challengeId];
        require(challenge.challengeId != 0, "challenge not found");
        require(msg.sender == resolver, "only resolver");
        require(challenge.result == ChallengeResult.Pending, "already resolved");
        require(result != ChallengeResult.Pending, "result required");

        challenge.result = result;
        activeChallenges[challenge.provider] -= 1;

        uint256 slashAmount = 0;
        uint256 challengerPayout = 0;
        uint256 treasuryPayout = 0;

        if (result == ChallengeResult.ProviderFault) {
            // Slash the provider's stake; split between challenger and treasury.
            slashAmount = (stake[challenge.provider] * slashBps) / BPS_DENOMINATOR;
            stake[challenge.provider] -= slashAmount;

            uint256 reward = (slashAmount * slashRewardBps) / BPS_DENOMINATOR;
            challengerPayout = reward + challengeDeposit;
            treasuryPayout = slashAmount - reward;

            require(
                token.transfer(challenge.challenger, challengerPayout),
                "challenger transfer failed"
            );
            if (treasuryPayout > 0) {
                require(
                    token.transfer(treasury, treasuryPayout),
                    "treasury transfer failed"
                );
            }

            // Escrow refunds the buyer; the job ends Rejected.
            IEscrowChallengeHooks(escrow).refundForChallenge(challenge.jobId);
        } else {
            // Challenge failed: forfeit the challenger's deposit to the treasury.
            treasuryPayout = challengeDeposit;
            require(
                token.transfer(treasury, treasuryPayout),
                "treasury transfer failed"
            );

            // Unfreeze the job so it can complete normally.
            IEscrowChallengeHooks(escrow).unfreezeForChallenge(challenge.jobId);
        }

        emit ChallengeResolved(
            challengeId,
            result,
            slashAmount,
            challengerPayout,
            treasuryPayout
        );
    }
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC20Like {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

interface IChallengeManagerView {
    function hasMinStake(address provider) external view returns (bool);
}

contract ProofMarketEscrow {
    enum JobState {
        Open,
        Funded,
        Submitted,
        Completed,
        Rejected,
        Expired,
        Challenged
    }

    struct Job {
        uint256 jobId;
        address client;
        uint256 providerAgentId;
        address provider;
        uint256 verifierAgentId;
        address evaluator;
        address token;
        uint256 budget;
        uint256 expiredAt;
        JobState state;
        bytes32 descriptionHash;
        bytes32 deliverableHash;
        bytes32 coverageHash;
    }

    uint256 public nextJobId = 1;
    address public owner;
    address public challengeManager;
    mapping(uint256 => Job) public jobs;

    event JobCreated(uint256 indexed jobId, address indexed client, address indexed provider);
    event JobFunded(uint256 indexed jobId, uint256 amount);
    event DeliverableSubmitted(uint256 indexed jobId, bytes32 deliverableHash);
    event JobCompleted(uint256 indexed jobId, bytes32 reasonHash);
    event JobRejected(uint256 indexed jobId, bytes32 reasonHash);
    event JobExpired(uint256 indexed jobId);
    event JobChallenged(uint256 indexed jobId);
    event JobRefundedForChallenge(uint256 indexed jobId);
    event JobUnfrozenForChallenge(uint256 indexed jobId);
    event ChallengeManagerSet(address indexed challengeManager);

    constructor() {
        owner = msg.sender;
    }

    modifier onlyChallengeManager() {
        require(msg.sender == challengeManager, "only challenge manager");
        _;
    }

    function setChallengeManager(address challengeManager_) external {
        require(msg.sender == owner, "only owner");
        require(challengeManager == address(0), "challenge manager already set");
        require(challengeManager_ != address(0), "challenge manager required");

        challengeManager = challengeManager_;
        emit ChallengeManagerSet(challengeManager_);
    }

    function createJob(
        uint256 providerAgentId,
        address provider,
        uint256 verifierAgentId,
        address evaluator,
        address token,
        uint256 expiredAt,
        bytes32 descriptionHash,
        bytes32 coverageHash
    ) external returns (uint256 jobId) {
        require(provider != address(0), "provider required");
        require(evaluator != address(0), "evaluator required");
        require(token != address(0), "token required");
        require(expiredAt > block.timestamp, "expiry must be future");
        require(
            challengeManager != address(0) &&
                IChallengeManagerView(challengeManager).hasMinStake(provider),
            "provider stake too low"
        );

        jobId = nextJobId++;
        jobs[jobId] = Job({
            jobId: jobId,
            client: msg.sender,
            providerAgentId: providerAgentId,
            provider: provider,
            verifierAgentId: verifierAgentId,
            evaluator: evaluator,
            token: token,
            budget: 0,
            expiredAt: expiredAt,
            state: JobState.Open,
            descriptionHash: descriptionHash,
            deliverableHash: bytes32(0),
            coverageHash: coverageHash
        });

        emit JobCreated(jobId, msg.sender, provider);
    }

    function setBudget(uint256 jobId, uint256 amount) external {
        Job storage job = jobs[jobId];
        require(job.client != address(0), "job not found");
        require(msg.sender == job.client, "only client");
        require(job.state == JobState.Open, "not open");
        require(amount > 0, "budget required");

        job.budget = amount;
    }

    function fund(uint256 jobId, uint256 expectedAmount) external {
        Job storage job = jobs[jobId];
        require(job.client != address(0), "job not found");
        require(msg.sender == job.client, "only client");
        require(job.state == JobState.Open, "not open");
        require(job.expiredAt > block.timestamp, "job expired");
        require(job.budget > 0, "budget required");
        require(job.budget == expectedAmount, "amount mismatch");

        job.state = JobState.Funded;
        require(
            IERC20Like(job.token).transferFrom(msg.sender, address(this), expectedAmount),
            "transfer failed"
        );

        emit JobFunded(jobId, expectedAmount);
    }

    function submit(uint256 jobId, bytes32 deliverableHash) external {
        Job storage job = jobs[jobId];
        require(job.client != address(0), "job not found");
        require(msg.sender == job.provider, "only provider");
        require(job.state == JobState.Funded, "not funded");
        require(job.expiredAt > block.timestamp, "job expired");

        job.deliverableHash = deliverableHash;
        job.state = JobState.Submitted;

        emit DeliverableSubmitted(jobId, deliverableHash);
    }

    function complete(uint256 jobId, bytes32 reasonHash) external {
        Job storage job = jobs[jobId];
        require(job.client != address(0), "job not found");
        require(msg.sender == job.evaluator, "only evaluator");
        require(job.state == JobState.Submitted, "not submitted");

        job.state = JobState.Completed;
        require(IERC20Like(job.token).transfer(job.provider, job.budget), "transfer failed");

        emit JobCompleted(jobId, reasonHash);
    }

    function reject(uint256 jobId, bytes32 reasonHash) external {
        Job storage job = jobs[jobId];
        require(job.client != address(0), "job not found");
        require(msg.sender == job.evaluator, "only evaluator");
        require(
            job.state == JobState.Funded || job.state == JobState.Submitted,
            "not rejectable"
        );

        job.state = JobState.Rejected;
        require(IERC20Like(job.token).transfer(job.client, job.budget), "transfer failed");

        emit JobRejected(jobId, reasonHash);
    }

    function expireAndRefund(uint256 jobId) external {
        Job storage job = jobs[jobId];
        require(job.client != address(0), "job not found");
        require(msg.sender == job.client, "only client");
        require(job.state == JobState.Funded, "not funded");
        require(job.expiredAt <= block.timestamp, "job not expired");

        job.state = JobState.Expired;
        require(IERC20Like(job.token).transfer(job.client, job.budget), "transfer failed");

        emit JobExpired(jobId);
    }

    function markChallenged(uint256 jobId) external onlyChallengeManager {
        Job storage job = jobs[jobId];
        require(job.client != address(0), "job not found");
        require(
            job.state == JobState.Funded || job.state == JobState.Submitted,
            "not challengeable"
        );

        job.state = JobState.Challenged;

        emit JobChallenged(jobId);
    }

    function refundForChallenge(uint256 jobId) external onlyChallengeManager {
        Job storage job = jobs[jobId];
        require(job.client != address(0), "job not found");
        require(job.state == JobState.Challenged, "not challenged");

        job.state = JobState.Rejected;
        require(IERC20Like(job.token).transfer(job.client, job.budget), "transfer failed");

        emit JobRefundedForChallenge(jobId);
    }

    function unfreezeForChallenge(uint256 jobId) external onlyChallengeManager {
        Job storage job = jobs[jobId];
        require(job.client != address(0), "job not found");
        require(job.state == JobState.Challenged, "not challenged");

        job.state = JobState.Submitted;

        emit JobUnfrozenForChallenge(jobId);
    }
}

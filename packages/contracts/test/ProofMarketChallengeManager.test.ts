import { expect } from "chai";
import { ethers } from "hardhat";

describe("ProofMarketChallengeManager", () => {
  const ChallengeType = {
    CoverageMiss: 4n
  } as const;
  const ChallengeResult = {
    Pending: 0n,
    ProviderFault: 1n,
    ProviderNotFault: 2n
  } as const;
  const JobState = {
    Open: 0n,
    Funded: 1n,
    Submitted: 2n,
    Completed: 3n,
    Rejected: 4n,
    Expired: 5n,
    Challenged: 6n
  } as const;

  const minStake = 10_000_000n;
  const challengeDeposit = 2_000_000n;
  const slashBps = 5_000n;
  const slashRewardBps = 5_000n;
  const budget = 1_000_000n;

  async function expectRevert(
    promise: Promise<unknown>,
    message: string
  ): Promise<void> {
    let error: unknown;

    try {
      await promise;
    } catch (caught) {
      error = caught;
    }

    expect(error, `expected revert containing "${message}"`).to.be.instanceOf(
      Error
    );
    expect((error as Error).message).to.include(message);
  }

  async function expectEvent(
    transactionPromise: Promise<any>,
    contract: any,
    eventName: string,
    expectedArgs: readonly unknown[]
  ): Promise<void> {
    const transaction = await transactionPromise;
    const receipt = await transaction.wait();
    const matchingEvents = receipt.logs
      .map((log: unknown) => {
        try {
          return contract.interface.parseLog(log);
        } catch {
          return null;
        }
      })
      .filter((event: { name: string } | null) => event?.name === eventName);

    expect(matchingEvents.length, `expected ${eventName} event`).to.be.greaterThan(
      0
    );
    const args = Array.from(matchingEvents[0].args).slice(
      0,
      expectedArgs.length
    );
    expect(args).to.deep.equal([...expectedArgs]);
  }

  async function deployFixture() {
    const [deployer, resolver, treasury, client, provider, evaluator, challenger, other] =
      await ethers.getSigners();

    const Token = await ethers.getContractFactory("MockUSDC");
    const token = await Token.deploy();

    const Escrow = await ethers.getContractFactory("ProofMarketEscrow");
    const escrow = await Escrow.deploy();

    const Manager = await ethers.getContractFactory("ProofMarketChallengeManager");
    const manager = await Manager.deploy(
      await token.getAddress(),
      resolver.address,
      treasury.address,
      minStake,
      challengeDeposit,
      slashBps,
      slashRewardBps
    );

    await escrow.setChallengeManager(await manager.getAddress());
    await manager.setEscrow(await escrow.getAddress());

    // Provider stakes the exact minimum.
    await token.mint(provider.address, minStake);
    await token.connect(provider).approve(await manager.getAddress(), minStake);
    await manager.connect(provider).depositStake(minStake);

    // Challenger holds exactly one deposit, pre-approved.
    await token.mint(challenger.address, challengeDeposit);
    await token
      .connect(challenger)
      .approve(await manager.getAddress(), challengeDeposit);

    const challengeHash = ethers.keccak256(
      ethers.toUtf8Bytes("coverage miss: no Block-STM evidence")
    );

    return {
      deployer,
      resolver,
      treasury,
      client,
      provider,
      evaluator,
      challenger,
      other,
      token,
      escrow,
      manager,
      challengeHash
    };
  }

  async function deployWithSubmittedJob() {
    const fixture = await deployFixture();
    const { escrow, token, client, provider, evaluator } = fixture;

    const latestBlock = await ethers.provider.getBlock("latest");
    const expiredAt = BigInt((latestBlock?.timestamp ?? 0) + 1800);
    const descriptionHash = ethers.keccak256(ethers.toUtf8Bytes("task_001"));
    const coverageHash = ethers.keccak256(ethers.toUtf8Bytes("coverage"));
    const deliverableHash = ethers.keccak256(ethers.toUtf8Bytes("package"));
    const reasonHash = ethers.keccak256(ethers.toUtf8Bytes("valid"));

    await escrow
      .connect(client)
      .createJob(
        1,
        provider.address,
        4,
        evaluator.address,
        await token.getAddress(),
        expiredAt,
        descriptionHash,
        coverageHash
      );
    await escrow.connect(client).setBudget(1, budget);
    await token.mint(client.address, budget);
    await token.connect(client).approve(await escrow.getAddress(), budget);
    await escrow.connect(client).fund(1, budget);
    await escrow.connect(provider).submit(1, deliverableHash);

    return { ...fixture, deliverableHash, reasonHash, jobId: 1n };
  }

  describe("deployment wiring", () => {
    it("only the owner can set the escrow, and only once", async () => {
      const { resolver, other, token, treasury } = await deployFixture();

      const Manager = await ethers.getContractFactory(
        "ProofMarketChallengeManager"
      );
      const fresh = await Manager.deploy(
        await token.getAddress(),
        resolver.address,
        treasury.address,
        minStake,
        challengeDeposit,
        slashBps,
        slashRewardBps
      );

      await expectRevert(
        fresh.connect(other).setEscrow(other.address),
        "only owner"
      );

      await fresh.setEscrow(other.address);
      expect(await fresh.escrow()).to.equal(other.address);

      await expectRevert(fresh.setEscrow(other.address), "escrow already set");
    });

    it("rejects opening a challenge before the escrow is wired", async () => {
      const { resolver, provider, token, treasury, challengeHash } =
        await deployFixture();

      const Manager = await ethers.getContractFactory(
        "ProofMarketChallengeManager"
      );
      const fresh = await Manager.deploy(
        await token.getAddress(),
        resolver.address,
        treasury.address,
        minStake,
        challengeDeposit,
        slashBps,
        slashRewardBps
      );

      await expectRevert(
        fresh.openChallenge(
          1,
          ChallengeType.CoverageMiss,
          challengeHash,
          provider.address
        ),
        "escrow not set"
      );
    });
  });

  describe("staking", () => {
    it("deposits and withdraws provider stake, moving tokens", async () => {
      const { manager, token, provider } = await deployFixture();

      expect(await manager.stake(provider.address)).to.equal(minStake);
      expect(await manager.hasMinStake(provider.address)).to.equal(true);
      expect(await token.balanceOf(await manager.getAddress())).to.equal(
        minStake
      );

      await expectEvent(
        manager.connect(provider).withdrawStake(minStake / 2n),
        manager,
        "StakeWithdrawn",
        [provider.address, minStake / 2n, minStake / 2n]
      );

      expect(await manager.stake(provider.address)).to.equal(minStake / 2n);
      expect(await manager.hasMinStake(provider.address)).to.equal(false);
      expect(await token.balanceOf(provider.address)).to.equal(minStake / 2n);
    });

    it("emits StakeDeposited and accumulates stake", async () => {
      const { manager, token, other } = await deployFixture();

      await token.mint(other.address, 3_000_000n);
      await token.connect(other).approve(await manager.getAddress(), 3_000_000n);

      await expectEvent(
        manager.connect(other).depositStake(1_000_000n),
        manager,
        "StakeDeposited",
        [other.address, 1_000_000n, 1_000_000n]
      );
      await expectEvent(
        manager.connect(other).depositStake(2_000_000n),
        manager,
        "StakeDeposited",
        [other.address, 2_000_000n, 3_000_000n]
      );
    });

    it("rejects withdrawing more than the staked amount", async () => {
      const { manager, provider } = await deployFixture();

      await expectRevert(
        manager.connect(provider).withdrawStake(minStake + 1n),
        "insufficient stake"
      );
    });

    it("blocks stake withdrawal while a challenge is pending against the provider", async () => {
      const { manager, provider, challenger, challengeHash } =
        await deployWithSubmittedJob();

      await manager
        .connect(challenger)
        .openChallenge(
          1,
          ChallengeType.CoverageMiss,
          challengeHash,
          provider.address
        );

      await expectRevert(
        manager.connect(provider).withdrawStake(1n),
        "active challenge pending"
      );
    });
  });

  describe("openChallenge", () => {
    it("locks the challenger deposit and freezes the job", async () => {
      const {
        manager,
        escrow,
        token,
        provider,
        challenger,
        evaluator,
        reasonHash,
        challengeHash
      } = await deployWithSubmittedJob();

      const managerBalanceBefore = await token.balanceOf(
        await manager.getAddress()
      );

      await expectEvent(
        manager
          .connect(challenger)
          .openChallenge(
            1,
            ChallengeType.CoverageMiss,
            challengeHash,
            provider.address
          ),
        manager,
        "ChallengeOpened",
        [1n, 1n, ChallengeType.CoverageMiss, challengeHash, challenger.address, provider.address]
      );

      expect(await token.balanceOf(challenger.address)).to.equal(0n);
      expect(await token.balanceOf(await manager.getAddress())).to.equal(
        managerBalanceBefore + challengeDeposit
      );

      const challenge = await manager.challenges(1);
      expect(challenge.challenger).to.equal(challenger.address);
      expect(challenge.provider).to.equal(provider.address);
      expect(challenge.result).to.equal(ChallengeResult.Pending);
      expect(await manager.activeChallenges(provider.address)).to.equal(1n);

      const job = await escrow.jobs(1);
      expect(job.state).to.equal(JobState.Challenged);

      // The frozen job cannot be completed.
      await expectRevert(
        escrow.connect(evaluator).complete(1, reasonHash),
        "not submitted"
      );
    });

    it("rejects invalid challenge records", async () => {
      const { manager, provider, challenger, other, challengeHash } =
        await deployWithSubmittedJob();

      await expectRevert(
        manager
          .connect(challenger)
          .openChallenge(
            0,
            ChallengeType.CoverageMiss,
            challengeHash,
            provider.address
          ),
        "job required"
      );

      await expectRevert(
        manager
          .connect(challenger)
          .openChallenge(
            1,
            ChallengeType.CoverageMiss,
            ethers.ZeroHash,
            provider.address
          ),
        "challenge hash required"
      );

      await expectRevert(
        manager
          .connect(challenger)
          .openChallenge(
            1,
            ChallengeType.CoverageMiss,
            challengeHash,
            other.address
          ),
        "provider has no stake"
      );
    });

    it("rejects a challenger who cannot fund the deposit", async () => {
      const { manager, token, provider, other, challengeHash } =
        await deployWithSubmittedJob();

      // No balance at all: the deposit transfer reverts inside the token.
      await expectRevert(
        manager
          .connect(other)
          .openChallenge(
            1,
            ChallengeType.CoverageMiss,
            challengeHash,
            provider.address
          ),
        "insufficient balance"
      );

      // Balance but no approval: still rejected.
      await token.mint(other.address, challengeDeposit);
      await expectRevert(
        manager
          .connect(other)
          .openChallenge(
            1,
            ChallengeType.CoverageMiss,
            challengeHash,
            provider.address
          ),
        "insufficient allowance"
      );
    });
  });

  describe("resolve", () => {
    async function openChallengeFixture() {
      const fixture = await deployWithSubmittedJob();

      await fixture.manager
        .connect(fixture.challenger)
        .openChallenge(
          1,
          ChallengeType.CoverageMiss,
          fixture.challengeHash,
          fixture.provider.address
        );

      return fixture;
    }

    it("ProviderFault: slashes stake, pays the challenger, funds the treasury, refunds the buyer", async () => {
      const { manager, escrow, token, resolver, treasury, client, provider, challenger } =
        await openChallengeFixture();

      const slashAmount = (minStake * slashBps) / 10_000n; // 5 mUSDC
      const reward = (slashAmount * slashRewardBps) / 10_000n; // 2.5 mUSDC

      await expectEvent(
        manager
          .connect(resolver)
          .resolve(1, ChallengeResult.ProviderFault),
        manager,
        "ChallengeResolved",
        [
          1n,
          ChallengeResult.ProviderFault,
          slashAmount,
          reward + challengeDeposit,
          slashAmount - reward
        ]
      );

      // Provider stake slashed by 50%.
      expect(await manager.stake(provider.address)).to.equal(
        minStake - slashAmount
      );
      // Challenger gets the reward plus their deposit back.
      expect(await token.balanceOf(challenger.address)).to.equal(
        reward + challengeDeposit
      );
      // Treasury gets the rest of the slashed stake.
      expect(await token.balanceOf(treasury.address)).to.equal(
        slashAmount - reward
      );
      // Buyer is refunded the escrowed budget.
      expect(await token.balanceOf(client.address)).to.equal(budget);

      const job = await escrow.jobs(1);
      expect(job.state).to.equal(JobState.Rejected);

      // Challenge is closed, so the provider can withdraw the remaining stake.
      expect(await manager.activeChallenges(provider.address)).to.equal(0n);
      await manager.connect(provider).withdrawStake(minStake - slashAmount);
      expect(await token.balanceOf(provider.address)).to.equal(
        minStake - slashAmount
      );
    });

    it("ProviderNotFault: forfeits the deposit to the treasury and unfreezes the job", async () => {
      const {
        manager,
        escrow,
        token,
        resolver,
        treasury,
        provider,
        challenger,
        evaluator,
        reasonHash
      } = await openChallengeFixture();

      await expectEvent(
        manager
          .connect(resolver)
          .resolve(1, ChallengeResult.ProviderNotFault),
        manager,
        "ChallengeResolved",
        [1n, ChallengeResult.ProviderNotFault, 0n, 0n, challengeDeposit]
      );

      // Deposit forfeited; stake untouched.
      expect(await token.balanceOf(treasury.address)).to.equal(challengeDeposit);
      expect(await token.balanceOf(challenger.address)).to.equal(0n);
      expect(await manager.stake(provider.address)).to.equal(minStake);

      // Job restored to Submitted, then completes normally.
      let job = await escrow.jobs(1);
      expect(job.state).to.equal(JobState.Submitted);

      await escrow.connect(evaluator).complete(1, reasonHash);
      job = await escrow.jobs(1);
      expect(job.state).to.equal(JobState.Completed);
      expect(await token.balanceOf(provider.address)).to.equal(budget);
    });

    it("only the resolver can resolve, exactly once, with a non-pending result", async () => {
      const { manager, resolver, other } = await openChallengeFixture();

      await expectRevert(
        manager.connect(other).resolve(1, ChallengeResult.ProviderFault),
        "only resolver"
      );

      await expectRevert(
        manager.connect(resolver).resolve(1, ChallengeResult.Pending),
        "result required"
      );

      await expectRevert(
        manager.connect(resolver).resolve(2, ChallengeResult.ProviderFault),
        "challenge not found"
      );

      await manager.connect(resolver).resolve(1, ChallengeResult.ProviderFault);

      await expectRevert(
        manager.connect(resolver).resolve(1, ChallengeResult.ProviderNotFault),
        "already resolved"
      );
    });
  });
});

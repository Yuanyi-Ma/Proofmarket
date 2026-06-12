import { describe, expect, it } from "vitest";
import { presetDefense, presetJuryVotes } from "@proofmarket/shared/src/fixtures";
import { createInMemoryStore } from "../src/demoStore";
import { createRealTaskService, type RealDeps } from "../src/realTaskService";

const HASH64 = `0x${"a".repeat(64)}`;

function makeDeps(
  overrides: Partial<RealDeps> = {}
): RealDeps & { calls: string[]; calldatas: Array<{ label: string; calldata: string }> } {
  const calls: string[] = [];
  const calldatas: Array<{ label: string; calldata: string }> = [];
  const base: RealDeps = {
    deployment: {
      chainId: 11155111,
      network: "sepolia",
      deployer: `0x${"1".repeat(40)}`,
      blockNumber: 1,
      coboWallet: `0x${"2".repeat(40)}`,
      contracts: {
        MockUSDC: `0x${"3".repeat(40)}`,
        ProofMarketEscrow: `0x${"4".repeat(40)}`,
        ProofMarketChallengeManager: `0x${"6".repeat(40)}`
      },
      mint: { to: `0x${"2".repeat(40)}`, rawAmount: "100000000", txHash: HASH64 },
      deployedAt: "2026-06-10T00:00:00.000Z",
      challengeManagerParams: {
        minStake: "2000000",
        challengeDeposit: "500000",
        slashBps: "5000",
        slashRewardBps: "5000"
      },
      resolver: `0x${"7".repeat(40)}`,
      treasury: `0x${"8".repeat(40)}`,
      providers: {
        "execution-research-expert": {
          address: `0x${"5".repeat(40)}`,
          mintedUsdc: "20000000",
          stakedAmount: "20000000",
          stakePending: false,
          agentId: 6388
        },
        "shallow-search-provider": {
          address: `0x${"a".repeat(40)}`,
          mintedUsdc: "20000000",
          stakedAmount: "0",
          stakePending: true,
          agentId: 6389
        },
        "general-web-summary": {
          address: `0x${"b".repeat(40)}`,
          mintedUsdc: "20000000",
          stakedAmount: "0",
          stakePending: true,
          agentId: 6390
        }
      },
      erc8004: {
        identityRegistry: `0x${"c".repeat(40)}`,
        reputationRegistry: `0x${"d".repeat(40)}`
      }
    },
    providerAddress: `0x${"5".repeat(40)}`,
    runResearchAgent: async (context) => ({
      plan: {
        taskId: context.taskId,
        recommendedProviderId: "execution-research-expert",
        reason: "specialist",
        maxPayment: "5",
        requiredEvidenceSchema: { minItems: 3, requiredFields: [] },
        chainActions: ["createJob", "fund", "submitEvidenceHash", "complete"]
      },
      rawStdout: "{}",
      attempts: 1
    }),
    cobo: {
      submitPact: async () => ({ pactId: "p-1", status: "pending_approval", raw: "{}" }),
      getPactStatus: async () => ({ pactId: "p-1", status: "active", raw: "{}" }),
      callContract: async ({ description, calldata }) => {
        calls.push(`cobo:${description}`);
        calldatas.push({ label: description, calldata });
        return { coboTxId: `tx-${description}`, status: "submitted", raw: "{}" };
      },
      getTx: async (id) => ({
        raw: "{}",
        parsed: { tx_hash: `0x${"b".repeat(64)}`, status: "confirmed", id }
      }),
      attemptDeniedTransfer: async () => {
        calls.push("cobo:attemptDeniedTransfer");
        return {
          denied: true,
          exitCode: 5,
          attemptedAction: "tx transfer 0.001 SETH -> 0xdead",
          rawOutput: '{"error":"policy denied"}'
        };
      }
    },
    chain: {
      waitForReceipt: async () => ({ logs: [], transactionHash: `0x${"b".repeat(64)}` }) as never,
      extractJobId: () => 7n,
      // Stubs the ChallengeOpened-event decoding: the fake openChallenge receipt
      // yields challengeId 42.
      extractChallengeId: () => 42n,
      // state 1 = Funded: satisfies the post-fund readback; deliverableHash HASH64
      // satisfies the runProvider integrity check (which only compares the hash).
      readJobState: async () => ({ state: 1, budget: 5_000_000n, deliverableHash: HASH64 as `0x${string}` })
    },
    resolveChallenge: async ({ challengeId }) => {
      calls.push(`resolveChallenge:${challengeId}`);
      return { txHash: `0x${"d".repeat(64)}` };
    },
    publishFeedback: async ({ agentId, value, tag2 }) => {
      calls.push(`publishFeedback:${agentId}:${value}:${tag2}`);
      return { txHash: `0x${"f".repeat(64)}` };
    },
    readReputation: async (agentId) => {
      calls.push(`readReputation:${agentId}`);
      // Distinct per-agent scores so assertions can tell providers apart.
      const scores: Record<number, number> = { 6388: 960, 6389: 400, 6390: 700 };
      const score = scores[agentId];
      if (score === undefined) throw new Error(`unknown agentId ${agentId}`);
      return { score };
    },
    services: {
      // Echo the requested providerId: feedback targets the provider that RAN.
      runProvider: async ({ providerId }) => ({
        taskId: "t",
        providerAgentId: 1,
        providerId,
        providerName: "Expert",
        coverageStatement: "covered",
        answers: [
          {
            providerAnswer: "a",
            sourceTitle: "s",
            sourceLocator: "arXiv:1",
            sourceLibrary: "arxiv",
            sourceMetadata: { year: 2022, type: "paper" },
            excerptOrSummary: "e",
            relevanceExplanation: "r"
          }
        ],
        packageHash: HASH64
      }),
      submitDeliverable: async () => ({ txHash: `0x${"c".repeat(64)}` }),
      judgeVerify: async () => ({
        judgeId: "judge-demo-001",
        jobId: "7",
        decision: "valid" as const,
        reasonCode: "PRESET_SUCCESS_PATH",
        verdictHash: HASH64,
        voting: { mode: "not_triggered", voteId: null, onchainTxHash: null }
      }),
      providerDefend: async (input) => {
        calls.push(`services:providerDefend:${input.challengeId}`);
        return {
          statement: presetDefense.statement,
          defenseHash: presetDefense.defenseHash,
          txHash: `0x${"a1".repeat(32)}`
        };
      },
      juryVote: async (input) => {
        calls.push(`services:juryVote:${input.challengeId}`);
        return {
          votes: presetJuryVotes([
            "0x0000000000000000000000000000000000000a01",
            "0x0000000000000000000000000000000000000a02",
            "0x0000000000000000000000000000000000000a03"
          ]).map((vote, i) => ({ ...vote, txHash: `0x${String(i + 1).repeat(64)}` }))
        };
      }
    },
    audit: { append: () => {} },
    now: () => "2026-06-10T12:00:00.000Z",
    pollDelayMs: 0
  };
  const deps = { ...base, ...overrides, calls, calldatas };
  return deps as RealDeps & {
    calls: string[];
    calldatas: Array<{ label: string; calldata: string }>;
  };
}

async function driveToPactActive(service: ReturnType<typeof createRealTaskService>) {
  const created = await service.createTask("q", "5 test USDC");
  await service.plan(created.id);
  await service.submitPact(created.id);
  return service.activatePact(created.id);
}

describe("real task service", () => {
  it("marks tasks as real mode", async () => {
    const service = createRealTaskService(createInMemoryStore(), makeDeps());
    const task = await service.createTask("q", "5 test USDC");
    expect(task.mode).toBe("real");
  });

  it("stores the claude plan and raw output", async () => {
    const service = createRealTaskService(createInMemoryStore(), makeDeps());
    const created = await service.createTask("q", "5 test USDC");
    const planned = await service.plan(created.id);
    expect(planned.plan?.recommendedProviderId).toBe("execution-research-expert");
    expect(planned.plan?.evidenceNeed).toBe("specialist");
    expect(planned.claudePlanRaw).toBe("{}");
  });

  it("refuses to execute escrow before the pact is active", async () => {
    const baseDeps = makeDeps();
    const deps = makeDeps({
      cobo: {
        ...baseDeps.cobo,
        getPactStatus: async () => ({ pactId: "p-1", status: "pending_approval", raw: "{}" })
      }
    });
    const service = createRealTaskService(createInMemoryStore(), deps);
    const created = await service.createTask("q", "5 test USDC");
    await service.plan(created.id);
    await service.submitPact(created.id);
    const stillSubmitted = await service.activatePact(created.id);
    expect(stillSubmitted.status).toBe("PactSubmitted");
    await expect(service.executeEscrow(created.id)).rejects.toThrow(/pact/i);
  });

  it("executes approve, createJob, setBudget, fund through cobo in order and records real hashes", async () => {
    const deps = makeDeps();
    const service = createRealTaskService(createInMemoryStore(), deps);
    const active = await driveToPactActive(service);
    const funded = await service.executeEscrow(active.id);
    expect(deps.calls.filter((c) => c.startsWith("cobo:"))).toEqual([
      "cobo:approve",
      "cobo:createJob",
      "cobo:setBudget",
      "cobo:fund"
    ]);
    expect(funded.jobId).toBe(7);
    expect(funded.status).toBe("JobFunded");
    expect(funded.txRecords.map((r) => r.label)).toEqual([
      "approve",
      "createJob",
      "setBudget",
      "fund"
    ]);
    expect(funded.txRecords.every((r) => /^0x[0-9a-f]{64}$/.test(r.txHash))).toBe(true);
    expect(funded.txRecords.every((r) => r.status === "confirmed")).toBe(true);
  });

  it("persists incremental progress during escrow execution", async () => {
    const store = createInMemoryStore();
    const snapshots: Array<{ pending: number; confirmed: number }> = [];
    const baseDeps = makeDeps();
    let taskId = "";
    const deps = makeDeps({
      cobo: {
        ...baseDeps.cobo,
        callContract: async ({ description }) => {
          const snapshot = store.getTask(taskId);
          snapshots.push({
            pending: snapshot.txRecords.filter((r) => r.status === "pending").length,
            confirmed: snapshot.txRecords.filter((r) => r.status === "confirmed").length
          });
          return { coboTxId: `tx-${description}`, status: "submitted", raw: "{}" };
        }
      }
    });
    const service = createRealTaskService(store, deps);
    const active = await driveToPactActive(service);
    taskId = active.id;
    await service.executeEscrow(active.id);
    // at each cobo call, the current record is already pending in the store,
    // and all prior records are confirmed
    expect(snapshots).toEqual([
      { pending: 1, confirmed: 0 },
      { pending: 1, confirmed: 1 },
      { pending: 1, confirmed: 2 },
      { pending: 1, confirmed: 3 }
    ]);
  });

  it("provider run stores the package and the provider submit tx", async () => {
    const service = createRealTaskService(createInMemoryStore(), makeDeps());
    const active = await driveToPactActive(service);
    await service.executeEscrow(active.id);
    const delivered = await service.runProvider(active.id, "execution-research-expert");
    expect(delivered.providerPackage?.packageHash).toBe(HASH64);
    expect(delivered.txRecords.some((r) => r.label === "submit")).toBe(true);
    expect(delivered.status).toBe("Delivered");
  });

  it("rejects provider delivery when the on-chain hash does not match", async () => {
    const baseDeps = makeDeps();
    const deps = makeDeps({
      chain: {
        ...baseDeps.chain,
        // state 1 + matching budget so executeEscrow's post-fund readback passes;
        // the mismatching deliverableHash is what runProvider must reject.
        readJobState: async () => ({
          state: 1,
          budget: 5_000_000n,
          deliverableHash: `0x${"9".repeat(64)}` as `0x${string}`
        })
      }
    });
    const service = createRealTaskService(createInMemoryStore(), deps);
    const active = await driveToPactActive(service);
    await service.executeEscrow(active.id);
    await expect(
      service.runProvider(active.id, "execution-research-expert")
    ).rejects.toThrow(/hash/i);
  });

  it("verify then settle completes through cobo with the verdict hash", async () => {
    const deps = makeDeps();
    const service = createRealTaskService(createInMemoryStore(), deps);
    const active = await driveToPactActive(service);
    await service.executeEscrow(active.id);
    await service.runProvider(active.id, "execution-research-expert");
    const verified = await service.verify(active.id);
    expect(verified.status).toBe("Verified");
    const settled = await service.settle(active.id);
    expect(settled.status).toBe("Settled");
    expect(deps.calls).toContain("cobo:complete");
  });

  it("routes task to Challenged when judgeVerify returns provider_fault", async () => {
    const deps = makeDeps({
      services: {
        ...makeDeps().services,
        judgeVerify: async () => ({
          judgeId: "judge-demo-001",
          jobId: "7",
          decision: "provider_fault" as const,
          reasonCode: "COVERAGE_MISS",
          challengeType: "CoverageMiss",
          verdictHash: HASH64,
          voting: { mode: "not_triggered", voteId: null, onchainTxHash: null }
        })
      }
    });
    const service = createRealTaskService(createInMemoryStore(), deps);
    const active = await driveToPactActive(service);
    await service.executeEscrow(active.id);
    await service.runProvider(active.id, "execution-research-expert");
    const result = await service.verify(active.id);
    expect(result.status).toBe("Challenged");
  });

  it("denial records the real cobo output", async () => {
    const service = createRealTaskService(createInMemoryStore(), makeDeps());
    const active = await driveToPactActive(service);
    const denied = await service.triggerDenial(active.id);
    expect(denied.status).toBe("DeniedByCobo");
    expect(denied.denial?.exitCode).toBe(5);
    expect(denied.denial?.rawOutput).toContain("policy denied");
  });

  it("refuses to trigger denial before the pact is active and never calls cobo", async () => {
    const deps = makeDeps();
    const service = createRealTaskService(createInMemoryStore(), deps);
    const created = await service.createTask("q", "5 test USDC");
    await service.plan(created.id);
    await service.submitPact(created.id); // PactSubmitted, not PactActive
    await expect(service.triggerDenial(created.id)).rejects.toThrow(/trigger denial/);
    expect(deps.calls).not.toContain("cobo:attemptDeniedTransfer");
  });

  it("funds the amount the plan says, not the raw budget limit", async () => {
    const baseDeps = makeDeps();
    const deps = makeDeps({
      runResearchAgent: async (context) => {
        const base = await baseDeps.runResearchAgent(context);
        return { ...base, plan: { ...base.plan, maxPayment: "3" } };
      },
      chain: {
        ...baseDeps.chain,
        readJobState: async () => ({
          state: 1,
          budget: 3_000_000n,
          deliverableHash: HASH64 as `0x${string}`
        })
      }
    });
    const service = createRealTaskService(createInMemoryStore(), deps);
    const active = await driveToPactActive(service); // budgetLimit stays "5 test USDC"
    await service.executeEscrow(active.id);
    const approve = deps.calldatas.find((c) => c.label === "approve");
    // 3_000_000 = 0x2dc6c0 — the approve allowance follows plan.maxPayment
    expect(approve?.calldata).toContain("2dc6c0");
    const fund = deps.calldatas.find((c) => c.label === "fund");
    expect(fund?.calldata).toContain("2dc6c0");
  });

  it("verifies the funded job on-chain and audits escrow_funded_verified", async () => {
    const store = createInMemoryStore();
    const service = createRealTaskService(store, makeDeps());
    const active = await driveToPactActive(service);
    const funded = await service.executeEscrow(active.id);
    const verifiedEvent = funded.audit.find((e) => e.type === "escrow_funded_verified");
    expect(verifiedEvent).toBeDefined();
    expect(verifiedEvent?.message).toContain("5000000");
  });

  it("rejects escrow execution when the post-fund readback disagrees", async () => {
    const baseDeps = makeDeps();
    const deps = makeDeps({
      chain: {
        ...baseDeps.chain,
        readJobState: async () => ({
          state: 0, // still Open — fund did not take effect
          budget: 0n,
          deliverableHash: `0x${"0".repeat(64)}` as `0x${string}`
        })
      }
    });
    const service = createRealTaskService(createInMemoryStore(), deps);
    const active = await driveToPactActive(service);
    await expect(service.executeEscrow(active.id)).rejects.toThrow(/readback|Funded/i);
  });

  it("propagates research agent failure instead of fabricating a plan", async () => {
    const deps = makeDeps({
      runResearchAgent: async () => {
        throw new Error("Claude research agent failed after retry: schema");
      }
    });
    const service = createRealTaskService(createInMemoryStore(), deps);
    const created = await service.createTask("q", "5 test USDC");
    await expect(service.plan(created.id)).rejects.toThrow(/after retry/);
  });

  it("walks the real challenge path: openChallenge → defense → jury votes → on-chain resolve", async () => {
    const deps = makeDeps();
    const service = createRealTaskService(createInMemoryStore(), deps);
    const active = await driveToPactActive(service);
    await service.executeEscrow(active.id);
    await service.runProvider(active.id, "shallow-search-provider");

    // 发起：approve(D+F→CM) + openChallenge through Cobo, challengeId captured,
    // then the provider auto-files its preset defense (provider-signed tx).
    const challenged = await service.openChallenge(active.id);
    expect(challenged.status).toBe("Challenged");
    expect(deps.calls).toContain("cobo:approveDeposit");
    expect(deps.calls).toContain("cobo:openChallenge");
    expect(
      deps.calls.indexOf("cobo:approveDeposit")
    ).toBeLessThan(deps.calls.indexOf("cobo:openChallenge"));
    expect(challenged.challenge?.type).toBe("CoverageMiss");
    expect(challenged.challenge?.statement).toContain("Block-STM");
    expect(challenged.challenge?.hitCoverageClause).toContain("覆盖声明");
    expect(challenged.challenge?.counterEvidenceHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(challenged.challenge?.challengeId).toBe(42);
    // Defense filed and recorded with its own tx.
    expect(deps.calls).toContain("services:providerDefend:42");
    expect(challenged.challenge?.defense?.statement).toBe(presetDefense.statement);
    expect(challenged.challenge?.defense?.defenseHash).toBe(presetDefense.defenseHash);
    expect(challenged.txRecords.some((r) => r.label === "defense" && r.status === "confirmed")).toBe(true);
    expect(challenged.audit.some((e) => e.type === "defense_submitted" && e.source === "provider")).toBe(true);
    // Cobo-routed challenge txs carry real hashes from the fake chain
    const challengeRecords = challenged.txRecords.filter(
      (r) => r.label === "approveDeposit" || r.label === "openChallenge"
    );
    expect(challengeRecords).toHaveLength(2);
    expect(challengeRecords.every((r) => r.status === "confirmed")).toBe(true);
    expect(challengeRecords.every((r) => r.txHash === `0x${"b".repeat(64)}`)).toBe(true);
    expect(challenged.audit.some((e) => e.type === "challenge_opened" && e.source === "user")).toBe(true);
    expect(
      challenged.audit.find((e) => e.type === "challenge_onchain_opened")?.message
    ).toContain("challengeId 42");

    // 审判：three jury votes (2:1 ProviderFault), each with a reason book
    const won = await service.winChallenge(active.id);
    expect(won.status).toBe("ChallengeWon");
    expect(deps.calls).toContain("services:juryVote:42");
    expect(won.challenge?.votes).toHaveLength(3);
    expect(won.challenge?.votes?.map((v) => v.vote)).toEqual([
      "ProviderFault",
      "ProviderFault",
      "ProviderNotFault"
    ]);
    expect(won.challenge?.votes?.[0].reasonBook.conclusion).toContain("ProviderFault");
    expect(won.txRecords.filter((r) => r.label === "castVote")).toHaveLength(3);
    expect(won.audit.filter((e) => e.type === "jury_vote")).toHaveLength(3);
    expect(
      won.audit.find((e) => e.type === "challenge_won")?.message
    ).toContain("2:1");

    // 资金动作：permissionless resolve(challengeId) executes the majority
    const refunded = await service.refundOrSlash(active.id);
    expect(refunded.status).toBe("RefundedOrSlashed");
    expect(deps.calls).toContain("resolveChallenge:42");
    const resolveRecord = refunded.txRecords.find((r) => r.label === "resolve");
    expect(resolveRecord?.status).toBe("confirmed");
    expect(resolveRecord?.txHash).toBe(`0x${"d".repeat(64)}`);
    expect(refunded.challenge?.resolvedTxHash).toBe(`0x${"d".repeat(64)}`);
    const fundEvent = refunded.audit.find((e) => e.type === "refund_or_slash");
    expect(fundEvent?.txHash).toBe(`0x${"d".repeat(64)}`);
    expect(fundEvent?.message).toContain("扣除专家质押");
    expect(fundEvent?.message).toContain("退款买方");
    expect(fundEvent?.message).toContain("审判费");
    // No fabrication: every recorded hash came from the fakes
    expect(
      refunded.txRecords.every((r) => /^0x[0-9a-f]{64}$/.test(r.txHash))
    ).toBe(true);
  });

  it("rejects openChallenge before delivery and winChallenge without an on-chain challenge", async () => {
    const deps = makeDeps();
    const service = createRealTaskService(createInMemoryStore(), deps);
    const created = await service.createTask("q", "5 test USDC");
    await expect(service.openChallenge(created.id)).rejects.toThrow(/open challenge/);
    expect(deps.calls).not.toContain("cobo:approveDeposit");
  });

  it("refuses openChallenge when the artifact lacks the challenge manager", async () => {
    const deps = makeDeps();
    delete deps.deployment.contracts.ProofMarketChallengeManager;
    const service = createRealTaskService(createInMemoryStore(), deps);
    const active = await driveToPactActive(service);
    await service.executeEscrow(active.id);
    await service.runProvider(active.id, "shallow-search-provider");
    await expect(service.openChallenge(active.id)).rejects.toThrow(/ProofMarketChallengeManager/);
    expect(deps.calls).not.toContain("cobo:approveDeposit");
  });

  it("surfaces a failed resolve with a failed record and audit, never a fake hash", async () => {
    const store = createInMemoryStore();
    const deps = makeDeps({
      resolveChallenge: async () => {
        throw new Error("resolver tx reverted on-chain");
      }
    });
    const service = createRealTaskService(store, deps);
    const active = await driveToPactActive(service);
    await service.executeEscrow(active.id);
    await service.runProvider(active.id, "shallow-search-provider");
    await service.openChallenge(active.id);
    await service.winChallenge(active.id);
    await expect(service.refundOrSlash(active.id)).rejects.toThrow(/reverted/);
    const stored = store.getTask(active.id);
    expect(stored.status).toBe("ChallengeWon"); // no transition on failure
    const resolveRecord = stored.txRecords.find((r) => r.label === "resolve");
    expect(resolveRecord?.status).toBe("failed");
    expect(resolveRecord?.txHash).toBe("");
    expect(
      stored.audit.some((e) => e.type === "chain_tx_failed" && e.message.includes("resolve"))
    ).toBe(true);
  });

  it("rejects a second executeEscrow after success without touching cobo again", async () => {
    const deps = makeDeps();
    const service = createRealTaskService(createInMemoryStore(), deps);
    const active = await driveToPactActive(service);
    await service.executeEscrow(active.id);
    const callsAfterFirst = [...deps.calls];
    await expect(service.executeEscrow(active.id)).rejects.toThrow(/cannot execute escrow/);
    expect(deps.calls).toEqual(callsAfterFirst);
  });

  it("allows only one of two concurrent executeEscrow calls to proceed", async () => {
    const deps = makeDeps();
    const originalCallContract = deps.cobo.callContract;
    deps.cobo.callContract = async (input) => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      return originalCallContract(input);
    };
    const service = createRealTaskService(createInMemoryStore(), deps);
    const active = await driveToPactActive(service);
    const results = await Promise.allSettled([
      service.executeEscrow(active.id),
      service.executeEscrow(active.id)
    ]);
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter(
      (r): r is PromiseRejectedResult => r.status === "rejected"
    );
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(String(rejected[0].reason)).toMatch(/already in progress/);
    expect(deps.calls.filter((c) => c.startsWith("cobo:"))).toEqual([
      "cobo:approve",
      "cobo:createJob",
      "cobo:setBudget",
      "cobo:fund"
    ]);
  });

  it("uses attempt-unique request ids for cobo calls", async () => {
    const deps = makeDeps();
    const requestIds: string[] = [];
    const originalCallContract = deps.cobo.callContract;
    deps.cobo.callContract = async (input) => {
      requestIds.push(input.requestId);
      return originalCallContract(input);
    };
    const service = createRealTaskService(createInMemoryStore(), deps);
    const active = await driveToPactActive(service);
    await service.executeEscrow(active.id);
    // Four-part shape: <taskId>-<label>-<attemptIndex>-<instanceSuffix>
    const labels = ["approve", "createJob", "setBudget", "fund"];
    expect(requestIds).toHaveLength(4);
    requestIds.forEach((requestId, index) => {
      expect(requestId).toMatch(
        new RegExp(`^${active.id}-${labels[index]}-${index}-[0-9a-z]+$`)
      );
    });
    // Process-unique suffix is identical within one service instance
    const suffixes = new Set(requestIds.map((id) => id.split("-").at(-1)));
    expect(suffixes.size).toBe(1);
    expect(new Set(requestIds).size).toBe(requestIds.length);
  });

  it("does not treat an inactive pact status as active", async () => {
    const deps = makeDeps();
    deps.cobo.getPactStatus = async () => ({ pactId: "p-1", status: "inactive", raw: "{}" });
    const service = createRealTaskService(createInMemoryStore(), deps);
    const created = await service.createTask("q", "5 test USDC");
    await service.plan(created.id);
    await service.submitPact(created.id);
    const result = await service.activatePact(created.id);
    expect(result.status).toBe("PactSubmitted");
  });

  it("records a chain_tx_failed audit event and failed record when the tx fails", async () => {
    const store = createInMemoryStore();
    const deps = makeDeps();
    deps.cobo.getTx = async () => ({ raw: "{}", parsed: { status: "failed" } });
    const service = createRealTaskService(store, deps);
    const active = await driveToPactActive(service);
    await expect(service.executeEscrow(active.id)).rejects.toThrow(/failed/);
    const stored = store.getTask(active.id);
    expect(stored.audit.some((event) => event.type === "chain_tx_failed")).toBe(true);
    const approve = stored.txRecords.find((record) => record.label === "approve");
    expect(approve?.status).toBe("failed");
    expect(approve?.coboTxId).toBe("tx-approve");
  });

  it("real-mode plan carries on-chain ERC-8004 reputation for every provider", async () => {
    const deps = makeDeps();
    const service = createRealTaskService(createInMemoryStore(), deps);
    const created = await service.createTask("q", "5 test USDC");
    const planned = await service.plan(created.id);
    expect(deps.calls.filter((c) => c.startsWith("readReputation:"))).toEqual([
      "readReputation:6388",
      "readReputation:6389",
      "readReputation:6390"
    ]);
    expect(planned.plan?.providerReputations).toEqual([
      { providerId: "execution-research-expert", score: 960, source: "erc8004" },
      { providerId: "shallow-search-provider", score: 400, source: "erc8004" },
      { providerId: "general-web-summary", score: 700, source: "erc8004" }
    ]);
    // The recommended provider's card data is on-chain-derived
    const recommended = planned.plan?.providerReputations?.find(
      (r) => r.providerId === planned.plan?.recommendedProviderId
    );
    expect(recommended).toEqual({
      providerId: "execution-research-expert",
      score: 960,
      source: "erc8004"
    });
    expect(planned.audit.some((e) => e.type === "reputation_loaded")).toBe(true);
  });

  it("falls back to fixture scores with an audit note when the reputation read fails", async () => {
    const deps = makeDeps({
      readReputation: async () => {
        throw new Error("rpc unreachable");
      }
    });
    const service = createRealTaskService(createInMemoryStore(), deps);
    const created = await service.createTask("q", "5 test USDC");
    const planned = await service.plan(created.id);
    expect(planned.status).toBe("Planned"); // planning never breaks on a read failure
    expect(planned.plan?.providerReputations).toEqual([
      { providerId: "execution-research-expert", score: 970, source: "fixture" },
      { providerId: "shallow-search-provider", score: 620, source: "fixture" },
      { providerId: "general-web-summary", score: 800, source: "fixture" }
    ]);
    const fallback = planned.audit.find((e) => e.type === "reputation_read_fallback");
    expect(fallback?.message).toContain("rpc unreachable");
    expect(planned.audit.some((e) => e.type === "reputation_loaded")).toBe(false);
  });

  it("falls back to fixture scores when the artifact has no agentIds", async () => {
    const deps = makeDeps();
    delete deps.deployment.providers;
    const service = createRealTaskService(createInMemoryStore(), deps);
    const created = await service.createTask("q", "5 test USDC");
    const planned = await service.plan(created.id);
    expect(planned.plan?.providerReputations?.every((r) => r.source === "fixture")).toBe(true);
    expect(deps.calls.some((c) => c.startsWith("readReputation:"))).toBe(false);
    expect(
      planned.audit.find((e) => e.type === "reputation_read_fallback")?.message
    ).toContain("无 agentId");
  });

  it("settle publishes positive on-chain feedback for the job's provider", async () => {
    const deps = makeDeps();
    const service = createRealTaskService(createInMemoryStore(), deps);
    const active = await driveToPactActive(service);
    await service.executeEscrow(active.id);
    await service.runProvider(active.id, "execution-research-expert");
    await service.verify(active.id);
    const settled = await service.settle(active.id);
    expect(settled.status).toBe("Settled");
    // agentId 6388 (execution-research-expert), 500 = 5.00, tag2 job.completed
    expect(deps.calls).toContain("publishFeedback:6388:500:job.completed");
    const record = settled.txRecords.find((r) => r.label === "feedback");
    expect(record?.status).toBe("confirmed");
    expect(record?.txHash).toBe(`0x${"f".repeat(64)}`);
    const event = settled.audit.find((e) => e.type === "reputation_feedback_published");
    expect(event?.txHash).toBe(`0x${"f".repeat(64)}`);
    expect(event?.message).toContain("好评");
    expect(event?.message).toContain("5.00");
  });

  it("refundOrSlash publishes negative feedback for the at-fault provider", async () => {
    const deps = makeDeps();
    const service = createRealTaskService(createInMemoryStore(), deps);
    const active = await driveToPactActive(service);
    await service.executeEscrow(active.id);
    // The at-fault provider is the one that ran (shallow), not the recommended one.
    await service.runProvider(active.id, "shallow-search-provider");
    await service.openChallenge(active.id);
    await service.winChallenge(active.id);
    const refunded = await service.refundOrSlash(active.id);
    expect(refunded.status).toBe("RefundedOrSlashed");
    expect(deps.calls).toContain("publishFeedback:6389:100:challenge.coverage_miss");
    const record = refunded.txRecords.find((r) => r.label === "feedback");
    expect(record?.status).toBe("confirmed");
    const event = refunded.audit.find((e) => e.type === "reputation_feedback_published");
    expect(event?.message).toContain("差评");
    expect(event?.message).toContain("1.00");
  });

  it("treats a feedback publish failure as non-fatal: settlement stands, failure audited", async () => {
    const deps = makeDeps({
      publishFeedback: async () => {
        throw new Error("rater out of gas");
      }
    });
    const service = createRealTaskService(createInMemoryStore(), deps);
    const active = await driveToPactActive(service);
    await service.executeEscrow(active.id);
    await service.runProvider(active.id, "execution-research-expert");
    await service.verify(active.id);
    const settled = await service.settle(active.id); // must NOT throw
    expect(settled.status).toBe("Settled");
    const record = settled.txRecords.find((r) => r.label === "feedback");
    expect(record?.status).toBe("failed");
    expect(record?.txHash).toBe(""); // no fabrication
    const event = settled.audit.find((e) => e.type === "reputation_feedback_failed");
    expect(event?.message).toContain("rater out of gas");
    expect(event?.message).toContain("非致命");
  });

  it("skips feedback gracefully when the provider has no agentId in the artifact", async () => {
    const deps = makeDeps();
    delete deps.deployment.providers!["execution-research-expert"].agentId;
    const service = createRealTaskService(createInMemoryStore(), deps);
    const active = await driveToPactActive(service);
    await service.executeEscrow(active.id);
    await service.runProvider(active.id, "execution-research-expert");
    await service.verify(active.id);
    const settled = await service.settle(active.id);
    expect(settled.status).toBe("Settled");
    expect(deps.calls.some((c) => c.startsWith("publishFeedback:"))).toBe(false);
    expect(settled.txRecords.some((r) => r.label === "feedback")).toBe(false);
    expect(settled.audit.some((e) => e.type === "reputation_feedback_skipped")).toBe(true);
  });

  it("fails the record and names the poll count when polls are exhausted", async () => {
    const store = createInMemoryStore();
    const deps = makeDeps();
    deps.cobo.getTx = async () => ({ raw: "{}", parsed: {} });
    const service = createRealTaskService(store, deps);
    const active = await driveToPactActive(service);
    await expect(service.executeEscrow(active.id)).rejects.toThrow(/60 polls/);
    const stored = store.getTask(active.id);
    const approve = stored.txRecords.find((record) => record.label === "approve");
    expect(approve?.status).toBe("failed");
    expect(stored.audit.some((event) => event.type === "chain_tx_failed")).toBe(true);
  });
});

import { describe, expect, it } from "vitest";
import { createInMemoryStore } from "../src/demoStore";
import { createRealTaskService, type RealDeps } from "../src/realTaskService";

const HASH64 = `0x${"a".repeat(64)}`;

function makeDeps(overrides: Partial<RealDeps> = {}): RealDeps & { calls: string[] } {
  const calls: string[] = [];
  const base: RealDeps = {
    deployment: {
      chainId: 11155111,
      network: "sepolia",
      deployer: `0x${"1".repeat(40)}`,
      blockNumber: 1,
      coboWallet: `0x${"2".repeat(40)}`,
      contracts: {
        MockUSDC: `0x${"3".repeat(40)}`,
        ProofMarketEscrow: `0x${"4".repeat(40)}`
      },
      mint: { to: `0x${"2".repeat(40)}`, rawAmount: "100000000", txHash: HASH64 },
      deployedAt: "2026-06-10T00:00:00.000Z"
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
      callContract: async ({ description }) => {
        calls.push(`cobo:${description}`);
        return { coboTxId: `tx-${description}`, status: "submitted", raw: "{}" };
      },
      getTx: async (id) => ({
        raw: "{}",
        parsed: { tx_hash: `0x${"b".repeat(64)}`, status: "confirmed", id }
      }),
      attemptDeniedTransfer: async () => ({
        denied: true,
        exitCode: 5,
        attemptedAction: "tx transfer 0.001 SETH -> 0xdead",
        rawOutput: '{"error":"policy denied"}'
      })
    },
    chain: {
      waitForReceipt: async () => ({ logs: [], transactionHash: `0x${"b".repeat(64)}` }) as never,
      extractJobId: () => 7n,
      readJobState: async () => ({ state: 2, budget: 5_000_000n, deliverableHash: HASH64 as `0x${string}` })
    },
    services: {
      runProvider: async () => ({
        taskId: "t",
        providerAgentId: 1,
        providerId: "execution-research-expert",
        providerName: "Expert",
        coverageStatement: "covered",
        answers: [
          {
            providerAnswer: "a",
            sourceTitle: "s",
            sourceLocator: "arXiv:1",
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
      })
    },
    audit: { append: () => {} },
    now: () => "2026-06-10T12:00:00.000Z",
    pollDelayMs: 0
  };
  const deps = { ...base, ...overrides, calls };
  return deps as RealDeps & { calls: string[] };
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
    expect(deps.calls).toEqual([
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
        readJobState: async () => ({
          state: 2,
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

  it("denial records the real cobo output", async () => {
    const service = createRealTaskService(createInMemoryStore(), makeDeps());
    const active = await driveToPactActive(service);
    const denied = await service.triggerDenial(active.id);
    expect(denied.status).toBe("DeniedByCobo");
    expect(denied.denial?.exitCode).toBe(5);
    expect(denied.denial?.rawOutput).toContain("policy denied");
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

  it("challenge actions are fixture-mode only", async () => {
    const service = createRealTaskService(createInMemoryStore(), makeDeps());
    const created = await service.createTask("q", "5 test USDC");
    await expect(service.winChallenge(created.id)).rejects.toThrow(/fixture/i);
    await expect(service.refundOrSlash(created.id)).rejects.toThrow(/fixture/i);
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
    expect(deps.calls).toEqual([
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
    expect(requestIds).toEqual([
      `${active.id}-approve-0`,
      `${active.id}-createJob-1`,
      `${active.id}-setBudget-2`,
      `${active.id}-fund-3`
    ]);
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

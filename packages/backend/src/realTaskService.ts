import {
  encodeApprove,
  encodeComplete,
  encodeCreateJob,
  encodeFund,
  encodeSetBudget
} from "@proofmarket/chain/src/calldata";
import { buildRealPactSubmission } from "@proofmarket/cobo/src/pactPolicy";
import { createAuditEvent } from "@proofmarket/shared/src/audit";
import { providerProfiles } from "@proofmarket/shared/src/fixtures";
import { stableHash } from "@proofmarket/shared/src/hash";
import type {
  CoboDenialRecord,
  DeploymentArtifact,
  ResearchPlanOutput,
  TxRecord
} from "@proofmarket/shared/src/realMode";
import { assertTransition } from "@proofmarket/shared/src/stateMachine";
import type {
  AuditEvent,
  AuditResult,
  AuditSource,
  PactSummary,
  ProcurementPlan,
  ProviderAnswerPackage,
  ProviderId,
  Task,
  TaskStatus
} from "@proofmarket/shared/src/types";
import type { InMemoryStore } from "./demoStore";
import type { TaskService } from "./taskService";

export type RealDeps = {
  deployment: DeploymentArtifact;
  providerAddress: string;
  runResearchAgent(context: {
    taskId: string;
    question: string;
    budgetAmount: string;
    providerCatalog: Array<{
      providerId: string;
      displayName: string;
      specialties: string[];
      price: string;
    }>;
    pactSummary: string;
  }): Promise<{ plan: ResearchPlanOutput; rawStdout: string; attempts: number }>;
  cobo: {
    submitPact(submission: unknown): Promise<{ pactId: string; status: string; raw: string }>;
    getPactStatus(pactId: string): Promise<{ pactId: string; status: string; raw: string }>;
    callContract(input: {
      pactId: string;
      contract: string;
      calldata: string;
      requestId: string;
      description: string;
    }): Promise<{ coboTxId: string; status: string; raw: string }>;
    getTx(coboTxId: string): Promise<{ raw: string; parsed: Record<string, unknown> }>;
    attemptDeniedTransfer(input: {
      pactId: string;
      dstAddress: string;
      amount: string;
    }): Promise<CoboDenialRecord>;
  };
  chain: {
    waitForReceipt(
      txHash: `0x${string}`
    ): Promise<{ logs: unknown[]; transactionHash: string }>;
    extractJobId(receipt: unknown, escrowAddress: string): bigint;
    readJobState(
      escrowAddress: `0x${string}`,
      jobId: bigint
    ): Promise<{ state: number; budget: bigint; deliverableHash: `0x${string}` }>;
  };
  services: {
    runProvider(input: {
      taskId: string;
      jobId: string;
      providerId: ProviderId;
      question: string;
    }): Promise<ProviderAnswerPackage>;
    submitDeliverable(input: {
      jobId: string;
      deliverableHash: string;
    }): Promise<{ txHash: string }>;
    judgeVerify(input: {
      taskId: string;
      jobId: string;
      evidencePackageHash: string;
      evidencePackage: unknown;
      successCriteria: string[];
    }): Promise<{
      judgeId: string;
      jobId: string;
      decision: "valid" | "invalid";
      reasonCode: string;
      verdictHash: string;
      voting: { mode: string; voteId: string | null; onchainTxHash: string | null };
    }>;
  };
  audit: { append(taskId: string, event: unknown): void };
  now(): string;
  pollDelayMs?: number; // injectable; 0 in tests, ~5000 in prod
};

const TX_HASH_PATTERN = /^0x[0-9a-fA-F]{64}$/;
const MAX_TX_POLLS = 60;
const FAILED_TX_STATUSES = new Set(["failed", "rejected", "denied"]);

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function truncate(text: string, maxLength = 300): string {
  return text.length <= maxLength ? text : `${text.slice(0, maxLength)}…`;
}

/** "5 test USDC" -> "5"; "0.5 mUSDC" -> "0.5" */
function leadingDecimal(budgetLimit: string): string {
  const match = budgetLimit.match(/^\s*(\d+(?:\.\d+)?)/);
  if (!match) {
    throw new Error(`Cannot derive a budget amount from "${budgetLimit}"`);
  }
  return match[1];
}

export function createRealTaskService(store: InMemoryStore, deps: RealDeps): TaskService {
  let taskCounter = 0;
  let auditCounter = 0;
  // Judge verdict hashes live only between verify() and settle() in one process.
  const verdicts = new Map<string, string>();
  // Re-entry guard: task ids with a money-moving operation currently in flight.
  const inFlight = new Set<string>();

  const escrowAddress = deps.deployment.contracts.ProofMarketEscrow as `0x${string}`;
  const tokenAddress = deps.deployment.contracts.MockUSDC as `0x${string}`;
  const pollDelayMs = deps.pollDelayMs ?? 5000;

  function nextId(prefix: string, counter: number): string {
    return `${prefix}_${counter.toString().padStart(3, "0")}`;
  }

  function nextTaskId(): string {
    taskCounter += 1;
    return nextId("task", taskCounter);
  }

  function audit(input: {
    taskId: string;
    source: AuditSource;
    type: string;
    result: AuditResult;
    message: string;
    txHash?: string | null;
    pactId?: string | null;
    jobId?: number | null;
  }): AuditEvent {
    auditCounter += 1;
    return createAuditEvent({
      id: nextId("audit", auditCounter),
      createdAt: deps.now(),
      ...input
    });
  }

  /** Appends to the task's audit array AND mirrors to the external audit sink. */
  function withAudit(task: Task, event: AuditEvent): Task {
    deps.audit.append(task.id, event);
    return {
      ...task,
      audit: [...task.audit, event],
      updatedAt: deps.now()
    };
  }

  function save(task: Task): Task {
    return store.saveTask(task);
  }

  /** Status gate: every method calls this FIRST, before any external side effect. */
  function assertStatus(task: Task, expected: TaskStatus[], action: string): void {
    if (!expected.includes(task.status)) {
      throw new Error(`cannot ${action} from status ${task.status}`);
    }
  }

  function transition(task: Task, status: TaskStatus): Task {
    assertTransition(task.status, status);
    return {
      ...task,
      status,
      updatedAt: deps.now()
    };
  }

  function extractTxHash(parsed: Record<string, unknown>): string | null {
    const candidate = parsed.tx_hash ?? parsed.transaction_hash;
    if (typeof candidate === "string" && TX_HASH_PATTERN.test(candidate)) {
      return candidate;
    }
    return null;
  }

  function isFailedTxStatus(parsed: Record<string, unknown>): boolean {
    return (
      typeof parsed.status === "string" &&
      FAILED_TX_STATUSES.has(parsed.status.toLowerCase())
    );
  }

  /**
   * Executes one contract call through Cobo, persisting incremental progress:
   * the record is saved as pending before the call, and confirmed (or failed)
   * as soon as the chain settles it.
   */
  async function coboCall(
    taskRef: { task: Task },
    label: TxRecord["label"],
    contract: string,
    calldata: string
  ): Promise<{ logs: unknown[]; transactionHash: string }> {
    const pactId = taskRef.task.pact?.pactId;
    if (!pactId) {
      throw new Error("Cannot execute a Cobo call without a pact");
    }

    // Attempt-unique idempotency suffix: a retried label gets a new index
    // because the failed record from the previous attempt stays in txRecords.
    const attemptIndex = taskRef.task.txRecords.length;
    const pending: TxRecord = { label, coboTxId: null, txHash: "", status: "pending" };
    taskRef.task = save({
      ...taskRef.task,
      txRecords: [...taskRef.task.txRecords, pending],
      updatedAt: deps.now()
    });
    const recordIndex = taskRef.task.txRecords.length - 1;

    function patchRecord(patch: Partial<TxRecord>): void {
      const txRecords = taskRef.task.txRecords.map((record, index) =>
        index === recordIndex ? { ...record, ...patch } : record
      );
      taskRef.task = save({ ...taskRef.task, txRecords, updatedAt: deps.now() });
    }

    function auditFailure(error: unknown): void {
      taskRef.task = save(
        withAudit(
          taskRef.task,
          audit({
            taskId: taskRef.task.id,
            source: "chain",
            type: "chain_tx_failed",
            result: "failed",
            message: `${label} failed: ${error instanceof Error ? error.message : String(error)}`,
            pactId,
            jobId: taskRef.task.jobId
          })
        )
      );
    }

    let call: { coboTxId: string; status: string; raw: string };
    try {
      call = await deps.cobo.callContract({
        pactId,
        contract,
        calldata,
        requestId: `${taskRef.task.id}-${label}-${attemptIndex}`,
        description: label
      });
    } catch (error) {
      patchRecord({ status: "failed" });
      auditFailure(error);
      throw error;
    }
    // Persist the Cobo identifier immediately so a crash mid-poll is traceable.
    patchRecord({ coboTxId: call.coboTxId });

    let txHash: string | null = null;
    for (let attempt = 0; attempt < MAX_TX_POLLS; attempt += 1) {
      const { parsed } = await deps.cobo.getTx(call.coboTxId);
      if (isFailedTxStatus(parsed)) {
        patchRecord({ status: "failed" });
        const error = new Error(
          `Cobo transaction ${call.coboTxId} (${label}) failed with status ${String(parsed.status)}`
        );
        auditFailure(error);
        throw error;
      }
      txHash = extractTxHash(parsed);
      if (txHash) break;
      await delay(pollDelayMs);
    }
    if (!txHash) {
      patchRecord({ status: "failed" });
      const error = new Error(
        `Cobo transaction ${call.coboTxId} (${label}) produced no tx hash after ${MAX_TX_POLLS} polls`
      );
      auditFailure(error);
      throw error;
    }

    // Persist the tx hash before waiting for the receipt: if waitForReceipt
    // throws, the record keeps both identifiers (still pending — the tx may
    // have landed on chain).
    patchRecord({ txHash });

    let receipt: { logs: unknown[]; transactionHash: string };
    try {
      receipt = await deps.chain.waitForReceipt(txHash as `0x${string}`);
    } catch (error) {
      auditFailure(error);
      throw error;
    }

    patchRecord({ status: "confirmed" });
    taskRef.task = save(
      withAudit(
        taskRef.task,
        audit({
          taskId: taskRef.task.id,
          source: "chain",
          type: "chain_tx_confirmed",
          result: "success",
          message: `${label} confirmed on Sepolia.`,
          txHash,
          pactId,
          jobId: taskRef.task.jobId
        })
      )
    );

    return receipt;
  }

  return {
    async getTask(id: string): Promise<Task> {
      return store.getTask(id);
    },

    async listTasks(): Promise<Task[]> {
      return store.listTasks();
    },

    async createTask(question: string, budget: string): Promise<Task> {
      const timestamp = deps.now();
      const id = nextTaskId();
      const task: Task = {
        id,
        userQuestion: question,
        status: "Created",
        budgetLimit: budget,
        selectedProviderIds: [],
        plan: null,
        pact: null,
        providerPackage: null,
        audit: [],
        jobId: null,
        mode: "real",
        txRecords: [],
        claudePlanRaw: null,
        denial: null,
        createdAt: timestamp,
        updatedAt: timestamp
      };

      return save(
        withAudit(
          task,
          audit({
            taskId: id,
            source: "user",
            type: "task_created",
            result: "success",
            message: `User created task with budget ${budget}.`
          })
        )
      );
    },

    async plan(id: string): Promise<Task> {
      const task = store.getTask(id);
      assertStatus(task, ["Created"], "plan");
      const budgetAmount = leadingDecimal(task.budgetLimit);
      const providerCatalog = providerProfiles.map((profile) => ({
        providerId: profile.id,
        displayName: profile.name,
        specialties: [profile.coverage],
        price: profile.price
      }));
      const pactSummary =
        "A Cobo pact restricts execution to the ProofMarketEscrow and MockUSDC contracts on Sepolia, " +
        "with a cap of 7 transactions and a 90 minute expiry.";

      // On research agent failure: rethrow untouched — never fabricate a plan.
      const { plan, rawStdout } = await deps.runResearchAgent({
        taskId: task.id,
        question: task.userQuestion,
        budgetAmount,
        providerCatalog,
        pactSummary
      });

      const recommendedProfile = providerProfiles.find(
        (profile) => profile.id === plan.recommendedProviderId
      );
      const procurementPlan: ProcurementPlan = {
        taskId: task.id,
        userQuestion: task.userQuestion,
        evidenceNeed: plan.reason,
        totalBudget: `${plan.maxPayment} mUSDC`,
        perJobCap: `${plan.maxPayment} mUSDC`,
        recommendedProviderId: plan.recommendedProviderId as ProviderId,
        providerCount: 3,
        coverage: recommendedProfile?.coverage ?? "specialist evidence coverage",
        returnType: "provider-answer-package",
        verificationMethod: "deterministic judge endpoint"
      };

      const planned = transition(
        {
          ...task,
          plan: procurementPlan,
          claudePlanRaw: rawStdout,
          selectedProviderIds: providerProfiles.map((profile) => profile.id)
        },
        "Planned"
      );

      return save(
        withAudit(
          planned,
          audit({
            taskId: id,
            source: "research-agent",
            type: "procurement_plan_created",
            result: "success",
            message:
              `Claude research agent recommended ${plan.recommendedProviderId} ` +
              `(max payment ${plan.maxPayment} mUSDC): ${plan.reason}`
          })
        )
      );
    },

    async submitPact(id: string): Promise<Task> {
      const task = store.getTask(id);
      assertStatus(task, ["Planned"], "submit pact");
      const budgetAmount = leadingDecimal(task.budgetLimit);
      const submission = buildRealPactSubmission({
        escrowAddress,
        tokenAddress,
        budgetAmount,
        taskId: task.id
      });

      const result = await deps.cobo.submitPact(submission);
      const pact: PactSummary = {
        intent: submission.intent,
        totalBudget: `${budgetAmount} mUSDC`,
        perJobCap: `${budgetAmount} mUSDC`,
        allowedTargets: [escrowAddress, tokenAddress],
        allowedFunctions: ["approve", "createJob", "setBudget", "fund", "complete"],
        denyRules: [
          "direct transfers denied by default (no transfer policy)",
          "max 7 txs",
          "expires 90 min"
        ],
        expiresInMinutes: 90,
        pactId: result.pactId,
        // Even if Cobo auto-approves immediately, stay in PactSubmitted here;
        // activatePact is the explicit activation gate. Strict equality so
        // "inactive"/"deactivated" never read as active.
        status: result.status.trim().toLowerCase() === "active" ? "active" : "submitted"
      };

      const submitted = transition(
        {
          ...task,
          pact
        },
        "PactSubmitted"
      );

      return save(
        withAudit(
          submitted,
          audit({
            taskId: id,
            source: "cobo",
            type: "pact_submitted",
            result: "success",
            message: `Submitted pact ${pact.pactId} (status ${result.status}). Raw: ${truncate(result.raw)}`,
            pactId: pact.pactId
          })
        )
      );
    },

    async activatePact(id: string): Promise<Task> {
      const task = store.getTask(id);
      if (!task.pact) {
        throw new Error("Cannot activate pact before submission");
      }

      const status = await deps.cobo.getPactStatus(task.pact.pactId);
      // Strict equality: "inactive"/"deactivated" must NOT count as active.
      const isActive = status.status.trim().toLowerCase() === "active";
      if (!isActive) {
        return save(
          withAudit(
            task,
            audit({
              taskId: id,
              source: "cobo",
              type: "pact_activation_pending",
              result: "pending",
              message:
                `Pact ${task.pact.pactId} is not active yet (status ${status.status}). ` +
                `Raw: ${truncate(status.raw)}`,
              pactId: task.pact.pactId
            })
          )
        );
      }

      const activated = transition(
        {
          ...task,
          pact: { ...task.pact, status: "active" }
        },
        "PactActive"
      );

      return save(
        withAudit(
          activated,
          audit({
            taskId: id,
            source: "cobo",
            type: "pact_activated",
            result: "success",
            message: `Pact ${task.pact.pactId} is active.`,
            pactId: task.pact.pactId
          })
        )
      );
    },

    async executeEscrow(id: string): Promise<Task> {
      const task = store.getTask(id);
      // Both pre-states are legal per the state machine (DeniedByCobo -> JobFunded).
      assertStatus(task, ["PactActive", "DeniedByCobo"], "execute escrow");
      if (inFlight.has(id)) {
        throw new Error("operation already in progress for this task");
      }
      inFlight.add(id);
      try {
        if (task.pact?.status !== "active") {
          throw new Error("pact not active — approve it first");
        }
        if (!task.plan) {
          throw new Error("Cannot execute escrow without a procurement plan");
        }

        const budgetAmount = leadingDecimal(task.budgetLimit);
        const budgetRaw = BigInt(Math.round(Number(budgetAmount) * 1e6));
        const taskRef = { task };

        await coboCall(
          taskRef,
          "approve",
          tokenAddress,
          encodeApprove(escrowAddress, budgetRaw)
        );

        const unixNow = Math.floor(Date.parse(deps.now()) / 1000);
        const createJobReceipt = await coboCall(
          taskRef,
          "createJob",
          escrowAddress,
          encodeCreateJob({
            providerAgentId: 1n,
            provider: deps.providerAddress as `0x${string}`,
            verifierAgentId: 3n,
            evaluator: deps.deployment.coboWallet as `0x${string}`,
            token: tokenAddress,
            expiredAt: BigInt(unixNow + 7200),
            descriptionHash: stableHash({
              taskId: task.id,
              question: task.userQuestion
            }) as `0x${string}`,
            coverageHash: stableHash({ coverage: task.plan.coverage }) as `0x${string}`
          })
        );

        const jobId = deps.chain.extractJobId(createJobReceipt, escrowAddress);
        taskRef.task = save({
          ...taskRef.task,
          jobId: Number(jobId),
          updatedAt: deps.now()
        });

        await coboCall(taskRef, "setBudget", escrowAddress, encodeSetBudget(jobId, budgetRaw));
        await coboCall(taskRef, "fund", escrowAddress, encodeFund(jobId, budgetRaw));

        const funded = transition(taskRef.task, "JobFunded");

        return save(
          withAudit(
            funded,
            audit({
              taskId: id,
              source: "cobo",
              type: "escrow_executed",
              result: "success",
              message: `Escrow job ${jobId} funded with ${budgetAmount} mUSDC on Sepolia.`,
              pactId: task.pact.pactId,
              jobId: Number(jobId)
            })
          )
        );
      } finally {
        inFlight.delete(id);
      }
    },

    async triggerDenial(id: string): Promise<Task> {
      const task = store.getTask(id);
      if (!task.pact) {
        throw new Error("Cannot trigger a denial demo without a pact");
      }

      const denial = await deps.cobo.attemptDeniedTransfer({
        pactId: task.pact.pactId,
        dstAddress: "0x000000000000000000000000000000000000dEaD",
        amount: "0.001"
      });

      const denied = transition(
        {
          ...task,
          denial
        },
        "DeniedByCobo"
      );

      return save(
        withAudit(
          denied,
          audit({
            taskId: id,
            source: "cobo",
            type: "escrow_denied",
            result: "denied",
            message:
              `Cobo denied ${denial.attemptedAction} (exit code ${denial.exitCode}). ` +
              `Raw output: ${truncate(denial.rawOutput)}`,
            pactId: task.pact.pactId
          })
        )
      );
    },

    async runProvider(id: string, providerId: ProviderId): Promise<Task> {
      const task = store.getTask(id);
      assertStatus(task, ["JobFunded"], "run provider");
      if (task.jobId === null) {
        throw new Error("Cannot run provider before the job is funded");
      }
      const jobId = String(task.jobId);

      const providerPackage = await deps.services.runProvider({
        taskId: task.id,
        jobId,
        providerId,
        question: task.userQuestion
      });

      let current = save(
        withAudit(
          { ...task, providerPackage, updatedAt: deps.now() },
          audit({
            taskId: id,
            source: "provider",
            type: "provider_package_delivered",
            result: "success",
            message: `Provider ${providerId} delivered package ${providerPackage.packageHash}.`,
            jobId: task.jobId
          })
        )
      );

      const submitted = await deps.services.submitDeliverable({
        jobId,
        deliverableHash: providerPackage.packageHash
      });
      const submitRecord: TxRecord = {
        label: "submit",
        coboTxId: null,
        txHash: submitted.txHash,
        status: "confirmed"
      };
      current = save(
        withAudit(
          {
            ...current,
            txRecords: [...current.txRecords, submitRecord],
            updatedAt: deps.now()
          },
          audit({
            taskId: id,
            source: "chain",
            type: "deliverable_submitted",
            result: "success",
            message: `Provider submitted deliverable hash ${providerPackage.packageHash} on-chain.`,
            txHash: submitted.txHash,
            jobId: task.jobId
          })
        )
      );

      // Integrity check: never trust the service response alone — the chain is the source of truth.
      const jobState = await deps.chain.readJobState(escrowAddress, BigInt(task.jobId));
      if (jobState.deliverableHash.toLowerCase() !== providerPackage.packageHash.toLowerCase()) {
        throw new Error(
          `on-chain deliverable hash mismatch: chain has ${jobState.deliverableHash}, ` +
            `provider package is ${providerPackage.packageHash}`
        );
      }

      return save(transition(current, "Delivered"));
    },

    async verify(id: string): Promise<Task> {
      const task = store.getTask(id);
      assertStatus(task, ["Delivered"], "verify");
      if (!task.providerPackage) {
        throw new Error("Cannot verify before provider delivery");
      }

      const verdict = await deps.services.judgeVerify({
        taskId: task.id,
        jobId: String(task.jobId),
        evidencePackageHash: task.providerPackage.packageHash,
        evidencePackage: task.providerPackage,
        successCriteria: [
          "at least 3 evidence items",
          "every item has a source locator",
          "answer explains evidence relevance"
        ]
      });

      verdicts.set(task.id, verdict.verdictHash);
      const nextStatus: TaskStatus = verdict.decision === "valid" ? "Verified" : "Challenged";
      const verified = transition(task, nextStatus);

      return save(
        withAudit(
          verified,
          audit({
            taskId: id,
            source: "verifier",
            type: verdict.decision === "valid" ? "verification_passed" : "verification_failed",
            result: verdict.decision === "valid" ? "success" : "failed",
            message:
              `Judge ${verdict.judgeId} decided ${verdict.decision} ` +
              `(${verdict.reasonCode}) verdictHash=${verdict.verdictHash}`,
            jobId: task.jobId
          })
        )
      );
    },

    async settle(id: string): Promise<Task> {
      const task = store.getTask(id);
      assertStatus(task, ["Verified"], "settle");
      if (inFlight.has(id)) {
        throw new Error("operation already in progress for this task");
      }
      inFlight.add(id);
      try {
        if (task.jobId === null) {
          throw new Error("Cannot settle before verification");
        }
        const verdictHash = verdicts.get(task.id);
        if (!verdictHash) {
          throw new Error("No judge verdict hash recorded for this task");
        }

        const taskRef = { task };
        await coboCall(
          taskRef,
          "complete",
          escrowAddress,
          encodeComplete(BigInt(task.jobId), verdictHash as `0x${string}`)
        );

        const settled = transition(taskRef.task, "Settled");

        return save(
          withAudit(
            settled,
            audit({
              taskId: id,
              source: "settlement",
              type: "settled",
              result: "success",
              message: `Provider payment settled with verdict hash ${verdictHash}.`,
              jobId: task.jobId
            })
          )
        );
      } finally {
        inFlight.delete(id);
      }
    },

    async winChallenge(): Promise<Task> {
      throw new Error("challenge path is fixture-mode only in this demo");
    },

    async refundOrSlash(): Promise<Task> {
      throw new Error("challenge path is fixture-mode only in this demo");
    }
  };
}

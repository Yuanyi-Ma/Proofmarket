import {
  ChallengeType,
  encodeApprove,
  encodeComplete,
  encodeCreateJob,
  encodeFund,
  encodeOpenChallenge,
  encodeSetBudget
} from "@proofmarket/chain/src/calldata";
import { buildRealPactSubmission } from "@proofmarket/cobo/src/pactPolicy";
import { createAuditEvent } from "@proofmarket/shared/src/audit";
import {
  presetChallengeDocument,
  presetCounterEvidence,
  providerProfiles
} from "@proofmarket/shared/src/fixtures";
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
  JuryVote,
  PactSummary,
  ProcurementPlan,
  ProviderAnswerPackage,
  ProviderId,
  ProviderReputation,
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
    extractChallengeId(receipt: unknown, challengeManagerAddress: string): bigint;
    readJobState(
      escrowAddress: `0x${string}`,
      jobId: bigint
    ): Promise<{ state: number; budget: bigint; deliverableHash: `0x${string}` }>;
  };
  /**
   * Executes ChallengeManager.resolve(challengeId) with the backend's resolver
   * key. v2: permissionless majority execution — the outcome comes from the
   * on-chain juror votes, not from this call. Does NOT go through Cobo.
   */
  resolveChallenge(input: { challengeId: bigint }): Promise<{ txHash: string }>;
  /**
   * Publishes ERC-8004 reputation feedback signed directly by the rater key
   * (PROVIDER_SIGNER — must NOT be the agent owner), not Cobo. `value` is on
   * the 0-500 raw scale (valueDecimals 2 → 500 = 5.00/5.00).
   */
  publishFeedback(input: {
    agentId: number;
    value: number;
    tag2: string;
  }): Promise<{ txHash: string }>;
  /**
   * Reads the ERC-8004 reputation summary for an agent, already mapped to the
   * fixture 0-1000 display scale. Throws on RPC failure or when the agent has
   * no on-chain feedback — the caller falls back to the fixture score.
   */
  readReputation(agentId: number): Promise<{ score: number }>;
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
      decision: "valid" | "provider_fault";
      reasonCode: string;
      verdictHash: string;
      voting: { mode: string; voteId: string | null; onchainTxHash: string | null };
    }>;
    /**
     * Provider's defense filing (preset content, real provider-signed
     * submitDefense tx). Returns the plaintext for the audit/UI layer.
     */
    providerDefend(input: { challengeId: string }): Promise<{
      statement: string;
      defenseHash: string;
      txHash: string;
    }>;
    /**
     * The jury panel: waits out the defense window R_w, then casts three real
     * castVote transactions (preset 2:1 verdict) and returns the reasoned
     * votes in casting order.
     */
    juryVote(input: { challengeId: string; openedAtMs: number }): Promise<{
      votes: (JuryVote & { txHash: string })[];
    }>;
  };
  audit: { append(taskId: string, event: unknown): void };
  now(): string;
  pollDelayMs?: number; // injectable; 0 in tests, ~5000 in prod
};

const TX_HASH_PATTERN = /^0x[0-9a-fA-F]{64}$/;
const MAX_TX_POLLS = 60;
const FAILED_TX_STATUSES = new Set(["failed", "rejected", "denied"]);

// ERC-8004 feedback values, valueDecimals=2 (500 → 5.00 on a 0-5 scale).
const FEEDBACK_POSITIVE_VALUE = 500; // job settled successfully
const FEEDBACK_NEGATIVE_VALUE = 100; // challenge upheld against the provider

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
  // Per-instance suffix so requestIds stay unique across process restarts:
  // a restarted server replays task/attempt counters from zero, and Cobo
  // deduplicates by requestId — a reused id would silently drop the call.
  const instanceSuffix = Date.now().toString(36);
  // Judge verdict hashes live only between verify() and settle() in one process.
  const verdicts = new Map<string, string>();
  // Wall-clock time openChallenge confirmed, per task — the jury service uses
  // it to sleep out the defense window R_w before casting votes.
  const challengeOpenedAt = new Map<string, number>();
  // Re-entry guard: task ids with a money-moving operation currently in flight.
  const inFlight = new Set<string>();

  const escrowAddress = deps.deployment.contracts.ProofMarketEscrow as `0x${string}`;
  const tokenAddress = deps.deployment.contracts.MockUSDC as `0x${string}`;
  const pollDelayMs = deps.pollDelayMs ?? 5000;
  // Challenge window W_c (escrow complete gate), in ms. 0 when the artifact
  // predates v2 — then no gating is applied client-side either.
  const challengeWindowMs =
    Number(deps.deployment.escrowParams?.challengeWindow ?? 0) * 1000;

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

  /**
   * Publishes ERC-8004 reputation feedback for the provider that ran the job,
   * after the settlement outcome is already final.
   *
   * Failure policy (documented design choice): feedback is a post-settlement
   * record, NOT part of the fund movement — if publishing fails (or the
   * provider has no agentId in the artifact), we record a failed/skipped audit
   * entry and return the task unchanged in status. No-fabrication still holds:
   * only a real txHash is ever recorded, and a failure never invents one.
   */
  async function publishReputationFeedback(
    task: Task,
    input: { value: number; tag2: string; sentiment: "好评" | "差评" }
  ): Promise<Task> {
    // The provider that actually ran the job (not necessarily the recommended one).
    const providerId =
      task.providerPackage?.providerId ?? task.plan?.recommendedProviderId ?? null;
    const agentId = providerId
      ? deps.deployment.providers?.[providerId]?.agentId
      : undefined;
    if (agentId == null) {
      // Graceful skip: provider not registered on ERC-8004 — note it, move on.
      return save(
        withAudit(
          task,
          audit({
            taskId: task.id,
            source: "chain",
            type: "reputation_feedback_skipped",
            result: "failed",
            message:
              `未发布链上信誉反馈（${input.sentiment}）：Provider ` +
              `${providerId ?? "未知"} 在部署 artifact 中没有 ERC-8004 agentId` +
              "（非致命，结算结果不受影响）。",
            jobId: task.jobId
          })
        )
      );
    }

    try {
      const { txHash } = await deps.publishFeedback({
        agentId,
        value: input.value,
        tag2: input.tag2
      });
      const record: TxRecord = {
        label: "feedback",
        coboTxId: null,
        txHash,
        status: "confirmed"
      };
      return save(
        withAudit(
          { ...task, txRecords: [...task.txRecords, record], updatedAt: deps.now() },
          audit({
            taskId: task.id,
            source: "chain",
            type: "reputation_feedback_published",
            result: "success",
            message:
              `已发布链上信誉反馈（${input.sentiment}）：agentId ${agentId}，` +
              `分值 ${(input.value / 100).toFixed(2)}/5.00，标签 ${input.tag2}。`,
            txHash,
            jobId: task.jobId
          })
        )
      );
    } catch (error) {
      const failedRecord: TxRecord = {
        label: "feedback",
        coboTxId: null,
        txHash: "",
        status: "failed"
      };
      return save(
        withAudit(
          { ...task, txRecords: [...task.txRecords, failedRecord], updatedAt: deps.now() },
          audit({
            taskId: task.id,
            source: "chain",
            type: "reputation_feedback_failed",
            result: "failed",
            message:
              `链上信誉反馈（${input.sentiment}）发布失败（非致命，结算结果不受影响）：` +
              `${error instanceof Error ? error.message : String(error)}`,
            jobId: task.jobId
          })
        )
      );
    }
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
            message: `${label} 执行失败：${error instanceof Error ? error.message : String(error)}`,
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
        requestId: `${taskRef.task.id}-${label}-${attemptIndex}-${instanceSuffix}`,
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
          message: `${label} 交易已在 Sepolia 上确认。`,
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
            message: `用户创建任务，预算 ${budget}。`
          })
        )
      );
    },

    async plan(id: string): Promise<Task> {
      const task = store.getTask(id);
      assertStatus(task, ["Created"], "plan");
      const budgetAmount = leadingDecimal(task.budgetLimit);
      // Read on-chain reputation FIRST — it is a probabilistic prior the
      // research agent must weigh when recommending. A degraded read (or a
      // missing agentId) falls back to the fixture score; it must never block
      // planning. Mapped to the 0-1000 scale.
      const providerReputations: ProviderReputation[] = [];
      const reputationFallbacks: string[] = [];
      for (const profile of providerProfiles) {
        const agentId = deps.deployment.providers?.[profile.id]?.agentId;
        if (agentId == null) {
          providerReputations.push({
            providerId: profile.id,
            score: profile.reputationScore,
            source: "fixture"
          });
          reputationFallbacks.push(`${profile.id}（artifact 中无 agentId）`);
          continue;
        }
        try {
          const { score } = await deps.readReputation(agentId);
          providerReputations.push({ providerId: profile.id, score, source: "erc8004" });
        } catch (error) {
          providerReputations.push({
            providerId: profile.id,
            score: profile.reputationScore,
            source: "fixture"
          });
          reputationFallbacks.push(
            `${profile.id}（${error instanceof Error ? error.message : String(error)}）`
          );
        }
      }
      const repOf = (pid: ProviderId): number | undefined =>
        providerReputations.find((r) => r.providerId === pid)?.score;

      // The catalog the agent reasons over: self-DECLARED coverage + price +
      // on-chain reputation/history. Deliberately no post-purchase facts — the
      // agent recommends on priors, the Judge verifies actual delivery later.
      const providerCatalog = providerProfiles.map((profile) => ({
        providerId: profile.id,
        displayName: profile.name,
        specialties: [profile.coverage],
        price: profile.price,
        reputation: repOf(profile.id),
        challengeHistory: `被挑战 ${profile.challengeStats.challenged} 次 / 成立 ${profile.challengeStats.upheld} 次`
      }));
      const challengeManagerAddress = deps.deployment.contracts.ProofMarketChallengeManager;
      const pactSummary = challengeManagerAddress
        ? "A Cobo pact restricts execution to the ProofMarketEscrow, MockUSDC and " +
          "ProofMarketChallengeManager contracts on Sepolia, " +
          "with a cap of 10 transactions and a 90 minute expiry."
        : "A Cobo pact restricts execution to the ProofMarketEscrow and MockUSDC " +
          "contracts on Sepolia, with a 90 minute expiry.";

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

      // Ranked shortlist the user picks from. validateResearchPlanOutput
      // normalizes plan.ranking (populated, recommended-first); fall back to a
      // single-entry list if a raw/unvalidated output omitted it.
      const ranking = plan.ranking ?? [
        { providerId: plan.recommendedProviderId, reason: plan.reason }
      ];
      const candidates = ranking.map((entry, index) => ({
        providerId: entry.providerId as ProviderId,
        reason: entry.reason,
        rank: index + 1
      }));

      const procurementPlan: ProcurementPlan = {
        taskId: task.id,
        userQuestion: task.userQuestion,
        evidenceNeed: plan.reason,
        totalBudget: `${plan.maxPayment} mUSDC`,
        perJobCap: `${plan.maxPayment} mUSDC`,
        recommendedProviderId: plan.recommendedProviderId as ProviderId,
        providerCount: 3,
        coverage: recommendedProfile?.coverage ?? "专项证据覆盖",
        returnType: "provider-answer-package",
        verificationMethod: "确定性 Judge 校验端点",
        providerReputations,
        candidates
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

      let result = save(
        withAudit(
          planned,
          audit({
            taskId: id,
            source: "research-agent",
            type: "procurement_plan_created",
            result: "success",
            message:
              `Claude 研究 Agent 推荐 ${plan.recommendedProviderId}` +
              `（最高支付 ${plan.maxPayment} mUSDC）：${plan.reason}`
          })
        )
      );

      const onchainScores = providerReputations.filter((r) => r.source === "erc8004");
      if (onchainScores.length > 0) {
        result = save(
          withAudit(
            result,
            audit({
              taskId: id,
              source: "chain",
              type: "reputation_loaded",
              result: "success",
              message:
                "已从 ERC-8004 信誉注册表读取链上信誉分：" +
                onchainScores.map((r) => `${r.providerId}=${r.score}`).join("，") +
                "。"
            })
          )
        );
      }
      if (reputationFallbacks.length > 0) {
        result = save(
          withAudit(
            result,
            audit({
              taskId: id,
              source: "chain",
              type: "reputation_read_fallback",
              result: "failed",
              message:
                "链上信誉读取失败，以下 Provider 已回退本地预设分（非致命）：" +
                reputationFallbacks.join("；")
            })
          )
        );
      }
      return result;
    },

    async submitPact(id: string): Promise<Task> {
      const task = store.getTask(id);
      assertStatus(task, ["Planned"], "submit pact");
      const budgetAmount = leadingDecimal(task.budgetLimit);
      const challengeManagerAddress = deps.deployment.contracts.ProofMarketChallengeManager;
      const submission = buildRealPactSubmission({
        escrowAddress,
        tokenAddress,
        challengeManagerAddress,
        budgetAmount,
        taskId: task.id
      });

      const result = await deps.cobo.submitPact(submission);
      const pact: PactSummary = {
        intent: submission.intent,
        totalBudget: `${budgetAmount} mUSDC`,
        perJobCap: `${budgetAmount} mUSDC`,
        allowedTargets: [
          escrowAddress,
          tokenAddress,
          ...(challengeManagerAddress ? [challengeManagerAddress] : [])
        ],
        allowedFunctions: [
          "approve",
          "createJob",
          "setBudget",
          "fund",
          "complete",
          "openChallenge"
        ],
        denyRules: [
          "默认禁止任何直接转账（无转账策略）",
          "最多 10 笔交易",
          "90 分钟后自动过期"
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
            message: `已提交 Cobo 授权策略（Pact ${pact.pactId}），状态 ${result.status}。`,
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
                `Pact ${task.pact.pactId} 尚未激活（状态 ${status.status}）。` +
                `原始返回：${truncate(status.raw)}`,
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
            message: `Pact ${task.pact.pactId} 已激活。`,
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

        // Fund what the plan says: perJobCap carries the Claude-validated
        // maxPayment, already checked against budgetLimit (the user ceiling)
        // when the plan was produced.
        const budgetAmount = leadingDecimal(task.plan.perJobCap);
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

        // Post-fund readback: the chain is the source of truth, not the
        // sequence of confirmed receipts. State 1 = Funded. Public RPC
        // endpoints sometimes serve a lagging replica right after a tx
        // confirms (or hiccup outright), so poll a few times before declaring
        // a mismatch — a stale read must not strand a correctly funded job.
        let jobState: { state: number; budget: bigint } | null = null;
        for (let attempt = 0; attempt < 5; attempt++) {
          try {
            jobState = await deps.chain.readJobState(escrowAddress, jobId);
            if (jobState.state === 1 && jobState.budget === budgetRaw) break;
          } catch {
            jobState = null;
          }
          if (attempt < 4) await delay(pollDelayMs);
        }
        if (!jobState || jobState.state !== 1 || jobState.budget !== budgetRaw) {
          throw new Error(
            `post-fund readback mismatch for job ${jobId}: ` +
              `state=${jobState?.state} (expected 1 Funded), ` +
              `budget=${jobState?.budget} (expected ${budgetRaw})`
          );
        }
        taskRef.task = save(
          withAudit(
            taskRef.task,
            audit({
              taskId: id,
              source: "chain",
              type: "escrow_funded_verified",
              result: "success",
              message: `链上回读确认订单 ${jobId} 已注资（Funded），预算 ${jobState.budget} 原始单位。`,
              pactId: task.pact.pactId,
              jobId: Number(jobId)
            })
          )
        );

        const funded = transition(taskRef.task, "JobFunded");

        return save(
          withAudit(
            funded,
            audit({
              taskId: id,
              source: "cobo",
              type: "escrow_executed",
              result: "success",
              message: `托管订单 ${jobId} 已在 Sepolia 上注资 ${budgetAmount} mUSDC。`,
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
      // Gate BEFORE the cobo side effect: a denial attempt against an
      // unapproved pact would prove nothing about the policy.
      assertStatus(task, ["PactActive"], "trigger denial");
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
            // rawOutput 是 caw CLI 的真实返回（真实证据），保持原文不翻译。
            message:
              `Cobo 已拒绝 ${denial.attemptedAction}（退出码 ${denial.exitCode}）。` +
              `原始输出：${truncate(denial.rawOutput)}`,
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
            message: `Provider ${providerId} 交付证据包 ${providerPackage.packageHash}。`,
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
            message: `Provider 已将交付物哈希 ${providerPackage.packageHash} 提交上链。`,
            txHash: submitted.txHash,
            jobId: task.jobId
          })
        )
      );

      // Integrity check: never trust the service response alone — the chain is
      // the source of truth. Poll a few times: a lagging RPC replica right
      // after the submit confirmation must not fail a correct delivery.
      let deliverableOnChain = "";
      for (let attempt = 0; attempt < 5; attempt++) {
        try {
          const jobState = await deps.chain.readJobState(escrowAddress, BigInt(task.jobId));
          deliverableOnChain = jobState.deliverableHash;
          if (deliverableOnChain.toLowerCase() === providerPackage.packageHash.toLowerCase()) break;
        } catch {
          deliverableOnChain = "";
        }
        if (attempt < 4) await delay(pollDelayMs);
      }
      if (deliverableOnChain.toLowerCase() !== providerPackage.packageHash.toLowerCase()) {
        throw new Error(
          `on-chain deliverable hash mismatch: chain has ${deliverableOnChain}, ` +
            `provider package is ${providerPackage.packageHash}`
        );
      }

      // Challenge window W_c starts at submit: settlement is blocked (by the
      // escrow contract and by the UI) until it passes.
      if (challengeWindowMs > 0) {
        const endsAt = new Date(Date.parse(deps.now()) + challengeWindowMs).toISOString();
        current = save(
          withAudit(
            { ...current, challengeWindowEndsAt: endsAt, updatedAt: deps.now() },
            audit({
              taskId: id,
              source: "chain",
              type: "challenge_window_opened",
              result: "success",
              message:
                `挑战窗口开启：${Math.round(challengeWindowMs / 60000)} 分钟内可对证据发起挑战，` +
                "窗口结束前合约拒绝放款（complete 被链上门禁拦截）。",
              jobId: task.jobId
            })
          )
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
            // 步骤 5/6 用 verdictHash= 前缀正则提取哈希，保持该字段格式不变。
            message:
              `Judge ${verdict.judgeId} 判定 ${verdict.decision}` +
              `（${verdict.reasonCode}）verdictHash=${verdict.verdictHash}`,
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
        // Client-side W_c guard: the escrow would revert anyway ("challenge
        // window open"); failing early gives a readable countdown message.
        if (task.challengeWindowEndsAt) {
          const remainingMs = Date.parse(task.challengeWindowEndsAt) - Date.parse(deps.now());
          if (remainingMs > 0) {
            throw new Error(
              `挑战窗口未结束，剩余 ${Math.ceil(remainingMs / 1000)} 秒后才可结算`
            );
          }
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

        const settledTask = save(
          withAudit(
            settled,
            audit({
              taskId: id,
              source: "settlement",
              type: "settled",
              result: "success",
              message: `已向 Provider 结算付款，verdict 哈希 ${verdictHash}。`,
              jobId: task.jobId
            })
          )
        );

        // Post-settlement: positive on-chain reputation feedback for the
        // provider (real tx, rater key, non-fatal on failure — see helper).
        return publishReputationFeedback(settledTask, {
          value: FEEDBACK_POSITIVE_VALUE,
          tag2: "job.completed",
          sentiment: "好评"
        });
      } finally {
        inFlight.delete(id);
      }
    },

    // ── Deterministic challenge flow (P2-c): real protocol + funds, preset
    //    content & vote. openChallenge/resolve move real money on Sepolia. ──

    async openChallenge(id: string): Promise<Task> {
      const task = store.getTask(id);
      // Delivered-only by design: the user challenge targets the freshly
      // delivered package (spec 08 step 1); after Verified the demo settles.
      assertStatus(task, ["Delivered"], "open challenge");
      if (inFlight.has(id)) {
        throw new Error("operation already in progress for this task");
      }
      inFlight.add(id);
      try {
        const challengeManagerAddress = deps.deployment.contracts.ProofMarketChallengeManager;
        if (!challengeManagerAddress) {
          throw new Error(
            "deployment artifact has no contracts.ProofMarketChallengeManager — " +
              "redeploy with the P0-2 script before running the challenge path"
          );
        }
        const depositRaw = deps.deployment.challengeManagerParams?.challengeDeposit;
        if (!depositRaw) {
          throw new Error(
            "deployment artifact has no challengeManagerParams.challengeDeposit — " +
              "cannot size the challenge deposit approval"
          );
        }
        // Jury fee F is collected together with the deposit at openChallenge.
        const juryFeeRaw = deps.deployment.challengeManagerParams?.juryFee ?? "0";
        const approveAmount = BigInt(depositRaw) + BigInt(juryFeeRaw);
        if (task.jobId === null) {
          throw new Error("Cannot open a challenge before the job is funded");
        }

        // Preset counter-evidence: only its hash goes on-chain (spec 08 step 2).
        const counterEvidenceHash = stableHash(presetCounterEvidence) as `0x${string}`;
        const opened = save(
          withAudit(
            {
              ...task,
              challenge: {
                type: "CoverageMiss" as const,
                statement: presetChallengeDocument.statement,
                hitCoverageClause: presetChallengeDocument.hitCoverageClause,
                counterEvidenceHash
              },
              updatedAt: deps.now()
            },
            audit({
              taskId: id,
              source: "user",
              type: "challenge_opened",
              result: "success",
              message:
                `用户发起挑战：类型 CoverageMiss，反证哈希 ${counterEvidenceHash}。` +
                `挑战者为 Cobo 钱包（订单 client），将锁定挑战押金 ${Number(depositRaw) / 1e6} mUSDC + ` +
                `审判费 ${Number(juryFeeRaw) / 1e6} mUSDC 并冻结托管订单。`,
              jobId: task.jobId
            })
          )
        );

        // Both calls are Cobo-routed (Pact-bounded): the Cobo wallet is the job
        // client, satisfying the contract's challenger ∈ {client, evaluator}.
        const taskRef = { task: opened };
        await coboCall(
          taskRef,
          "approveDeposit",
          tokenAddress,
          encodeApprove(challengeManagerAddress as `0x${string}`, approveAmount)
        );
        // One call: the contract's openChallenge locks deposit + jury fee AND
        // calls escrow.markChallenged itself, freezing the job.
        const receipt = await coboCall(
          taskRef,
          "openChallenge",
          challengeManagerAddress,
          encodeOpenChallenge(BigInt(task.jobId), ChallengeType.CoverageMiss, counterEvidenceHash)
        );
        challengeOpenedAt.set(id, Date.parse(deps.now()));

        // challengeId comes from the ChallengeOpened event — needed by resolve().
        const challengeId = deps.chain.extractChallengeId(receipt, challengeManagerAddress);
        taskRef.task = save({
          ...taskRef.task,
          challenge: { ...taskRef.task.challenge!, challengeId: Number(challengeId) },
          updatedAt: deps.now()
        });

        const challenged = save(
          withAudit(
            transition(taskRef.task, "Challenged"),
            audit({
              taskId: id,
              source: "chain",
              type: "challenge_onchain_opened",
              result: "success",
              message:
                `挑战已上链：ChallengeManager 已锁定押金与审判费并冻结订单 ${task.jobId}` +
                `（challengeId ${challengeId}）。Provider 应辩窗口开启。`,
              jobId: task.jobId
            })
          )
        );

        // Provider defense (应辩书): preset content, real provider-signed tx.
        // Non-fatal on failure — skipping the defense forfeits it (合约语义),
        // the jury still waits out R_w before voting.
        try {
          const defense = await deps.services.providerDefend({
            challengeId: String(challengeId)
          });
          const defenseRecord: TxRecord = {
            label: "defense",
            coboTxId: null,
            txHash: defense.txHash,
            status: "confirmed"
          };
          return save(
            withAudit(
              {
                ...challenged,
                challenge: {
                  ...challenged.challenge!,
                  defense: {
                    statement: defense.statement,
                    defenseHash: defense.defenseHash,
                    txHash: defense.txHash
                  }
                },
                txRecords: [...challenged.txRecords, defenseRecord],
                updatedAt: deps.now()
              },
              audit({
                taskId: id,
                source: "provider",
                type: "defense_submitted",
                result: "success",
                message:
                  `Provider 已在应辩窗口内提交应辩书（哈希 ${defense.defenseHash}）：` +
                  `${defense.statement}`,
                txHash: defense.txHash,
                jobId: task.jobId
              })
            )
          );
        } catch (error) {
          return save(
            withAudit(
              challenged,
              audit({
                taskId: id,
                source: "provider",
                type: "defense_skipped",
                result: "failed",
                message:
                  `Provider 应辩提交失败（视同放弃应辩，裁决照常进行）：` +
                  `${error instanceof Error ? error.message : String(error)}`,
                jobId: task.jobId
              })
            )
          );
        }
      } finally {
        inFlight.delete(id);
      }
    },

    async winChallenge(id: string): Promise<Task> {
      const task = store.getTask(id);
      assertStatus(task, ["Challenged"], "win challenge");
      if (inFlight.has(id)) {
        throw new Error("operation already in progress for this task");
      }
      inFlight.add(id);
      try {
      if (!task.challenge || task.challenge.challengeId == null) {
        throw new Error(
          "no on-chain challenge recorded for this task — open the challenge first"
        );
      }

      // The jury panel (审判团确定性裁决): three real castVote transactions,
      // preset 2:1 ProviderFault. The contract rejects votes before
      // openedAt + R_w, so wait the window out HERE (a long sleep inside the
      // services HTTP call would trip undici's headers timeout instead).
      const openedAtMs = challengeOpenedAt.get(id) ?? Date.parse(task.updatedAt);
      const defenseWindowMs =
        Number(deps.deployment.challengeManagerParams?.defenseWindow ?? 0) * 1000;
      if (defenseWindowMs > 0) {
        const remainingWindowMs =
          openedAtMs + defenseWindowMs + 5_000 - Date.parse(deps.now());
        if (remainingWindowMs > 0) {
          await delay(remainingWindowMs);
        }
      }
      const { votes } = await deps.services.juryVote({
        challengeId: String(task.challenge.challengeId),
        openedAtMs
      });
      const faultVotes = votes.filter((vote) => vote.vote === "ProviderFault").length;
      const majority = Math.floor(votes.length / 2) + 1;
      if (faultVotes < majority) {
        throw new Error(
          `unexpected jury outcome: ${faultVotes}/${votes.length} ProviderFault votes (need ${majority})`
        );
      }

      let current: Task = { ...task, challenge: { ...task.challenge, votes } };
      const voteRecords: TxRecord[] = votes.map((vote) => ({
        label: "castVote" as const,
        coboTxId: null,
        txHash: vote.txHash ?? "",
        status: "confirmed" as const
      }));
      current = { ...current, txRecords: [...current.txRecords, ...voteRecords] };
      for (const vote of votes) {
        current = withAudit(
          current,
          audit({
            taskId: id,
            source: "verifier",
            type: "jury_vote",
            result: "success",
            message:
              `审判方 ${vote.jurorId}（${vote.modelFamily}）投票 ${vote.vote}` +
              `（${vote.reasonCode}），理由书哈希 ${vote.reasonHash} 已随票上链。` +
              `结论：${vote.reasonBook.conclusion}`,
            txHash: vote.txHash ?? null,
            jobId: task.jobId
          })
        );
      }

      const won = transition(current, "ChallengeWon");

      return save(
        withAudit(
          won,
          audit({
            taskId: id,
            source: "verifier",
            type: "challenge_won",
            result: "success",
            message:
              `审判团多数决 ${faultVotes}:${votes.length - faultVotes} 判 ProviderFault，挑战成立。` +
              "多数已达成，任何人可执行链上裁决。",
            jobId: task.jobId
          })
        )
      );
      } finally {
        inFlight.delete(id);
      }
    },

    async refundOrSlash(id: string): Promise<Task> {
      const task = store.getTask(id);
      assertStatus(task, ["ChallengeWon"], "refund or slash");
      if (inFlight.has(id)) {
        throw new Error("operation already in progress for this task");
      }
      inFlight.add(id);
      try {
        const challenge = task.challenge;
        if (!challenge || challenge.challengeId == null) {
          throw new Error("no on-chain challenge recorded for this task");
        }

        // resolve(challengeId) executes the on-chain vote majority — it is
        // permissionless, signed here by the backend's resolver key (not
        // Cobo). On-chain it slashes the provider stake, pays the challenger
        // (deposit + fee refund + reward), pays the jury fee out of the slash,
        // sends the remainder to the treasury and refunds the buyer.
        let resolved: { txHash: string };
        try {
          resolved = await deps.resolveChallenge({
            challengeId: BigInt(challenge.challengeId)
          });
        } catch (error) {
          // No fabrication: surface the failure with a failed record + audit.
          const failedRecord: TxRecord = {
            label: "resolve",
            coboTxId: null,
            txHash: "",
            status: "failed"
          };
          save(
            withAudit(
              { ...task, txRecords: [...task.txRecords, failedRecord], updatedAt: deps.now() },
              audit({
                taskId: id,
                source: "chain",
                type: "chain_tx_failed",
                result: "failed",
                message: `resolve 执行失败：${error instanceof Error ? error.message : String(error)}`,
                jobId: task.jobId
              })
            )
          );
          throw error;
        }

        const resolveRecord: TxRecord = {
          label: "resolve",
          coboTxId: null,
          txHash: resolved.txHash,
          status: "confirmed"
        };
        const updated = save({
          ...task,
          txRecords: [...task.txRecords, resolveRecord],
          challenge: { ...challenge, resolvedTxHash: resolved.txHash },
          updatedAt: deps.now()
        });

        const refunded = transition(updated, "RefundedOrSlashed");
        const refundedTask = save(
          withAudit(
            refunded,
            audit({
              taskId: id,
              source: "settlement",
              type: "refund_or_slash",
              result: "success",
              message:
                "链上裁决已执行：扣除 Provider 质押 50%（挑战者得一半作奖励），" +
                "托管资金退款买方，挑战者押金与审判费全额退回，" +
                "审判费由扣罚承担、三位审判方均分，余额归入金库。",
              txHash: resolved.txHash,
              jobId: task.jobId
            })
          )
        );

        // Post-resolution: negative on-chain reputation feedback for the
        // at-fault provider (real tx, rater key, non-fatal on failure).
        return publishReputationFeedback(refundedTask, {
          value: FEEDBACK_NEGATIVE_VALUE,
          tag2: "challenge.coverage_miss",
          sentiment: "差评"
        });
      } finally {
        inFlight.delete(id);
      }
    }
  };
}

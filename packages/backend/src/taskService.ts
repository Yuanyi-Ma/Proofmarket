import {
  generateProcurementPlan,
  runProvider as runProviderAgent,
  verifyPackage
} from "@proofmarket/agents/src";
import { buildPactPolicy } from "@proofmarket/cobo/src";
import { createAuditEvent } from "@proofmarket/shared/src/audit";
import {
  presetChallengeDocument,
  presetCounterEvidence,
  presetDefense,
  presetJuryVotes,
  providerProfiles
} from "@proofmarket/shared/src/fixtures";
import { stableHash } from "@proofmarket/shared/src/hash";
import { assertTransition } from "@proofmarket/shared/src/stateMachine";
import type {
  AuditEvent,
  AuditResult,
  AuditSource,
  PactSummary,
  ProviderId,
  Task,
  TaskStatus
} from "@proofmarket/shared/src/types";
import { appendAudit } from "./auditStore";
import type { InMemoryStore } from "./demoStore";

export type TaskService = {
  getTask(id: string): Promise<Task>;
  listTasks(): Promise<Task[]>;
  createTask(question: string, budget: string): Promise<Task>;
  plan(id: string): Promise<Task>;
  submitPact(id: string): Promise<Task>;
  activatePact(id: string): Promise<Task>;
  executeEscrow(id: string): Promise<Task>;
  triggerDenial(id: string): Promise<Task>;
  runProvider(id: string, providerId: ProviderId): Promise<Task>;
  verify(id: string): Promise<Task>;
  settle(id: string): Promise<Task>;
  openChallenge(id: string): Promise<Task>;
  winChallenge(id: string): Promise<Task>;
  refundOrSlash(id: string): Promise<Task>;
};

export function createTaskService(store: InMemoryStore): TaskService {
  let taskCounter = 0;
  let auditCounter = 0;

  function now(): string {
    return new Date().toISOString();
  }

  function nextId(prefix: string, counter: number): string {
    return `${prefix}_${counter.toString().padStart(3, "0")}`;
  }

  function nextTaskId(): string {
    taskCounter += 1;
    return nextId("task", taskCounter);
  }

  function nextAuditId(): string {
    auditCounter += 1;
    return nextId("audit", auditCounter);
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
    return createAuditEvent({
      id: nextAuditId(),
      createdAt: now(),
      ...input
    });
  }

  function save(task: Task): Task {
    return store.saveTask(task);
  }

  function transition(task: Task, status: TaskStatus): Task {
    assertTransition(task.status, status);
    return {
      ...task,
      status,
      updatedAt: now()
    };
  }

  function withAudit(task: Task, event: AuditEvent): Task {
    return appendAudit(task, event);
  }

  function pactFor(task: Task): PactSummary {
    const policy = buildPactPolicy({
      escrowAddress: "ProofMarketEscrow",
      tokenAddress: "MockUSDC",
      challengeManagerAddress: "ProofMarketChallengeManager"
    });

    return {
      intent: `Fund one provider research job for task ${task.id}.`,
      totalBudget: policy.totalBudget,
      perJobCap: task.plan?.perJobCap ?? policy.perJobCap,
      allowedTargets: policy.allowedTargets,
      allowedFunctions: policy.allowedFunctions,
      denyRules: policy.denyRules,
      expiresInMinutes: policy.expiresInMinutes,
      pactId: `pact_${task.id.slice("task_".length)}`,
      status: "submitted"
    };
  }

  return {
    async getTask(id: string): Promise<Task> {
      return store.getTask(id);
    },

    async listTasks(): Promise<Task[]> {
      return store.listTasks();
    },

    async createTask(question: string, budget: string): Promise<Task> {
      const timestamp = now();
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
        mode: "fixture",
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
      const plan = generateProcurementPlan(
        task.id,
        task.userQuestion
      );
      const selectedProviderIds = providerProfiles.map((provider) => provider.id);
      const planned = transition(
        {
          ...task,
          plan,
          selectedProviderIds
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
            message: `已选定候选专家：${selectedProviderIds.join("、")}。`
          })
        )
      );
    },

    async submitPact(id: string): Promise<Task> {
      const task = store.getTask(id);
      const pact = pactFor(task);
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
            message: `已提交 Pact ${pact.pactId}。`,
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
      const pact: PactSummary = {
        ...task.pact,
        status: "active"
      };
      const activated = transition(
        {
          ...task,
          pact
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
            message: `Pact ${pact.pactId} 已激活。`,
            pactId: pact.pactId
          })
        )
      );
    },

    async executeEscrow(id: string): Promise<Task> {
      const task = store.getTask(id);
      const funded = transition(
        {
          ...task,
          jobId: 1
        },
        "JobFunded"
      );

      return save(
        withAudit(
          funded,
          audit({
            taskId: id,
            source: "cobo",
            type: "escrow_executed",
            result: "success",
            message: "托管订单已在演示链上注资。",
            txHash: "0xproofmarket0000000000000000000000000000000000000000000000000001",
            pactId: task.pact?.pactId ?? null,
            jobId: 1
          })
        )
      );
    },

    async triggerDenial(id: string): Promise<Task> {
      const task = store.getTask(id);
      const denied = transition(task, "DeniedByCobo");
      const denial = {
        denied: true,
        reason:
          "直接转账被拒绝：目标地址不在白名单内，且金额超出 Pact 上限。",
        attemptedTarget: "0xDeniedDirectTransfer",
        attemptedFunction: "transfer",
        attemptedAmount: "10 SETH",
        movedFunds: "0 test USDC"
      };

      return save(
        withAudit(
          denied,
          audit({
            taskId: id,
            source: "cobo",
            type: "escrow_denied",
            result: "denied",
            message:
              `${denial.reason} 尝试目标=${denial.attemptedTarget}；` +
              `函数=${denial.attemptedFunction}；金额=${denial.attemptedAmount}；` +
              `已转移资金=${denial.movedFunds}；未创建任何托管订单。`,
            pactId: task.pact?.pactId ?? null
          })
        )
      );
    },

    async runProvider(id: string, providerId: ProviderId): Promise<Task> {
      const task = store.getTask(id);
      const providerPackage = runProviderAgent(task.id, providerId);
      const delivered = transition(
        {
          ...task,
          providerPackage
        },
        "Delivered"
      );

      return save(
        withAudit(
          delivered,
          audit({
            taskId: id,
            source: "provider",
            type: "provider_package_delivered",
            result: "success",
            message: `专家 ${providerId} 交付研究简报 ${providerPackage.packageHash}。`,
            jobId: task.jobId
          })
        )
      );
    },

    async verify(id: string): Promise<Task> {
      const task = store.getTask(id);
      if (!task.providerPackage || task.status !== "Delivered") {
        throw new Error("Cannot verify before provider delivery");
      }

      const verdict = verifyPackage(task.providerPackage);
      const nextStatus: TaskStatus =
        verdict.verdict === "valid" ? "Verified" : "Challenged";
      const verified = transition(task, nextStatus);
      const result = verdict.verdict === "valid" ? "success" : "failed";

      return save(
        withAudit(
          verified,
          audit({
            taskId: id,
            source: "verifier",
            type:
              verdict.verdict === "valid"
                ? "verification_passed"
                : "verification_failed",
            result,
            message: `${verdict.reason} resultHash=${verdict.resultHash}`,
            jobId: task.jobId
          })
        )
      );
    },

    async settle(id: string): Promise<Task> {
      const task = store.getTask(id);
      const settled = transition(task, "Settled");

      return save(
        withAudit(
          settled,
          audit({
            taskId: id,
            source: "settlement",
            type: "settled",
            result: "success",
            message: "已向专家结算付款。",
            jobId: task.jobId
          })
        )
      );
    },

    // Explicit user-initiated challenge: Delivered → Challenged only. Verified
    // is deliberately NOT a legal entry point — once the verifier accepted the
    // package, the demo settles; the user challenge targets the freshly
    // delivered package (spec 08 "确定性挑战流程" step 1).
    async openChallenge(id: string): Promise<Task> {
      const task = store.getTask(id);
      if (task.status !== "Delivered") {
        throw new Error("Cannot open a challenge before evidence delivery");
      }

      const counterEvidenceHash = stableHash(presetCounterEvidence);
      let challenged = transition(
        {
          ...task,
          challenge: {
            type: "CoverageMiss" as const,
            statement: presetChallengeDocument.statement,
            hitCoverageClause: presetChallengeDocument.hitCoverageClause,
            counterEvidenceHash
          }
        },
        "Challenged"
      );

      challenged = withAudit(
        challenged,
        audit({
          taskId: id,
          source: "user",
          type: "challenge_opened",
          result: "success",
          message:
            `用户发起挑战：类型 CoverageMiss，反证哈希 ${counterEvidenceHash}。` +
            "挑战押金与审判费已锁定，托管订单已冻结，专家应辩窗口开启。" +
            `审判方指派：${presetChallengeDocument.juryAssignmentBasis}`,
          jobId: task.jobId
        })
      );

      // Preset defense, mirroring the real flow's auto-filed 应辩书.
      return save(
        withAudit(
          {
            ...challenged,
            challenge: { ...challenged.challenge!, defense: { ...presetDefense } }
          },
          audit({
            taskId: id,
            source: "provider",
            type: "defense_submitted",
            result: "success",
            message:
              `专家已在应辩窗口内提交应辩书（哈希 ${presetDefense.defenseHash}）：` +
              `${presetDefense.statement}`,
            jobId: task.jobId
          })
        )
      );
    },

    async winChallenge(id: string): Promise<Task> {
      const task = store.getTask(id);
      // Preset jury verdict (审判团确定性裁决): 2:1 ProviderFault, fixture
      // juror addresses (no chain in fixture mode).
      const votes = presetJuryVotes([
        "0x0000000000000000000000000000000000000a01",
        "0x0000000000000000000000000000000000000a02",
        "0x0000000000000000000000000000000000000a03"
      ]);
      const faultVotes = votes.filter((vote) => vote.vote === "ProviderFault").length;

      let current = task.challenge
        ? // The verify() fault auto-route reaches Challenged without an explicit
          // challenge record; only attach the votes when a challenge exists.
          { ...task, challenge: { ...task.challenge, votes } }
        : task;
      for (const vote of votes) {
        current = withAudit(
          current,
          audit({
            taskId: id,
            source: "verifier",
            type: "jury_vote",
            result: "success",
            message:
              `审判方 ${vote.jurorAddress.slice(0, 10)}… 投票 ${vote.vote}` +
              `（${vote.reasonCode}），理由书哈希 ${vote.reasonHash}。` +
              `结论：${vote.reasonBook.conclusion}`,
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
              `审判团多数决 ${faultVotes}:${votes.length - faultVotes} 判 ProviderFault，挑战成立。`,
            jobId: task.jobId
          })
        )
      );
    },

    async refundOrSlash(id: string): Promise<Task> {
      const task = store.getTask(id);
      const refunded = transition(task, "RefundedOrSlashed");

      return save(
        withAudit(
          refunded,
          audit({
            taskId: id,
            source: "settlement",
            type: "refund_or_slash",
            result: "success",
            message:
              "已执行裁决资金动作：扣除专家质押 50%（挑战者得一半作奖励），" +
              "托管资金退款买方，挑战者押金与审判费退回，审判费由扣罚承担、审判团均分，余额归入金库。",
            jobId: task.jobId
          })
        )
      );
    }
  };
}

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { AuditLog } from "../components/AuditLog";
import { ChallengePanel } from "../components/ChallengePanel";
import { EvidencePanel } from "../components/EvidencePanel";
import { ExecutionTimeline } from "../components/ExecutionTimeline";
import { FinalAnswer } from "../components/FinalAnswer";
import { ModeBadge } from "../components/ModeBadge";
import { PactReview } from "../components/PactReview";
import { ProviderMarket } from "../components/ProviderMarket";
import { TaskEntry } from "../components/TaskEntry";
import type {
  AuditEvent,
  PactSummary,
  ProviderAnswerPackage,
  Task
} from "@proofmarket/shared/src/types";

const providerPackage: ProviderAnswerPackage = {
  taskId: "task_001",
  providerAgentId: 1,
  providerId: "execution-research-expert",
  providerName: "Execution Research Expert Agent",
  coverageStatement:
    "Searched 2021-2026 blockchain transaction execution acceleration sources.",
  packageHash: "0xpackagehash",
  answers: [
    {
      providerAnswer: "Parallel execution and conflict detection matter.",
      sourceTitle: "Block-STM",
      sourceLocator: "arXiv:2203.06871",
      sourceLibrary: "arxiv",
      sourceMetadata: { year: 2022, type: "paper" },
      excerptOrSummary: "Block-STM executes ordered transactions concurrently.",
      relevanceExplanation: "Directly supports execution acceleration."
    }
  ]
};

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: "task_001",
    userQuestion: "Question",
    status: "Created",
    budgetLimit: "5 test USDC",
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
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides
  };
}

function auditEvent(overrides: Partial<AuditEvent> = {}): AuditEvent {
  return {
    id: "audit_001",
    taskId: "task_001",
    source: "chain",
    type: "chain_tx_confirmed",
    result: "success",
    message: "approve confirmed on Sepolia.",
    txHash: null,
    pactId: null,
    jobId: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides
  };
}

function realPact(overrides: Partial<PactSummary> = {}): PactSummary {
  return {
    intent: "Fund one provider research job.",
    totalBudget: "5 mUSDC",
    perJobCap: "5 mUSDC",
    allowedTargets: ["ProofMarketEscrow", "MockUSDC"],
    allowedFunctions: ["approve", "createJob", "setBudget", "fund", "complete"],
    denyRules: ["direct transfers denied by default", "max 7 txs"],
    expiresInMinutes: 90,
    pactId: "pact_real_001",
    status: "submitted",
    ...overrides
  };
}

const sampleTxHash = `0x${"ab12".repeat(16)}`;

function timelineRowClass(html: string, state: string): string {
  const pattern = new RegExp(
    `<div class="timeline-row ([^"]+)">(?:(?!<div class="timeline-row).)*<strong>${state}</strong>`,
    "s"
  );

  return pattern.exec(html)?.[1] ?? "";
}

describe("ProofMarket workflow UI content", () => {
  const noop = vi.fn();

  it("renders the task entry empty state and required create action", () => {
    const html = renderToStaticMarkup(
      <TaskEntry task={null} onCreate={noop} isBusy={false} />
    );

    expect(html).toContain("Ask one research question that needs evidence");
    expect(html).toContain("Create task");
    expect(html).toContain("Generate procurement plan");
  });

  it("renders exactly three provider candidates with expert and shallow actions", () => {
    const html = renderToStaticMarkup(
      <ProviderMarket
        task={null}
        onRunExpert={noop}
        onRunShallow={noop}
      />
    );

    expect((html.match(/data-provider-card=/g) ?? [])).toHaveLength(3);
    expect(html).toContain("区块链系统专家 Agent");
    expect(html).toContain("文献速查 Agent");
    expect(html).toContain("共识层研究专家 Agent");
    expect(html).toContain("Run expert provider");
    expect(html).toContain("Run shallow provider");
  });

  it("renders Cobo boundaries and the CoverageMiss challenge path", () => {
    const pactHtml = renderToStaticMarkup(
      <PactReview task={null} onSubmit={noop} onFund={noop} onTriggerDenial={noop} />
    );
    const challengeHtml = renderToStaticMarkup(
      <ChallengePanel task={null} onWinChallenge={noop} onRefundOrSlash={noop} />
    );

    expect(pactHtml).toContain("5 test USDC");
    expect(pactHtml).toContain("Allowed targets");
    expect(pactHtml).toContain("Trigger Cobo denial");
    expect(challengeHtml).toContain("CoverageMiss");
    expect(challengeHtml).toContain("Block-STM");
    expect(challengeHtml).toContain("Win challenge");
    expect(challengeHtml).toContain("Refund or slash");
  });

  it("keeps branch timeline states inactive when a happy path task is settled", () => {
    const html = renderToStaticMarkup(
      <ExecutionTimeline task={task({ status: "Settled" })} />
    );

    expect(html).toContain("Happy path");
    expect(html).toContain("Challenge branch");
    expect(html).toContain("Denial branch");
    expect(html).toContain("DeniedByCobo");
    expect(html).toContain("Challenged");
    expect(html).toContain("not-taken");
    expect(timelineRowClass(html, "DeniedByCobo")).toBe("not-taken");
    expect(timelineRowClass(html, "Challenged")).toBe("not-taken");
  });

  it("shows ReturnedToEscrowPath on the denial branch after Cobo denial", () => {
    const html = renderToStaticMarkup(
      <ExecutionTimeline task={task({ status: "DeniedByCobo" })} />
    );

    expect(html).toContain("ReturnedToEscrowPath");
    expect(html).toContain("escrow can be funded next");
  });

  it("renders the current backend Cobo policy without masking mismatches", () => {
    const html = renderToStaticMarkup(
      <PactReview
        task={task({
          status: "PactActive",
          pact: {
            intent: "Backend intent",
            totalBudget: "5 test USDC",
            perJobCap: "1 test USDC",
            allowedTargets: [
              "ProofMarketEscrow",
              "MockUSDC",
              "ProofMarketChallengeManager"
            ],
            allowedFunctions: [
              "createJob",
              "fund",
              "submit",
              "complete",
              "reject",
              "approve"
            ],
            denyRules: [
              "direct transfer",
              "non-whitelisted target",
              "amount above cap",
              "expired pact"
            ],
            expiresInMinutes: 30,
            pactId: "pact_001",
            status: "active"
          }
        })}
        onSubmit={noop}
        onFund={noop}
        onTriggerDenial={noop}
      />
    );

    expect(html).toContain("ProofMarketEscrow, MockUSDC, ProofMarketChallengeManager");
    expect(html).toContain("createJob, fund, submit, complete, reject, approve");
    expect(html).toContain("direct transfer");
    expect(html).toContain("non-whitelisted target");
    expect(html).toContain("amount above cap");
    expect(html).toContain("expired pact");
  });

  it("does not render the normal research conclusion before verification", () => {
    const html = renderToStaticMarkup(
      <FinalAnswer
        task={task({ status: "Delivered", providerPackage })}
        onSettle={noop}
        isBusy={false}
      />
    );

    expect(html).toContain("Waiting for verified evidence");
    expect(html).not.toContain("Recent blockchain execution acceleration work centers");
  });

  it("shows per-item verification status and package hash on evidence cards", () => {
    const html = renderToStaticMarkup(
      <EvidencePanel
        task={task({ status: "Verified", providerPackage })}
        onVerify={noop}
        isBusy={false}
      />
    );

    expect(html).toContain("Per-item verification status");
    expect(html).toContain("Verified");
    expect(html).toContain("Per-item package hash");
    expect(html).toContain("0xpackagehash");
  });

  it("allows a fresh task after one exists and disables creation while busy", () => {
    const existingTaskHtml = renderToStaticMarkup(
      <TaskEntry task={task()} onCreate={noop} isBusy={false} />
    );
    const busyHtml = renderToStaticMarkup(
      <TaskEntry task={null} onCreate={noop} isBusy />
    );

    expect(existingTaskHtml).toContain("Create fresh task");
    expect(existingTaskHtml).not.toMatch(/<button disabled[^>]*>Create fresh task/);
    expect(busyHtml).toMatch(/<button disabled[^>]*>Create task/);
  });

  it("renders a mode badge for fixture and real tasks and none without a task", () => {
    const fixtureHtml = renderToStaticMarkup(<ModeBadge task={task()} />);
    const realHtml = renderToStaticMarkup(<ModeBadge task={task({ mode: "real" })} />);
    const emptyHtml = renderToStaticMarkup(<ModeBadge task={null} />);

    expect(fixtureHtml).toContain("本地模拟");
    expect(fixtureHtml).not.toContain("Sepolia");
    expect(realHtml).toContain("Sepolia 测试网");
    expect(emptyHtml).toBe("");
  });

  it("links audit events with a full tx hash to Sepolia Etherscan", () => {
    const html = renderToStaticMarkup(
      <AuditLog
        task={task({
          audit: [
            auditEvent({ id: "audit_001", txHash: sampleTxHash }),
            auditEvent({ id: "audit_002", type: "task_created", txHash: null })
          ]
        })}
      />
    );

    expect(html).toContain(
      `href="https://sepolia.etherscan.io/tx/${sampleTxHash}"`
    );
    expect((html.match(/sepolia\.etherscan\.io/g) ?? [])).toHaveLength(1);
  });

  it("replaces challenge actions with a local-demo note in real mode", () => {
    const html = renderToStaticMarkup(
      <ChallengePanel
        task={task({ mode: "real", status: "Verified" })}
        onWinChallenge={noop}
        onRefundOrSlash={noop}
      />
    );

    expect(html).toContain("Local mechanism demo — not available in real mode");
    expect(html).not.toContain("Win challenge");
    expect(html).not.toMatch(/<button[^>]*>Refund or slash<\/button>/);
  });

  it("offers a Cobo approval check while a real pact is submitted", () => {
    const html = renderToStaticMarkup(
      <PactReview
        task={task({
          mode: "real",
          status: "PactSubmitted",
          pact: realPact({ status: "submitted" })
        })}
        onSubmit={noop}
        onFund={noop}
        onTriggerDenial={noop}
        onCheckApproval={noop}
      />
    );

    expect(html).toContain("Check Cobo approval");
    expect(html).toContain("Approve the Pact in your Cobo wallet, then check.");
  });

  it("renders real Cobo denial details in the audit log", () => {
    const html = renderToStaticMarkup(
      <AuditLog
        task={task({
          mode: "real",
          status: "DeniedByCobo",
          denial: {
            denied: true,
            exitCode: 5,
            attemptedAction: "transfer 0.001 mUSDC to 0x…dEaD",
            rawOutput: "Error: policy denied transfer (no transfer rule)"
          }
        })}
      />
    );

    expect(html).toContain("transfer 0.001 mUSDC to 0x…dEaD");
    expect(html).toContain("exit 5");
    expect(html).toContain("Error: policy denied transfer (no transfer rule)");
  });

  it("renders one timeline row per tx record with links for confirmed hashes", () => {
    const html = renderToStaticMarkup(
      <ExecutionTimeline
        task={task({
          mode: "real",
          status: "JobFunded",
          txRecords: [
            { label: "approve", coboTxId: "cobo_1", txHash: sampleTxHash, status: "confirmed" },
            { label: "createJob", coboTxId: "cobo_2", txHash: "", status: "pending" }
          ]
        })}
      />
    );

    expect(html).toContain("approve");
    expect(html).toContain("createJob");
    expect(html).toContain("confirmed");
    expect(html).toContain("pending");
    expect(html).toContain(
      `href="https://sepolia.etherscan.io/tx/${sampleTxHash}"`
    );
  });
});

// @vitest-environment jsdom
import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Step6Done } from "../components/steps/Step6Done";
import type { Task, ProviderAnswerPackage } from "@proofmarket/shared/src/types";
import type { TxRecord } from "@proofmarket/shared/src/realMode";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(cleanup);

const FULL_TX_HASH_1 = "0x" + "a".repeat(64);
const FULL_TX_HASH_2 = "0x" + "b".repeat(64);
const FULL_TX_HASH_3 = "0x" + "c".repeat(64);
const FULL_TX_HASH_4 = "0x" + "d".repeat(64);
const FULL_TX_HASH_5 = "0x" + "e".repeat(64);
const FULL_TX_HASH_6 = "0x" + "f".repeat(64);

const pkg: ProviderAnswerPackage = {
  taskId: "task_001",
  providerAgentId: 1,
  providerId: "execution-research-expert",
  providerName: "区块链执行研究专家",
  coverageStatement: "覆盖 2021–2026 年区块链交易执行加速方向的论文",
  answers: [
    {
      providerAnswer: "乐观并行执行是当前执行加速的核心方向。",
      sourceTitle: "Block-STM",
      sourceLocator: "arXiv:2203.06871",
      sourceMetadata: { year: 2022, type: "paper" },
      excerptOrSummary: "Block-STM 通过乐观并发控制实现并行执行。",
      relevanceExplanation: "直接相关，但不能证明普遍适用所有工作负载。"
    },
    {
      providerAnswer: "投机执行可降低延迟。",
      sourceTitle: "Speculative Execution Survey",
      sourceLocator: "arXiv:2301.09999",
      sourceMetadata: { year: 2023, type: "paper" },
      excerptOrSummary: "综述投机执行在区块链的应用。",
      relevanceExplanation: "与主题相关，覆盖范围限于 EVM 兼容链。"
    }
  ],
  packageHash: "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890ab"
};

const allTxRecords: TxRecord[] = [
  { label: "approve", coboTxId: "cobo_1", txHash: FULL_TX_HASH_1, status: "confirmed" },
  { label: "createJob", coboTxId: "cobo_2", txHash: FULL_TX_HASH_2, status: "confirmed" },
  { label: "setBudget", coboTxId: "cobo_3", txHash: FULL_TX_HASH_3, status: "confirmed" },
  { label: "fund", coboTxId: "cobo_4", txHash: FULL_TX_HASH_4, status: "confirmed" },
  { label: "submit", coboTxId: "cobo_5", txHash: FULL_TX_HASH_5, status: "confirmed" },
  { label: "complete", coboTxId: "cobo_6", txHash: FULL_TX_HASH_6, status: "confirmed" }
];

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: "task_001",
    userQuestion: "区块链交易执行加速的最新研究是什么？",
    status: "Settled",
    budgetLimit: "5 test USDC",
    selectedProviderIds: ["execution-research-expert"],
    plan: null,
    pact: {
      intent: "Fund one provider research job",
      totalBudget: "5 test USDC",
      perJobCap: "1 test USDC",
      allowedTargets: ["ProofMarketEscrow", "MockUSDC"],
      allowedFunctions: ["createJob", "fund", "submit", "complete", "reject", "approve"],
      denyRules: ["direct transfer"],
      expiresInMinutes: 30,
      pactId: "pact_abc123",
      status: "active"
    },
    providerPackage: pkg,
    audit: [
      {
        id: "evt_01",
        taskId: "task_001",
        source: "verifier",
        type: "verification_passed",
        result: "success",
        message: "Judge verdict: valid. verdictHash=0x" + "9".repeat(64),
        txHash: null,
        pactId: null,
        jobId: 42,
        createdAt: "2026-01-01T00:01:00.000Z"
      }
    ],
    jobId: 42,
    mode: "fixture",
    txRecords: allTxRecords,
    claudePlanRaw: null,
    denial: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides
  };
}

const noop = vi.fn();

describe("Step6Done — final answer (settled)", () => {
  it("renders the conclusion from providerPackage first answer", () => {
    render(
      <Step6Done
        task={task()}
        onSettle={noop}
        onReset={noop}
        onOpenAudit={noop}
      />
    );
    expect(screen.getByText("乐观并行执行是当前执行加速的核心方向。")).toBeTruthy();
  });

  it("renders evidence summary with count", () => {
    render(
      <Step6Done
        task={task()}
        onSettle={noop}
        onReset={noop}
        onOpenAudit={noop}
      />
    );
    expect(screen.getByText(/共 2 条证据/)).toBeTruthy();
  });

  it("renders source title in evidence summary", () => {
    render(
      <Step6Done
        task={task()}
        onSettle={noop}
        onReset={noop}
        onOpenAudit={noop}
      />
    );
    expect(screen.getByText(/Block-STM/)).toBeTruthy();
  });
});

describe("Step6Done — 凭证清单 (settled)", () => {
  it("renders all 6 tx records with Chinese labels", () => {
    render(
      <Step6Done
        task={task()}
        onSettle={noop}
        onReset={noop}
        onOpenAudit={noop}
      />
    );
    expect(screen.getByText(/授权代币/)).toBeTruthy();
    expect(screen.getByText(/创建订单/)).toBeTruthy();
    expect(screen.getByText(/设定预算/)).toBeTruthy();
    expect(screen.getByText(/注入托管资金/)).toBeTruthy();
    expect(screen.getByText(/提交证据/)).toBeTruthy();
    expect(screen.getByText(/结算放款/)).toBeTruthy();
  });

  it("renders all 6 tx hashes as Etherscan links", () => {
    render(
      <Step6Done
        task={task()}
        onSettle={noop}
        onReset={noop}
        onOpenAudit={noop}
      />
    );
    const links = document.querySelectorAll<HTMLAnchorElement>("a.hash");
    expect(links.length).toBe(6);
    for (const link of Array.from(links)) {
      expect(link.href).toContain("sepolia.etherscan.io/tx/");
    }
  });

  it("renders jobId in mono", () => {
    render(
      <Step6Done
        task={task()}
        onSettle={noop}
        onReset={noop}
        onOpenAudit={noop}
      />
    );
    expect(screen.getByText("42")).toBeTruthy();
  });

  it("renders pactId in mono", () => {
    render(
      <Step6Done
        task={task()}
        onSettle={noop}
        onReset={noop}
        onOpenAudit={noop}
      />
    );
    expect(screen.getByText("pact_abc123")).toBeTruthy();
  });

  it("renders packageHash in mono", () => {
    render(
      <Step6Done
        task={task()}
        onSettle={noop}
        onReset={noop}
        onOpenAudit={noop}
      />
    );
    expect(
      screen.getByText("0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890ab")
    ).toBeTruthy();
  });

  it("renders verdictHash from audit events", () => {
    render(
      <Step6Done
        task={task()}
        onSettle={noop}
        onReset={noop}
        onOpenAudit={noop}
      />
    );
    // The audit event message contains verdictHash=0x999...
    expect(screen.getByText("0x" + "9".repeat(64))).toBeTruthy();
  });
});

describe("Step6Done — actions (settled)", () => {
  it("shows exactly one 开始新任务 button", () => {
    render(
      <Step6Done
        task={task()}
        onSettle={noop}
        onReset={noop}
        onOpenAudit={noop}
      />
    );
    const btns = screen.getAllByRole("button", { name: /开始新任务/ });
    expect(btns.length).toBe(1);
  });

  it("shows 查看完整审计 button", () => {
    render(
      <Step6Done
        task={task()}
        onSettle={noop}
        onReset={noop}
        onOpenAudit={noop}
      />
    );
    expect(screen.getByRole("button", { name: /查看完整审计/ })).toBeTruthy();
  });

  it("calls onReset when 开始新任务 is clicked", () => {
    const onReset = vi.fn();
    render(
      <Step6Done
        task={task()}
        onSettle={noop}
        onReset={onReset}
        onOpenAudit={noop}
      />
    );
    screen.getByRole("button", { name: /开始新任务/ }).click();
    expect(onReset).toHaveBeenCalledOnce();
  });

  it("calls onOpenAudit when 查看完整审计 is clicked", () => {
    const onOpenAudit = vi.fn();
    render(
      <Step6Done
        task={task()}
        onSettle={noop}
        onReset={noop}
        onOpenAudit={onOpenAudit}
      />
    );
    screen.getByRole("button", { name: /查看完整审计/ }).click();
    expect(onOpenAudit).toHaveBeenCalledOnce();
  });
});

describe("Step6Done — Verified (pre-settle)", () => {
  it("shows 确认结算 button when status is Verified", () => {
    render(
      <Step6Done
        task={task({ status: "Verified" })}
        onSettle={noop}
        onReset={noop}
        onOpenAudit={noop}
      />
    );
    expect(screen.getByRole("button", { name: /确认结算/ })).toBeTruthy();
  });

  it("shows pending message when Verified (not yet settled)", () => {
    render(
      <Step6Done
        task={task({ status: "Verified" })}
        onSettle={noop}
        onReset={noop}
        onOpenAudit={noop}
      />
    );
    expect(screen.getByText(/证据已通过核验/)).toBeTruthy();
  });

  it("does NOT show receipt when Verified (not yet settled)", () => {
    render(
      <Step6Done
        task={task({ status: "Verified" })}
        onSettle={noop}
        onReset={noop}
        onOpenAudit={noop}
      />
    );
    // Receipt section only shows on Settled/Audited
    expect(screen.queryByText(/凭证清单/)).toBeNull();
  });

  it("disables 确认结算 when isBusy", () => {
    render(
      <Step6Done
        task={task({ status: "Verified" })}
        onSettle={noop}
        onReset={noop}
        onOpenAudit={noop}
        isBusy={true}
      />
    );
    const btn = screen.getByRole("button", { name: /确认结算/ });
    expect((btn as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("Step6Done — Audited state", () => {
  it("renders receipt (凭证清单) when status is Audited", () => {
    render(
      <Step6Done
        task={task({ status: "Audited" })}
        onSettle={noop}
        onReset={noop}
        onOpenAudit={noop}
      />
    );
    expect(screen.getByText(/凭证清单/)).toBeTruthy();
  });
});

describe("Step6Done — challenge window gate (W_c)", () => {
  it("disables settlement with a countdown while the window is open", () => {
    const endsAt = new Date(Date.now() + 120_000).toISOString();
    render(
      <Step6Done
        task={task({ status: "Verified", challengeWindowEndsAt: endsAt })}
        onSettle={noop}
        onReset={noop}
        onOpenAudit={noop}
      />
    );
    const btn = screen.getByRole("button", { name: /挑战窗口剩余/ });
    expect((btn as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId("settle-window-note").textContent).toContain("挑战窗口剩余");
  });

  it("re-enables 确认结算 once the window has passed", () => {
    const endsAt = new Date(Date.now() - 1_000).toISOString();
    render(
      <Step6Done
        task={task({ status: "Verified", challengeWindowEndsAt: endsAt })}
        onSettle={noop}
        onReset={noop}
        onOpenAudit={noop}
      />
    );
    const btn = screen.getByRole("button", { name: /确认结算/ });
    expect((btn as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByTestId("settle-window-note").textContent).toContain("挑战窗口已结束");
  });
});

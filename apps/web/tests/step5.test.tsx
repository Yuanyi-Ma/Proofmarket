// @vitest-environment jsdom
import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Step5Evidence } from "../components/steps/Step5Evidence";
import type { Task, ProviderAnswerPackage, TaskChallenge, ChallengeVote } from "@proofmarket/shared/src/types";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(cleanup);

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
      excerptOrSummary: "Block-STM 通过乐观并发控制实现并行执行，减少冲突重执行。",
      relevanceExplanation: "直接支持执行加速主题，但不能证明普遍适用所有工作负载。"
    },
    {
      providerAnswer: "投机执行可进一步降低延迟。",
      sourceTitle: "Speculative Execution Survey",
      sourceLocator: "arXiv:2301.09999",
      sourceMetadata: { year: 2023, type: "paper" },
      excerptOrSummary: "综述了投机执行在区块链场景的应用与局限。",
      relevanceExplanation: "与主题相关，但覆盖范围仅限于 EVM 兼容链。"
    }
  ],
  packageHash: "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890ab"
};

const COUNTER_EVIDENCE_HASH =
  "0xdeadbeef11111111111111111111111111111111111111111111111111111111ab";

const RESULT_HASH =
  "0xcafe000000000000000000000000000000000000000000000000000000000001";

const challengeFixture: TaskChallenge = {
  type: "CoverageMiss",
  counterEvidenceHash: COUNTER_EVIDENCE_HASH
};

const voteFixture: ChallengeVote = {
  voterId: "resolver-demo-001",
  vote: "ProviderFault",
  reasonCode: "COVERAGE_MISS",
  reason:
    "Provider 声明覆盖 2021-2026 年区块链执行加速方向，却遗漏了 Block-STM，覆盖缺失成立。",
  resultHash: RESULT_HASH
};

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: "task_001",
    userQuestion: "区块链交易执行加速的最新研究是什么？",
    status: "Delivered",
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
    audit: [],
    jobId: 42,
    mode: "fixture",
    txRecords: [],
    claudePlanRaw: null,
    denial: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides
  };
}

const noop = vi.fn();
const defaultProps = {
  onVerify: noop,
  onOpenChallenge: noop,
  onRequestVote: noop,
  onResolve: noop,
};

describe("Step5Evidence — evidence package rendering", () => {
  it("renders provider name", () => {
    render(<Step5Evidence task={task()} {...defaultProps} />);
    expect(screen.getByText("区块链执行研究专家")).toBeTruthy();
  });

  it("renders coverage statement", () => {
    render(<Step5Evidence task={task()} {...defaultProps} />);
    expect(screen.getByText("覆盖 2021–2026 年区块链交易执行加速方向的论文")).toBeTruthy();
  });

  it("renders source titles for all evidence items", () => {
    render(<Step5Evidence task={task()} {...defaultProps} />);
    expect(screen.getByText("Block-STM")).toBeTruthy();
    expect(screen.getByText("Speculative Execution Survey")).toBeTruthy();
  });

  it("renders source locators in summary (mono)", () => {
    render(<Step5Evidence task={task()} {...defaultProps} />);
    const locators = screen.getAllByText("arXiv:2203.06871");
    expect(locators.length).toBeGreaterThan(0);
  });

  it("renders package hash in mono", () => {
    render(<Step5Evidence task={task()} {...defaultProps} />);
    expect(
      screen.getByText("0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890ab")
    ).toBeTruthy();
  });
});

describe("Step5Evidence — verify action state", () => {
  it("shows 核验证据 button when status is Delivered", () => {
    render(<Step5Evidence task={task({ status: "Delivered" })} {...defaultProps} />);
    expect(screen.getByRole("button", { name: /核验证据/ })).toBeTruthy();
  });

  it("does not show 核验证据 button in readOnly mode", () => {
    render(<Step5Evidence task={task({ status: "Delivered" })} {...defaultProps} readOnly={true} />);
    expect(screen.queryByRole("button", { name: /核验证据/ })).toBeNull();
  });

  it("disables 核验证据 when isBusy", () => {
    render(<Step5Evidence task={task({ status: "Delivered" })} {...defaultProps} isBusy={true} />);
    const btn = screen.getByRole("button", { name: /核验证据/ });
    expect((btn as HTMLButtonElement).disabled).toBe(true);
  });

  it("shows 验证通过 status text when Verified", () => {
    render(<Step5Evidence task={task({ status: "Verified" })} {...defaultProps} />);
    expect(screen.getByText("验证通过")).toBeTruthy();
  });
});

describe("Step5Evidence — challenge entry at Delivered", () => {
  it("shows 发起挑战 button at Delivered alongside 核验证据", () => {
    render(<Step5Evidence task={task({ status: "Delivered" })} {...defaultProps} />);
    // Both the primary and secondary actions should be present
    expect(screen.getByRole("button", { name: /核验证据/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /发起挑战/ })).toBeTruthy();
  });

  it("disables 发起挑战 when isBusy", () => {
    render(<Step5Evidence task={task({ status: "Delivered" })} {...defaultProps} isBusy={true} />);
    const btn = screen.getByRole("button", { name: /发起挑战/ });
    expect((btn as HTMLButtonElement).disabled).toBe(true);
  });

  it("does not show 发起挑战 in readOnly mode", () => {
    render(<Step5Evidence task={task({ status: "Delivered" })} {...defaultProps} readOnly={true} />);
    expect(screen.queryByRole("button", { name: /发起挑战/ })).toBeNull();
  });
});

describe("Step5Evidence — Challenged stage", () => {
  const challengedTask = task({
    status: "Challenged",
    challenge: challengeFixture
  });

  it("shows 挑战已发起 heading", () => {
    render(<Step5Evidence task={challengedTask} {...defaultProps} />);
    expect(screen.getByText("挑战已发起")).toBeTruthy();
  });

  it("shows challenge type CoverageMiss with Chinese label", () => {
    render(<Step5Evidence task={challengedTask} {...defaultProps} />);
    expect(screen.getAllByText(/CoverageMiss/).length).toBeGreaterThan(0);
    expect(screen.getByText(/覆盖声明漏检/)).toBeTruthy();
  });

  it("shows counterEvidenceHash in mono", () => {
    render(<Step5Evidence task={challengedTask} {...defaultProps} />);
    const hashes = screen.getAllByText(COUNTER_EVIDENCE_HASH);
    expect(hashes.length).toBeGreaterThan(0);
  });

  it("shows 提交给审判者的材料 panel with provider summary", () => {
    render(<Step5Evidence task={challengedTask} {...defaultProps} />);
    expect(screen.getByText("提交给审判者的材料")).toBeTruthy();
    // Provider name appears in both the package header and the materials panel
    expect(screen.getAllByText(/区块链执行研究专家/).length).toBeGreaterThan(0);
  });

  it("shows 请求审判 action button", () => {
    render(<Step5Evidence task={challengedTask} {...defaultProps} />);
    expect(screen.getByRole("button", { name: /请求审判/ })).toBeTruthy();
  });

  it("shows real-mode tx records when present", () => {
    const realTask = task({
      status: "Challenged",
      mode: "real",
      challenge: challengeFixture,
      txRecords: [
        {
          label: "approveDeposit",
          coboTxId: null,
          txHash: "0xaaa0000000000000000000000000000000000000000000000000000000000001",
          status: "confirmed"
        },
        {
          label: "openChallenge",
          coboTxId: null,
          txHash: "0xbbb0000000000000000000000000000000000000000000000000000000000002",
          status: "confirmed"
        }
      ]
    });
    render(<Step5Evidence task={realTask} {...defaultProps} />);
    // Should show 链上交易 section label
    expect(screen.getByText("链上交易")).toBeTruthy();
    // Should show both tx labels
    expect(screen.getByText("授权挑战押金")).toBeTruthy();
    expect(screen.getByText("发起挑战（链上）")).toBeTruthy();
  });
});

describe("Step5Evidence — ChallengeWon stage", () => {
  const wonTask = task({
    status: "ChallengeWon",
    challenge: { ...challengeFixture, vote: voteFixture }
  });

  it("shows ProviderFault verdict heading", () => {
    render(<Step5Evidence task={wonTask} {...defaultProps} />);
    expect(screen.getByText(/ProviderFault/)).toBeTruthy();
    expect(screen.getByText(/覆盖声明漏检，挑战成立/)).toBeTruthy();
  });

  it("shows vote reason text", () => {
    render(<Step5Evidence task={wonTask} {...defaultProps} />);
    // Block-STM appears in both evidence items and the vote reason text
    expect(screen.getAllByText(/Block-STM/).length).toBeGreaterThan(0);
    expect(screen.getByText(/覆盖缺失成立/)).toBeTruthy();
  });

  it("shows resultHash in mono", () => {
    render(<Step5Evidence task={wonTask} {...defaultProps} />);
    const hashes = screen.getAllByText(RESULT_HASH);
    expect(hashes.length).toBeGreaterThan(0);
  });

  it("shows 执行裁决 button", () => {
    render(<Step5Evidence task={wonTask} {...defaultProps} />);
    expect(screen.getByRole("button", { name: /执行裁决/ })).toBeTruthy();
  });

  it("still shows materials panel (counterEvidenceHash) for reference", () => {
    render(<Step5Evidence task={wonTask} {...defaultProps} />);
    const hashes = screen.getAllByText(COUNTER_EVIDENCE_HASH);
    expect(hashes.length).toBeGreaterThan(0);
  });
});

describe("Step5Evidence — RefundedOrSlashed stage", () => {
  const resolvedTask = task({
    status: "RefundedOrSlashed",
    challenge: {
      ...challengeFixture,
      vote: voteFixture,
      resolvedTxHash: null
    }
  });

  it("shows 裁决已执行 heading", () => {
    render(<Step5Evidence task={resolvedTask} {...defaultProps} />);
    // 裁决已执行 appears in both the status label area and the stage heading
    expect(screen.getAllByText(/裁决已执行/).length).toBeGreaterThan(0);
  });

  it("shows three fund action lines", () => {
    render(<Step5Evidence task={resolvedTask} {...defaultProps} />);
    expect(screen.getByText(/扣除 Provider 质押 50%/)).toBeTruthy();
    expect(screen.getByText(/托管资金退款买方/)).toBeTruthy();
    expect(screen.getByText(/挑战者押金退回/)).toBeTruthy();
  });

  it("shows resolve txHash with etherscan link in real mode", () => {
    const realResolvedTask = task({
      status: "RefundedOrSlashed",
      mode: "real",
      challenge: {
        ...challengeFixture,
        vote: voteFixture,
        resolvedTxHash: "0xffff000000000000000000000000000000000000000000000000000000000099"
      },
      txRecords: [
        {
          label: "resolve",
          coboTxId: null,
          txHash: "0xffff000000000000000000000000000000000000000000000000000000000099",
          status: "confirmed"
        }
      ]
    });
    render(<Step5Evidence task={realResolvedTask} {...defaultProps} />);
    // Should show a shortened hash linked to etherscan
    const link = screen.getByRole("link", { name: /Etherscan 查看裁决交易/ });
    expect(link).toBeTruthy();
    expect((link as HTMLAnchorElement).href).toContain("sepolia.etherscan.io");
  });

  it("shows terminal audit prompt", () => {
    render(<Step5Evidence task={resolvedTask} {...defaultProps} />);
    expect(screen.getByText(/挑战流程已完成/)).toBeTruthy();
  });

  it("does not show 执行裁决 button (terminal state)", () => {
    render(<Step5Evidence task={resolvedTask} {...defaultProps} />);
    expect(screen.queryByRole("button", { name: /执行裁决/ })).toBeNull();
  });
});

describe("Step5Evidence — real-mode honesty note", () => {
  it("shows honesty note at Delivered in real mode", () => {
    render(
      <Step5Evidence
        task={task({ mode: "real", status: "Delivered" })}
        {...defaultProps}
      />
    );
    expect(screen.getByText(/真实链上挑战需已部署 ChallengeManager/)).toBeTruthy();
  });

  it("does not show honesty note in fixture mode", () => {
    render(
      <Step5Evidence
        task={task({ mode: "fixture", status: "Delivered" })}
        {...defaultProps}
      />
    );
    expect(screen.queryByText(/真实链上挑战需已部署 ChallengeManager/)).toBeNull();
  });
});

describe("Step5Evidence — no package", () => {
  it("shows waiting message when providerPackage is null", () => {
    render(
      <Step5Evidence
        task={task({ providerPackage: null })}
        {...defaultProps}
      />
    );
    expect(screen.getByText(/等待 Provider 交付证据包/)).toBeTruthy();
  });
});

describe("Step5Evidence — legacy status badges (status labels)", () => {
  it("shows 挑战进行中 status text when status is Challenged", () => {
    render(
      <Step5Evidence
        task={task({ mode: "fixture", status: "Challenged", challenge: challengeFixture })}
        {...defaultProps}
      />
    );
    expect(screen.getAllByText(/挑战进行中/).length).toBeGreaterThan(0);
  });

  it("shows 挑战成立 status text when ChallengeWon", () => {
    render(
      <Step5Evidence
        task={task({
          mode: "fixture",
          status: "ChallengeWon",
          challenge: { ...challengeFixture, vote: voteFixture }
        })}
        {...defaultProps}
      />
    );
    expect(screen.getAllByText(/挑战成立/).length).toBeGreaterThan(0);
  });

  it("shows 裁决已执行 status when RefundedOrSlashed", () => {
    render(
      <Step5Evidence
        task={task({
          mode: "fixture",
          status: "RefundedOrSlashed",
          challenge: { ...challengeFixture, vote: voteFixture }
        })}
        {...defaultProps}
      />
    );
    expect(screen.getAllByText(/裁决已执行/).length).toBeGreaterThan(0);
  });
});

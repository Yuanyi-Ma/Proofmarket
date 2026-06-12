// @vitest-environment jsdom
import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Step5Evidence } from "../components/steps/Step5Evidence";
import { presetDefense, presetJuryVotes } from "@proofmarket/shared/src/fixtures";
import type { Task, ProviderAnswerPackage, TaskChallenge } from "@proofmarket/shared/src/types";

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
      sourceLibrary: "arxiv",
      sourceMetadata: { year: 2022, type: "paper" },
      excerptOrSummary: "Block-STM 通过乐观并发控制实现并行执行，减少冲突重执行。",
      relevanceExplanation: "直接支持执行加速主题，但不能证明普遍适用所有工作负载。"
    },
    {
      providerAnswer: "投机执行可进一步降低延迟。",
      sourceTitle: "Speculative Execution Survey",
      sourceLocator: "arXiv:2301.09999",
      sourceLibrary: "arxiv",
      sourceMetadata: { year: 2023, type: "paper" },
      excerptOrSummary: "综述了投机执行在区块链场景的应用与局限。",
      relevanceExplanation: "与主题相关，但覆盖范围仅限于 EVM 兼容链。"
    }
  ],
  packageHash: "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890ab"
};

const COUNTER_EVIDENCE_HASH =
  "0xdeadbeef11111111111111111111111111111111111111111111111111111111ab";

const challengeFixture: TaskChallenge = {
  type: "CoverageMiss",
  statement: "交付的证据包未包含 Block-STM——承诺范围内的代表性工作，属于覆盖漏检。",
  hitCoverageClause: "覆盖声明：『2021-2026 年区块链执行加速方向（IEEE / Elsevier）』",
  counterEvidenceHash: COUNTER_EVIDENCE_HASH,
  defense: { ...presetDefense }
};

const votesFixture = presetJuryVotes([
  "0x0000000000000000000000000000000000000a01",
  "0x0000000000000000000000000000000000000a02",
  "0x0000000000000000000000000000000000000a03"
]);

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
  it("shows 核验简报 button when status is Delivered", () => {
    render(<Step5Evidence task={task({ status: "Delivered" })} {...defaultProps} />);
    expect(screen.getByRole("button", { name: /核验简报/ })).toBeTruthy();
  });

  it("does not show 核验简报 button in readOnly mode", () => {
    render(<Step5Evidence task={task({ status: "Delivered" })} {...defaultProps} readOnly={true} />);
    expect(screen.queryByRole("button", { name: /核验简报/ })).toBeNull();
  });

  it("disables 核验简报 when isBusy", () => {
    render(<Step5Evidence task={task({ status: "Delivered" })} {...defaultProps} isBusy={true} />);
    const btn = screen.getByRole("button", { name: /核验简报/ });
    expect((btn as HTMLButtonElement).disabled).toBe(true);
  });

  it("shows 验证通过 status text when Verified", () => {
    render(<Step5Evidence task={task({ status: "Verified" })} {...defaultProps} />);
    expect(screen.getByText("验证通过")).toBeTruthy();
  });
});

describe("Step5Evidence — challenge entry at Delivered", () => {
  it("shows 发起挑战 button at Delivered alongside 核验简报", () => {
    render(<Step5Evidence task={task({ status: "Delivered" })} {...defaultProps} />);
    // Both the primary and secondary actions should be present
    expect(screen.getByRole("button", { name: /核验简报/ })).toBeTruthy();
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

describe("Step5Evidence — challenge window banner (real mode)", () => {
  it("shows a ticking countdown while the window is open", () => {
    const endsAt = new Date(Date.now() + 120_000).toISOString();
    render(
      <Step5Evidence
        task={task({ mode: "real", status: "Delivered", challengeWindowEndsAt: endsAt })}
        {...defaultProps}
      />
    );
    expect(screen.getByTestId("challenge-window-banner").textContent).toContain("挑战窗口剩余");
  });

  it("announces a closed window once it has passed", () => {
    const endsAt = new Date(Date.now() - 1_000).toISOString();
    render(
      <Step5Evidence
        task={task({ mode: "real", status: "Delivered", challengeWindowEndsAt: endsAt })}
        {...defaultProps}
      />
    );
    expect(screen.getByTestId("challenge-window-banner").textContent).toContain("挑战窗口已结束");
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
    expect(screen.getAllByText(/覆盖声明漏检/).length).toBeGreaterThan(0);
  });

  it("shows the deposit D and jury fee F as separate locked rows", () => {
    render(<Step5Evidence task={challengedTask} {...defaultProps} />);
    expect(screen.getByText("挑战押金 D")).toBeTruthy();
    expect(screen.getByText("审判费 F")).toBeTruthy();
  });

  it("shows counterEvidenceHash in mono", () => {
    render(<Step5Evidence task={challengedTask} {...defaultProps} />);
    const hashes = screen.getAllByText(COUNTER_EVIDENCE_HASH);
    expect(hashes.length).toBeGreaterThan(0);
  });

  it("shows the 挑战书 panel with statement and coverage clause", () => {
    render(<Step5Evidence task={challengedTask} {...defaultProps} />);
    expect(screen.getByText(/挑战书（提交给审判团的材料）/)).toBeTruthy();
    expect(screen.getByText(challengeFixture.statement)).toBeTruthy();
    expect(screen.getAllByText(challengeFixture.hitCoverageClause).length).toBeGreaterThan(0);
  });

  it("shows the provider defense card with plaintext and hash", () => {
    render(<Step5Evidence task={challengedTask} {...defaultProps} />);
    expect(screen.getByText(/专家应辩书/)).toBeTruthy();
    expect(screen.getByText(presetDefense.statement)).toBeTruthy();
    expect(screen.getByText(presetDefense.defenseHash)).toBeTruthy();
  });

  it("shows 请求审判团裁决 action button", () => {
    render(<Step5Evidence task={challengedTask} {...defaultProps} />);
    expect(screen.getByRole("button", { name: /请求审判团裁决/ })).toBeTruthy();
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
        },
        {
          label: "defense",
          coboTxId: null,
          txHash: "0xccc0000000000000000000000000000000000000000000000000000000000003",
          status: "confirmed"
        }
      ]
    });
    render(<Step5Evidence task={realTask} {...defaultProps} />);
    // Should show 链上交易 section label
    expect(screen.getByText("链上交易")).toBeTruthy();
    // Should show all three tx labels
    expect(screen.getByText("授权押金 + 审判费")).toBeTruthy();
    expect(screen.getByText("发起挑战（链上）")).toBeTruthy();
    expect(screen.getByText("提交应辩书（链上）")).toBeTruthy();
  });
});

describe("Step5Evidence — ChallengeWon stage (jury verdict)", () => {
  const wonTask = task({
    status: "ChallengeWon",
    challenge: { ...challengeFixture, votes: votesFixture }
  });

  it("shows the 2:1 majority verdict heading", () => {
    render(<Step5Evidence task={wonTask} {...defaultProps} />);
    expect(screen.getByText(/审判团投票 2 : 1/)).toBeTruthy();
    expect(screen.getByText(/覆盖声明漏检，挑战成立/)).toBeTruthy();
  });

  it("renders one neutral vote card per juror (no model-brand claims)", () => {
    render(<Step5Evidence task={wonTask} {...defaultProps} />);
    votesFixture.forEach((vote, i) => {
      expect(screen.getByTestId(`jury-vote-${vote.jurorId}`)).toBeTruthy();
      expect(screen.getByText(`审判方 ${i + 1}`)).toBeTruthy();
      // Model brands are unverifiable claims — they must not render.
      expect(screen.queryByText(new RegExp(vote.modelFamily))).toBeNull();
    });
  });

  it("marks the dissenting vote and shows its reason book", () => {
    render(<Step5Evidence task={wonTask} {...defaultProps} />);
    expect(screen.getByText(/NotFault（异议）/)).toBeTruthy();
    const dissent = votesFixture.find((v) => v.vote === "ProviderNotFault")!;
    expect(screen.getByText(dissent.reasonBook.conclusion)).toBeTruthy();
  });

  it("shows reason-book hashes (on-chain commitments)", () => {
    render(<Step5Evidence task={wonTask} {...defaultProps} />);
    for (const vote of votesFixture) {
      expect(screen.getByText(vote.reasonHash)).toBeTruthy();
    }
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
      votes: votesFixture,
      resolvedTxHash: null
    }
  });

  it("shows 裁决已执行 heading", () => {
    render(<Step5Evidence task={resolvedTask} {...defaultProps} />);
    // 裁决已执行 appears in both the status label area and the stage heading
    expect(screen.getAllByText(/裁决已执行/).length).toBeGreaterThan(0);
  });

  it("shows the fund action lines including the jury fee", () => {
    render(<Step5Evidence task={resolvedTask} {...defaultProps} />);
    expect(screen.getByText(/扣罚专家本单履约 bond（10 mUSDC）的 50%/)).toBeTruthy();
    expect(screen.getByText(/托管资金退款买方/)).toBeTruthy();
    expect(screen.getByText(/挑战者押金 \+ 审判费全额退回/)).toBeTruthy();
    expect(screen.getByText(/三位审判方均分/)).toBeTruthy();
  });

  it("does not leak roadmap copy into the resolved view", () => {
    render(<Step5Evidence task={resolvedTask} {...defaultProps} />);
    expect(screen.queryByText(/后续可做/)).toBeNull();
  });

  it("shows resolve txHash with etherscan link in real mode", () => {
    const realResolvedTask = task({
      status: "RefundedOrSlashed",
      mode: "real",
      challenge: {
        ...challengeFixture,
        votes: votesFixture,
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

describe("Step5Evidence — real-mode challenge explainer", () => {
  it("shows the challenge explainer at Delivered in real mode", () => {
    render(
      <Step5Evidence
        task={task({ mode: "real", status: "Delivered" })}
        {...defaultProps}
      />
    );
    expect(screen.getByText(/若对简报有异议，可发起挑战/)).toBeTruthy();
  });

  it("does not show the challenge explainer in fixture mode", () => {
    render(
      <Step5Evidence
        task={task({ mode: "fixture", status: "Delivered" })}
        {...defaultProps}
      />
    );
    expect(screen.queryByText(/若对简报有异议，可发起挑战/)).toBeNull();
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
    expect(screen.getByText(/等待专家交付研究简报/)).toBeTruthy();
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
          challenge: { ...challengeFixture, votes: votesFixture }
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
          challenge: { ...challengeFixture, votes: votesFixture }
        })}
        {...defaultProps}
      />
    );
    expect(screen.getAllByText(/裁决已执行/).length).toBeGreaterThan(0);
  });
});

// ── 我方 Agent 抽查核验 + Merkle 承诺 ────────────────────────────────────────
import { buildPackageCommitment } from "@proofmarket/shared/src/merkle";

/** 同一内容、真实承诺根：抽查面板的 Merkle 路径验证是真实计算。 */
function withRealRoot(p: ProviderAnswerPackage): ProviderAnswerPackage {
  const { packageHash: _ignored, ...preimage } = p;
  return { ...p, packageHash: buildPackageCommitment(preimage).root };
}

const expertPkg: ProviderAnswerPackage = withRealRoot({
  ...pkg,
  coverageStatement:
    "本简报基于论文库与行业研报库，覆盖 2021-2026 年区块链交易执行加速方向。",
  answers: [
    {
      ...pkg.answers[0],
      // 与 lib/localCorpus.ts 的存档段落逐字一致——查准内容比对是真实子串匹配
      excerptOrSummary:
        "Block-STM 利用乐观并行执行与冲突检测，在保持确定性结果的前提下并发执行有序的区块链交易。"
    },
    {
      providerAnswer: "状态热点约束并行收益。",
      sourceTitle: "高吞吐智能合约执行中的状态热点",
      sourceLocator: "delphi:state-hotspots-2025",
      sourceLibrary: "delphi-digital",
      sourceMetadata: { year: 2025, type: "report" },
      excerptOrSummary: "状态热点与存储 I/O 仍可能主导执行延迟。",
      relevanceExplanation: "约束过度宣称。"
    }
  ]
});

const shallowPkg: ProviderAnswerPackage = withRealRoot({
  ...pkg,
  providerId: "shallow-search-provider",
  providerName: "文献速查 Agent",
  coverageStatement:
    "自报广泛覆盖 2021-2026 年区块链执行加速方向的学术论文（接入 IEEE Xplore / Elsevier ScienceDirect / arXiv）。",
  answers: [
    {
      providerAnswer: "性能提升主要来自共识与硬件。",
      sourceTitle: "通用区块链性能综述",
      sourceLocator: "web:generic-performance-overview",
      sourceLibrary: "open-web",
      sourceMetadata: { year: 2024, type: "report" },
      excerptOrSummary: "通用公开网页摘要。",
      relevanceExplanation: "相关但遗漏执行层专项工作。"
    }
  ]
});

describe("Step5Evidence — Agent spot check (scope-matched, real Merkle proofs)", () => {
  it("expert package: both samples in scope and present, no failure strip", () => {
    render(<Step5Evidence task={task({ providerPackage: expertPkg })} {...defaultProps} />);
    expect(screen.getByTestId("agent-spot-check")).toBeTruthy();
    expect(screen.queryByTestId("spot-check-failed")).toBeNull();
    expect(screen.getAllByText(/已包含在简报中/).length).toBe(2);
  });

  it("expert package: 查准 rows do both real checks — corpus match and Merkle proof", () => {
    render(<Step5Evidence task={task({ providerPackage: expertPkg })} {...defaultProps} />);
    expect(screen.getAllByText(/Merkle 路径折算回承诺根，验证通过/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/摘录与本地资料库存档段落逐字一致/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/Merkle 路径验证失败/)).toBeNull();
  });

  it("a tampered excerpt fails the corpus comparison (red, not copy)", () => {
    const tampered = withRealRoot({
      ...expertPkg,
      answers: [
        { ...expertPkg.answers[0], excerptOrSummary: "Block-STM 可让所有工作负载获得线性加速。" },
        expertPkg.answers[1]
      ]
    });
    render(<Step5Evidence task={task({ providerPackage: tampered })} {...defaultProps} />);
    expect(screen.getAllByText(/摘录在本地资料库中比对失败/).length).toBe(1);
  });

  it("shallow package: in-scope paper miss is red, out-of-scope report sample is excluded", () => {
    render(<Step5Evidence task={task({ providerPackage: shallowPkg })} {...defaultProps} />);
    expect(screen.getByTestId("spot-check-failed")).toBeTruthy();
    expect(screen.getAllByText(/未出现在简报中——且在其覆盖声明范围内/).length).toBe(1);
    expect(screen.getAllByText(/不在其覆盖声明范围/).length).toBe(1);
  });

  it("shallow package: secondary action becomes 生成挑战包，发起挑战", () => {
    render(<Step5Evidence task={task({ providerPackage: shallowPkg })} {...defaultProps} />);
    expect(screen.getByRole("button", { name: "生成挑战包，发起挑战" })).toBeTruthy();
  });

  it("expert package keeps the plain 发起挑战 action", () => {
    render(<Step5Evidence task={task({ providerPackage: expertPkg })} {...defaultProps} />);
    expect(screen.getByRole("button", { name: "发起挑战" })).toBeTruthy();
  });

  it("链上一致性 lists the commitment structure: overview leaf + one leaf per answer", () => {
    render(<Step5Evidence task={task({ providerPackage: expertPkg })} {...defaultProps} />);
    expect(screen.getAllByText(/总述与覆盖声明/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/叶 2/).length).toBeGreaterThan(0);
  });
});

describe("Step5Evidence — challenge materials rigor rows", () => {
  it("挑战书 shows the counter-evidence library and jury assignment basis", () => {
    render(
      <Step5Evidence
        task={task({ status: "Challenged", challenge: challengeFixture })}
        {...defaultProps}
      />
    );
    expect(screen.getAllByText(/反证所在库/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/审判方指派依据/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/开放获取/).length).toBeGreaterThan(0);
  });

  it("every jury vote card carries an 原文核对 row", () => {
    render(
      <Step5Evidence
        task={task({
          status: "ChallengeWon",
          challenge: { ...challengeFixture, votes: votesFixture }
        })}
        {...defaultProps}
      />
    );
    expect(screen.getAllByText("原文核对").length).toBe(votesFixture.length);
    expect(screen.getAllByText(/已凭自有 arXiv 访问权限调取/).length).toBeGreaterThan(0);
  });
});

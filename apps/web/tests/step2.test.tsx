import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { Step2Plan } from "../components/steps/Step2Plan";
import type { ProcurementPlan, Task } from "@proofmarket/shared/src/types";

const noop = vi.fn();

/** 最小完整 ProcurementPlan（不含 providerReputations —— 对应 fixture 模式）。 */
function basePlan(overrides: Partial<ProcurementPlan> = {}): ProcurementPlan {
  return {
    taskId: "task_001",
    userQuestion: "请调研区块链交易执行加速研究进展。",
    evidenceNeed: "需要 2021-2026 执行加速一手论文证据。",
    totalBudget: "5 test USDC",
    perJobCap: "1 test USDC",
    recommendedProviderId: "execution-research-expert",
    providerCount: 3,
    coverage: "Block-STM, parallel execution, conflict detection.",
    returnType: "provider-answer-package",
    verificationMethod: "Verifier checks locators, excerpts, relevance, coverage.",
    ...overrides
  };
}

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: "task_001",
    userQuestion: "请调研区块链交易执行加速研究进展。",
    status: "Planned",
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

describe("Step2Plan — provider reputation 来源展示", () => {
  it("real 模式：plan.providerReputations 有 erc8004 条目时，显示链上分数与「链上信誉」标签", () => {
    const realPlan = basePlan({
      providerReputations: [
        { providerId: "execution-research-expert", score: 980, source: "erc8004" },
        { providerId: "shallow-search-provider",   score: 720, source: "erc8004" },
        { providerId: "general-web-summary",        score: 830, source: "erc8004" }
      ]
    });

    const html = renderToStaticMarkup(
      <Step2Plan
        task={task({ mode: "real", plan: realPlan })}
        onConfirm={noop}
      />
    );

    // 三个 provider 行均应含「链上信誉」标签（按 badge 样式类计数，
    // 避免与页面说明文案里出现的「链上信誉」字样混淆）
    const badgeCount = (html.match(/chain-rep-tag/g) ?? []).length;
    expect(badgeCount).toBe(3);

    // 链上分数要出现在 HTML 中（非 fixture 原始值）
    expect(html).toContain("980");
    expect(html).toContain("720");
    expect(html).toContain("830");

    // 标签使用 chain-rep-tag 样式类
    expect(html).toContain('class="chain-rep-tag"');
  });

  it("fixture 模式：plan 不含 providerReputations 时，回退到 providerProfiles 本地分数，无「链上信誉」标签", () => {
    const fixturePlan = basePlan(); // 不含 providerReputations

    const html = renderToStaticMarkup(
      <Step2Plan
        task={task({ mode: "fixture", plan: fixturePlan })}
        onConfirm={noop}
      />
    );

    // 不应出现链上信誉 badge（说明文案里的「链上信誉」字样不算，按样式类判定）
    expect(html).not.toContain("chain-rep-tag");

    // 应显示 fixture 原始信誉分（970 / 620 / 800）
    expect(html).toContain("970");
    expect(html).toContain("620");
    expect(html).toContain("800");
  });

  it("providerReputations 存在但 source 不是 erc8004 时，不显示「链上信誉」标签", () => {
    const mixedPlan = basePlan({
      providerReputations: [
        { providerId: "execution-research-expert", score: 970, source: "fixture" }
      ]
    });

    const html = renderToStaticMarkup(
      <Step2Plan
        task={task({ mode: "real", plan: mixedPlan })}
        onConfirm={noop}
      />
    );

    expect(html).not.toContain("chain-rep-tag");
  });
});

describe("Step2Plan — 结构化挑战计数", () => {
  it("候选卡展示「被挑战 N 次 / 成立 M 次」结构化计数（0 挑战显示无记录）", () => {
    const markup = renderToStaticMarkup(
      <Step2Plan task={task({ plan: basePlan() })} onConfirm={noop} />
    );
    expect(markup).toContain("无挑战记录");
    expect(markup).toContain("被挑战 5 次 / 成立 3 次");
    expect(markup).toContain("被挑战 1 次 / 成立 0 次");
  });
});

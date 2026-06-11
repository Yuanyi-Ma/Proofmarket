import React, { useState } from "react";
import { providerProfiles } from "@proofmarket/shared/src/fixtures";
import type { PlanCandidate, ProviderId, Task } from "@proofmarket/shared/src/types";
import { DataRow } from "../Section";
import { StatusBadge } from "../StatusBadge";
import { StepShell } from "../StepShell";
import { sepoliaAddressUrl, shortAddress } from "../../lib/links";

type Step2PlanProps = {
  task: Task | null;
  /** Confirm with the provider the user selected from the shortlist. */
  onConfirm: (providerId: ProviderId) => void;
  isBusy?: boolean;
  /** True when reviewing this step after it is done: no action button. */
  readOnly?: boolean;
};

export function Step2Plan({
  task,
  onConfirm,
  isBusy = false,
  readOnly = false
}: Step2PlanProps) {
  const plan = task?.plan ?? null;

  // Ranked shortlist the user picks from. Real mode + fixture both populate
  // plan.candidates; fall back to the catalog order if somehow absent.
  const candidates: PlanCandidate[] =
    plan?.candidates && plan.candidates.length > 0
      ? plan.candidates
      : providerProfiles.map((p, i) => ({
          providerId: p.id,
          rank: i + 1,
          reason: p.coverage
        }));

  const [selected, setSelected] = useState<ProviderId>(
    (plan?.recommendedProviderId as ProviderId) ?? candidates[0]?.providerId
  );

  /** 查找某个 provider 在链上信誉列表里的得分（仅 real mode 有）。 */
  function onChainScore(providerId: ProviderId): number | null {
    if (!plan?.providerReputations) return null;
    const entry = plan.providerReputations.find((r) => r.providerId === providerId);
    return entry?.source === "erc8004" ? entry.score : null;
  }

  return (
    <StepShell
      stepNo={2}
      title="采购方案"
      subtitle="研究 Agent（真实 Claude Code）已分析你的问题并给出一份候选证据来源排序。选择一个后进入授权。"
      primary={
        readOnly || !plan
          ? undefined
          : {
              label: "确认方案，去授权",
              onClick: () => onConfirm(selected),
              disabled: isBusy || !selected,
              busy: isBusy
            }
      }
    >
      {plan ? (
        <>
          <article className="recommend-card">
            <div className="badge-row">
              <StatusBadge tone="success">Agent 分析</StatusBadge>
            </div>
            <DataRow label="判断依据" value={plan.evidenceNeed} />
          </article>

          <p className="small muted tight" style={{ marginTop: 16 }}>
            Agent 推荐排序（共 {candidates.length} 个候选，默认选中第一名，可改选）
          </p>
          <p className="small muted tight" style={{ marginTop: 4 }}>
            推荐基于各来源的【自报覆盖】【报价】【链上信誉 / 历史挑战记录】做的概率性判断；具体交付质量要等第 5 步由 Judge 核验后才能确定。
          </p>

          <div className="candidate-list" role="radiogroup" aria-label="选择 Provider">
            {candidates.map((candidate) => {
              const profile = providerProfiles.find((p) => p.id === candidate.providerId);
              if (!profile) return null;
              const isSelected = selected === candidate.providerId;
              const isTop = candidate.rank === 1;
              const chainScore = onChainScore(candidate.providerId);

              return (
                <label
                  key={candidate.providerId}
                  className={`candidate-card${isSelected ? " selected" : ""}`}
                  data-provider-row={candidate.providerId}
                >
                  <input
                    type="radio"
                    name="provider-choice"
                    className="candidate-radio"
                    value={candidate.providerId}
                    checked={isSelected}
                    disabled={readOnly || isBusy}
                    onChange={() => setSelected(candidate.providerId)}
                  />
                  <div className="candidate-body">
                    <div className="candidate-head">
                      <span className="candidate-rank">#{candidate.rank}</span>
                      <strong>{profile.name}</strong>
                      {isTop ? <StatusBadge tone="success">推荐</StatusBadge> : null}
                    </div>

                    <p className="candidate-reason">{candidate.reason}</p>

                    <div className="candidate-facts">
                      <span className="candidate-fact">
                        <span className="data-label">价格</span>
                        <span className="mono">{profile.price}</span>
                      </span>
                      <span className="candidate-fact">
                        <span className="data-label">信誉分</span>
                        <span className="mono">
                          {chainScore !== null ? (
                            <>
                              {chainScore} / 1000{" "}
                              <span className="chain-rep-tag">链上信誉</span>
                            </>
                          ) : (
                            <>{profile.reputationScore} / 1000</>
                          )}
                        </span>
                      </span>
                      <span className="candidate-fact">
                        <span className="data-label">挑战记录</span>
                        <span className="mono">
                          {profile.challengeStats.challenged === 0
                            ? "无挑战记录"
                            : `被挑战 ${profile.challengeStats.challenged} 次 / 成立 ${profile.challengeStats.upheld} 次`}
                        </span>
                      </span>
                      <span className="candidate-fact">
                        <span className="data-label">链上身份</span>
                        <span className="mono">
                          <a
                            className="hash"
                            href={sepoliaAddressUrl(profile.address)}
                            target="_blank"
                            rel="noreferrer"
                            aria-label={`在 Etherscan 查看 ${profile.name} 的链上地址`}
                            onClick={(e) => e.stopPropagation()}
                          >
                            {shortAddress(profile.address)}
                          </a>
                          {" · "}
                          <span className="muted">Agent #{profile.agentId}</span>
                        </span>
                      </span>
                    </div>

                    <p className="small muted tight candidate-coverage">{profile.coverage}</p>
                  </div>
                </label>
              );
            })}
          </div>

          {!readOnly && selected !== plan.recommendedProviderId ? (
            <div className="info-strip" style={{ marginTop: 12 }}>
              你选择的不是 Agent 的推荐项。该来源在"自报覆盖 + 链上信誉"上属于较低概率的选择，交付完整性的先验风险更高——若交付有缺口，可在第 5 步发起挑战。
            </div>
          ) : null}

          <div className="data-grid" style={{ marginTop: 16 }}>
            <DataRow label="验证方式" value={plan.verificationMethod} />
            <DataRow
              label="预算明细"
              value={
                <span className="mono">
                  总预算 {plan.totalBudget} · 单个 Provider 上限 {plan.perJobCap}
                </span>
              }
            />
            <DataRow
              label="返回内容"
              value="带证据定位与核验线索的回答包，而非整篇文档或无限制的钱包访问。"
            />
          </div>

          {readOnly ? (
            <div className="info-strip">方案已确认，此处为只读回看。</div>
          ) : null}
        </>
      ) : (
        <div className="info-strip">
          采购方案尚未生成。请回到第 1 步提交研究问题。
        </div>
      )}
    </StepShell>
  );
}

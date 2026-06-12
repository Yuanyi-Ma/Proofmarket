import React, { useState } from "react";
import { providerProfiles } from "@proofmarket/shared/src/fixtures";
import { LIBRARIES } from "@proofmarket/shared/src/libraries";
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
      title="委托方案"
      subtitle="Agent 已分析你的问题，给出候选领域专家排序。选择一位后进入授权。"
      primary={
        readOnly || !plan
          ? undefined
          : {
              label: "确认委托，去授权",
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
            <DataRow label="需求分析" value={plan.evidenceNeed} />
          </article>

          <p className="small muted tight" style={{ marginTop: 16 }}>
            Agent 推荐排序（共 {candidates.length} 位候选专家，默认选中第一名，可改选）
          </p>
          <p className="small muted tight" style={{ marginTop: 4 }}>
            推荐基于各专家的【自报资料覆盖】【报价】【链上信誉 / 历史挑战记录】做的概率性判断；具体交付质量要等第 5 步由 Judge 核验后才能确定。
          </p>

          <div className="candidate-list" role="radiogroup" aria-label="选择专家">
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

                    <div className="lib-tag-row" aria-label="资料库授权">
                      {profile.libraries.map((lib) => (
                        <span className="lib-tag" key={lib}>
                          {LIBRARIES[lib].name}
                        </span>
                      ))}
                    </div>
                  </div>
                </label>
              );
            })}
          </div>

          {!readOnly && selected !== plan.recommendedProviderId ? (
            <div className="info-strip" style={{ marginTop: 12 }}>
              你选择的不是 Agent 的推荐项。该专家在"自报资料覆盖 + 链上信誉"上属于较低概率的选择，交付完整性的先验风险更高——若简报有缺口，可在第 5 步发起挑战。
            </div>
          ) : null}

          <div style={{ marginTop: 20 }}>
            <p className="section-kicker" style={{ margin: "0 0 8px" }}>委托条款</p>
            <div className="data-grid">
              <DataRow
                label="交付物"
                value="研究简报：核心资料的关键摘录 + 来源定位 + 研究摘要，并附针对你问题的总结；不搬运资料全文，无版权风险。"
              />
              <DataRow label="核验方式" value={plan.verificationMethod} />
              <DataRow
                label="预算"
                value={
                  <span className="mono">
                    总预算 {plan.totalBudget} · 单笔上限 {plan.perJobCap}
                  </span>
                }
              />
              <DataRow
                label="结算条件"
                value="资金先入链上托管；简报通过核验、且挑战窗口结束后，才放款给专家。"
              />
              <DataRow
                label="违约保障"
                value="交付与声明不符可发起挑战；挑战成立即全额退款，并从专家质押中扣罚赔付。"
              />
            </div>
          </div>

          {readOnly ? (
            <div className="info-strip">委托已确认，此处为只读回看。</div>
          ) : null}
        </>
      ) : (
        <div className="info-strip">
          委托方案尚未生成。请回到第 1 步提交研究问题。
        </div>
      )}
    </StepShell>
  );
}

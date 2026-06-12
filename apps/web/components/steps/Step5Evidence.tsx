import React from "react";
import type { JuryVote, Task, TaskChallenge } from "@proofmarket/shared/src/types";
import type { TxRecord } from "@proofmarket/shared/src/realMode";
import {
  presetChallengeDocument,
  presetCounterEvidence
} from "@proofmarket/shared/src/fixtures";
import { LIBRARIES, type LibraryId } from "@proofmarket/shared/src/libraries";
import {
  buildPackageCommitment,
  getMerkleProof,
  verifyMerkleProof
} from "@proofmarket/shared/src/merkle";
import { isFullTxHash, sepoliaTxUrl, shortHash } from "../../lib/links";
import { LOCAL_CORPUS } from "../../lib/localCorpus";
import { formatCountdown, useCountdown } from "../../lib/useCountdown";
import { StepShell } from "../StepShell";

// 我方 Agent 概率性抽查的查全样本：来自用户侧本地资料库的「该方向应出现
// 文献」清单。命中与否按简报实际内容（sourceLocator）比对——专家包命中、
// 速查包漏检是真实的内容差异，不是写死的结果。
const COMPLETENESS_SAMPLES = [
  {
    title:
      "Block-STM: Scaling Blockchain Execution by Turning Ordering Curse to a Performance Blessing",
    locator: "arXiv:2203.06871",
    library: "arxiv" as LibraryId,
    kind: "paper" as const
  },
  {
    title: "高吞吐智能合约执行中的状态热点",
    locator: "delphi:state-hotspots-2025",
    library: "delphi-digital" as LibraryId,
    kind: "report" as const
  }
] as const;

// 查全样本必须先做范围匹配：只有落在该专家覆盖声明范围内的样本才计入
// 漏检。范围按声明的资料类型判断——声明含「研报」才把研报类样本计入，
// 论文类样本要求声明含「论文」。范围外的样本展示为灰色、不计入挑战。
function sampleInScope(
  pkg: NonNullable<Task["providerPackage"]>,
  sample: (typeof COMPLETENESS_SAMPLES)[number]
): boolean {
  return sample.kind === "report"
    ? pkg.coverageStatement.includes("研报")
    : pkg.coverageStatement.includes("论文");
}

function packageMissesSample(pkg: NonNullable<Task["providerPackage"]>): boolean {
  return COMPLETENESS_SAMPLES.some(
    (sample) =>
      sampleInScope(pkg, sample) &&
      !pkg.answers.some((a) => a.sourceLocator === sample.locator)
  );
}

// 我方 Agent 的抽查核验：查准（抽样比对摘录与本地库原文，并验证该叶子
// 确在专家签名的承诺根下）+ 查全（抽样「理应出现」的文献看是否在简报
// 内）。这是挑战机制成立的根基——产出难、概率性验证容易，所以可以先
// 信任交付，事后抽查兜底。
function AgentSpotCheck({ pkg }: { pkg: NonNullable<Task["providerPackage"]> }) {
  // 查准抽样是两项真实计算的叠加，不是展示文案：
  // ① 内容比对——摘录必须逐字出现在本地资料库（LOCAL_CORPUS）对应来源的
  //    原文段落里，本地没有该来源或对不上即红；
  // ② 承诺绑定——该条目的叶子哈希必须沿 Merkle 路径折算回专家签名上链的
  //    承诺根，证明内容没有在传输层被调包。
  const commitment = buildPackageCommitment(pkg);
  const accuracySamples = pkg.answers.slice(0, 2).map((answer) => {
    const leafIndex = pkg.answers.indexOf(answer) + 1; // 叶 0 为总述
    const proof = getMerkleProof(commitment.leafHashes, leafIndex);
    const corpusText = LOCAL_CORPUS[answer.sourceLocator];
    return {
      answer,
      excerptOk:
        corpusText != null && corpusText.includes(answer.excerptOrSummary),
      proofOk: verifyMerkleProof(
        commitment.leafHashes[leafIndex],
        proof,
        pkg.packageHash
      )
    };
  });
  const completeness = COMPLETENESS_SAMPLES.map((sample) => ({
    ...sample,
    inScope: sampleInScope(pkg, sample),
    present: pkg.answers.some((a) => a.sourceLocator === sample.locator)
  }));
  const missed = completeness.filter((c) => c.inScope && !c.present);

  return (
    <div className="spot-check" style={{ marginTop: 20 }} data-testid="agent-spot-check">
      <p className="section-kicker" style={{ margin: "0 0 8px" }}>
        我方 Agent 抽查核验
      </p>
      <div className="data-grid">
        <div className="data-row">
          <span className="data-label">查准 · 抽样比对</span>
          <div className="data-value">
            {accuracySamples.map(({ answer, excerptOk, proofOk }) => (
              <div key={answer.sourceLocator} className="dot-inline-wrap" style={{ marginBottom: 2 }}>
                <span className={`dot ${excerptOk && proofOk ? "ok" : "danger"}`} aria-hidden="true" />
                <span className="small">
                  《{answer.sourceTitle}》
                  {excerptOk
                    ? "摘录与本地资料库存档段落逐字一致"
                    : "摘录在本地资料库中比对失败"}
                  {proofOk
                    ? "；叶子哈希沿 Merkle 路径折算回承诺根，验证通过"
                    : "；Merkle 路径验证失败"}
                </span>
              </div>
            ))}
          </div>
        </div>
        <div className="data-row">
          <span className="data-label">查全 · 抽样应出现文献</span>
          <div className="data-value">
            {completeness.map((c) => (
              <div key={c.locator} className="dot-inline-wrap" style={{ marginBottom: 2 }}>
                <span
                  className={`dot ${c.present ? "ok" : c.inScope ? "danger" : "neutral"}`}
                  aria-hidden="true"
                />
                <span className={`small${c.inScope ? "" : " muted"}`}>
                  《{c.title}》
                  {c.present
                    ? "已包含在简报中"
                    : c.inScope
                      ? "未出现在简报中——且在其覆盖声明范围内"
                      : `不在其覆盖声明范围（${LIBRARIES[c.library].kind}类来源未在声明中承诺），不计入`}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
      {missed.length > 0 ? (
        <div className="error-strip" style={{ marginTop: 8 }} data-testid="spot-check-failed">
          查全抽检未通过：覆盖声明范围内的代表性文献缺失。Agent 已按「问题点 + 反证原文 + 哈希」准备好挑战包，可一键发起挑战。
        </div>
      ) : (
        <p className="small muted tight" style={{ marginTop: 8 }}>
          抽查由你的 Agent 在本地资料库自动执行：概率性抽样，不做全量复核——任何一次漏检或篡改都有足够概率被低成本抓到。
        </p>
      )}
    </div>
  );
}

// 挑战书 + counter-evidence handed to the jury. All plaintext is shown in
// full; only its hash is committed on-chain, so anyone can verify the
// plaintext was not altered. challenge.counterEvidenceHash is that commitment.
function ChallengeMaterials({
  task,
  challenge
}: {
  task: Task;
  challenge: TaskChallenge;
}) {
  return (
    <div className="challenge-materials" style={{ marginTop: 14 }}>
      <p className="section-kicker" style={{ margin: "0 0 8px" }}>
        挑战书（提交给审判团的材料）
      </p>
      <div className="data-row">
        <span className="data-label">专家交付简报</span>
        <div className="data-value">
          {task.providerPackage
            ? `${task.providerPackage.providerName} · ${task.providerPackage.answers.length} 条来源支撑`
            : "—"}
        </div>
      </div>
      <div className="data-row" style={{ marginTop: 6 }}>
        <span className="data-label">挑战类型</span>
        <div className="data-value">
          <span className="mono">{challenge.type}</span>
          <span className="muted small"> — 承诺范围内漏检（L2）</span>
        </div>
      </div>
      <div className="data-row" style={{ marginTop: 6 }}>
        <span className="data-label">挑战者陈述</span>
        <div className="data-value">{challenge.statement}</div>
      </div>
      <div className="data-row" style={{ marginTop: 6 }}>
        <span className="data-label">命中声明条款</span>
        <div className="data-value">{challenge.hitCoverageClause}</div>
      </div>
      <div className="data-row" style={{ marginTop: 6 }}>
        <span className="data-label">反证来源</span>
        <div className="data-value">
          {presetCounterEvidence.sourceTitle}
          <span className="muted small mono"> （{presetCounterEvidence.sourceLocator}）</span>
        </div>
      </div>
      <div className="data-row" style={{ marginTop: 6 }}>
        <span className="data-label">反证所在库</span>
        <div className="data-value">
          {LIBRARIES[presetCounterEvidence.sourceLibrary as LibraryId].name}
          <span className="muted small">
            {" "}· {LIBRARIES[presetCounterEvidence.sourceLibrary as LibraryId].access}——审判方自行调取原文核对，不依赖挑战者提交件
          </span>
        </div>
      </div>
      <div className="data-row" style={{ marginTop: 6 }}>
        <span className="data-label">反证主张（明文）</span>
        <div className="data-value">{presetCounterEvidence.claim}</div>
      </div>
      <div className="data-row" style={{ marginTop: 6 }}>
        <span className="data-label">反证哈希</span>
        <div className="data-value mono">{challenge.counterEvidenceHash}</div>
      </div>
      <div className="data-row" style={{ marginTop: 6 }}>
        <span className="data-label">被挑战简报承诺根</span>
        <div className="data-value mono">
          {task.providerPackage ? shortHash(task.providerPackage.packageHash) : "—"}
          <span className="muted small">（专家签名上链的 Merkle 根）</span>
        </div>
      </div>
      <div className="data-row" style={{ marginTop: 6 }}>
        <span className="data-label">审判方指派依据</span>
        <div className="data-value">{presetChallengeDocument.juryAssignmentBasis}</div>
      </div>
      <p className="small muted tight" style={{ marginTop: 6 }}>
        上方为提交给审判团的明文；协议只把它的哈希写入链上，任何人可按哈希核对明文未被篡改。审判团不轻信提交件，各审判方凭自有库授权按定位符调取原文核对。「缺失」无法用哈希路径证明，由审判团裁量——但若专家实际包含了该文献，应辩时只需出示对应叶子与到承诺根的
        Merkle 路径，即可一证推翻挑战。
      </p>
    </div>
  );
}

// The provider's defense statement (应辩书), filed within the defense window.
function DefenseCard({ challenge }: { challenge: TaskChallenge }) {
  const defense = challenge.defense;
  const txLink = defense?.txHash && isFullTxHash(defense.txHash) ? sepoliaTxUrl(defense.txHash) : null;
  return (
    <div className="challenge-materials" style={{ marginTop: 14 }} data-testid="defense-card">
      <p className="section-kicker" style={{ margin: "0 0 8px" }}>
        专家应辩书（应辩窗口内提交）
      </p>
      {defense ? (
        <>
          <div className="data-row">
            <span className="data-label">应辩陈述（明文）</span>
            <div className="data-value">{defense.statement}</div>
          </div>
          <div className="data-row" style={{ marginTop: 6 }}>
            <span className="data-label">应辩书哈希</span>
            <div className="data-value mono">
              {txLink ? (
                <a
                  className="hash"
                  href={txLink}
                  target="_blank"
                  rel="noreferrer"
                  aria-label="在 Etherscan 查看应辩书提交交易"
                >
                  {defense.defenseHash}
                </a>
              ) : (
                defense.defenseHash
              )}
            </div>
          </div>
          <p className="small muted tight" style={{ marginTop: 6 }}>
            挑战是公开的链上事件：专家端的监听服务收到事件后在窗口内自动提交应辩，窗口按链上时间强制。审判团必须等应辩窗口结束才能投票（强制兼听）；放弃应辩视同弃权，裁决照常进行。
          </p>
          {challenge.type === "CoverageMiss" ? (
            <p className="small muted tight" style={{ marginTop: 4 }}>
              本应辩仅作范围抗辩，未出示叶子证明——若简报确实包含该文献，专家只需给出对应叶子与到承诺根的
              Merkle 路径，即可直接推翻挑战、无需审判团裁量。
            </p>
          ) : null}
        </>
      ) : (
        <div className="info-strip">专家未在应辩窗口内提交应辩书（视同放弃应辩）。</div>
      )}
    </div>
  );
}

// One juror's reasoned vote: model family, direction, and the three-question
// reason book whose hash went on-chain with the castVote transaction.
function JuryVoteCard({ vote, index }: { vote: JuryVote; index: number }) {
  const isFault = vote.vote === "ProviderFault";
  const txLink = vote.txHash && isFullTxHash(vote.txHash) ? sepoliaTxUrl(vote.txHash) : null;
  return (
    <details className="evidence-item-row" data-testid={`jury-vote-${vote.jurorId}`} open={index === 0}>
      <summary className="evidence-item-summary">
        <span className="evidence-item-index">{index + 1}</span>
        <span className="evidence-item-title">
          审判方 {index + 1}
          {vote.jurorAddress ? (
            <span className="muted small mono">（{vote.jurorAddress.slice(0, 10)}…）</span>
          ) : null}
        </span>
        <span className={`status-badge ${isFault ? "danger" : "warning"}`}>
          {isFault ? "ProviderFault" : "NotFault（异议）"}
        </span>
      </summary>
      <div className="evidence-item-body">
        <div className="data-row">
          <span className="data-label">原文核对</span>
          <div className="data-value">{vote.reasonBook.sourceCheck}</div>
        </div>
        <div className="data-row">
          <span className="data-label">范围内？</span>
          <div className="data-value">{vote.reasonBook.inScope}</div>
        </div>
        <div className="data-row">
          <span className="data-label">命中声明？</span>
          <div className="data-value">{vote.reasonBook.hitsDeclaredQuery}</div>
        </div>
        <div className="data-row">
          <span className="data-label">未返回且未排除？</span>
          <div className="data-value">{vote.reasonBook.notReturnedNotExcluded}</div>
        </div>
        <div className="data-row">
          <span className="data-label">结论</span>
          <div className="data-value">{vote.reasonBook.conclusion}</div>
        </div>
        <div className="data-row">
          <span className="data-label">理由书哈希</span>
          <div className="data-value mono">{vote.reasonHash}</div>
        </div>
        {txLink && (
          <div className="data-row">
            <span className="data-label">投票交易</span>
            <div className="data-value">
              <a
                className="hash"
                href={txLink}
                target="_blank"
                rel="noreferrer"
                aria-label={`在 Etherscan 查看 ${vote.jurorId} 的投票交易`}
              >
                {shortHash(vote.txHash!)}
              </a>
            </div>
          </div>
        )}
      </div>
    </details>
  );
}

type Step5EvidenceProps = {
  task: Task | null;
  onVerify: () => void;
  onOpenChallenge: () => void;
  onRequestVote: () => void;
  onResolve: () => void;
  isBusy?: boolean;
  readOnly?: boolean;
};

// Extract verdictHash from an audit event message. The message may contain
// patterns like "verdictHash=0x..." or just a hash embedded in the text.
function extractVerdictHash(message: string): string | null {
  const explicit = message.match(/verdictHash=([0-9a-fA-Fx]+)/);
  if (explicit?.[1]) return explicit[1];
  // Fallback: any full 0x + 64-hex hash in the message.
  const embedded = message.match(/0x[0-9a-fA-F]{64}/);
  if (embedded?.[0]) return embedded[0];
  return null;
}

function findVerdictHash(task: Task | null): string | null {
  if (!task) return null;
  for (const event of task.audit) {
    if (
      event.type === "verification_passed" ||
      event.type === "settlement" ||
      event.type === "verified"
    ) {
      const h = extractVerdictHash(event.message);
      if (h) return h;
    }
  }
  // Try any audit event that carries a txHash and relates to verification.
  for (const event of task.audit) {
    if (event.type.includes("verif") || event.type.includes("verdict")) {
      if (isFullTxHash(event.txHash)) return event.txHash;
      const h = extractVerdictHash(event.message);
      if (h) return h;
    }
  }
  return null;
}

function statusLabel(task: Task | null): { text: string; tone: "ok" | "pending" | "danger" } {
  switch (task?.status) {
    case "Verified":
      return { text: "验证通过", tone: "ok" };
    case "Challenged":
      return { text: "挑战进行中", tone: "danger" };
    case "ChallengeWon":
      return { text: "挑战成立", tone: "danger" };
    case "ChallengeLost":
      return { text: "挑战驳回", tone: "ok" };
    case "RefundedOrSlashed":
      return { text: "裁决已执行", tone: "danger" };
    default:
      return { text: "等待核验", tone: "pending" };
  }
}

// Expandable evidence item using native <details>/<summary>.
function EvidenceItem({
  index,
  answer,
}: {
  index: number;
  answer: {
    providerAnswer: string;
    sourceTitle: string;
    sourceLocator: string;
    sourceLibrary: string;
    sourceMetadata: { year: number; type: string };
    excerptOrSummary: string;
    relevanceExplanation: string;
  };
}) {
  return (
    <details className="evidence-item-row">
      <summary className="evidence-item-summary">
        <span className="evidence-item-index">{index + 1}</span>
        <span className="evidence-item-title">{answer.sourceTitle}</span>
        <span className="evidence-item-locator mono">{answer.sourceLocator}</span>
      </summary>
      <div className="evidence-item-body">
        <div className="data-row">
          <span className="data-label">专家结论</span>
          <div className="data-value">{answer.providerAnswer}</div>
        </div>
        <div className="data-row">
          <span className="data-label">来源定位</span>
          <div className="data-value mono">{answer.sourceLocator}</div>
        </div>
        <div className="data-row">
          <span className="data-label">来源库</span>
          <div className="data-value">
            {LIBRARIES[answer.sourceLibrary as LibraryId]?.name ?? answer.sourceLibrary}
            <span className="muted small">
              {" "}· {LIBRARIES[answer.sourceLibrary as LibraryId]?.kind ?? ""}
            </span>
          </div>
        </div>
        <div className="data-row">
          <span className="data-label">年份 / 类型</span>
          <div className="data-value">
            <span className="mono">{answer.sourceMetadata.year}</span>
            {" / "}
            {answer.sourceMetadata.type}
          </div>
        </div>
        <div className="data-row">
          <span className="data-label">摘录 / 摘要</span>
          <div className="data-value">{answer.excerptOrSummary}</div>
        </div>
        <div className="data-row">
          <span className="data-label">相关性说明</span>
          <div className="data-value">{answer.relevanceExplanation}</div>
        </div>
      </div>
    </details>
  );
}

// Renders a tx row for challenge-related records.
function ChallengeTxRow({ record }: { record: TxRecord }) {
  const labelMap: Record<string, string> = {
    approveDeposit: "授权押金 + 审判费",
    openChallenge: "发起挑战（链上）",
    defense: "提交应辩书（链上）",
    castVote: "审判投票（链上）",
    resolve: "执行裁决（链上）"
  };
  const label = labelMap[record.label] ?? record.label;
  const isConfirmed = record.status === "confirmed";
  const isPending = record.status === "pending";
  const isFailed = record.status === "failed";
  const hasLink = isConfirmed && isFullTxHash(record.txHash);

  return (
    <div
      className={`tx-progress-row ${record.status}`}
      aria-label={`${label}：${record.status}`}
    >
      <div className="tx-row-left">
        <span className="tx-label">{label}</span>
        <span className="tx-sublabel">
          {hasLink ? (
            <a
              className="hash"
              href={sepoliaTxUrl(record.txHash)}
              target="_blank"
              rel="noreferrer"
              aria-label={`在 Etherscan 查看 ${label} 交易`}
            >
              {shortHash(record.txHash)}
            </a>
          ) : isPending ? (
            <span className="tx-pending-text muted small">进行中…</span>
          ) : isFailed ? (
            <span className="muted small">交易失败</span>
          ) : (
            <span className="muted small">等待广播</span>
          )}
        </span>
      </div>
      <div className="tx-row-right">
        {isConfirmed && <span className="status-badge success">已确认</span>}
        {isPending && <span className="status-badge warning">进行中</span>}
        {isFailed && <span className="status-badge danger">失败</span>}
      </div>
    </div>
  );
}

// Stage 1:挑战已发起 (status = Challenged)
function ChallengeStage1({
  task,
  challenge,
  onRequestVote,
  isBusy,
  readOnly,
}: {
  task: Task;
  challenge: TaskChallenge;
  onRequestVote: () => void;
  isBusy: boolean;
  readOnly: boolean;
}) {
  const challengeTxRecords = task.txRecords.filter(
    (r) => r.label === "approveDeposit" || r.label === "openChallenge" || r.label === "defense"
  );
  const isRealMode = task.mode === "real";

  return (
    <div className="challenge-stage" aria-label="挑战已发起">
      <div className="challenge-stage-header">
        <span className="dot danger" aria-hidden="true" />
        <strong>挑战已发起</strong>
      </div>

      <div className="challenge-stage-body">
        {/* Challenge metadata */}
        <div className="data-row">
          <span className="data-label">挑战类型</span>
          <div className="data-value">
            <span className="mono">{challenge.type}</span>
            <span className="muted small"> — 覆盖声明漏检</span>
          </div>
        </div>
        <div className="data-row" style={{ marginTop: 6 }}>
          <span className="data-label">挑战押金 D</span>
          <div className="data-value">
            <span className="dot danger" style={{ verticalAlign: "middle", marginRight: 6 }} aria-hidden="true" />
            2 mUSDC 已锁定（挑战失败没收入金库）
          </div>
        </div>
        <div className="data-row" style={{ marginTop: 6 }}>
          <span className="data-label">审判费 F</span>
          <div className="data-value">
            <span className="dot danger" style={{ verticalAlign: "middle", marginRight: 6 }} aria-hidden="true" />
            0.5 mUSDC 已锁定（审判团均分；挑战成功则由扣罚承担、全额退回）
          </div>
        </div>
        <div className="data-row" style={{ marginTop: 6 }}>
          <span className="data-label">托管订单</span>
          <div className="data-value">
            <span className="dot pending" style={{ verticalAlign: "middle", marginRight: 6 }} aria-hidden="true" />
            已冻结（等待裁决）
          </div>
        </div>

        {/* Real mode: on-chain tx records */}
        {isRealMode && challengeTxRecords.length > 0 && (
          <div style={{ marginTop: 12 }}>
            <p className="section-kicker" style={{ margin: "0 0 6px" }}>链上交易</p>
            <div className="tx-progress-list">
              {challengeTxRecords.map((record, i) => (
                <ChallengeTxRow key={`${record.label}-${i}`} record={record} />
              ))}
            </div>
          </div>
        )}

        {/* 挑战书 for the jury */}
        <ChallengeMaterials task={task} challenge={challenge} />

        {/* Provider 应辩书 */}
        <DefenseCard challenge={challenge} />

        {/* Action */}
        {!readOnly && (
          <div style={{ marginTop: 14 }}>
            <button
              type="button"
              onClick={onRequestVote}
              disabled={isBusy}
              aria-busy={isBusy ? "true" : undefined}
            >
              {isBusy ? "审判团裁决中（等待应辩窗口结束 + 三票上链）…" : "请求审判团裁决"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// Stage 2: 审判团投票已完成 (status = ChallengeWon)
function ChallengeStage2({
  task,
  challenge,
  votes,
  onResolve,
  isBusy,
  readOnly,
}: {
  task: Task;
  challenge: TaskChallenge;
  votes: JuryVote[];
  onResolve: () => void;
  isBusy: boolean;
  readOnly: boolean;
}) {
  const faultVotes = votes.filter((vote) => vote.vote === "ProviderFault").length;
  const dissent = votes.length - faultVotes;

  return (
    <div className="challenge-stage" aria-label="审判团投票结果">
      <div className="challenge-stage-header">
        <span className="dot danger" aria-hidden="true" />
        <strong>
          审判团投票 {faultVotes} : {dissent} — ProviderFault（覆盖声明漏检，挑战成立）
        </strong>
      </div>

      <div className="challenge-stage-body">
        <p className="small muted tight" style={{ margin: "0 0 8px" }}>
          三个相互独立的审判方各自核对原文后投票，理由书哈希随票上链。
          多数决生效——异议票也完整留痕。
        </p>
        <div className="evidence-items-list">
          {votes.map((vote, i) => (
            <JuryVoteCard key={vote.jurorId} vote={vote} index={i} />
          ))}
        </div>
        <p className="small muted tight" style={{ marginTop: 8 }}>
          每个审判方注册时已把模型版本与审判 prompt 的哈希承诺上链，任何人可按承诺参数离线重跑复核任一票。
        </p>

        {/* Materials panel (still visible for reference) */}
        <ChallengeMaterials task={task} challenge={challenge} />
        <DefenseCard challenge={challenge} />

        {/* Action */}
        {!readOnly && (
          <div style={{ marginTop: 14 }}>
            <button
              type="button"
              onClick={onResolve}
              disabled={isBusy}
              aria-busy={isBusy ? "true" : undefined}
            >
              {isBusy ? "执行裁决…" : "执行裁决（多数已达成，任何人可执行）"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// Stage 3: 裁决已执行 (status = RefundedOrSlashed)
function ChallengeStage3({
  task,
  challenge,
}: {
  task: Task;
  challenge: TaskChallenge;
}) {
  const isRealMode = task.mode === "real";
  const resolveRecord = task.txRecords.find((r) => r.label === "resolve");
  const resolvedTxHash = challenge.resolvedTxHash ?? resolveRecord?.txHash;
  const hasEtherscanLink = isRealMode && resolvedTxHash && isFullTxHash(resolvedTxHash);

  return (
    <div className="challenge-stage challenge-stage--resolved" aria-label="裁决已执行">
      <div className="challenge-stage-header">
        <span className="dot ok" aria-hidden="true" />
        <strong>裁决已执行</strong>
      </div>

      <div className="challenge-stage-body">
        {/* Fund actions — one line per effect (§4.3 资金流) */}
        <div className="challenge-fund-actions">
          <div className="challenge-fund-row">
            <span className="challenge-fund-icon" aria-hidden="true">—</span>
            <span>扣罚专家本单履约 bond（10 mUSDC）的 50% = 5 mUSDC，其中一半奖励挑战者</span>
          </div>
          <div className="challenge-fund-row">
            <span className="challenge-fund-icon" aria-hidden="true">—</span>
            <span>托管资金退款买方</span>
          </div>
          <div className="challenge-fund-row">
            <span className="challenge-fund-icon" aria-hidden="true">—</span>
            <span>挑战者押金 + 审判费全额退回</span>
          </div>
          <div className="challenge-fund-row">
            <span className="challenge-fund-icon" aria-hidden="true">—</span>
            <span>审判费 0.5 mUSDC 由扣罚承担，三位审判方均分，余额归入金库</span>
          </div>
        </div>

        {/* Real mode: resolve tx */}
        {resolvedTxHash && (
          <div className="data-row" style={{ marginTop: 12 }}>
            <span className="data-label">裁决交易</span>
            <div className="data-value">
              {hasEtherscanLink ? (
                <a
                  className="hash"
                  href={sepoliaTxUrl(resolvedTxHash)}
                  target="_blank"
                  rel="noreferrer"
                  aria-label="在 Etherscan 查看裁决交易"
                >
                  {shortHash(resolvedTxHash)}
                </a>
              ) : (
                <span className="mono">{resolvedTxHash}</span>
              )}
            </div>
          </div>
        )}

        {isRealMode && !resolvedTxHash && (
          <div style={{ marginTop: 12 }}>
            <div className="tx-progress-list">
              {task.txRecords
                .filter((r) => r.label === "resolve")
                .map((record, i) => (
                  <ChallengeTxRow key={`resolve-${i}`} record={record} />
                ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export function Step5Evidence({
  task,
  onVerify,
  onOpenChallenge,
  onRequestVote,
  onResolve,
  isBusy = false,
  readOnly = false,
}: Step5EvidenceProps) {
  const providerPackage = task?.providerPackage ?? null;
  const status = task?.status;
  const isDelivered = status === "Delivered";
  const isRealMode = task?.mode === "real";
  // Challenge window W_c countdown — drives the banner under Delivered.
  const windowRemaining = useCountdown(task?.challengeWindowEndsAt);

  const { text: statusText, tone: statusTone } = statusLabel(task);
  const verdictHash = findVerdictHash(task);

  // Submit tx for package hash etherscan link
  const submitRecord = task?.txRecords?.find((r) => r.label === "submit");
  const submitTxLink =
    submitRecord && isFullTxHash(submitRecord.txHash)
      ? sepoliaTxUrl(submitRecord.txHash)
      : null;

  const challenge = task?.challenge ?? null;

  // Determine which challenge stage we are in
  const isChallenged = status === "Challenged";
  const isChallengeWon = status === "ChallengeWon";
  const isRefundedOrSlashed = status === "RefundedOrSlashed";
  const isInChallengeFlow = isChallenged || isChallengeWon || isRefundedOrSlashed;

  // Primary action for the success path
  let primary: { label: string; onClick: () => void; disabled?: boolean; busy?: boolean } | undefined;
  let secondary: { label: string; onClick: () => void; disabled?: boolean } | undefined;

  if (!readOnly && isDelivered) {
    primary = {
      label: "核验简报",
      onClick: onVerify,
      disabled: isBusy,
      busy: isBusy,
    };
    // Secondary: low-key challenge entry; when the agent's spot check found
    // a coverage miss, the same action ships the pre-built challenge package.
    secondary = {
      label:
        providerPackage && packageMissesSample(providerPackage)
          ? "生成挑战包，发起挑战"
          : "发起挑战",
      onClick: onOpenChallenge,
      disabled: isBusy,
    };
  }
  // When in challenge flow, no top-level primary — actions are inline in the stage.

  return (
    <StepShell
      stepNo={5}
      title="研究简报与核验"
      subtitle={
        isInChallengeFlow
          ? "挑战流程进行中——查看挑战状态与资金动作。"
          : "专家已交付研究简报：关键摘录、来源定位与研究摘要。核验通过后即可结算；若发现问题可发起挑战。"
      }
      primary={primary}
      secondary={secondary}
    >
      {/* ── 证据包 ─────────────────────────────────── */}
      {providerPackage ? (
        <div className="evidence-section">
          <p className="section-kicker" style={{ margin: "0 0 8px" }}>
            研究简报
          </p>

          {/* Provider header */}
          <div className="data-row" style={{ marginBottom: 8 }}>
            <span className="data-label">领域专家</span>
            <div className="data-value">
              <strong>{providerPackage.providerName}</strong>
            </div>
          </div>
          <div className="data-row" style={{ marginBottom: 12 }}>
            <span className="data-label">覆盖声明</span>
            <div className="data-value">{providerPackage.coverageStatement}</div>
          </div>

          {/* Evidence items — expandable list */}
          {providerPackage.answers.length > 0 ? (
            <div className="evidence-items-list">
              {providerPackage.answers.map((answer, i) => (
                <EvidenceItem key={answer.sourceLocator} index={i} answer={answer} />
              ))}
            </div>
          ) : (
            <div className="info-strip">简报中暂无具体条目。</div>
          )}
        </div>
      ) : (
        <div className="info-strip">等待专家交付研究简报…</div>
      )}

      {/* ── 我方 Agent 抽查核验 ───────────────────────── */}
      {providerPackage && <AgentSpotCheck pkg={providerPackage} />}

      {/* ── 链上一致性 ───────────────────────────────── */}
      {providerPackage && (
        <div className="onchain-consistency" style={{ marginTop: 20 }}>
          <p className="section-kicker" style={{ margin: "0 0 8px" }}>
            链上一致性
          </p>
          <div className="data-row">
            <span className="data-label">简报承诺根</span>
            <div className="data-value">
              {submitTxLink ? (
                <a
                  className="hash"
                  href={submitTxLink}
                  target="_blank"
                  rel="noreferrer"
                  aria-label="在 Etherscan 查看简报提交交易"
                >
                  {providerPackage.packageHash}
                </a>
              ) : (
                <span className="mono">{providerPackage.packageHash}</span>
              )}
            </div>
          </div>
          {(() => {
            // Real recomputation, not copy: rebuild the tree from the received
            // plaintext and compare to the root the provider signed on-chain.
            const { root, leafHashes } = buildPackageCommitment(providerPackage);
            const rootMatches = root === providerPackage.packageHash;
            return (
              <>
                <div className="data-row" style={{ marginTop: 6 }}>
                  <span className="data-label">承诺结构</span>
                  <div className="data-value">
                    <div className="small">
                      <span className="mono">叶 0</span> 总述与覆盖声明{" "}
                      <span className="mono muted">{shortHash(leafHashes[0])}</span>
                    </div>
                    {providerPackage.answers.map((answer, i) => (
                      <div className="small" key={answer.sourceLocator}>
                        <span className="mono">叶 {i + 1}</span> 《{answer.sourceTitle}》{" "}
                        <span className="mono muted">{shortHash(leafHashes[i + 1])}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="data-row" style={{ marginTop: 6 }}>
                  <span className="data-label">明文重算</span>
                  <div className="data-value">
                    <span className="dot-inline-wrap">
                      <span
                        className={`dot ${rootMatches ? "ok" : "danger"}`}
                        aria-hidden="true"
                      />
                      <span className="small">
                        {rootMatches
                          ? "按收到的明文重算 Merkle 根，与专家签名提交的承诺根一致"
                          : "明文重算根与链上承诺不一致——交付内容与签名承诺不符"}
                      </span>
                    </span>
                  </div>
                </div>
              </>
            );
          })()}
          <p className="small muted tight" style={{ marginTop: 6 }}>
            简报按「总述 + 逐条资料-建议」组织成 Merkle 树，根由专家地址签名的 submit
            交易写入链上：明文重算即可比对，改一个字都对不上。专家无法否认交付内容，任何人也无法伪造一份「专家给的」简报——伪造文本凑不出专家签过名的根。挑战或应辩只需出示相关叶子与哈希路径，无需公开简报全文。
          </p>
        </div>
      )}

      {/* ── 验证结论 ─────────────────────────────────── */}
      <div className="verification-result" style={{ marginTop: 20 }}>
        <p className="section-kicker" style={{ margin: "0 0 8px" }}>
          验证结论
        </p>
        <div className="data-row">
          <span className="data-label">当前状态</span>
          <div className="data-value">
            <span className="dot-inline-wrap">
              <span className={`dot ${statusTone}`} aria-hidden="true" />
              <span>{statusText}</span>
            </span>
          </div>
        </div>

        {verdictHash && (
          <div className="data-row" style={{ marginTop: 6 }}>
            <span className="data-label">Verdict 哈希</span>
            <div className="data-value mono">{verdictHash}</div>
          </div>
        )}

        {(status === "Verified" || (status as string) === "Settled" || (status as string) === "Audited") &&
          !verdictHash && (
            <div className="data-row" style={{ marginTop: 6 }}>
              <span className="data-label">Judge 判定</span>
              <div className="data-value">有效</div>
            </div>
          )}
        <p className="small muted tight" style={{ marginTop: 6 }}>
          Judge 核验是协议外的辅助判断；对交付质量的硬保证来自挑战机制与经济惩罚，不依赖这一步。
        </p>
      </div>

      {/* ── 确定性挑战流程 ──────────────────────────────── */}
      {isInChallengeFlow && challenge && (
        <div className="challenge-section" style={{ marginTop: 24 }}>
          <p className="section-kicker" style={{ margin: "0 0 10px" }}>
            挑战流程
          </p>

          {/* Stage 1: Challenged */}
          {isChallenged && (
            <ChallengeStage1
              task={task!}
              challenge={challenge}
              onRequestVote={onRequestVote}
              isBusy={isBusy}
              readOnly={readOnly}
            />
          )}

          {/* Stage 2: ChallengeWon — jury verdict rendered */}
          {isChallengeWon && challenge.votes && challenge.votes.length > 0 && (
            <ChallengeStage2
              task={task!}
              challenge={challenge}
              votes={challenge.votes}
              onResolve={onResolve}
              isBusy={isBusy}
              readOnly={readOnly}
            />
          )}

          {/* ChallengeWon but no votes yet (edge case in real mode, show waiting) */}
          {isChallengeWon && (!challenge.votes || challenge.votes.length === 0) && (
            <div className="challenge-stage" aria-label="等待审判结果">
              <div className="challenge-stage-header">
                <span className="dot pending" aria-hidden="true" />
                <strong>等待审判团投票…</strong>
              </div>
              <div className="challenge-stage-body">
                <div className="info-strip">审判团正在处理，请稍候。</div>
              </div>
            </div>
          )}

          {/* Stage 3: RefundedOrSlashed — terminal */}
          {isRefundedOrSlashed && (
            <ChallengeStage3
              task={task!}
              challenge={challenge}
            />
          )}
        </div>
      )}

      {/* ── 挑战窗口与挑战说明（real 模式）──────────────────── */}
      {isDelivered && isRealMode && (
        <div className="info-strip" style={{ marginTop: 16 }} data-testid="challenge-window-banner">
          <span className="small">
            {windowRemaining > 0 ? (
              <>
                挑战窗口剩余 <span className="mono">{formatCountdown(windowRemaining)}</span>
                ，窗口结束前合约拒绝放款。
              </>
            ) : task?.challengeWindowEndsAt ? (
              <>挑战窗口已结束，订单可正常结算。</>
            ) : null}
            {" "}若对简报有异议，可发起挑战：锁定押金 + 审判费 → 专家应辩 →
            审判团（3 个独立审判方）多数决 → 链上扣罚 / 退款，全过程上链可查。
          </span>
        </div>
      )}

      {/* Terminal state: offer audit review */}
      {isRefundedOrSlashed && (
        <div className="info-strip" style={{ marginTop: 16 }}>
          <span className="small muted">
            挑战流程已完成。可在右侧审计侧栏查看完整事件链路与链上凭证。
          </span>
        </div>
      )}
    </StepShell>
  );
}

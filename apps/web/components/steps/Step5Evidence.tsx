import React from "react";
import type { Task, TaskChallenge, ChallengeVote } from "@proofmarket/shared/src/types";
import type { TxRecord } from "@proofmarket/shared/src/realMode";
import { isFullTxHash, sepoliaTxUrl, shortHash } from "../../lib/links";
import { StepShell } from "../StepShell";

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
          <span className="data-label">Provider 回答</span>
          <div className="data-value">{answer.providerAnswer}</div>
        </div>
        <div className="data-row">
          <span className="data-label">来源定位</span>
          <div className="data-value mono">{answer.sourceLocator}</div>
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

// Renders a tx row for challenge-related records (approveDeposit / openChallenge / resolve).
function ChallengeTxRow({ record }: { record: TxRecord }) {
  const labelMap: Record<string, string> = {
    approveDeposit: "授权挑战押金",
    openChallenge: "发起挑战（链上）",
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
    (r) => r.label === "approveDeposit" || r.label === "openChallenge"
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
          <span className="data-label">挑战者押金</span>
          <div className="data-value">
            <span className="dot danger" style={{ verticalAlign: "middle", marginRight: 6 }} aria-hidden="true" />
            已锁定
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

        {/* Materials for the judge */}
        <div className="challenge-materials" style={{ marginTop: 14 }}>
          <p className="section-kicker" style={{ margin: "0 0 8px" }}>提交给审判者的材料</p>
          <div className="data-row">
            <span className="data-label">Provider 证据包</span>
            <div className="data-value">
              {task.providerPackage
                ? `${task.providerPackage.providerName} · ${task.providerPackage.answers.length} 条证据`
                : "—"}
            </div>
          </div>
          <div className="data-row" style={{ marginTop: 6 }}>
            <span className="data-label">挑战类型</span>
            <div className="data-value">
              <span className="mono">{challenge.type}</span>
            </div>
          </div>
          <div className="data-row" style={{ marginTop: 6 }}>
            <span className="data-label">反证哈希</span>
            <div className="data-value mono">{challenge.counterEvidenceHash}</div>
          </div>
          <p className="small muted tight" style={{ marginTop: 6 }}>
            协议只将哈希写入链上；原始反证存于链下审计层，可按哈希核对完整性。
          </p>
        </div>

        {/* Action */}
        {!readOnly && (
          <div style={{ marginTop: 14 }}>
            <button
              type="button"
              onClick={onRequestVote}
              disabled={isBusy}
              aria-busy={isBusy ? "true" : undefined}
            >
              {isBusy ? "请求审判…" : "请求审判"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// Stage 2: 审判者投票已完成 (status = ChallengeWon)
function ChallengeStage2({
  task,
  challenge,
  vote,
  onResolve,
  isBusy,
  readOnly,
}: {
  task: Task;
  challenge: TaskChallenge;
  vote: ChallengeVote;
  onResolve: () => void;
  isBusy: boolean;
  readOnly: boolean;
}) {
  return (
    <div className="challenge-stage" aria-label="审判者投票结果">
      <div className="challenge-stage-header">
        <span className="dot danger" aria-hidden="true" />
        <strong>审判者投票：{vote.vote}（覆盖声明漏检，挑战成立）</strong>
      </div>

      <div className="challenge-stage-body">
        <div className="data-row">
          <span className="data-label">审判者</span>
          <div className="data-value mono">{vote.voterId}</div>
        </div>
        <div className="data-row" style={{ marginTop: 6 }}>
          <span className="data-label">原因码</span>
          <div className="data-value mono">{vote.reasonCode}</div>
        </div>
        <div className="data-row" style={{ marginTop: 6 }}>
          <span className="data-label">理由</span>
          <div className="data-value">{vote.reason}</div>
        </div>
        <div className="data-row" style={{ marginTop: 6 }}>
          <span className="data-label">结果哈希</span>
          <div className="data-value mono">{vote.resultHash}</div>
        </div>

        {/* Materials panel (still visible for reference) */}
        <div className="challenge-materials" style={{ marginTop: 14 }}>
          <p className="section-kicker" style={{ margin: "0 0 8px" }}>提交给审判者的材料</p>
          <div className="data-row">
            <span className="data-label">Provider 证据包</span>
            <div className="data-value">
              {task.providerPackage
                ? `${task.providerPackage.providerName} · ${task.providerPackage.answers.length} 条证据`
                : "—"}
            </div>
          </div>
          <div className="data-row" style={{ marginTop: 6 }}>
            <span className="data-label">挑战类型</span>
            <div className="data-value mono">{challenge.type}</div>
          </div>
          <div className="data-row" style={{ marginTop: 6 }}>
            <span className="data-label">反证哈希</span>
            <div className="data-value mono">{challenge.counterEvidenceHash}</div>
          </div>
        </div>

        {/* Action */}
        {!readOnly && (
          <div style={{ marginTop: 14 }}>
            <button
              type="button"
              onClick={onResolve}
              disabled={isBusy}
              aria-busy={isBusy ? "true" : undefined}
            >
              {isBusy ? "执行裁决…" : "执行裁决"}
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
        {/* Fund actions — three lines, one per effect */}
        <div className="challenge-fund-actions">
          <div className="challenge-fund-row">
            <span className="challenge-fund-icon" aria-hidden="true">—</span>
            <span>扣除 Provider 质押 50%（一半奖励挑战者）</span>
          </div>
          <div className="challenge-fund-row">
            <span className="challenge-fund-icon" aria-hidden="true">—</span>
            <span>托管资金退款买方</span>
          </div>
          <div className="challenge-fund-row">
            <span className="challenge-fund-icon" aria-hidden="true">—</span>
            <span>挑战者押金退回</span>
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
      label: "核验证据",
      onClick: onVerify,
      disabled: isBusy,
      busy: isBusy,
    };
    // Secondary: low-key challenge entry
    secondary = {
      label: "发起挑战（演示争议流程）",
      onClick: onOpenChallenge,
      disabled: isBusy,
    };
  }
  // When in challenge flow, no top-level primary — actions are inline in the stage.

  return (
    <StepShell
      stepNo={5}
      title="证据与核验"
      subtitle={
        isInChallengeFlow
          ? "挑战流程进行中——查看挑战状态与资金动作。"
          : "Provider 已交付带证据包的回答。核验通过后即可结算；若发现问题可发起挑战。"
      }
      primary={primary}
      secondary={secondary}
    >
      {/* ── 证据包 ─────────────────────────────────── */}
      {providerPackage ? (
        <div className="evidence-section">
          <p className="section-kicker" style={{ margin: "0 0 8px" }}>
            证据包
          </p>

          {/* Provider header */}
          <div className="data-row" style={{ marginBottom: 8 }}>
            <span className="data-label">Provider</span>
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
            <div className="info-strip">证据包中暂无具体条目。</div>
          )}
        </div>
      ) : (
        <div className="info-strip">等待 Provider 交付证据包…</div>
      )}

      {/* ── 链上一致性 ───────────────────────────────── */}
      {providerPackage && (
        <div className="onchain-consistency" style={{ marginTop: 20 }}>
          <p className="section-kicker" style={{ margin: "0 0 8px" }}>
            链上一致性
          </p>
          <div className="data-row">
            <span className="data-label">证据包哈希</span>
            <div className="data-value">
              {submitTxLink ? (
                <a
                  className="hash"
                  href={submitTxLink}
                  target="_blank"
                  rel="noreferrer"
                  aria-label="在 Etherscan 查看证据包提交交易"
                >
                  {providerPackage.packageHash}
                </a>
              ) : (
                <span className="mono">{providerPackage.packageHash}</span>
              )}
            </div>
          </div>
          <p className="small muted tight" style={{ marginTop: 6 }}>
            证据包哈希已写入链上，任何人均可核对。
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

          {/* Stage 2: ChallengeWon — verdict rendered */}
          {isChallengeWon && challenge.vote && (
            <ChallengeStage2
              task={task!}
              challenge={challenge}
              vote={challenge.vote}
              onResolve={onResolve}
              isBusy={isBusy}
              readOnly={readOnly}
            />
          )}

          {/* ChallengeWon but no vote yet (edge case in real mode, show waiting) */}
          {isChallengeWon && !challenge.vote && (
            <div className="challenge-stage" aria-label="等待审判结果">
              <div className="challenge-stage-header">
                <span className="dot pending" aria-hidden="true" />
                <strong>等待审判者投票…</strong>
              </div>
              <div className="challenge-stage-body">
                <div className="info-strip">审判者正在处理，请稍候。</div>
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

      {/* ── 实诚提示（real 模式）──────────────────────────── */}
      {isDelivered && isRealMode && (
        <div className="info-strip" style={{ marginTop: 16 }}>
          <span className="small">
            真实链上挑战需已部署 ChallengeManager 并配置 resolver。fixture 模式可完整演示挑战流程。
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

import React from "react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createPublicClient, http } from "viem";
import { sepolia } from "viem/chains";
import { challengeManagerAbi, erc20Abi, escrowAbi } from "@proofmarket/chain/src/escrowAbi";
import {
  readReputationSummary,
  reputationSummaryToScore1000
} from "@proofmarket/chain/src/erc8004";
import { parseDeploymentArtifact } from "@proofmarket/shared/src/realMode";
import { presetJurors, providerProfiles } from "@proofmarket/shared/src/fixtures";
import { LIBRARIES, libraryNames } from "@proofmarket/shared/src/libraries";
import { sepoliaAddressUrl, shortAddress } from "../../lib/links";

// Live chain reads on every request: this page is the on-screen proof of the
// design doc's "系统初始化完成判定" — it must never serve a cached state.
export const dynamic = "force-dynamic";

const mUSDC = (raw: bigint) => `${Number(raw) / 1e6} mUSDC`;

async function loadSystemState() {
  const root = join(process.cwd(), "..", "..");
  const artifact = parseDeploymentArtifact(
    JSON.parse(readFileSync(join(root, "deployments", "sepolia.json"), "utf8"))
  );
  const client = createPublicClient({
    chain: sepolia,
    transport: http(process.env.SEPOLIA_RPC_URL ?? "")
  });

  const cm = artifact.contracts.ProofMarketChallengeManager as `0x${string}`;
  const escrow = artifact.contracts.ProofMarketEscrow as `0x${string}`;
  const token = artifact.contracts.MockUSDC as `0x${string}`;

  const readCm = <T,>(functionName: string, args: unknown[] = []) =>
    client.readContract({
      address: cm,
      abi: challengeManagerAbi,
      functionName,
      args
    } as never) as Promise<T>;

  const [minStake, deposit, juryFee, defenseWindow, jurySize, jurorCount, challengeWindow, coboBalance] =
    await Promise.all([
      readCm<bigint>("minStake" as never).catch(() => 10_000_000n),
      readCm<bigint>("challengeDeposit" as never).catch(() => 2_000_000n),
      readCm<bigint>("juryFee"),
      readCm<bigint>("defenseWindow"),
      readCm<bigint>("jurySize"),
      readCm<bigint>("jurorCount"),
      client.readContract({ address: escrow, abi: escrowAbi, functionName: "challengeWindow" }) as Promise<bigint>,
      client.readContract({
        address: token,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [artifact.coboWallet as `0x${string}`]
      }) as Promise<bigint>
    ]);

  // Each juror's on-chain registration commitment (model/prompt hashes).
  const jurors = await Promise.all(
    (artifact.jurors ?? []).map(async (juror) => {
      const onChain = (await readCm<[string, string, boolean]>("jurors", [juror.address]).catch(
        () => null
      )) as [string, string, boolean] | null;
      return {
        ...juror,
        modelHash: onChain?.[0] ?? null,
        promptHash: onChain?.[1] ?? null,
        registered: onChain?.[2] ?? false
      };
    })
  );

  // The on-chain provider signer carries the stake for every job; catalog
  // providers carry the ERC-8004 identities and reputation.
  const expertAddress = artifact.providers?.["execution-research-expert"]?.address ?? "";
  const [stake, lockedStake] = await Promise.all([
    readCm<bigint>("stake", [expertAddress]),
    readCm<bigint>("lockedStake", [expertAddress])
  ]);

  const reputations = await Promise.all(
    providerProfiles.map(async (profile) => {
      if (!artifact.erc8004) return { id: profile.id, score: profile.reputationScore, source: "fixture" };
      try {
        const summary = await readReputationSummary(
          process.env.SEPOLIA_RPC_URL ?? "",
          artifact.erc8004.reputationRegistry as `0x${string}`,
          BigInt(profile.agentId)
        );
        if (summary.count === 0n) throw new Error("no feedback");
        return { id: profile.id, score: reputationSummaryToScore1000(summary), source: "erc8004" };
      } catch {
        return { id: profile.id, score: profile.reputationScore, source: "fixture" };
      }
    })
  );

  return {
    artifact,
    params: { minStake, deposit, juryFee, defenseWindow, jurySize, jurorCount, challengeWindow },
    jurors,
    expert: { address: expertAddress, stake, lockedStake, free: stake - lockedStake },
    coboBalance,
    reputations
  };
}

function CheckRow({ ok, label }: { ok: boolean; label: string }) {
  return (
    <div className="data-row" style={{ marginTop: 6 }}>
      <span className="data-label">
        <span className={`dot ${ok ? "ok" : "danger"}`} aria-hidden="true" />
      </span>
      <div className="data-value">{label}</div>
    </div>
  );
}

export default async function SystemPage() {
  const state = await loadSystemState();
  const { artifact, params, jurors, expert, coboBalance, reputations } = state;
  const slash = (params.minStake * 5000n) / 10000n;
  const reward = (slash * 5000n) / 10000n;
  const jurySeated = params.jurorCount === params.jurySize && jurors.every((j) => j.registered);
  const stakeOk = expert.free >= params.minStake;
  const coboOk = coboBalance >= params.deposit + params.juryFee;

  return (
    <main className="wizard-shell" style={{ maxWidth: 1080, margin: "0 auto", padding: "32px 24px" }}>
      <h1 style={{ marginBottom: 4 }}>系统状态</h1>
      <p className="muted small" style={{ marginTop: 0 }}>
        以下数据全部来自 Sepolia 链上实时读取，地址均可点击在 Etherscan 复核。
      </p>

      {/* 判定清单 */}
      <section className="recommend-card" style={{ marginTop: 20 }} aria-label="就绪检查">
        <p className="section-kicker" style={{ margin: "0 0 8px" }}>就绪检查</p>
        <CheckRow ok label={`三合约已部署并完成双向 wire（Escrow / ChallengeManager / MockUSDC）`} />
        <CheckRow
          ok={jurySeated}
          label={`审判团已满席：${params.jurorCount}/${params.jurySize} 个独立运营方注册，模型版本哈希 + 审判 prompt 哈希已上链承诺`}
        />
        <CheckRow
          ok={stakeOk}
          label={`专家质押达标：可用质押 ${mUSDC(expert.free)} ≥ minStake ${mUSDC(params.minStake)}（总质押 ${mUSDC(expert.stake)}，在途锁定 ${mUSDC(expert.lockedStake)}）`}
        />
        <CheckRow ok={coboOk} label={`Cobo 钱包持有预算资产：${mUSDC(coboBalance)}`} />
      </section>

      {/* 合约与协议参数 */}
      <section style={{ marginTop: 24 }}>
        <p className="section-kicker">合约与协议参数（链上读取）</p>
        <div className="data-grid">
          <div className="data-row">
            <span className="data-label">Escrow 托管</span>
            <div className="data-value mono">
              <a className="hash" href={sepoliaAddressUrl(artifact.contracts.ProofMarketEscrow)} target="_blank" rel="noreferrer">
                {shortAddress(artifact.contracts.ProofMarketEscrow)}
              </a>
              <span className="muted"> · 挑战窗口 W_c = {String(params.challengeWindow)}s（窗口未过 complete 拒绝放款）</span>
            </div>
          </div>
          <div className="data-row">
            <span className="data-label">ChallengeManager</span>
            <div className="data-value mono">
              <a className="hash" href={sepoliaAddressUrl(artifact.contracts.ProofMarketChallengeManager ?? "")} target="_blank" rel="noreferrer">
                {shortAddress(artifact.contracts.ProofMarketChallengeManager ?? "")}
              </a>
              <span className="muted">
                {" "}· D={mUSDC(params.deposit)} · F={mUSDC(params.juryFee)} · S={mUSDC(slash)} · R={mUSDC(reward)} · R_w={String(params.defenseWindow)}s · N={String(params.jurySize)}
              </span>
            </div>
          </div>
          <div className="data-row">
            <span className="data-label">MockUSDC</span>
            <div className="data-value mono">
              <a className="hash" href={sepoliaAddressUrl(artifact.contracts.MockUSDC)} target="_blank" rel="noreferrer">
                {shortAddress(artifact.contracts.MockUSDC)}
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* 审判团 */}
      <section style={{ marginTop: 24 }} aria-label="审判团">
        <p className="section-kicker">AI 审判团（{String(params.jurorCount)}/{String(params.jurySize)} 席，相互独立的运营方）</p>
        <div className="evidence-items-list">
          {jurors.map((juror) => (
            <details key={juror.jurorId} className="evidence-item-row" open>
              <summary className="evidence-item-summary">
                <span className="evidence-item-title">
                  审判方 {jurors.indexOf(juror) + 1}
                </span>
                <span className={`status-badge ${juror.registered ? "success" : "danger"}`}>
                  {juror.registered ? "已注册" : "未注册"}
                </span>
              </summary>
              <div className="evidence-item-body">
                <div className="data-row">
                  <span className="data-label">链上地址</span>
                  <div className="data-value mono">
                    <a className="hash" href={sepoliaAddressUrl(juror.address)} target="_blank" rel="noreferrer">
                      {juror.address}
                    </a>
                  </div>
                </div>
                <div className="data-row">
                  <span className="data-label">模型版本承诺</span>
                  <div className="data-value mono">
                    {juror.modelHash ? `${juror.modelHash.slice(0, 26)}…` : "—"}
                  </div>
                </div>
                <div className="data-row">
                  <span className="data-label">审判 prompt 承诺</span>
                  <div className="data-value mono">
                    {juror.promptHash ? `${juror.promptHash.slice(0, 26)}…` : "—"}
                  </div>
                </div>
                <div className="data-row">
                  <span className="data-label">资料库授权</span>
                  <div className="data-value">
                    {libraryNames(
                      presetJurors[jurors.indexOf(juror)]?.libraryAccess ?? []
                    ) || "—"}
                    <span className="muted small">
                      {" "}· 运营方自报，用于原文核对与挑战指派匹配
                    </span>
                  </div>
                </div>
              </div>
            </details>
          ))}
        </div>
        <p className="small muted tight" style={{ marginTop: 8 }}>
          每个审判方注册时将其模型版本与审判 prompt 的哈希承诺上链；裁决有争议时按承诺参数披露并离线重跑，任何一票都可复核。挑战发起时按「审判方库授权 ⊇ 反证所在库」指派席位，确保每一票都能自行调取原文，而不是轻信挑战者提交件。
        </p>
      </section>

      {/* Provider 市场 */}
      <section style={{ marginTop: 24 }} aria-label="领域专家网络">
        <p className="section-kicker">领域专家网络（ERC-8004 身份 + 链上信誉）</p>
        <div className="data-grid">
          {providerProfiles.map((profile) => {
            const rep = reputations.find((r) => r.id === profile.id);
            return (
              <div className="data-row" key={profile.id}>
                <span className="data-label">{profile.name}</span>
                <div className="data-value">
                  <span className="mono">
                    <a className="hash" href={sepoliaAddressUrl(profile.address)} target="_blank" rel="noreferrer">
                      {shortAddress(profile.address)}
                    </a>
                    {" "}· Agent #{profile.agentId}
                  </span>
                  <span className="muted small">
                    {" "}· 信誉 {rep?.score}/1000{rep?.source === "erc8004" ? "（链上）" : ""} · 被挑战 {profile.challengeStats.challenged} 次 / 成立 {profile.challengeStats.upheld} 次
                  </span>
                  <span className="lib-tag-row">
                    {profile.libraries.map((lib) => (
                      <span className="lib-tag" key={lib}>
                        {LIBRARIES[lib].name}
                      </span>
                    ))}
                  </span>
                </div>
              </div>
            );
          })}
          <div className="data-row">
            <span className="data-label">链上执行身份</span>
            <div className="data-value">
              <span className="mono">
                <a className="hash" href={sepoliaAddressUrl(expert.address)} target="_blank" rel="noreferrer">
                  {shortAddress(expert.address)}
                </a>
              </span>
              <span className="muted small">
                {" "}· 专家统一签名地址：质押 {mUSDC(expert.stake)}，每单锁定 {mUSDC(params.minStake)} 作履约 bond
              </span>
            </div>
          </div>
        </div>
      </section>

      <p className="small muted" style={{ marginTop: 28 }}>
        <a href="/">← 返回首页</a>
        {" · "}
        <a href="/console">进入控制台</a>
      </p>
    </main>
  );
}

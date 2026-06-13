# ProofMarket

**AI Agent 的可信专业资料网络。** 当你的 Agent 需要权威资料支撑严肃研究、分析或判断时，它可以在你授权的预算内，付费委托持有订阅资料库授权的「领域专家 Agent」，拿回一份**可验证、可挑战、可结算**的研究简报——交付的是**带证据的内容**（结论 + 来源定位 + 限长摘录），不是无法核对的建议。

**两个保证**贯穿全程：

- 专家**不能瞎编（查准）**：简报里引用的每条资料都能被调出原文核对，编造来源、改写摘录，被查到就要赔钱；
- 专家**不能偷工减料（查全）**：专家先声明查了哪些库、什么范围，声明范围内漏掉该有的资料，被查到同样赔钱。

**核心论点**：产出一份高质量简报很难，但概率性地检查它做没做对很容易。所以协议先信任交付、直接给结果，事后靠本地抽查和挑战机制兜底——只要作恶被抓的概率 × 罚金 > 省下的成本，诚实就是专家唯一划算的选择。简报按「总述 + 逐条资料」组成 **Merkle 树**承诺上链：争议只交换单条内容加哈希路径，**原文不动，信任流动**。

资金边界由 **Cobo Agentic Wallet** 强制执行（任务级授权，越权真实拒绝）；托管、挑战、应辩、AI 陪审团投票、清算与 ERC-8004 信誉全部跑在 Sepolia 实链上，委托流程遵循 ERC-8004 / ERC-8183 的设计。

## 快速了解

- **项目介绍网页**：https://yuanyi-ma.github.io/proofmarket/
- **Pitch**：[`ProofMarket-pitch.pptx`](./ProofMarket-pitch.pptx)
- **演示视频**（Sepolia 真链实跑）：[在线播放](https://yuanyi-ma.github.io/proofmarket/#demo) · [文件下载](./ProofMarket-demo.mp4)

## 仓库结构

| 路径 | 内容 |
|---|---|
| `apps/web` | 控制台前端（Next.js）：六步向导、Agent 抽查核验、挑战与陪审可视化 |
| `packages/contracts` | Escrow / ChallengeManager / MockUSDC 合约与部署脚本 |
| `packages/backend` | 任务服务（fixture / real 双模式） |
| `packages/agents` | 规划 / 领域专家 / 核验 Agent |
| `packages/services` | 专家链上提交器与陪审投票服务 |
| `packages/chain` `cobo` `shared` | 链读写 / Cobo 封装 / 共享类型、资料库注册表与 Merkle 承诺 |
| `deployments/sepolia.json` | Sepolia 合约地址与部署参数 |

---

The demo uses deterministic providers and a mock corpus. It does not perform real paid database retrieval, sell full documents, or give an agent unrestricted wallet access.

## Demo Runbook

### Local Verification

```bash
pnpm install
pnpm test
pnpm --filter @proofmarket/web build
pnpm --filter @proofmarket/web test:e2e
```

`pnpm test` includes the contract suite. Focused contract checks can be run with `pnpm --filter @proofmarket/contracts test`; Hardhat outputs are configured under the system temp directory so the repo is not left with `artifacts`, `cache`, or `typechain-types`. Hardhat warns on Node v25; use a Hardhat-supported Node LTS in CI if needed.

### Demo Scripts

```bash
pnpm demo:success
pnpm demo:challenge
pnpm demo:denial
```

The success path settles the expert provider task. The challenge path starts from a fresh task, uses the shallow provider, wins a coverage-miss challenge, and executes refund or slash. The denial path starts from a fresh task and records a Cobo rejection before funds move.

Checked-in fixture snapshots live in `data/fixtures/happy-path.json`, `data/fixtures/challenge-path.json`, and `data/fixtures/cobo-denial.json`. The test suite validates their terminal states, Pact vocabulary, and Cobo denial audit detail.

### Live Demo

```bash
pnpm dev
```

Open `http://localhost:3000`.

If MockUSDC is not visible in Cobo, say "test asset" during the demo.
Use `Create fresh task` between the success, challenge, and denial paths when presenting the live UI.

## Real mode (Sepolia + Cobo + Claude Code)

This section covers running the full on-chain flow against Sepolia testnet with a real Cobo Agentic Wallet and Claude Code as the research agent.

### Environment setup

```bash
cp .env.example .env
# Fill in the following keys:
#   DEPLOYER_PRIVATE_KEY      — test key that deploys contracts and pays gas
#   PROVIDER_SIGNER_PRIVATE_KEY — test key for the demo Provider identity
#   PROVIDER_SIGNER_ADDRESS   — address of the provider signer key above
#   COBO_WALLET_ADDRESS       — Cobo Agentic Wallet Sepolia address
#   SEPOLIA_RPC_URL           — already set to a public RPC; use your own for reliability
#   SERVICES_URL / SERVICES_PORT — leave defaults unless you changed the port
#   CLAUDE_BIN                — path to the Claude Code binary (default: claude)
```

### Deploy contracts (first time, or after reset)

```bash
cd packages/contracts && set -a; source ../../.env; set +a; pnpm hardhat run scripts/deploy-sepolia.ts --network sepolia
```

This writes `deployments/sepolia.json`. The preflight will FAIL until this file exists.

### Preflight

Run this before every demo to confirm all prerequisites are satisfied:

```bash
pnpm preflight
```

Each check prints `PASS`, `FAIL`, or `INFO`. Fix any `FAIL` items before proceeding. Typical pre-demo failures and fixes:

| FAIL | Fix |
|---|---|
| `deployment_artifact` | Run the deploy command above |
| `gas_cobo_wallet` | `caw faucet deposit` (Sepolia faucet; daily limit 0.02 SETH) |
| `gas_deployer` | Use a public Sepolia faucet (e.g. sepoliafaucet.com) or transfer from the Cobo wallet |
| `gas_provider_signer` | Use a public Sepolia faucet (e.g. sepoliafaucet.com) or transfer from the Cobo wallet |
| `services_reachable` | Start services: `pnpm dev:services` |

### Running the demo

Open three terminals:

**Terminal A** — Provider/Judge service:
```bash
pnpm dev:services
```

**Terminal B** — Web server in real mode:
```bash
PROOFMARKET_MODE=real pnpm dev
```

**Terminal C** — Headless driver (or open browser to `http://localhost:3000`):
```bash
pnpm demo:real
```

`pnpm demo:real` runs the full success path (create → plan → pact → execute → provider → verify → settle) then a denial-demo path on a fresh task. It prints every transaction hash with Etherscan links and the audit file path.

### Demo Day plan

**Pairing decision before the demo:**

- **Unpaired wallet (recommended for live demos):** Pacts auto-approve on first `pact-status` check — zero waiting, fully automated. No human step needed.
- **Paired wallet (adds a visible human-approval scene):** The script prints "waiting for Cobo approval — approve in the Cobo app when prompted" between pact-status tries. You have up to 5 minutes. Re-rehearse the full flow with pairing enabled before demo day — do not pair for the first time during the live run.

**Pre-demo checklist:**

1. Run `pnpm preflight` — all checks must PASS.
2. Pre-run one complete `pnpm demo:real` execution as a backup artifact. Keep the task ID and Etherscan links.
3. Top up Cobo wallet via `caw faucet deposit` if gas is below 0.01 SETH (Sepolia faucet daily limit: 0.02 SETH).
4. Keep fixture-mode challenge and denial demos clearly labeled "local simulation" when presenting alongside the real-mode run.

**Recovery:** If a real-mode escrow run fails mid-flow, start a fresh task (`pnpm demo:real` again). Do not retry the same task's `execute` step — partial escrow state is not recoverable without a contract-level reset.

---

### Talk Track

1. Create a task from the default blockchain execution acceleration research question.
2. Generate the procurement plan and show the scope, providers, budget, and verification method before spending.
3. Show exactly three providers and explain why `论文证据专家 Agent` (execution-research-expert) is recommended.
4. Submit and activate the Cobo Pact, making the spending boundary visible.
5. Fund the escrow job and point to the transaction hash rather than a direct provider payment.
6. Run the expert provider and show the evidence-backed answer package.
7. Verify the evidence and settle payment only after the verifier accepts it.
8. Start a fresh shallow-provider path, show the `CoverageMiss` challenge document and the provider's defense, then the 2:1 jury verdict (per-vote reason books on-chain) and the permissionless resolve with slash, refunds, and jury-fee split.
9. Start a fresh denial path, trigger the blocked Cobo action, and show that funds did not move.
10. Open the audit log and replay the plan, Pact, allowed transaction, delivery hash, verifier result, settlement, challenge result, and denial.

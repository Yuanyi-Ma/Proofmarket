# ProofMarket Demo

ProofMarket demonstrates one Cobo-bounded evidence procurement loop: a user asks a research question, the Research Agent proposes a bounded plan, Cobo constrains spending, escrow funds the provider job, evidence is verified, and settlement or challenge outcomes are replayable in the audit trail.

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
3. Show exactly three providers and explain why `Execution Research Expert Agent` is recommended.
4. Submit and activate the Cobo Pact, making the spending boundary visible.
5. Fund the escrow job and point to the transaction hash rather than a direct provider payment.
6. Run the expert provider and show the evidence-backed answer package.
7. Verify the evidence and settle payment only after the verifier accepts it.
8. Start a fresh shallow-provider path, show the `CoverageMiss`, then show challenge win plus refund or slash.
9. Start a fresh denial path, trigger the blocked Cobo action, and show that funds did not move.
10. Open the audit log and replay the plan, Pact, allowed transaction, delivery hash, verifier result, settlement, challenge result, and denial.

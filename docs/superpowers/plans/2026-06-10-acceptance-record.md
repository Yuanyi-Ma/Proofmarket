# ProofMarket Real Success Path — Acceptance Record

Date: 2026-06-10
Run: headless driver `pnpm demo:real` (unpaired Cobo wallet, auto-approved pacts), web on :3001, services on :4010, real mode.
Spec: `../../../spec/proofmarket-demo/real-success-path-spec.md` §11 验收 / §16 最小通过定义.

## Result: PASS — full real closed loop on Sepolia

Every hash below is real and independently verifiable on sepolia.etherscan.io. No fixtures, no fabricated values.

## Deployment (spec §11.2)

| Item | Value |
|---|---|
| chainId | 11155111 (Sepolia) |
| MockUSDC | `0x7528910Abbe570ad70F09a9694226f303Cbb9f96` |
| ProofMarketEscrow | `0x8bd19cf98C3edb4D613106A20cEbB58FAfb22dA6` |
| Deployer | `0xFd36efb2d9A02eD2F2b0fD9d664F24B590602892` |
| Cobo wallet (escrow client + evaluator) | `0xe84772e20744cdc22318825e00cf5fdf6000cc24` |
| Provider signer | `0x0866e2b066d1D04e4a5A4Cccc380E7Da2c1c2f3a` |
| Mint (100 mUSDC → Cobo wallet) | `0xf4169817dd044e4dd5520f2f46ae0d9f1642d54c5f29db5b79d44c47b9b92138` |
| Deploy artifact | `deployments/sepolia.json` |

## Success path — task_001 (final status: Settled)

Research Agent: real Claude Code launched, recommended `execution-research-expert` with a reasoned provider-selection justification (stored in `claudePlanRaw`).
Pact: `8d446a31-d0bc-40b8-80c2-ed9ea72a3e80` (active).

| Step | tx hash (Sepolia) | receipt | block |
|---|---|---|---|
| approve | `0x64ceef52167a2e6f56f5bd11d3b15bbb7ef97b8aac68fb8a6f6fe560d173e915` | 0x1 success | 11027558 |
| createJob | `0xd738e5c61ed7fb7449cbe1b031a4f5a1f87636e49d3df35df0696048024f561f` | 0x1 success | 11027561 |
| setBudget | `0xd68d2d20d87489b67113d87a793b7450fd084955c34bc7a5bb0baf8d0b0643f6` | 0x1 success | 11027563 |
| fund | `0x8858cfc2c6b6e35a11c62b9b3edf260bc26e93949a76e6c47e09567f66756b98` | 0x1 success | 11027565 |
| submit (provider signer) | `0xbdce626f14c5be6130d0deb9d3cb4694871a82e8bf62d8e98cdd127f19b677b6` | 0x1 success | 11027566 |
| complete (settlement) | `0xf9423115a4c671b008c74204a646456ca25b0dfa96dbbf901426433aefeb78fc` | 0x1 success | 11027568 |

Evidence package hash: `0x79a3e6bb5d99750f62a223e05d3aa79381351753141e64aa70f4ad233268b387`
Verdict hash: `0x6cca78d392447f6e004178a6f7cc6b5c0e59636233bfd3327b2c9e1692d60c2f`

### On-chain readback (independent verification)

- Escrow `jobs(1)`: state = **3 (Completed)**, budget = **1000000** raw (1 mUSDC), deliverableHash = **0x79a3e6bb…b387** — byte-identical to the off-chain package hash.
- MockUSDC `balanceOf(coboWallet)` = **99000000** (started 100000000, −1000000 paid out).
- MockUSDC `balanceOf(providerSigner)` = **1000000** (received the escrow payment).

Audit trail: `data/demo-state/audit-task_001.jsonl` (20 events) — includes `escrow_funded_verified` (post-fund chain readback) and `chain_tx_confirmed` per tx.

## Denial path — task_002 (final status: DeniedByCobo)

Out-of-Pact transfer (0.001 SETH → `0x…dEaD`) submitted to Cobo and **really rejected by the policy engine**:
- exit code 5
- Cobo raw: `403 Forbidden … "code":"TRANSFER_LIMIT_EXCEEDED","reason":"no_pact_transfer_allowed…`
- No on-chain transaction produced.
Audit trail: `data/demo-state/audit-task_002.jsonl`.

## Spec §11.1 硬性验收 — all satisfied

- 真实启动 Claude Code 并保存结构化输出 ✓ (plan reason captured, schema-validated)
- schema 失败停止不补假数据 ✓ (validator + retry-then-throw)
- Pact 未激活不调用 createJob ✓ (executeEscrow gated on pact active)
- createJob 返回真实 tx hash + 链上 jobId ✓ (jobId 1 from JobCreated event)
- fund 返回真实 tx hash + 能从合约读回资金状态 ✓ (escrow_funded_verified: state Funded, budget 1000000)
- Provider package 稳定 hash ✓
- 提交 hash 能从链上读回同一个 ✓ (deliverableHash == packageHash on chain)
- Judge valid 后经 Cobo 执行 complete ✓
- complete 后展示真实结算 tx hash ✓
- 拒绝由 Cobo policy engine 真实拒绝，原因来自 Cobo ✓ (exit 5, TRANSFER_LIMIT_EXCEEDED)

## Notes for Demo Day

- Wallet is unpaired → pacts auto-approve, the whole flow runs with zero human steps. If a "user approves in Cobo app" scene is wanted, pair the wallet and re-run this acceptance (approval becomes manual).
- Sepolia gas spiked to ~20 gwei during this run (normally 1–2); the deployer was funded generously to absorb it. Top up before a live run.
- One fix was required mid-acceptance: `caw tx call` / `tx transfer` need an explicit `--src-address` in this environment (server-side auto-select did not work). Fixed in `packages/cobo/src/coboClient.ts` (srcAddress option, wired from `deployment.coboWallet` in `apps/web/lib/api.ts`).

# Real Success Path Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the local-state-machine demo into a real closed loop: Claude Code plans procurement, Cobo Pact executes Sepolia escrow transactions, deterministic Provider/Judge services participate over real interfaces, and the UI shows only real hashes in real mode.

**Architecture:** A `PROOFMARKET_MODE=fixture|real` switch selects between the existing in-memory task service (unchanged behavior, relabeled) and a new async orchestrator that drives `caw` CLI (Cobo), viem (Sepolia reads + provider signer), a spawned `claude -p` research agent, and a small HTTP service hosting the deterministic Provider and Judge. Contracts (`MockUSDC`, `ProofMarketEscrow`) are deployed to Sepolia by a local deployer key; the Cobo wallet is the escrow client/evaluator; the provider signer submits deliverable hashes.

**Tech Stack:** pnpm workspace, TypeScript, Next.js 15 (routes + UI), Hardhat 2 (contracts), viem (chain), Cobo `caw` CLI v0.2.86, Claude Code headless (`claude -p`), vitest.

**Spec:** `../../../spec/proofmarket-demo/real-success-path-spec.md` (定稿 2026-06-10)

**Key environment facts (verified 2026-06-10):**
- `caw` v0.2.86 at `/Users/luke/.local/bin/caw`. `caw status` → `{"healthy":true,"wallet_paired":false,"wallet_status":"active"}`.
- **Pact approval is fully automatic while unpaired** (probe verified: `caw pact submit` → `"Pact submitted and auto-approved for unpaired agent"`, status `active` immediately). The whole real path is therefore testable end-to-end with no human in the loop. Pairing is OPTIONAL and only changes Demo Day narrative (human-approval scene); if Luke pairs before the demo, re-run the full acceptance afterwards because approval becomes manual.
- `caw` responses use an envelope: `{"message":"","result":{...},"success":true}` — e.g. `pact_id` lives at `result.pact_id`. All parsers must unwrap `result` when present.
- Cobo Sepolia address: `0xe84772e20744cdc22318825e00cf5fdf6000cc24`, balance 0.01 SETH (needs faucet top-up).
- Real CLI surface: `caw pact submit --intent --execution-plan --policies --completion-conditions`, `caw pact status --pact-id` (triggers lazy activation), `caw tx call --pact-id --contract --calldata --chain-id SETH [--request-id] [--value]`, `caw tx get --tx-id|--request-id`, `caw tx transfer --pact-id --token-id SETH --dst-address --amount`, `caw faucet deposit`. Exit code 5 = policy denied (this is the real denial signal).
- `contract_call` policies support ONLY `chain_in` + `target_in` (contract addresses) + `deny_if.usage_limits.rolling_24h.tx_count_gt`. No per-function selectors, no parameter/amount matching in this CLI version. Budget exposure is bounded by: small MockUSDC mint, tx-count completion condition, pact expiry, and default-deny on everything else (transfers are denied because no transfer policy exists). State this honestly in UI/talk track.
- Policy semantics are default-deny: an operation not matching any policy is denied. So the denial demo = attempt `caw tx transfer` of SETH to a stranger address under a pact that has no transfer policy → exit 5.
- `MockUSDC.decimals = 6`. Budget "5 mUSDC" = `5000000` raw units.
- Real success path needs 5 Cobo contract calls: `approve`, `createJob`, `setBudget`, `fund`, `complete` (Escrow requires `setBudget` before `fund`; client == evaluator == Cobo wallet). Completion condition `tx_count` must be ≥ 7 to leave room for the denial probe + one retry.

---

## File Structure

```
proofmarket-demo/
  .env.example                                  # NEW: documented env vars
  deployments/sepolia.json                      # NEW: deploy artifact (committed)
  packages/
    contracts/
      hardhat.config.ts                         # MODIFY: add sepolia network
      scripts/deploy-sepolia.ts                 # NEW: deploy + mint + artifact
    shared/src/
      realMode.ts                               # NEW: real-mode types + env loader
      types.ts                                  # MODIFY: Task gains txRecords + mode fields
      stateMachine.ts                           # (unchanged)
    cobo/src/
      pactPolicy.ts                             # MODIFY: + buildRealPactSubmission
      coboClient.ts                             # REWRITE: real caw flags, denial via exit 5
      coboFixture.ts                            # (unchanged, fixture mode)
    chain/                                      # NEW package: viem reads + ABI + calldata
      src/escrowAbi.ts
      src/calldata.ts
      src/chainReader.ts
    agents/src/
      claudeResearchAgent.ts                    # NEW: prompt builder, validator, spawner
    services/                                   # NEW package: deterministic Provider+Judge HTTP
      src/server.ts
      src/providerSigner.ts
    backend/src/
      realTaskService.ts                        # NEW: async orchestrator (DI for testability)
      taskService.ts                            # MODIFY: methods become async (Promise)
      auditFileLog.ts                           # NEW: JSONL audit sink
  apps/web/
    lib/api.ts                                  # MODIFY: mode switch
    app/api/tasks/.../route.ts                  # MODIFY: await service calls
    app/page.tsx + components                   # MODIFY: mode badge, tx links, pact polling
  scripts/
    check-real-env.ts                           # NEW: preflight
    run-real-success.ts                         # NEW: headless real E2E driver
```

Execution order = Task order. Tasks 1–6 need no Cobo pairing and no user input. Task 7 onward needs Luke (pairing + pact approval).

---

### Task 1: Sepolia deploy script and artifact

**Files:**
- Modify: `packages/contracts/hardhat.config.ts`
- Create: `packages/contracts/scripts/deploy-sepolia.ts`
- Create: `.env.example`
- Test: `packages/shared/tests/deploymentArtifact.test.ts` (artifact shape validator lives in shared, Task 2 consumes it — write the validator here)

- [ ] **Step 1: Add sepolia network to hardhat config**

In `packages/contracts/hardhat.config.ts`, add `networks` to the existing config object (keep existing `solidity`, `paths`, `typechain` keys):

```ts
const sepoliaRpcUrl = process.env.SEPOLIA_RPC_URL ?? "";
const deployerKey = process.env.DEPLOYER_PRIVATE_KEY ?? "";

const config: HardhatUserConfig = {
  // ...existing solidity/paths/typechain settings unchanged...
  networks: {
    sepolia: {
      url: sepoliaRpcUrl,
      accounts: deployerKey ? [deployerKey] : []
    }
  }
};
```

- [ ] **Step 2: Create `.env.example` at repo root**

```bash
# Mode: fixture (local demo, fake values, labeled) | real (Sepolia + Cobo + Claude Code)
PROOFMARKET_MODE=fixture
SEPOLIA_RPC_URL=https://ethereum-sepolia-rpc.publicnode.com
# Local test key that deploys contracts and pays deploy gas. NEVER a real-money key.
DEPLOYER_PRIVATE_KEY=
# Local test key for the demo Provider identity (submits deliverable hash on-chain).
PROVIDER_SIGNER_PRIVATE_KEY=
# Cobo Agentic Wallet Sepolia address (escrow client + evaluator).
COBO_WALLET_ADDRESS=0xe84772e20744cdc22318825e00cf5fdf6000cc24
# Deterministic Provider/Judge service.
SERVICES_URL=http://localhost:4010
SERVICES_PORT=4010
# Claude Code binary for the research agent.
CLAUDE_BIN=claude
```

- [ ] **Step 3: Write the deploy script**

`packages/contracts/scripts/deploy-sepolia.ts`:

```ts
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import hre from "hardhat";

const COBO_WALLET = process.env.COBO_WALLET_ADDRESS ?? "";
const MINT_AMOUNT = 100_000_000n; // 100 mUSDC at 6 decimals

async function main() {
  if (!COBO_WALLET.startsWith("0x") || COBO_WALLET.length !== 42) {
    throw new Error("COBO_WALLET_ADDRESS must be a 42-char 0x address");
  }

  const [deployer] = await hre.ethers.getSigners();
  console.log(`Deployer: ${deployer.address}`);

  const usdc = await hre.ethers.deployContract("MockUSDC");
  await usdc.waitForDeployment();
  const usdcAddress = await usdc.getAddress();
  console.log(`MockUSDC: ${usdcAddress}`);

  const escrow = await hre.ethers.deployContract("ProofMarketEscrow");
  await escrow.waitForDeployment();
  const escrowAddress = await escrow.getAddress();
  console.log(`ProofMarketEscrow: ${escrowAddress}`);

  const mintTx = await usdc.mint(COBO_WALLET, MINT_AMOUNT);
  const mintReceipt = await mintTx.wait();
  console.log(`Minted 100 mUSDC to ${COBO_WALLET}: ${mintReceipt?.hash}`);

  const block = await hre.ethers.provider.getBlockNumber();
  const artifact = {
    chainId: 11155111,
    network: "sepolia",
    deployer: deployer.address,
    blockNumber: block,
    coboWallet: COBO_WALLET,
    contracts: {
      MockUSDC: usdcAddress,
      ProofMarketEscrow: escrowAddress
    },
    mint: {
      to: COBO_WALLET,
      rawAmount: MINT_AMOUNT.toString(),
      txHash: mintReceipt?.hash ?? ""
    },
    deployedAt: new Date().toISOString()
  };

  const outDir = join(process.cwd(), "..", "..", "deployments");
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, "sepolia.json"), `${JSON.stringify(artifact, null, 2)}\n`);
  console.log("Wrote deployments/sepolia.json");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
```

Note on env loading: Hardhat does not auto-load `.env`. Run via dotenv-cli style shell sourcing (see Step 5 command), or `set -a; source ../../.env; set +a` first. Do not add a dotenv dependency to the contracts package.

- [ ] **Step 4: Verify against local hardhat node first**

```bash
cd packages/contracts
pnpm hardhat node   # terminal A (leave running)
# terminal B:
COBO_WALLET_ADDRESS=0x70997970C51812dc3A010C7d01b50e0d17dc79C8 \
SEPOLIA_RPC_URL=http://127.0.0.1:8545 \
DEPLOYER_PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 \
pnpm hardhat run scripts/deploy-sepolia.ts --network sepolia
```

Expected: prints two contract addresses + mint tx hash, writes `deployments/sepolia.json` with `chainId: 11155111` (the artifact records the *target* chainId constant; when running this local smoke the network is actually the hardhat node — that is fine, delete the artifact after the smoke test). Kill terminal A.

- [ ] **Step 5: Run existing contract tests, confirm nothing broke**

```bash
pnpm --filter @proofmarket/contracts test
```

Expected: PASS (same as baseline).

- [ ] **Step 6: Real Sepolia deploy** *(needs funded deployer key — generate a fresh key, fund it from a faucet, ~0.01 SETH)*

```bash
cd packages/contracts
set -a; source ../../.env; set +a
pnpm hardhat run scripts/deploy-sepolia.ts --network sepolia
```

Expected: real addresses; `deployments/sepolia.json` committed. Verify on https://sepolia.etherscan.io that both contracts exist and the mint transferred 100000000 raw units to the Cobo wallet.

- [ ] **Step 7: Commit**

```bash
git add packages/contracts .env.example deployments/sepolia.json
git commit -m "feat: Sepolia deploy script, deployment artifact, env template"
```

---

### Task 2: Shared real-mode types and env loader

**Files:**
- Create: `packages/shared/src/realMode.ts`
- Modify: `packages/shared/src/types.ts`
- Modify: `packages/shared/src/index.ts` (add `export * from "./realMode";`)
- Test: `packages/shared/tests/realMode.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/shared/tests/realMode.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  parseDeploymentArtifact,
  validateResearchPlanOutput,
  ALLOWED_CHAIN_ACTIONS
} from "@proofmarket/shared/src/realMode";

const goodArtifact = {
  chainId: 11155111,
  network: "sepolia",
  deployer: "0x" + "1".repeat(40),
  blockNumber: 123,
  coboWallet: "0x" + "2".repeat(40),
  contracts: {
    MockUSDC: "0x" + "3".repeat(40),
    ProofMarketEscrow: "0x" + "4".repeat(40)
  },
  mint: { to: "0x" + "2".repeat(40), rawAmount: "100000000", txHash: "0x" + "5".repeat(64) },
  deployedAt: "2026-06-10T00:00:00.000Z"
};

const goodPlan = {
  taskId: "task_001",
  recommendedProviderId: "execution-research-expert",
  reason: "Catalog marks this provider as the execution research specialist.",
  maxPayment: "5",
  requiredEvidenceSchema: {
    minItems: 3,
    requiredFields: ["sourceTitle", "sourceLocator", "claim", "relevanceExplanation"]
  },
  chainActions: ["createJob", "fund", "submitEvidenceHash", "complete"]
};

describe("parseDeploymentArtifact", () => {
  it("accepts a valid artifact", () => {
    expect(parseDeploymentArtifact(goodArtifact).contracts.ProofMarketEscrow).toBe(
      goodArtifact.contracts.ProofMarketEscrow
    );
  });

  it("rejects a wrong chainId", () => {
    expect(() => parseDeploymentArtifact({ ...goodArtifact, chainId: 1 })).toThrow(
      /chainId/
    );
  });

  it("rejects malformed addresses", () => {
    expect(() =>
      parseDeploymentArtifact({
        ...goodArtifact,
        contracts: { ...goodArtifact.contracts, MockUSDC: "0x123" }
      })
    ).toThrow(/address/);
  });
});

describe("validateResearchPlanOutput", () => {
  const catalogIds = ["execution-research-expert", "shallow-search-provider"];

  it("accepts a valid plan", () => {
    const plan = validateResearchPlanOutput(goodPlan, {
      taskId: "task_001",
      budgetAmount: "5",
      providerIds: catalogIds
    });
    expect(plan.recommendedProviderId).toBe("execution-research-expert");
  });

  it("rejects unknown provider", () => {
    expect(() =>
      validateResearchPlanOutput(
        { ...goodPlan, recommendedProviderId: "made-up" },
        { taskId: "task_001", budgetAmount: "5", providerIds: catalogIds }
      )
    ).toThrow(/provider/i);
  });

  it("rejects maxPayment above budget", () => {
    expect(() =>
      validateResearchPlanOutput(
        { ...goodPlan, maxPayment: "6" },
        { taskId: "task_001", budgetAmount: "5", providerIds: catalogIds }
      )
    ).toThrow(/budget/i);
  });

  it("rejects chain actions outside the allowed set", () => {
    expect(() =>
      validateResearchPlanOutput(
        { ...goodPlan, chainActions: ["createJob", "selfdestruct"] },
        { taskId: "task_001", budgetAmount: "5", providerIds: catalogIds }
      )
    ).toThrow(/action/i);
  });

  it("rejects output that smuggles a contract address", () => {
    expect(() =>
      validateResearchPlanOutput(
        { ...goodPlan, reason: "send to 0x" + "a".repeat(40) },
        { taskId: "task_001", budgetAmount: "5", providerIds: catalogIds }
      )
    ).toThrow(/address/i);
  });

  it("exposes the allowed action set", () => {
    expect(ALLOWED_CHAIN_ACTIONS).toEqual([
      "createJob",
      "fund",
      "submitEvidenceHash",
      "complete"
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @proofmarket/shared test
```

Expected: FAIL — cannot resolve `realMode`.

- [ ] **Step 3: Implement `packages/shared/src/realMode.ts`**

```ts
export const SEPOLIA_CHAIN_ID = 11155111;
export const ALLOWED_CHAIN_ACTIONS = [
  "createJob",
  "fund",
  "submitEvidenceHash",
  "complete"
] as const;
export type ChainAction = (typeof ALLOWED_CHAIN_ACTIONS)[number];

export type DeploymentArtifact = {
  chainId: number;
  network: string;
  deployer: string;
  blockNumber: number;
  coboWallet: string;
  contracts: { MockUSDC: string; ProofMarketEscrow: string };
  mint: { to: string; rawAmount: string; txHash: string };
  deployedAt: string;
};

export type ResearchPlanOutput = {
  taskId: string;
  recommendedProviderId: string;
  reason: string;
  maxPayment: string;
  requiredEvidenceSchema: { minItems: number; requiredFields: string[] };
  chainActions: ChainAction[];
};

export type TxRecord = {
  label: "approve" | "createJob" | "setBudget" | "fund" | "submit" | "complete";
  coboTxId: string | null;
  txHash: string;
  status: "pending" | "confirmed" | "failed";
};

export type CoboDenialRecord = {
  denied: true;
  exitCode: number;
  attemptedAction: string;
  rawOutput: string;
};

function isHexAddress(value: unknown): value is string {
  return typeof value === "string" && /^0x[0-9a-fA-F]{40}$/.test(value);
}

export function parseDeploymentArtifact(input: unknown): DeploymentArtifact {
  const a = input as DeploymentArtifact;
  if (!a || typeof a !== "object") throw new Error("artifact must be an object");
  if (a.chainId !== SEPOLIA_CHAIN_ID) {
    throw new Error(`artifact chainId must be ${SEPOLIA_CHAIN_ID}, got ${a.chainId}`);
  }
  for (const [name, addr] of [
    ["deployer", a.deployer],
    ["coboWallet", a.coboWallet],
    ["contracts.MockUSDC", a.contracts?.MockUSDC],
    ["contracts.ProofMarketEscrow", a.contracts?.ProofMarketEscrow]
  ] as const) {
    if (!isHexAddress(addr)) throw new Error(`artifact ${name} is not a valid address`);
  }
  return a;
}

const ADDRESS_PATTERN = /0x[0-9a-fA-F]{40}/;

export function validateResearchPlanOutput(
  input: unknown,
  context: { taskId: string; budgetAmount: string; providerIds: string[] }
): ResearchPlanOutput {
  const p = input as ResearchPlanOutput;
  if (!p || typeof p !== "object") throw new Error("plan must be an object");
  if (p.taskId !== context.taskId) throw new Error("plan taskId mismatch");
  if (!context.providerIds.includes(p.recommendedProviderId)) {
    throw new Error(`unknown provider: ${p.recommendedProviderId}`);
  }
  if (typeof p.reason !== "string" || p.reason.length === 0) {
    throw new Error("plan reason required");
  }
  if (!(Number(p.maxPayment) > 0) || Number(p.maxPayment) > Number(context.budgetAmount)) {
    throw new Error(`maxPayment ${p.maxPayment} exceeds budget ${context.budgetAmount}`);
  }
  if (
    !Array.isArray(p.chainActions) ||
    p.chainActions.length === 0 ||
    !p.chainActions.every((action) =>
      (ALLOWED_CHAIN_ACTIONS as readonly string[]).includes(action)
    )
  ) {
    throw new Error("chainActions contains a disallowed action");
  }
  const schema = p.requiredEvidenceSchema;
  if (!schema || typeof schema.minItems !== "number" || !Array.isArray(schema.requiredFields)) {
    throw new Error("requiredEvidenceSchema malformed");
  }
  if (ADDRESS_PATTERN.test(JSON.stringify(p))) {
    throw new Error("plan output must not contain contract addresses");
  }
  return p;
}
```

- [ ] **Step 4: Extend `Task` type**

In `packages/shared/src/types.ts`, add to the `Task` type (after `jobId`):

```ts
  mode: "fixture" | "real";
  txRecords: import("./realMode").TxRecord[];
  claudePlanRaw: string | null;
  denial: import("./realMode").CoboDenialRecord | null;
```

Then fix the two construction sites that build `Task` literals — `packages/backend/src/taskService.ts` `createTask` gains `mode: "fixture", txRecords: [], claudePlanRaw: null, denial: null`, and `packages/shared/src/fixtures.ts` snapshot fixtures gain the same fields (run the fixture tests to find every literal the compiler flags).

- [ ] **Step 5: Run shared + backend + web tests, fix compile fallout, verify pass**

```bash
pnpm --filter @proofmarket/shared test && pnpm --filter @proofmarket/backend test && pnpm --filter @proofmarket/web test
```

Expected: PASS after updating fixture literals and any UI test snapshots that enumerate Task fields.

- [ ] **Step 6: Commit**

```bash
git add packages/shared packages/backend apps/web data
git commit -m "feat: real-mode types, deployment artifact parser, research plan validator"
```

---

### Task 3: Cobo client rewrite against the real `caw` CLI

**Files:**
- Modify: `packages/cobo/src/pactPolicy.ts`
- Rewrite: `packages/cobo/src/coboClient.ts`
- Modify: `packages/cobo/src/index.ts`
- Test: `packages/cobo/tests/pactPolicy.test.ts` (extend), `packages/cobo/tests/coboClient.test.ts` (new, uses a fake `caw` on PATH)

- [ ] **Step 1: Write failing tests for the real pact submission builder**

Append to `packages/cobo/tests/pactPolicy.test.ts`:

```ts
import { buildRealPactSubmission } from "../src/pactPolicy";

describe("buildRealPactSubmission", () => {
  const input = {
    escrowAddress: "0x" + "4".repeat(40),
    tokenAddress: "0x" + "3".repeat(40),
    budgetAmount: "5",
    taskId: "task_001"
  };

  it("whitelists exactly escrow and token contracts on SETH", () => {
    const submission = buildRealPactSubmission(input);
    const policy = submission.policies[0];
    expect(policy.type).toBe("contract_call");
    expect(policy.rules.when.chain_in).toEqual(["SETH"]);
    expect(policy.rules.when.target_in).toEqual([
      { chain_id: "SETH", contract_addr: input.escrowAddress },
      { chain_id: "SETH", contract_addr: input.tokenAddress }
    ]);
  });

  it("has no transfer policy so direct transfers are default-denied", () => {
    const submission = buildRealPactSubmission(input);
    expect(submission.policies.every((p) => p.type === "contract_call")).toBe(true);
  });

  it("caps tx count and expires", () => {
    const submission = buildRealPactSubmission(input);
    expect(submission.completionConditions).toEqual([
      { type: "tx_count", threshold: "7" },
      { type: "time_elapsed", threshold: "5400" }
    ]);
    expect(
      submission.policies[0].rules.deny_if.usage_limits.rolling_24h.tx_count_gt
    ).toBe(7);
  });

  it("mentions the budget in intent and execution plan", () => {
    const submission = buildRealPactSubmission(input);
    expect(submission.intent).toContain("5 mUSDC");
    expect(submission.executionPlan).toContain("# Risk Controls");
  });
});
```

- [ ] **Step 2: Run, verify fail**

```bash
pnpm --filter @proofmarket/cobo test
```

Expected: FAIL — `buildRealPactSubmission` not exported.

- [ ] **Step 3: Implement the builder in `packages/cobo/src/pactPolicy.ts`** (keep the existing `buildPactPolicy` summary used by fixture mode/UI)

```ts
export type RealPactSubmissionInput = {
  escrowAddress: string;
  tokenAddress: string;
  budgetAmount: string; // human units, e.g. "5"
  taskId: string;
};

export type RealPactSubmission = {
  intent: string;
  executionPlan: string;
  policies: Array<{
    name: string;
    type: "contract_call";
    rules: {
      effect: "allow";
      when: {
        chain_in: string[];
        target_in: Array<{ chain_id: string; contract_addr: string }>;
      };
      deny_if: { usage_limits: { rolling_24h: { tx_count_gt: number } } };
    };
  }>;
  completionConditions: Array<{ type: string; threshold: string }>;
};

export function buildRealPactSubmission(
  input: RealPactSubmissionInput
): RealPactSubmission {
  return {
    intent: `ProofMarket ${input.taskId}: fund one evidence procurement job, max ${input.budgetAmount} mUSDC, Sepolia escrow only.`,
    executionPlan: [
      "# Summary",
      `Procure one evidence-backed research answer through ProofMarketEscrow within ${input.budgetAmount} mUSDC.`,
      "",
      "# Operations",
      `- MockUSDC.approve(escrow, ${input.budgetAmount} mUSDC)`,
      "- ProofMarketEscrow.createJob(...)",
      `- ProofMarketEscrow.setBudget(jobId, ${input.budgetAmount} mUSDC)`,
      `- ProofMarketEscrow.fund(jobId, ${input.budgetAmount} mUSDC)`,
      "- ProofMarketEscrow.complete(jobId, verdictHash) after verifier acceptance",
      "",
      "# Risk Controls",
      "- Contract allowlist: ProofMarketEscrow + MockUSDC on SETH only",
      "- No transfer policy: any direct transfer is denied by default",
      "- Max 7 transactions, pact auto-expires after 90 minutes"
    ].join("\n"),
    policies: [
      {
        name: "proofmarket-escrow-calls",
        type: "contract_call",
        rules: {
          effect: "allow",
          when: {
            chain_in: ["SETH"],
            target_in: [
              { chain_id: "SETH", contract_addr: input.escrowAddress },
              { chain_id: "SETH", contract_addr: input.tokenAddress }
            ]
          },
          deny_if: { usage_limits: { rolling_24h: { tx_count_gt: 7 } } }
        }
      }
    ],
    completionConditions: [
      { type: "tx_count", threshold: "7" },
      { type: "time_elapsed", threshold: "5400" }
    ]
  };
}
```

- [ ] **Step 4: Write failing tests for the CLI client using a fake `caw`**

`packages/cobo/tests/coboClient.test.ts`:

```ts
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildRealPactSubmission } from "../src/pactPolicy";
import { createCliCoboClient } from "../src/coboClient";

function fakeCaw(script: string): string {
  const dir = mkdtempSync(join(tmpdir(), "fake-caw-"));
  const file = join(dir, "caw");
  writeFileSync(file, `#!/bin/bash\n${script}`);
  chmodSync(file, 0o755);
  return dir;
}

const submission = buildRealPactSubmission({
  escrowAddress: "0x" + "4".repeat(40),
  tokenAddress: "0x" + "3".repeat(40),
  budgetAmount: "5",
  taskId: "task_001"
});

describe("createCliCoboClient", () => {
  it("submits a pact and returns the pact id", async () => {
    const dir = fakeCaw(`echo '{"pact_id":"p-123","status":"pending_approval"}'`);
    const client = createCliCoboClient({ pathPrepend: dir });
    const result = await client.submitPact(submission);
    expect(result.pactId).toBe("p-123");
    expect(result.raw).toContain("p-123");
  });

  it("unwraps the real caw envelope {message, result, success}", async () => {
    const dir = fakeCaw(
      `echo '{"message":"","result":{"pact_id":"p-real","status":"active","message":"Pact submitted and auto-approved for unpaired agent."},"success":true}'`
    );
    const client = createCliCoboClient({ pathPrepend: dir });
    const result = await client.submitPact(submission);
    expect(result.pactId).toBe("p-real");
    expect(result.status).toBe("active");
  });

  it("passes required flags to pact submit", async () => {
    const dir = fakeCaw(`echo "$@" > "$0.args"; echo '{"pact_id":"p-1"}'`);
    const client = createCliCoboClient({ pathPrepend: dir });
    await client.submitPact(submission);
    const { readFileSync } = await import("node:fs");
    const args = readFileSync(join(dir, "caw.args"), "utf8");
    expect(args).toContain("pact submit");
    expect(args).toContain("--intent");
    expect(args).toContain("--execution-plan");
    expect(args).toContain("--policies");
    expect(args).toContain("--completion-conditions");
  });

  it("reads pact status", async () => {
    const dir = fakeCaw(`echo '{"pact_id":"p-123","status":"active"}'`);
    const client = createCliCoboClient({ pathPrepend: dir });
    const status = await client.getPactStatus("p-123");
    expect(status.status).toBe("active");
  });

  it("submits a contract call and returns the tx record id", async () => {
    const dir = fakeCaw(`echo '{"tx_id":"tx-9","status":"submitted"}'`);
    const client = createCliCoboClient({ pathPrepend: dir });
    const result = await client.callContract({
      pactId: "p-123",
      contract: "0x" + "4".repeat(40),
      calldata: "0xdeadbeef",
      requestId: "task_001-createJob",
      description: "createJob"
    });
    expect(result.coboTxId).toBe("tx-9");
  });

  it("maps exit code 5 to a denial record instead of throwing", async () => {
    const dir = fakeCaw(`echo '{"error":"policy denied: no matching policy"}' >&2; exit 5`);
    const client = createCliCoboClient({ pathPrepend: dir });
    const denial = await client.attemptDeniedTransfer({
      pactId: "p-123",
      dstAddress: "0x" + "d".repeat(40),
      amount: "0.001"
    });
    expect(denial.denied).toBe(true);
    expect(denial.exitCode).toBe(5);
    expect(denial.rawOutput).toContain("policy denied");
  });

  it("throws on non-policy errors", async () => {
    const dir = fakeCaw(`echo 'network broke' >&2; exit 7`);
    const client = createCliCoboClient({ pathPrepend: dir });
    await expect(
      client.callContract({
        pactId: "p-1",
        contract: "0x" + "4".repeat(40),
        calldata: "0x00",
        requestId: "r",
        description: "d"
      })
    ).rejects.toThrow(/exit 7/);
  });
});
```

- [ ] **Step 5: Run, verify fail; then rewrite `packages/cobo/src/coboClient.ts`**

```ts
import { execFile } from "node:child_process";

import type { RealPactSubmission } from "./pactPolicy";

export type CoboClientOptions = {
  pathPrepend?: string; // tests inject a fake caw directory
  timeoutMs?: number;
};

export type PactSubmitResult = { pactId: string; status: string; raw: string };
export type PactStatusResult = { pactId: string; status: string; raw: string };
export type ContractCallResult = { coboTxId: string; status: string; raw: string };
export type DenialResult = {
  denied: true;
  exitCode: number;
  attemptedAction: string;
  rawOutput: string;
};

export interface CoboClient {
  submitPact(submission: RealPactSubmission): Promise<PactSubmitResult>;
  getPactStatus(pactId: string): Promise<PactStatusResult>;
  callContract(input: {
    pactId: string;
    contract: string;
    calldata: string;
    requestId: string;
    description: string;
  }): Promise<ContractCallResult>;
  getTx(coboTxId: string): Promise<{ raw: string; parsed: Record<string, unknown> }>;
  attemptDeniedTransfer(input: {
    pactId: string;
    dstAddress: string;
    amount: string;
  }): Promise<DenialResult>;
}

type RunResult = { stdout: string; stderr: string; exitCode: number };

function runCaw(args: string[], options: CoboClientOptions): Promise<RunResult> {
  const env = { ...process.env };
  if (options.pathPrepend) env.PATH = `${options.pathPrepend}:${env.PATH}`;
  return new Promise((resolve) => {
    execFile(
      "caw",
      args,
      { env, timeout: options.timeoutMs ?? 120_000 },
      (error, stdout, stderr) => {
        const exitCode =
          error && typeof (error as NodeJS.ErrnoException & { code?: number }).code === "number"
            ? ((error as unknown as { code: number }).code as number)
            : error
              ? 1
              : 0;
        resolve({ stdout: stdout ?? "", stderr: stderr ?? "", exitCode });
      }
    );
  });
}

function parseLooseJson(raw: string): Record<string, unknown> {
  let parsed: Record<string, unknown> = {};
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    const match = raw.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        parsed = JSON.parse(match[0]) as Record<string, unknown>;
      } catch {
        /* fall through */
      }
    }
  }
  // caw wraps payloads as {message, result: {...}, success} — unwrap when present
  if (parsed.result && typeof parsed.result === "object" && !Array.isArray(parsed.result)) {
    return { ...parsed, ...(parsed.result as Record<string, unknown>) };
  }
  return parsed;
}

function pickString(obj: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === "string" && value) return value;
  }
  return "";
}

export function createCliCoboClient(options: CoboClientOptions = {}): CoboClient {
  async function expectSuccess(args: string[], action: string): Promise<RunResult> {
    const result = await runCaw(args, options);
    if (result.exitCode !== 0) {
      throw new Error(
        `caw ${action} failed with exit ${result.exitCode}: ${result.stderr || result.stdout}`
      );
    }
    return result;
  }

  return {
    async submitPact(submission) {
      const result = await expectSuccess(
        [
          "pact",
          "submit",
          "--intent",
          submission.intent,
          "--execution-plan",
          submission.executionPlan,
          "--policies",
          JSON.stringify(submission.policies),
          "--completion-conditions",
          JSON.stringify(submission.completionConditions)
        ],
        "pact submit"
      );
      const parsed = parseLooseJson(result.stdout);
      const pactId = pickString(parsed, ["pact_id", "pactId", "id"]);
      if (!pactId) throw new Error(`caw pact submit returned no pact id: ${result.stdout}`);
      return { pactId, status: pickString(parsed, ["status"]), raw: result.stdout };
    },

    async getPactStatus(pactId) {
      const result = await expectSuccess(
        ["pact", "status", "--pact-id", pactId],
        "pact status"
      );
      const parsed = parseLooseJson(result.stdout);
      return {
        pactId,
        status: pickString(parsed, ["status", "state"]),
        raw: result.stdout
      };
    },

    async callContract(input) {
      const result = await expectSuccess(
        [
          "tx",
          "call",
          "--pact-id",
          input.pactId,
          "--chain-id",
          "SETH",
          "--contract",
          input.contract,
          "--calldata",
          input.calldata,
          "--request-id",
          input.requestId,
          "--description",
          input.description
        ],
        "tx call"
      );
      const parsed = parseLooseJson(result.stdout);
      const coboTxId = pickString(parsed, ["tx_id", "txId", "transaction_id", "id"]);
      if (!coboTxId) throw new Error(`caw tx call returned no tx id: ${result.stdout}`);
      return { coboTxId, status: pickString(parsed, ["status"]), raw: result.stdout };
    },

    async getTx(coboTxId) {
      const result = await expectSuccess(["tx", "get", "--tx-id", coboTxId], "tx get");
      return { raw: result.stdout, parsed: parseLooseJson(result.stdout) };
    },

    async attemptDeniedTransfer(input) {
      const args = [
        "tx",
        "transfer",
        "--pact-id",
        input.pactId,
        "--token-id",
        "SETH",
        "--dst-address",
        input.dstAddress,
        "--amount",
        input.amount
      ];
      const result = await runCaw(args, options);
      if (result.exitCode === 5 || result.exitCode !== 0) {
        return {
          denied: true,
          exitCode: result.exitCode,
          attemptedAction: `tx transfer ${input.amount} SETH -> ${input.dstAddress}`,
          rawOutput: result.stderr || result.stdout
        };
      }
      throw new Error(
        `DENIAL DEMO FAILED OPEN: caw allowed a transfer that must be denied. Output: ${result.stdout}`
      );
    }
  };
}
```

Also update `packages/cobo/src/index.ts` exports to match, and delete the old `caw contract call`-based types. The fixture client in `coboFixture.ts` stays for fixture mode.

- [ ] **Step 6: Run cobo tests, verify pass**

```bash
pnpm --filter @proofmarket/cobo test
```

Expected: PASS.

- [ ] **Step 7: Fix backend compile fallout** — `taskService.ts` imports `buildPactPolicy` only; ensure `pnpm test` at root still passes.

- [ ] **Step 8: Commit**

```bash
git add packages/cobo packages/backend
git commit -m "feat: real caw CLI client with pact submission and exit-5 denial mapping"
```

---

### Task 4: Chain package (viem reads + calldata encoding)

**Files:**
- Create: `packages/chain/package.json`, `packages/chain/tsconfig.json`
- Create: `packages/chain/src/escrowAbi.ts`, `packages/chain/src/calldata.ts`, `packages/chain/src/chainReader.ts`, `packages/chain/src/index.ts`
- Test: `packages/chain/tests/calldata.test.ts`
- Modify: `pnpm-workspace.yaml` already covers `packages/*` (verify; no change expected)

- [ ] **Step 1: Scaffold package**

`packages/chain/package.json`:

```json
{
  "name": "@proofmarket/chain",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "src/index.ts",
  "scripts": {
    "build": "tsc --noEmit",
    "test": "vitest run tests"
  },
  "dependencies": {
    "@proofmarket/shared": "workspace:*",
    "viem": "^2.21.0"
  },
  "devDependencies": {
    "typescript": "^5.7.2",
    "vitest": "^2.1.8"
  }
}
```

`packages/chain/tsconfig.json`: copy `packages/cobo/tsconfig.json` verbatim.

Run `pnpm install` at repo root after creating it.

- [ ] **Step 2: Write failing calldata tests**

`packages/chain/tests/calldata.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  encodeApprove,
  encodeCreateJob,
  encodeSetBudget,
  encodeFund,
  encodeComplete,
  encodeSubmit
} from "../src/calldata";

const addr = (c: string) => `0x${c.repeat(40)}` as `0x${string}`;
const hash32 = (c: string) => `0x${c.repeat(64)}` as `0x${string}`;

describe("calldata encoding", () => {
  it("encodes approve(spender, amount)", () => {
    const data = encodeApprove(addr("4"), 5_000_000n);
    expect(data.startsWith("0x095ea7b3")).toBe(true); // approve selector
  });

  it("encodes createJob with 8 args", () => {
    const data = encodeCreateJob({
      providerAgentId: 1n,
      provider: addr("a"),
      verifierAgentId: 2n,
      evaluator: addr("b"),
      token: addr("3"),
      expiredAt: 1_900_000_000n,
      descriptionHash: hash32("1"),
      coverageHash: hash32("2")
    });
    expect(data.length).toBe(2 + 8 + 8 * 64); // selector + 8 words
  });

  it("encodes setBudget, fund, complete, submit", () => {
    expect(encodeSetBudget(1n, 5_000_000n).length).toBe(2 + 8 + 2 * 64);
    expect(encodeFund(1n, 5_000_000n).length).toBe(2 + 8 + 2 * 64);
    expect(encodeComplete(1n, hash32("3")).length).toBe(2 + 8 + 2 * 64);
    expect(encodeSubmit(1n, hash32("4")).length).toBe(2 + 8 + 2 * 64);
  });
});
```

- [ ] **Step 3: Run, verify fail; implement**

`packages/chain/src/escrowAbi.ts`:

```ts
export const escrowAbi = [
  {
    type: "function",
    name: "createJob",
    stateMutability: "nonpayable",
    inputs: [
      { name: "providerAgentId", type: "uint256" },
      { name: "provider", type: "address" },
      { name: "verifierAgentId", type: "uint256" },
      { name: "evaluator", type: "address" },
      { name: "token", type: "address" },
      { name: "expiredAt", type: "uint256" },
      { name: "descriptionHash", type: "bytes32" },
      { name: "coverageHash", type: "bytes32" }
    ],
    outputs: [{ name: "jobId", type: "uint256" }]
  },
  { type: "function", name: "setBudget", stateMutability: "nonpayable", inputs: [{ name: "jobId", type: "uint256" }, { name: "amount", type: "uint256" }], outputs: [] },
  { type: "function", name: "fund", stateMutability: "nonpayable", inputs: [{ name: "jobId", type: "uint256" }, { name: "expectedAmount", type: "uint256" }], outputs: [] },
  { type: "function", name: "submit", stateMutability: "nonpayable", inputs: [{ name: "jobId", type: "uint256" }, { name: "deliverableHash", type: "bytes32" }], outputs: [] },
  { type: "function", name: "complete", stateMutability: "nonpayable", inputs: [{ name: "jobId", type: "uint256" }, { name: "reasonHash", type: "bytes32" }], outputs: [] },
  {
    type: "function",
    name: "jobs",
    stateMutability: "view",
    inputs: [{ name: "", type: "uint256" }],
    outputs: [
      { name: "jobId", type: "uint256" },
      { name: "client", type: "address" },
      { name: "providerAgentId", type: "uint256" },
      { name: "provider", type: "address" },
      { name: "verifierAgentId", type: "uint256" },
      { name: "evaluator", type: "address" },
      { name: "token", type: "address" },
      { name: "budget", type: "uint256" },
      { name: "expiredAt", type: "uint256" },
      { name: "state", type: "uint8" },
      { name: "descriptionHash", type: "bytes32" },
      { name: "deliverableHash", type: "bytes32" },
      { name: "coverageHash", type: "bytes32" }
    ]
  },
  {
    type: "event",
    name: "JobCreated",
    inputs: [
      { name: "jobId", type: "uint256", indexed: true },
      { name: "client", type: "address", indexed: true },
      { name: "provider", type: "address", indexed: true }
    ]
  },
  { type: "event", name: "JobFunded", inputs: [{ name: "jobId", type: "uint256", indexed: true }, { name: "amount", type: "uint256", indexed: false }] },
  { type: "event", name: "DeliverableSubmitted", inputs: [{ name: "jobId", type: "uint256", indexed: true }, { name: "deliverableHash", type: "bytes32", indexed: false }] },
  { type: "event", name: "JobCompleted", inputs: [{ name: "jobId", type: "uint256", indexed: true }, { name: "reasonHash", type: "bytes32", indexed: false }] }
] as const;

export const erc20Abi = [
  { type: "function", name: "approve", stateMutability: "nonpayable", inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ name: "", type: "bool" }] },
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "", type: "address" }], outputs: [{ name: "", type: "uint256" }] }
] as const;
```

`packages/chain/src/calldata.ts`:

```ts
import { encodeFunctionData } from "viem";
import { erc20Abi, escrowAbi } from "./escrowAbi";

type Hex = `0x${string}`;

export function encodeApprove(spender: Hex, amount: bigint): Hex {
  return encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [spender, amount] });
}

export function encodeCreateJob(args: {
  providerAgentId: bigint;
  provider: Hex;
  verifierAgentId: bigint;
  evaluator: Hex;
  token: Hex;
  expiredAt: bigint;
  descriptionHash: Hex;
  coverageHash: Hex;
}): Hex {
  return encodeFunctionData({
    abi: escrowAbi,
    functionName: "createJob",
    args: [
      args.providerAgentId,
      args.provider,
      args.verifierAgentId,
      args.evaluator,
      args.token,
      args.expiredAt,
      args.descriptionHash,
      args.coverageHash
    ]
  });
}

export function encodeSetBudget(jobId: bigint, amount: bigint): Hex {
  return encodeFunctionData({ abi: escrowAbi, functionName: "setBudget", args: [jobId, amount] });
}

export function encodeFund(jobId: bigint, expectedAmount: bigint): Hex {
  return encodeFunctionData({ abi: escrowAbi, functionName: "fund", args: [jobId, expectedAmount] });
}

export function encodeSubmit(jobId: bigint, deliverableHash: Hex): Hex {
  return encodeFunctionData({ abi: escrowAbi, functionName: "submit", args: [jobId, deliverableHash] });
}

export function encodeComplete(jobId: bigint, reasonHash: Hex): Hex {
  return encodeFunctionData({ abi: escrowAbi, functionName: "complete", args: [jobId, reasonHash] });
}
```

`packages/chain/src/chainReader.ts`:

```ts
import {
  createPublicClient,
  decodeEventLog,
  http,
  type Hash,
  type PublicClient,
  type TransactionReceipt
} from "viem";
import { sepolia } from "viem/chains";
import { escrowAbi } from "./escrowAbi";

export type ChainReader = {
  waitForReceipt(txHash: Hash): Promise<TransactionReceipt>;
  extractJobId(receipt: TransactionReceipt, escrowAddress: string): bigint;
  readJobState(escrowAddress: `0x${string}`, jobId: bigint): Promise<{ state: number; budget: bigint; deliverableHash: `0x${string}` }>;
};

export function createChainReader(rpcUrl: string): ChainReader {
  const client: PublicClient = createPublicClient({ chain: sepolia, transport: http(rpcUrl) });

  return {
    async waitForReceipt(txHash) {
      return client.waitForTransactionReceipt({ hash: txHash, timeout: 180_000 });
    },

    extractJobId(receipt, escrowAddress) {
      for (const log of receipt.logs) {
        if (log.address.toLowerCase() !== escrowAddress.toLowerCase()) continue;
        try {
          const event = decodeEventLog({ abi: escrowAbi, data: log.data, topics: log.topics });
          if (event.eventName === "JobCreated") {
            return (event.args as { jobId: bigint }).jobId;
          }
        } catch {
          /* not a JobCreated log */
        }
      }
      throw new Error(`No JobCreated event found in receipt ${receipt.transactionHash}`);
    },

    async readJobState(escrowAddress, jobId) {
      const job = (await client.readContract({
        address: escrowAddress,
        abi: escrowAbi,
        functionName: "jobs",
        args: [jobId]
      })) as readonly unknown[];
      return {
        state: Number(job[9]),
        budget: job[7] as bigint,
        deliverableHash: job[11] as `0x${string}`
      };
    }
  };
}
```

`packages/chain/src/index.ts` re-exports all three modules.

- [ ] **Step 4: Run chain tests, verify pass**

```bash
pnpm install && pnpm --filter @proofmarket/chain test
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/chain pnpm-lock.yaml
git commit -m "feat: chain package with escrow ABI, calldata encoders, Sepolia reader"
```

---

### Task 5: Claude Code research agent launcher

**Files:**
- Create: `packages/agents/src/claudeResearchAgent.ts`
- Modify: `packages/agents/src/index.ts` (export it)
- Test: `packages/agents/tests/claudeResearchAgent.test.ts` (fake `claude` binary, same PATH trick as Task 3)

- [ ] **Step 1: Write failing tests**

`packages/agents/tests/claudeResearchAgent.test.ts`:

```ts
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildResearchPrompt, runClaudeResearchAgent } from "../src/claudeResearchAgent";

function fakeClaude(script: string): string {
  const dir = mkdtempSync(join(tmpdir(), "fake-claude-"));
  const file = join(dir, "claude");
  writeFileSync(file, `#!/bin/bash\n${script}`);
  chmodSync(file, 0o755);
  return file;
}

const context = {
  taskId: "task_001",
  question: "Survey recent research on blockchain transaction execution acceleration.",
  budgetAmount: "5",
  providerCatalog: [
    {
      providerId: "execution-research-expert",
      displayName: "Execution Research Expert Agent",
      specialties: ["parallel execution", "Block-STM"],
      price: "5 mUSDC"
    },
    {
      providerId: "shallow-search-provider",
      displayName: "Shallow Search Provider Agent",
      specialties: ["general web summaries"],
      price: "1 mUSDC"
    }
  ],
  pactSummary: "Escrow + MockUSDC allowlist on Sepolia, max 7 txs, 90 min expiry."
};

const validPlan = JSON.stringify({
  taskId: "task_001",
  recommendedProviderId: "execution-research-expert",
  reason: "Specialist coverage of execution acceleration literature.",
  maxPayment: "5",
  requiredEvidenceSchema: {
    minItems: 3,
    requiredFields: ["sourceTitle", "sourceLocator", "claim", "relevanceExplanation"]
  },
  chainActions: ["createJob", "fund", "submitEvidenceHash", "complete"]
});

function claudeEnvelope(result: string): string {
  return JSON.stringify({ type: "result", subtype: "success", result });
}

describe("buildResearchPrompt", () => {
  it("includes question, budget, catalog, allowed actions, pact summary, and schema", () => {
    const prompt = buildResearchPrompt(context);
    expect(prompt).toContain(context.question);
    expect(prompt).toContain('"maxPayment"');
    expect(prompt).toContain("execution-research-expert");
    expect(prompt).toContain("submitEvidenceHash");
    expect(prompt).toContain(context.pactSummary);
  });

  it("forbids addresses, calldata, and keys", () => {
    const prompt = buildResearchPrompt(context);
    expect(prompt).toMatch(/never .*contract address/i);
  });
});

describe("runClaudeResearchAgent", () => {
  it("parses and validates a good run", async () => {
    const bin = fakeClaude(`echo '${claudeEnvelope(validPlan)}'`);
    const run = await runClaudeResearchAgent(context, { claudeBin: bin });
    expect(run.plan.recommendedProviderId).toBe("execution-research-expert");
    expect(run.rawStdout).toContain("result");
  });

  it("extracts JSON when the result has prose around it", async () => {
    const wrapped = claudeEnvelope(`Here is the plan:\\n\`\`\`json\\n${validPlan.replace(/"/g, '\\"')}\\n\`\`\``);
    const bin = fakeClaude(`echo '${wrapped}'`);
    const run = await runClaudeResearchAgent(context, { claudeBin: bin });
    expect(run.plan.taskId).toBe("task_001");
  });

  it("retries once then fails hard on invalid output", async () => {
    const bin = fakeClaude(`echo '${claudeEnvelope("{\\"taskId\\":\\"task_001\\"}")}'`);
    await expect(runClaudeResearchAgent(context, { claudeBin: bin })).rejects.toThrow(
      /after retry/i
    );
  });
});
```

- [ ] **Step 2: Run, verify fail**

```bash
pnpm --filter @proofmarket/agents test
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `packages/agents/src/claudeResearchAgent.ts`**

```ts
import { execFile } from "node:child_process";
import {
  ALLOWED_CHAIN_ACTIONS,
  validateResearchPlanOutput,
  type ResearchPlanOutput
} from "@proofmarket/shared/src/realMode";

export type ProviderCatalogEntry = {
  providerId: string;
  displayName: string;
  specialties: string[];
  price: string;
};

export type ResearchContext = {
  taskId: string;
  question: string;
  budgetAmount: string;
  providerCatalog: ProviderCatalogEntry[];
  pactSummary: string;
};

export type ResearchRun = {
  plan: ResearchPlanOutput;
  rawStdout: string;
  attempts: number;
};

export function buildResearchPrompt(context: ResearchContext): string {
  return [
    "You are the ProofMarket Research Agent. Produce a procurement plan for buying",
    "verifiable evidence from one provider. Respond with ONLY a JSON object matching",
    "this schema (no markdown fences, no commentary):",
    JSON.stringify(
      {
        taskId: context.taskId,
        recommendedProviderId: "<one providerId from the catalog>",
        reason: "<why this provider fits the question>",
        maxPayment: `<decimal string, must not exceed ${context.budgetAmount}>`,
        requiredEvidenceSchema: {
          minItems: 3,
          requiredFields: ["sourceTitle", "sourceLocator", "claim", "relevanceExplanation"]
        },
        chainActions: ALLOWED_CHAIN_ACTIONS
      },
      null,
      2
    ),
    "",
    `User question: ${context.question}`,
    `Budget cap: ${context.budgetAmount} mUSDC`,
    `Allowed chain actions (use exactly these): ${ALLOWED_CHAIN_ACTIONS.join(", ")}`,
    `Cobo Pact boundary: ${context.pactSummary}`,
    "",
    "Provider catalog:",
    JSON.stringify(context.providerCatalog, null, 2),
    "",
    "Rules: never output a contract address, calldata, or key material.",
    "Pick the provider whose specialties best match the question and justify briefly."
  ].join("\n");
}

function runClaude(
  prompt: string,
  claudeBin: string,
  timeoutMs: number
): Promise<{ stdout: string }> {
  return new Promise((resolve, reject) => {
    execFile(
      claudeBin,
      ["-p", prompt, "--output-format", "json", "--max-turns", "1"],
      { timeout: timeoutMs, maxBuffer: 10 * 1024 * 1024 },
      (error, stdout) => {
        if (error) reject(new Error(`claude failed: ${error.message}`));
        else resolve({ stdout: stdout ?? "" });
      }
    );
  });
}

function extractPlanJson(stdout: string): unknown {
  const envelope = JSON.parse(stdout) as { result?: string };
  const result = envelope.result ?? "";
  try {
    return JSON.parse(result);
  } catch {
    const fenced = result.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenced) return JSON.parse(fenced[1]);
    const bare = result.match(/\{[\s\S]*\}/);
    if (bare) return JSON.parse(bare[0]);
    throw new Error("no JSON object found in claude result");
  }
}

export async function runClaudeResearchAgent(
  context: ResearchContext,
  options: { claudeBin?: string; timeoutMs?: number } = {}
): Promise<ResearchRun> {
  const claudeBin = options.claudeBin ?? process.env.CLAUDE_BIN ?? "claude";
  const timeoutMs = options.timeoutMs ?? 180_000;
  const prompt = buildResearchPrompt(context);
  const providerIds = context.providerCatalog.map((entry) => entry.providerId);

  let lastError: Error | null = null;
  let lastStdout = "";
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const { stdout } = await runClaude(prompt, claudeBin, timeoutMs);
      lastStdout = stdout;
      const candidate = extractPlanJson(stdout);
      const plan = validateResearchPlanOutput(candidate, {
        taskId: context.taskId,
        budgetAmount: context.budgetAmount,
        providerIds
      });
      return { plan, rawStdout: stdout, attempts: attempt };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
    }
  }
  throw new Error(
    `Claude research agent failed after retry: ${lastError?.message}. Raw: ${lastStdout.slice(0, 500)}`
  );
}
```

Spec rule honored: on schema failure after one retry this THROWS — the orchestrator must surface the failure, never fabricate a plan.

- [ ] **Step 4: Run, verify pass**

```bash
pnpm --filter @proofmarket/agents test
```

Expected: PASS.

- [ ] **Step 5: One real smoke run (no chain involved, costs one Claude call)**

```bash
cd /Users/luke/agents/product_designer/proofmarket/proofmarket-demo
pnpm tsx -e "
import { runClaudeResearchAgent } from './packages/agents/src/claudeResearchAgent.ts';
const run = await runClaudeResearchAgent({
  taskId: 'smoke_001',
  question: 'Survey recent research on blockchain transaction execution acceleration.',
  budgetAmount: '5',
  providerCatalog: [
    { providerId: 'execution-research-expert', displayName: 'Execution Research Expert Agent', specialties: ['parallel execution','Block-STM'], price: '5 mUSDC' },
    { providerId: 'shallow-search-provider', displayName: 'Shallow Search Provider Agent', specialties: ['general summaries'], price: '1 mUSDC' }
  ],
  pactSummary: 'Escrow + MockUSDC allowlist on Sepolia, max 7 txs, 90 min expiry.'
});
console.log(JSON.stringify(run.plan, null, 2), 'attempts:', run.attempts);
"
```

Expected: a validated plan recommending `execution-research-expert`.

- [ ] **Step 6: Commit**

```bash
git add packages/agents
git commit -m "feat: Claude Code research agent launcher with schema validation and single retry"
```

---

### Task 6: Deterministic Provider + Judge HTTP service

**Files:**
- Create: `packages/services/package.json` (same shape as chain package; deps: `@proofmarket/shared`, `@proofmarket/agents`, `@proofmarket/chain`, `viem`; script `"dev": "tsx src/server.ts"`, add `tsx` devDep)
- Create: `packages/services/tsconfig.json` (copy from cobo)
- Create: `packages/services/src/server.ts`, `packages/services/src/providerSigner.ts`, `packages/services/src/index.ts`
- Test: `packages/services/tests/server.test.ts`
- Modify: root `package.json` scripts — add `"dev:services": "pnpm --filter @proofmarket/services dev"`

- [ ] **Step 1: Write failing tests**

`packages/services/tests/server.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startServicesServer, type RunningServer } from "../src/server";

let server: RunningServer;

beforeAll(async () => {
  server = await startServicesServer({ port: 0, submitOnChain: null }); // null = no signer in tests
});

afterAll(async () => {
  await server.close();
});

describe("provider endpoint", () => {
  it("returns a deterministic evidence package for the expert provider", async () => {
    const response = await fetch(`${server.url}/provider/run`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        taskId: "task_001",
        jobId: "1",
        providerId: "execution-research-expert",
        question: "anything",
        requiredEvidenceSchema: { minItems: 3, requiredFields: [] }
      })
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.providerId).toBe("execution-research-expert");
    expect(body.packageHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(body.answers.length).toBeGreaterThanOrEqual(3);
  });

  it("is deterministic: same input, same hash", async () => {
    const call = () =>
      fetch(`${server.url}/provider/run`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          taskId: "task_001",
          jobId: "1",
          providerId: "execution-research-expert",
          question: "anything",
          requiredEvidenceSchema: { minItems: 3, requiredFields: [] }
        })
      }).then((r) => r.json());
    const [a, b] = await Promise.all([call(), call()]);
    expect(a.packageHash).toBe(b.packageHash);
  });

  it("rejects submit when no signer is configured", async () => {
    const response = await fetch(`${server.url}/provider/submit`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jobId: "1", deliverableHash: "0x" + "a".repeat(64) })
    });
    expect(response.status).toBe(503);
  });
});

describe("judge endpoint", () => {
  it("returns a deterministic valid verdict with a verdict hash", async () => {
    const response = await fetch(`${server.url}/judge/verify`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        taskId: "task_001",
        jobId: "1",
        evidencePackageHash: "0x" + "a".repeat(64),
        evidencePackage: { answers: [1, 2, 3] },
        successCriteria: ["at least 3 evidence items"]
      })
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.decision).toBe("valid");
    expect(body.reasonCode).toBe("PRESET_SUCCESS_PATH");
    expect(body.verdictHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(body.voting.mode).toBe("not_triggered");
  });
});
```

- [ ] **Step 2: Run, verify fail; implement `packages/services/src/server.ts`**

```ts
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { runProvider } from "@proofmarket/agents/src/providers";
import { stableHash } from "@proofmarket/shared/src/hash";
import type { ProviderId } from "@proofmarket/shared/src/types";

export type SubmitOnChain = (input: {
  jobId: bigint;
  deliverableHash: `0x${string}`;
}) => Promise<{ txHash: string }>;

export type RunningServer = { url: string; close(): Promise<void> };

function readBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let data = "";
    request.on("data", (chunk) => (data += chunk));
    request.on("end", () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch (error) {
        reject(error);
      }
    });
    request.on("error", reject);
  });
}

function send(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

export async function startServicesServer(options: {
  port: number;
  submitOnChain: SubmitOnChain | null;
}): Promise<RunningServer> {
  const server: Server = createServer(async (request, response) => {
    try {
      const body = await readBody(request);

      if (request.method === "POST" && request.url === "/provider/run") {
        const providerId = String(body.providerId ?? "") as ProviderId;
        const taskId = String(body.taskId ?? "");
        const pkg = runProvider(taskId, providerId);
        send(response, 200, { ...pkg, jobId: String(body.jobId ?? "") });
        return;
      }

      if (request.method === "POST" && request.url === "/provider/submit") {
        if (!options.submitOnChain) {
          send(response, 503, { error: "provider signer not configured" });
          return;
        }
        const result = await options.submitOnChain({
          jobId: BigInt(String(body.jobId)),
          deliverableHash: String(body.deliverableHash) as `0x${string}`
        });
        send(response, 200, { txHash: result.txHash });
        return;
      }

      if (request.method === "POST" && request.url === "/judge/verify") {
        const verdict = {
          judgeId: "judge-demo-001",
          jobId: String(body.jobId ?? ""),
          decision: "valid" as const,
          reasonCode: "PRESET_SUCCESS_PATH",
          verdictHash: stableHash({
            jobId: String(body.jobId ?? ""),
            evidencePackageHash: String(body.evidencePackageHash ?? ""),
            decision: "valid"
          }),
          voting: { mode: "not_triggered", voteId: null, onchainTxHash: null }
        };
        send(response, 200, verdict);
        return;
      }

      send(response, 404, { error: `no route: ${request.method} ${request.url}` });
    } catch (error) {
      send(response, 500, { error: error instanceof Error ? error.message : String(error) });
    }
  });

  await new Promise<void>((resolve) => server.listen(options.port, resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : options.port;
  return {
    url: `http://localhost:${port}`,
    close: () => new Promise((resolve) => server.close(() => resolve()))
  };
}
```

`packages/services/src/providerSigner.ts` (the on-chain submit boundary — provider identity signs, not the user's Cobo wallet, per spec §7.2):

```ts
import { createWalletClient, http, publicActions } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import { escrowAbi } from "@proofmarket/chain/src/escrowAbi";
import type { SubmitOnChain } from "./server";

export function createProviderSubmitter(input: {
  rpcUrl: string;
  privateKey: `0x${string}`;
  escrowAddress: `0x${string}`;
}): SubmitOnChain {
  const account = privateKeyToAccount(input.privateKey);
  const client = createWalletClient({
    account,
    chain: sepolia,
    transport: http(input.rpcUrl)
  }).extend(publicActions);

  return async ({ jobId, deliverableHash }) => {
    const hash = await client.writeContract({
      address: input.escrowAddress,
      abi: escrowAbi,
      functionName: "submit",
      args: [jobId, deliverableHash]
    });
    await client.waitForTransactionReceipt({ hash, timeout: 180_000 });
    return { txHash: hash };
  };
}
```

`packages/services/src/index.ts` — boot entry used by `pnpm dev:services`:

```ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseDeploymentArtifact } from "@proofmarket/shared/src/realMode";
import { createProviderSubmitter } from "./providerSigner";
import { startServicesServer } from "./server";

const port = Number(process.env.SERVICES_PORT ?? 4010);
const rpcUrl = process.env.SEPOLIA_RPC_URL ?? "";
const providerKey = process.env.PROVIDER_SIGNER_PRIVATE_KEY ?? "";

let submitOnChain = null;
if (rpcUrl && providerKey) {
  const artifact = parseDeploymentArtifact(
    JSON.parse(readFileSync(join(process.cwd(), "../../deployments/sepolia.json"), "utf8"))
  );
  submitOnChain = createProviderSubmitter({
    rpcUrl,
    privateKey: providerKey as `0x${string}`,
    escrowAddress: artifact.contracts.ProofMarketEscrow as `0x${string}`
  });
  console.log("Provider on-chain submitter: ENABLED");
} else {
  console.log("Provider on-chain submitter: disabled (no key/rpc)");
}

const server = await startServicesServer({ port, submitOnChain });
console.log(`ProofMarket services listening at ${server.url}`);
```

Note: `server.ts` and `providerSigner.ts` must not import `index.ts` (boot file reads env/files; tests import only the pure modules).

- [ ] **Step 3: Run, verify pass**

```bash
pnpm install && pnpm --filter @proofmarket/services test
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/services package.json pnpm-lock.yaml
git commit -m "feat: deterministic provider and judge HTTP service with provider signer boundary"
```

---

### Task 7: Async TaskService interface + real orchestrator

**Files:**
- Modify: `packages/backend/src/taskService.ts` (all methods return `Promise<Task>`; bodies unchanged otherwise; mark created tasks `mode: "fixture"`)
- Create: `packages/backend/src/realTaskService.ts`
- Create: `packages/backend/src/auditFileLog.ts`
- Modify: `packages/backend/src/index.ts`
- Test: `packages/backend/tests/realTaskService.test.ts` (all integrations injected as fakes), update `packages/backend/tests/taskService.test.ts` + web route/api tests for `await`

- [ ] **Step 1: Make the existing interface async**

In `taskService.ts`, change the `TaskService` type so every method returns `Promise<Task>` / `Promise<Task[]>`, and add `async` to each implementation method (no logic changes). In `createTask`, set `mode: "fixture"`. Update every call site the compiler flags: `packages/backend/tests/taskService.test.ts`, `apps/web/app/api/**/route.ts` handlers (add `await`), `apps/web/tests/*`, `scripts/run-demo-*.ts`.

- [ ] **Step 2: Run full test suite, verify green before adding anything new**

```bash
pnpm test
```

Expected: PASS — pure mechanical asyncification.

- [ ] **Step 3: Commit the asyncification separately**

```bash
git add -A
git commit -m "refactor: TaskService methods return promises to make room for real orchestration"
```

- [ ] **Step 4: Write failing orchestrator tests**

`packages/backend/tests/realTaskService.test.ts` — inject fakes for every boundary; assert ordering, state transitions, audit contents, and the no-fabrication rules:

```ts
import { describe, expect, it } from "vitest";
import { createInMemoryStore } from "../src/demoStore";
import { createRealTaskService, type RealDeps } from "../src/realTaskService";

const HASH64 = `0x${"a".repeat(64)}`;

function makeDeps(overrides: Partial<RealDeps> = {}): RealDeps {
  const calls: string[] = [];
  const deps: RealDeps = {
    deployment: {
      chainId: 11155111,
      network: "sepolia",
      deployer: `0x${"1".repeat(40)}`,
      blockNumber: 1,
      coboWallet: `0x${"2".repeat(40)}`,
      contracts: {
        MockUSDC: `0x${"3".repeat(40)}`,
        ProofMarketEscrow: `0x${"4".repeat(40)}`
      },
      mint: { to: `0x${"2".repeat(40)}`, rawAmount: "100000000", txHash: HASH64 },
      deployedAt: "2026-06-10T00:00:00.000Z"
    },
    providerAddress: `0x${"5".repeat(40)}`,
    runResearchAgent: async (context) => ({
      plan: {
        taskId: context.taskId,
        recommendedProviderId: "execution-research-expert",
        reason: "specialist",
        maxPayment: "5",
        requiredEvidenceSchema: { minItems: 3, requiredFields: [] },
        chainActions: ["createJob", "fund", "submitEvidenceHash", "complete"]
      },
      rawStdout: "{}",
      attempts: 1
    }),
    cobo: {
      submitPact: async () => ({ pactId: "p-1", status: "pending_approval", raw: "{}" }),
      getPactStatus: async () => ({ pactId: "p-1", status: "active", raw: "{}" }),
      callContract: async ({ description }) => {
        calls.push(`cobo:${description}`);
        return { coboTxId: `tx-${description}`, status: "submitted", raw: "{}" };
      },
      getTx: async (id) => ({
        raw: "{}",
        parsed: { tx_hash: `0x${"b".repeat(64)}`, status: "confirmed", id }
      }),
      attemptDeniedTransfer: async () => ({
        denied: true,
        exitCode: 5,
        attemptedAction: "tx transfer 0.001 SETH -> 0xdead",
        rawOutput: '{"error":"policy denied"}'
      })
    },
    chain: {
      waitForReceipt: async () => ({ logs: [], transactionHash: `0x${"b".repeat(64)}` }) as never,
      extractJobId: () => 7n,
      readJobState: async () => ({ state: 1, budget: 5_000_000n, deliverableHash: HASH64 as `0x${string}` })
    },
    services: {
      runProvider: async () => ({
        taskId: "t",
        providerAgentId: 1,
        providerId: "execution-research-expert",
        providerName: "Expert",
        coverageStatement: "covered",
        answers: [
          {
            providerAnswer: "a",
            sourceTitle: "s",
            sourceLocator: "arXiv:1",
            sourceMetadata: { year: 2022, type: "paper" },
            excerptOrSummary: "e",
            relevanceExplanation: "r"
          }
        ],
        packageHash: HASH64
      }),
      submitDeliverable: async () => ({ txHash: `0x${"c".repeat(64)}` }),
      judgeVerify: async () => ({
        judgeId: "judge-demo-001",
        jobId: "7",
        decision: "valid" as const,
        reasonCode: "PRESET_SUCCESS_PATH",
        verdictHash: HASH64,
        voting: { mode: "not_triggered", voteId: null, onchainTxHash: null }
      })
    },
    audit: { append: () => {} },
    now: () => "2026-06-10T12:00:00.000Z",
    ...overrides
  };
  (deps as RealDeps & { calls: string[] }).calls = calls;
  return deps;
}

async function driveToPactActive(service: ReturnType<typeof createRealTaskService>) {
  const created = await service.createTask("q", "5 test USDC");
  await service.plan(created.id);
  await service.submitPact(created.id);
  return service.activatePact(created.id);
}

describe("real task service", () => {
  it("marks tasks as real mode", async () => {
    const service = createRealTaskService(createInMemoryStore(), makeDeps());
    const task = await service.createTask("q", "5 test USDC");
    expect(task.mode).toBe("real");
  });

  it("stores the claude plan and raw output", async () => {
    const service = createRealTaskService(createInMemoryStore(), makeDeps());
    const created = await service.createTask("q", "5 test USDC");
    const planned = await service.plan(created.id);
    expect(planned.plan?.recommendedProviderId).toBe("execution-research-expert");
    expect(planned.claudePlanRaw).toBe("{}");
  });

  it("refuses to execute escrow before the pact is active", async () => {
    const deps = makeDeps({
      cobo: {
        ...makeDeps().cobo,
        getPactStatus: async () => ({ pactId: "p-1", status: "pending_approval", raw: "{}" })
      }
    });
    const service = createRealTaskService(createInMemoryStore(), deps);
    const created = await service.createTask("q", "5 test USDC");
    await service.plan(created.id);
    const submitted = await service.submitPact(created.id);
    const stillSubmitted = await service.activatePact(created.id);
    expect(stillSubmitted.status).toBe("PactSubmitted");
    await expect(service.executeEscrow(created.id)).rejects.toThrow(/pact/i);
  });

  it("executes approve, createJob, setBudget, fund through cobo in order and records real hashes", async () => {
    const deps = makeDeps();
    const service = createRealTaskService(createInMemoryStore(), deps);
    const active = await driveToPactActive(service);
    const funded = await service.executeEscrow(active.id);
    expect((deps as never as { calls: string[] }).calls).toEqual([
      "cobo:approve",
      "cobo:createJob",
      "cobo:setBudget",
      "cobo:fund"
    ]);
    expect(funded.jobId).toBe(7);
    expect(funded.status).toBe("JobFunded");
    expect(funded.txRecords.map((r) => r.label)).toEqual([
      "approve",
      "createJob",
      "setBudget",
      "fund"
    ]);
    expect(funded.txRecords.every((r) => /^0x[0-9a-f]{64}$/.test(r.txHash))).toBe(true);
  });

  it("provider run stores the package and the provider submit tx", async () => {
    const service = createRealTaskService(createInMemoryStore(), makeDeps());
    const active = await driveToPactActive(service);
    await service.executeEscrow(active.id);
    const delivered = await service.runProvider(active.id, "execution-research-expert");
    expect(delivered.providerPackage?.packageHash).toBe(HASH64);
    expect(delivered.txRecords.some((r) => r.label === "submit")).toBe(true);
    expect(delivered.status).toBe("Delivered");
  });

  it("verify then settle completes through cobo with the verdict hash", async () => {
    const deps = makeDeps();
    const service = createRealTaskService(createInMemoryStore(), deps);
    const active = await driveToPactActive(service);
    await service.executeEscrow(active.id);
    await service.runProvider(active.id, "execution-research-expert");
    const verified = await service.verify(active.id);
    expect(verified.status).toBe("Verified");
    const settled = await service.settle(active.id);
    expect(settled.status).toBe("Settled");
    expect((deps as never as { calls: string[] }).calls).toContain("cobo:complete");
  });

  it("denial records the real cobo output", async () => {
    const service = createRealTaskService(createInMemoryStore(), makeDeps());
    const active = await driveToPactActive(service);
    const denied = await service.triggerDenial(active.id);
    expect(denied.status).toBe("DeniedByCobo");
    expect(denied.denial?.exitCode).toBe(5);
    expect(denied.denial?.rawOutput).toContain("policy denied");
  });

  it("propagates research agent failure instead of fabricating a plan", async () => {
    const deps = makeDeps({
      runResearchAgent: async () => {
        throw new Error("Claude research agent failed after retry: schema");
      }
    });
    const service = createRealTaskService(createInMemoryStore(), deps);
    const created = await service.createTask("q", "5 test USDC");
    await expect(service.plan(created.id)).rejects.toThrow(/after retry/);
  });
});
```

- [ ] **Step 5: Run, verify fail; implement `packages/backend/src/realTaskService.ts`**

Implements the same public surface as `createTaskService` (so routes/UI need no structural change). Shape:

```ts
import { providerProfiles } from "@proofmarket/shared/src/fixtures";
import { createAuditEvent } from "@proofmarket/shared/src/audit";
import { assertTransition } from "@proofmarket/shared/src/stateMachine";
import {
  parseDeploymentArtifact,
  type CoboDenialRecord,
  type DeploymentArtifact,
  type ResearchPlanOutput,
  type TxRecord
} from "@proofmarket/shared/src/realMode";
import { stableHash } from "@proofmarket/shared/src/hash";
import type { ProviderAnswerPackage, ProviderId, Task, TaskStatus } from "@proofmarket/shared/src/types";
import {
  encodeApprove,
  encodeCreateJob,
  encodeFund,
  encodeSetBudget,
  encodeComplete
} from "@proofmarket/chain/src/calldata";
import type { InMemoryStore } from "./demoStore";
import type { TaskService } from "./taskService";

export type RealDeps = {
  deployment: DeploymentArtifact;
  providerAddress: string;
  runResearchAgent(context: {
    taskId: string;
    question: string;
    budgetAmount: string;
    providerCatalog: Array<{ providerId: string; displayName: string; specialties: string[]; price: string }>;
    pactSummary: string;
  }): Promise<{ plan: ResearchPlanOutput; rawStdout: string; attempts: number }>;
  cobo: {
    submitPact(submission: unknown): Promise<{ pactId: string; status: string; raw: string }>;
    getPactStatus(pactId: string): Promise<{ pactId: string; status: string; raw: string }>;
    callContract(input: { pactId: string; contract: string; calldata: string; requestId: string; description: string }): Promise<{ coboTxId: string; status: string; raw: string }>;
    getTx(coboTxId: string): Promise<{ raw: string; parsed: Record<string, unknown> }>;
    attemptDeniedTransfer(input: { pactId: string; dstAddress: string; amount: string }): Promise<CoboDenialRecord & { attemptedAction: string }>;
  };
  chain: {
    waitForReceipt(txHash: `0x${string}`): Promise<{ logs: unknown[]; transactionHash: string }>;
    extractJobId(receipt: unknown, escrowAddress: string): bigint;
    readJobState(escrowAddress: `0x${string}`, jobId: bigint): Promise<{ state: number; budget: bigint; deliverableHash: `0x${string}` }>;
  };
  services: {
    runProvider(input: { taskId: string; jobId: string; providerId: ProviderId; question: string }): Promise<ProviderAnswerPackage>;
    submitDeliverable(input: { jobId: string; deliverableHash: string }): Promise<{ txHash: string }>;
    judgeVerify(input: { taskId: string; jobId: string; evidencePackageHash: string; evidencePackage: unknown; successCriteria: string[] }): Promise<{ judgeId: string; jobId: string; decision: "valid" | "invalid"; reasonCode: string; verdictHash: string; voting: { mode: string; voteId: string | null; onchainTxHash: string | null } }>;
  };
  audit: { append(taskId: string, event: unknown): void };
  now(): string;
};

export function createRealTaskService(store: InMemoryStore, deps: RealDeps): TaskService;
```

Implementation requirements (each is asserted by a Step 4 test — keep them in lockstep):

1. `createTask` — same as fixture but `mode: "real"`.
2. `plan` — build provider catalog from `providerProfiles` (id, name, coverage→specialties, price), call `deps.runResearchAgent`; on success store a `ProcurementPlan` derived from the validated output (`recommendedProviderId` cast to `ProviderId`, `evidenceNeed` = the plan's `reason` so the UI shows Claude's provider-selection rationale, `totalBudget` = `${maxPayment} mUSDC`, `verificationMethod` = "deterministic judge endpoint") plus `claudePlanRaw = rawStdout`; transition `Created → Planned`; audit `source: "research-agent"`. On failure: rethrow (route returns 500 with real message).
3. `submitPact` — `buildRealPactSubmission` (import from `@proofmarket/cobo/src/pactPolicy`) with escrow/token addresses from `deps.deployment` and budget parsed from `task.budgetLimit` (leading decimal, e.g. `"5 test USDC"` → `"5"`); call `deps.cobo.submitPact`; store `PactSummary` with real `pactId` and `status: "submitted"`; transition to `PactSubmitted`; audit raw output.
4. `activatePact` — poll once via `deps.cobo.getPactStatus`; if status string contains `"active"`, set pact status active and transition `PactSubmitted → PactActive`; otherwise return the task UNCHANGED (no transition, audit a `pending` event). Frontend calls this repeatedly as a "check approval" button.
5. `executeEscrow` — guard: pact must exist and be `active`, else throw `"pact not active"`. Budget raw units: `BigInt(Math.round(Number(budgetAmount) * 1e6))`. Then four sequential Cobo calls, each via a private helper `coboCall(task, label, contract, calldata)` that (a) appends a `TxRecord` with status `pending` and **immediately persists via `store.saveTask` so concurrent GETs see live progress**, (b) calls `deps.cobo.callContract` with `requestId = \`${task.id}-${label}\``, (c) polls `deps.cobo.getTx` until `parsed.tx_hash` (or `transaction_hash`) is a 66-char hex and status is terminal (max 60 polls, 5s apart in prod; the poll delay must be injectable/zero in tests), (d) `deps.chain.waitForReceipt`, (e) updates the same `TxRecord` to `confirmed` with the REAL txHash, persists again, and appends an audit event. Order: `approve(escrow, budget)` on MockUSDC → `createJob(providerAgentId=1, provider=deps.providerAddress, verifierAgentId=3, evaluator=deployment.coboWallet, token=MockUSDC, expiredAt=now+2h, descriptionHash=stableHash({taskId,question}), coverageHash=stableHash({coverage: plan.coverage}))` on escrow → extract `jobId` from the createJob receipt → `setBudget(jobId, budget)` → `fund(jobId, budget)`. Transition `PactActive → JobFunded`, store `jobId` as number. Add a test: a `store.getTask` snapshot taken between fake cobo calls (hook the fake `callContract` to capture it) shows the earlier records `confirmed` and the current one `pending`.
6. `runProvider` — requires `JobFunded`; call `deps.services.runProvider`, store package; call `deps.services.submitDeliverable` with the package hash; record `submit` TxRecord (provider signer hash); transition to `Delivered`. After submit, `deps.chain.readJobState` must show `deliverableHash === packageHash` — if mismatch, throw (hash integrity check from spec §11.1).
7. `verify` — requires `Delivered`; call `deps.services.judgeVerify` with the package + criteria; `valid → Verified` else `Challenged`; audit verdict hash + reason.
8. `settle` — requires `Verified`; Cobo `complete(jobId, verdictHash)` via the same `coboCall` helper; transition to `Settled`; audit settlement tx hash.
9. `triggerDenial` — requires an active pact; call `deps.cobo.attemptDeniedTransfer({ pactId, dstAddress: "0x000000000000000000000000000000000000dEaD", amount: "0.001" })`; store the returned record in `task.denial`; transition to `DeniedByCobo`; audit with `result: "denied"` and the RAW Cobo output in the message.
10. `winChallenge` / `refundOrSlash` — real mode throws `new Error("challenge path is fixture-mode only in this demo")` (routes surface it; the UI hides those buttons in real mode).
11. Every audit event also goes to `deps.audit.append` (file sink).

`packages/backend/src/auditFileLog.ts`:

```ts
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

export function createAuditFileLog(rootDir: string) {
  return {
    append(taskId: string, event: unknown): void {
      const file = join(rootDir, "data", "demo-state", `audit-${taskId}.jsonl`);
      mkdirSync(dirname(file), { recursive: true });
      appendFileSync(file, `${JSON.stringify(event)}\n`);
    }
  };
}
```

- [ ] **Step 6: Run backend tests until green**

```bash
pnpm --filter @proofmarket/backend test
```

Expected: PASS, including all pre-existing fixture-service tests.

- [ ] **Step 7: Commit**

```bash
git add packages/backend
git commit -m "feat: real task orchestrator with cobo execution, hash integrity checks, real denial"
```

---

### Task 8: Wire mode switch + frontend real-mode UX

**Files:**
- Modify: `apps/web/lib/api.ts`
- Modify: `apps/web/app/page.tsx`, `apps/web/components/PactReview.tsx`, `apps/web/components/AuditLog.tsx`, `apps/web/components/ExecutionTimeline.tsx`, `apps/web/components/ChallengePanel.tsx`
- Modify: `apps/web/app/api/tasks/[taskId]/pact/route.ts` siblings — add `apps/web/app/api/tasks/[taskId]/pact-status/route.ts`
- Test: extend `apps/web/tests/ui-content.test.tsx` and `apps/web/tests/task-flow.test.tsx`

- [ ] **Step 1: Mode switch in `apps/web/lib/api.ts`**

```ts
import "server-only";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createInMemoryStore } from "@proofmarket/backend/src/demoStore";
import { createTaskService } from "@proofmarket/backend/src/taskService";
import { createRealTaskService } from "@proofmarket/backend/src/realTaskService";
import { createAuditFileLog } from "@proofmarket/backend/src/auditFileLog";
import { parseDeploymentArtifact } from "@proofmarket/shared/src/realMode";
import { createCliCoboClient } from "@proofmarket/cobo/src/coboClient";
import { createChainReader } from "@proofmarket/chain/src/chainReader";
import { runClaudeResearchAgent } from "@proofmarket/agents/src/claudeResearchAgent";

type TaskService = ReturnType<typeof createTaskService>;

const globalForProofMarket = globalThis as typeof globalThis & {
  proofMarketService?: TaskService;
};

function buildRealService(): TaskService {
  const repoRoot = join(process.cwd(), "..", "..");
  const deployment = parseDeploymentArtifact(
    JSON.parse(readFileSync(join(repoRoot, "deployments", "sepolia.json"), "utf8"))
  );
  const servicesUrl = process.env.SERVICES_URL ?? "http://localhost:4010";
  const chain = createChainReader(process.env.SEPOLIA_RPC_URL ?? "");
  const cobo = createCliCoboClient({});

  async function post<T>(path: string, body: unknown): Promise<T> {
    const response = await fetch(`${servicesUrl}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
    });
    if (!response.ok) {
      throw new Error(`services ${path} failed: ${response.status} ${await response.text()}`);
    }
    return (await response.json()) as T;
  }

  return createRealTaskService(createInMemoryStore(), {
    deployment,
    providerAddress: process.env.PROVIDER_SIGNER_ADDRESS ?? deployment.deployer,
    runResearchAgent: (context) => runClaudeResearchAgent(context),
    cobo,
    chain,
    services: {
      runProvider: (input) => post("/provider/run", input),
      submitDeliverable: (input) => post("/provider/submit", input),
      judgeVerify: (input) => post("/judge/verify", input)
    },
    audit: createAuditFileLog(repoRoot),
    now: () => new Date().toISOString()
  });
}

export function getTaskService(): TaskService {
  if (!globalForProofMarket.proofMarketService) {
    globalForProofMarket.proofMarketService =
      process.env.PROOFMARKET_MODE === "real"
        ? buildRealService()
        : createTaskService(createInMemoryStore());
  }
  return globalForProofMarket.proofMarketService;
}
```

Add `PROVIDER_SIGNER_ADDRESS=` to `.env.example` (address of the provider signer key; createJob's `provider` arg and Escrow's `submit` sender must match).

- [ ] **Step 2: Add pact-status route and a task GET route for live progress**

`apps/web/app/api/tasks/[taskId]/pact-status/route.ts` — same pattern as the existing action routes, calls `service.activatePact(taskId)`.

`apps/web/app/api/tasks/[taskId]/route.ts` — `GET` returning `service.getTask(taskId)` (read-only, no transition). The in-memory store is a process-wide singleton, so a GET issued while a long-running action POST is in flight returns the incrementally saved task with live `txRecords`.

In `page.tsx`, while `busyAction` is one of `execute` / `provider` / `settle`, poll `GET /api/tasks/${task.id}` every 2 seconds with `setInterval` and `setTask` on each response; clear the interval when the action resolves (the POST response remains the authoritative final state). Result: during escrow execution the timeline shows `approve — confirmed`, `createJob — pending`, … updating live instead of a 1–3 minute opaque busy state. Add a test in `task-flow.test.tsx`: render with a mocked fetch where the GET returns a task containing one pending txRecord, advance fake timers, assert the pending row renders.

- [ ] **Step 3: Frontend changes (test-first where the components are already covered)**

Extend `apps/web/tests/ui-content.test.tsx` with: (a) header shows `fixture mode` badge when task.mode is fixture and `real · Sepolia` when real; (b) audit rows with a 66-char `txHash` render an `<a href="https://sepolia.etherscan.io/tx/...">`; (c) in real mode the ChallengePanel renders the label `Local mechanism demo — not available in real mode` instead of action buttons; (d) PactReview in real mode with pact status `submitted` shows a `Check Cobo approval` button. Then implement:

- `page.tsx`: badge in `.page-header` from `task?.mode`; `PactReview` gains `onCheckApproval={() => runAction("pact-status")}` (add `"pact-status"` to `ActionName`).
- `PactReview.tsx`: when `task.mode === "real"` and `task.pact?.status === "submitted"`, render the check-approval button + helper text "Approve the Pact in your Cobo app, then check.". Denial button label becomes `Attempt out-of-Pact transfer (real Cobo denial)` in real mode.
- `AuditLog.tsx`: linkify `txHash`; when `task.denial` exists render a `<details>` block with `denial.attemptedAction`, `exit ${denial.exitCode}`, and `denial.rawOutput` verbatim.
- `ExecutionTimeline.tsx`: render `task.txRecords` as rows `label — status — hash(linked)` between the existing stage entries.
- `ChallengePanel.tsx`: hide action buttons when `task.mode === "real"`, show the local-demo note.

- [ ] **Step 4: Run web tests + build**

```bash
pnpm --filter @proofmarket/web test && pnpm --filter @proofmarket/web build
```

Expected: PASS. Fixture-mode e2e (`pnpm test:e2e`) must still pass — it exercises the default fixture mode.

- [ ] **Step 5: Commit**

```bash
git add apps/web .env.example
git commit -m "feat: mode switch, real-mode pact polling, tx links, real denial display"
```

---

### Task 9: Preflight + headless real-path driver + runbook

**Files:**
- Create: `scripts/check-real-env.ts`
- Create: `scripts/run-real-success.ts`
- Modify: root `package.json` (scripts `preflight`, `demo:real`), `README.md`

- [ ] **Step 1: Preflight script `scripts/check-real-env.ts`**

Checks, printing PASS/FAIL per line and exiting 1 on any FAIL:

```ts
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createPublicClient, formatEther, http } from "viem";
import { sepolia } from "viem/chains";
import { parseDeploymentArtifact } from "@proofmarket/shared/src/realMode";

const checks: Array<{ name: string; run: () => Promise<string> | string }> = [];
const repoRoot = process.cwd();

checks.push({
  name: "caw installed",
  run: () => execFileSync("caw", ["version"], { encoding: "utf8" }).trim()
});

checks.push({
  name: "caw wallet status",
  run: () => {
    const status = JSON.parse(execFileSync("caw", ["status"], { encoding: "utf8" }));
    if (status.wallet_status !== "active" || !status.healthy) {
      throw new Error(`wallet not ready: ${JSON.stringify(status)}`);
    }
    // Pairing is informational, not a gate: unpaired agents auto-approve pacts (verified).
    return status.wallet_paired
      ? "active, paired (pact approval is MANUAL — approve in the Cobo app when prompted)"
      : "active, unpaired (pacts auto-approve; fully automated run)";
  }
});

checks.push({
  name: "deployment artifact",
  run: () => {
    const file = join(repoRoot, "deployments", "sepolia.json");
    if (!existsSync(file)) throw new Error("missing deployments/sepolia.json — run Task 1 Step 6");
    const artifact = parseDeploymentArtifact(JSON.parse(readFileSync(file, "utf8")));
    return artifact.contracts.ProofMarketEscrow;
  }
});

checks.push({
  name: "cobo wallet gas (>= 0.005 SETH)",
  run: async () => {
    const client = createPublicClient({ chain: sepolia, transport: http(process.env.SEPOLIA_RPC_URL ?? "") });
    const balance = await client.getBalance({
      address: (process.env.COBO_WALLET_ADDRESS ?? "") as `0x${string}`
    });
    if (balance < 5_000_000_000_000_000n) {
      throw new Error(`only ${formatEther(balance)} SETH — top up via \`caw faucet deposit\``);
    }
    return `${formatEther(balance)} SETH`;
  }
});

checks.push({
  name: "services reachable",
  run: async () => {
    const response = await fetch(`${process.env.SERVICES_URL ?? "http://localhost:4010"}/judge/verify`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jobId: "0", evidencePackageHash: "0x", evidencePackage: {}, successCriteria: [] })
    });
    if (!response.ok) throw new Error(`status ${response.status}`);
    return "ok";
  }
});

checks.push({
  name: "claude binary",
  run: () => execFileSync(process.env.CLAUDE_BIN ?? "claude", ["--version"], { encoding: "utf8" }).trim()
});

let failed = false;
for (const check of checks) {
  try {
    const detail = await check.run();
    console.log(`PASS  ${check.name}: ${detail}`);
  } catch (error) {
    failed = true;
    console.log(`FAIL  ${check.name}: ${error instanceof Error ? error.message : error}`);
  }
}
process.exit(failed ? 1 : 0);
```

Also check provider signer gas (same pattern as the cobo wallet check, `PROVIDER_SIGNER_ADDRESS`, threshold 0.002 SETH) and MockUSDC balance of the Cobo wallet (`readContract balanceOf >= 5_000_000`).

- [ ] **Step 2: Headless driver `scripts/run-real-success.ts`**

Drives the Next API end-to-end (server must be running with `PROOFMARKET_MODE=real`). Sequence: POST `/api/tasks` → `/plan` → `/pact` → loop POST `/pact-status` every 10s until status `PactActive` (unpaired wallet: exits on the first iteration because pacts auto-approve; paired wallet: prints "waiting for Cobo approval — approve in the Cobo app" until approved) → `/execute` → `/provider {providerId from plan}` → `/verify` → `/settle` → then POST `/denial-demo` on a SECOND fresh task driven to PactActive, to capture a real denial without consuming the success pact's tx budget. Print every tx hash and finish by printing the audit JSONL path. Straightforward fetch loop, ~120 lines, same `readTaskResponse` error pattern as `page.tsx`.

- [ ] **Step 3: Root scripts + README**

`package.json` scripts: `"preflight": "tsx --env-file=.env scripts/check-real-env.ts"`, `"demo:real": "tsx --env-file=.env scripts/run-real-success.ts"` (tsx ≥4.19 forwards `--env-file` to node; if it does not in practice, switch both to `node --env-file=.env --import tsx ...`). README gains a "Real mode" section: env setup, `pnpm dev:services`, `PROOFMARKET_MODE=real pnpm dev`, `pnpm preflight`, the manual pairing + pact-approval steps, and the Demo Day plan from spec §15.

- [ ] **Step 4: Commit**

```bash
git add scripts package.json README.md
git commit -m "feat: real-env preflight and headless real success-path driver"
```

---

### Task 10: Real-chain acceptance run (fully automatable while the wallet is unpaired)

No new code. This is the spec §16 最小通过定义 checklist executed against Sepolia. With the wallet unpaired, pacts auto-approve, so every step below can run without Luke.

- [ ] **Step 1: top up gas** — `caw faucet deposit` for the Cobo wallet; fund deployer + provider signer keys (also via `caw faucet deposit` to those addresses). `pnpm preflight` → all PASS.
- [ ] **Step 2: start stack** — terminal A `pnpm dev:services`; terminal B `PROOFMARKET_MODE=real pnpm dev`.
- [ ] **Step 3: run `pnpm demo:real`** — pact auto-approves, no manual gate. Expect: real pactId, 5 confirmed Sepolia tx hashes (approve/createJob/setBudget/fund/complete), package hash readable back from chain state, judge verdict hash in the JobCompleted event tx, and a real denial record with exit code 5.
- [ ] **Step 3b (OPTIONAL, Demo Day narrative decision — Luke):** if the human-approval scene is wanted, pair the Cobo app, then RE-RUN this whole acceptance: approval becomes manual and the rehearsal must cover it (spec §15).
- [ ] **Step 4: cross-check every hash** on sepolia.etherscan.io and in `data/demo-state/audit-task_*.jsonl`. Each item of spec §11.2 审计材料表 must have a concrete value. Record them in `docs/superpowers/plans/2026-06-10-acceptance-record.md`.
- [ ] **Step 5: run the UI flow once via the browser** (fresh task, same steps) to verify the demo-day driving surface: live per-tx progress during escrow execution, the pact status check, and the denial panel showing raw Cobo output.
- [ ] **Step 6: fixture regression** — `PROOFMARKET_MODE=fixture pnpm test && pnpm demo:success && pnpm demo:challenge && pnpm demo:denial` all still green (challenge path must keep working; it remains the local mechanism demo).
- [ ] **Step 7: final commit + tag**

```bash
git add -A
git commit -m "docs: real-path acceptance record with Sepolia hashes"
git tag real-success-path-v1
```

---

## Risks pinned to tasks

| Risk | Where handled |
| --- | --- |
| `caw` JSON field names differ from assumptions (`pact_id`/`tx_id`/`tx_hash`) | `parseLooseJson` + `pickString` try multiple keys; Task 10 Step 4 is the first live contact — if a field is missing, fix `pickString` key lists only, no structural change |
| Pairing changes approval behavior | Unpaired = auto-approve (verified), used for all testing; pairing is an optional Demo Day decision and forces a full re-acceptance (Task 10 Step 3b) |
| `contract_call` policy cannot cap amounts | Mint only 100 mUSDC, budget 5, tx_count 7, 90 min expiry; talk track says "boundary = contract allowlist + tx count + expiry + tiny test balance" |
| Claude output unstable | Strict validator + 1 retry + hard stop (Task 5); plan failure surfaces as a route 500 with the real error |
| Sepolia slow during demo | `waitForReceipt` timeout 180s; Demo Day plan keeps a pre-run completed task (spec §15) |
| MockUSDC invisible in Cobo UI | Known; talk track says "test asset", balances shown via contract events |

## Execution notes

- Tasks 1–6 are independent of pairing and can run back-to-back; Task 1 Step 6 (real deploy) only needs a faucet-funded deployer key.
- Task 7 Step 1 (asyncification) touches many files — commit it alone before the orchestrator lands.
- Never commit `.env`; commit `.env.example` and `deployments/sepolia.json`.


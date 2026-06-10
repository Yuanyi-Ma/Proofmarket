/**
 * scripts/check-real-env.ts
 * Preflight checks for real-mode (Sepolia + Cobo + Claude Code) operation.
 *
 * Usage:
 *   pnpm preflight
 *   (or: npx tsx --env-file=.env scripts/check-real-env.ts)
 *
 * Prints PASS / FAIL / INFO per check and exits 1 if any FAIL.
 */

import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { promisify } from "node:util";

import { createPublicClient, formatEther, http } from "viem";
import { sepolia } from "viem/chains";

import { erc20Abi } from "@proofmarket/chain/src/escrowAbi";
import { parseDeploymentArtifact } from "@proofmarket/shared/src/realMode";

const execFileAsync = promisify(execFile);

const REPO_ROOT = resolve(import.meta.dirname ?? new URL(".", import.meta.url).pathname, "..");
const ARTIFACT_PATH = resolve(REPO_ROOT, "deployments", "sepolia.json");

let failed = false;

function pass(name: string, detail: string): void {
  console.log(`PASS ${name}: ${detail}`);
}

function fail(name: string, reason: string): void {
  console.log(`FAIL ${name}: ${reason}`);
  failed = true;
}

function info(name: string, detail: string): void {
  console.log(`INFO ${name}: ${detail}`);
}

async function runCommand(
  cmd: string,
  args: string[]
): Promise<{ stdout: string; stderr: string; code: number }> {
  try {
    const result = await execFileAsync(cmd, args);
    return { stdout: result.stdout.trim(), stderr: "", code: 0 };
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; code?: number; message?: string };
    return {
      stdout: e.stdout?.trim() ?? "",
      stderr: e.stderr?.trim() ?? e.message ?? String(err),
      code: typeof e.code === "number" ? e.code : 1
    };
  }
}

async function checkCawInstalled(): Promise<void> {
  const name = "caw_installed";
  const result = await runCommand("caw", ["version"]);
  if (result.code !== 0) {
    fail(name, `caw not found or errored: ${result.stderr || result.stdout}. Install from https://docs.cobo.com/cobo-waas2/get-started`);
    return;
  }
  pass(name, result.stdout || "found");
}

async function checkCawWalletStatus(): Promise<void> {
  const name = "caw_wallet_status";
  const result = await runCommand("caw", ["status"]);
  if (result.code !== 0) {
    fail(name, `caw status failed (exit ${result.code}): ${result.stderr || result.stdout}`);
    return;
  }

  let parsed: Record<string, unknown> = {};
  try {
    parsed = JSON.parse(result.stdout) as Record<string, unknown>;
  } catch {
    fail(name, `caw status returned non-JSON: ${result.stdout}`);
    return;
  }

  const healthy = parsed.healthy as boolean | undefined;
  const walletStatus = parsed.wallet_status as string | undefined;
  const walletPaired = parsed.wallet_paired as boolean | undefined;

  if (!healthy) {
    fail(name, `caw daemon not healthy. wallet_status=${walletStatus ?? "unknown"}. Ensure caw daemon is running.`);
    return;
  }
  if (walletStatus !== "active") {
    fail(name, `wallet_status="${walletStatus}" — expected "active". Check caw daemon and wallet setup.`);
    return;
  }

  const pairingDetail = walletPaired
    ? "paired (pact approval is MANUAL — approve in the Cobo app when prompted)"
    : "unpaired (pacts auto-approve; fully automated run)";

  pass(name, `healthy, wallet_status=active`);
  info("caw_pairing", pairingDetail);
}

async function checkDeploymentArtifact(): Promise<ReturnType<typeof parseDeploymentArtifact> | null> {
  const name = "deployment_artifact";
  if (!existsSync(ARTIFACT_PATH)) {
    fail(
      name,
      `deployments/sepolia.json not found. Run: cd packages/contracts && set -a; source ../../.env; set +a; pnpm hardhat run scripts/deploy-sepolia.ts --network sepolia`
    );
    return null;
  }

  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(ARTIFACT_PATH, "utf8"));
  } catch (err) {
    fail(name, `deployments/sepolia.json is not valid JSON: ${String(err)}`);
    return null;
  }

  try {
    const artifact = parseDeploymentArtifact(raw);
    pass(name, `chainId=${artifact.chainId}, deployer=${artifact.deployer}, MockUSDC=${artifact.contracts.MockUSDC}`);
    return artifact;
  } catch (err) {
    fail(name, `deployments/sepolia.json failed validation: ${String(err)}. Re-run the deploy command above.`);
    return null;
  }
}

function checkEnvVars(): void {
  const required = [
    "SEPOLIA_RPC_URL",
    "COBO_WALLET_ADDRESS",
    "PROVIDER_SIGNER_ADDRESS",
    "PROVIDER_SIGNER_PRIVATE_KEY"
  ] as const;
  // Vars whose values must never be printed — show only presence
  const secretVars = new Set(["PROVIDER_SIGNER_PRIVATE_KEY"]);
  for (const varName of required) {
    const value = process.env[varName];
    if (!value) {
      fail(`env_${varName}`, `${varName} is not set. Add it to .env (see .env.example).`);
    } else if (secretVars.has(varName)) {
      pass(`env_${varName}`, "(set)");
    } else {
      pass(`env_${varName}`, value.slice(0, 20) + (value.length > 20 ? "…" : ""));
    }
  }
}

async function checkGasBalance(
  client: ReturnType<typeof createPublicClient>,
  label: string,
  address: `0x${string}`,
  minEth: number
): Promise<void> {
  const name = `gas_${label}`;
  try {
    const balance = await client.getBalance({ address });
    const ethVal = Number(formatEther(balance));
    if (ethVal < minEth) {
      fail(
        name,
        `${address} has ${ethVal.toFixed(6)} SETH, need ≥ ${minEth} SETH. Top up via: caw faucet deposit`
      );
    } else {
      pass(name, `${address} has ${ethVal.toFixed(6)} SETH (≥ ${minEth} required)`);
    }
  } catch (err) {
    fail(name, `Failed to read balance for ${address}: ${String(err)}`);
  }
}

async function checkMockUsdcBalance(
  client: ReturnType<typeof createPublicClient>,
  coboAddress: `0x${string}`,
  usdcAddress: `0x${string}`
): Promise<void> {
  const name = "usdc_balance_cobo_wallet";
  const MIN_RAW = 5_000_000n;
  try {
    const raw = await client.readContract({
      address: usdcAddress,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [coboAddress]
    });
    const balance = raw as bigint;
    if (balance < MIN_RAW) {
      fail(
        name,
        `Cobo wallet MockUSDC balance ${balance} raw < ${MIN_RAW} required. Mint more via the deploy script or re-deploy.`
      );
    } else {
      pass(name, `Cobo wallet MockUSDC balance = ${balance} raw (≥ ${MIN_RAW} required)`);
    }
  } catch (err) {
    fail(name, `Failed to read MockUSDC balanceOf: ${String(err)}`);
  }
}

async function checkServicesReachable(): Promise<void> {
  const name = "services_reachable";
  const servicesUrl = process.env.SERVICES_URL ?? "http://localhost:4010";
  const url = `${servicesUrl}/judge/verify`;
  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ taskId: "preflight-check", packageHash: "0x0000" }),
      signal: AbortSignal.timeout(5000)
    });
    if (resp.status >= 500) {
      fail(
        name,
        `${url} returned ${resp.status} — service is up but erroring. Check pnpm dev:services logs.`
      );
    } else {
      // 2xx–4xx means the server is reachable; payload mismatch is ok for preflight
      pass(name, `${url} returned ${resp.status} (service is running)`);
    }
  } catch (err) {
    fail(
      name,
      `Cannot reach ${url}: ${String(err)}. Run: pnpm dev:services (in a separate terminal)`
    );
  }
}

async function checkClaudeBin(): Promise<void> {
  const name = "claude_binary";
  const claudeBin = process.env.CLAUDE_BIN ?? "claude";
  const result = await runCommand(claudeBin, ["--version"]);
  if (result.code !== 0) {
    fail(
      name,
      `"${claudeBin} --version" failed (exit ${result.code}): ${result.stderr || result.stdout}. Set CLAUDE_BIN in .env to the Claude Code binary path.`
    );
  } else {
    pass(name, `${claudeBin} — ${result.stdout || "ok"}`);
  }
}

async function main(): Promise<void> {
  console.log("=== ProofMarket Real-Mode Preflight ===\n");

  // 1. caw installed
  await checkCawInstalled();

  // 2. caw wallet status (healthy + active); pairing is INFO not a gate
  await checkCawWalletStatus();

  // 3. Deployment artifact
  const artifact = await checkDeploymentArtifact();

  // 4. Env vars
  checkEnvVars();

  // 5-8: On-chain checks — only run if we have the RPC URL
  const rpcUrl = process.env.SEPOLIA_RPC_URL;
  if (rpcUrl) {
    const client = createPublicClient({ chain: sepolia, transport: http(rpcUrl) });

    const coboAddress = process.env.COBO_WALLET_ADDRESS as `0x${string}` | undefined;
    const providerSignerAddress = process.env.PROVIDER_SIGNER_ADDRESS as `0x${string}` | undefined;

    // 5. Cobo wallet gas
    if (coboAddress) {
      await checkGasBalance(client, "cobo_wallet", coboAddress, 0.005);
    } else {
      fail("gas_cobo_wallet", "COBO_WALLET_ADDRESS not set — skipped balance check");
    }

    // 6. Deployer gas — derived from artifact
    if (artifact) {
      await checkGasBalance(client, "deployer", artifact.deployer as `0x${string}`, 0.003);
    } else {
      fail("gas_deployer", "Deployment artifact missing — cannot check deployer balance");
    }

    // 7. Provider signer gas
    if (providerSignerAddress) {
      await checkGasBalance(client, "provider_signer", providerSignerAddress, 0.001);
    } else {
      fail("gas_provider_signer", "PROVIDER_SIGNER_ADDRESS not set — skipped balance check");
    }

    // 8. Cobo wallet MockUSDC balance
    if (artifact && coboAddress) {
      await checkMockUsdcBalance(
        client,
        coboAddress,
        artifact.contracts.MockUSDC as `0x${string}`
      );
    } else {
      fail(
        "usdc_balance_cobo_wallet",
        "Artifact or COBO_WALLET_ADDRESS missing — cannot check MockUSDC balance"
      );
    }
  } else {
    for (const n of ["gas_cobo_wallet", "gas_deployer", "gas_provider_signer", "usdc_balance_cobo_wallet"]) {
      fail(n, "SEPOLIA_RPC_URL not set — skipped on-chain check");
    }
  }

  // 9. Services reachable
  await checkServicesReachable();

  // 10. Claude binary
  await checkClaudeBin();

  console.log("\n=== Preflight complete ===");
  if (failed) {
    console.log("Status: FAILED — fix the FAIL items above before running pnpm demo:real\n");
    process.exit(1);
  } else {
    console.log("Status: PASSED — ready for real-mode demo\n");
  }
}

main().catch((err) => {
  console.error("Preflight crashed unexpectedly:", err);
  process.exit(1);
});

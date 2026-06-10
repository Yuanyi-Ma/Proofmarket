/**
 * scripts/run-real-success.ts
 * Headless driver for the full real-mode success path + denial-demo path.
 *
 * Requires a running web server (default http://localhost:3000).
 * Override via WEB_URL env var.
 *
 * Usage:
 *   pnpm demo:real
 *   (or: WEB_URL=http://localhost:3000 npx tsx --env-file=.env scripts/run-real-success.ts)
 *
 * Exits 1 on any non-ok HTTP response — no retries, no fabrication.
 */

import type { Task } from "@proofmarket/shared/src/types";

const WEB_URL = (process.env.WEB_URL ?? "http://localhost:3000").replace(/\/$/, "");
const ETHERSCAN_BASE = "https://sepolia.etherscan.io/tx";

const DEFAULT_QUESTION = "请调研近几年区块链交易执行加速的最新研究进展。";
const DEFAULT_BUDGET = "5 test USDC";

// Mirrors the readTaskResponse helper in apps/web/app/page.tsx exactly.
async function readTaskResponse(response: Response): Promise<Task> {
  const text = await response.text();
  let payload: unknown = null;

  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = null;
  }

  if (!response.ok) {
    console.error(
      `HTTP ${response.status} from ${response.url}:\n${text.slice(0, 2000)}`
    );
    process.exit(1);
  }

  return payload as Task;
}

async function postAction(path: string, body: unknown = {}): Promise<Task> {
  console.log(`  POST ${WEB_URL}${path}`);
  const response = await fetch(`${WEB_URL}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  return readTaskResponse(response);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function etherscanLink(txHash: string): string {
  return `${ETHERSCAN_BASE}/${txHash}`;
}

async function runSuccessPath(): Promise<{ task: Task; providerId: string }> {
  console.log("\n=== SUCCESS PATH ===\n");

  // 1. Create task
  console.log("[1/7] Creating task...");
  let task = await postAction("/api/tasks", {
    question: DEFAULT_QUESTION,
    budget: DEFAULT_BUDGET
  });
  console.log(`      task.id = ${task.id}`);
  console.log(`      status  = ${task.status}`);

  // 2. Plan
  console.log("\n[2/7] Generating procurement plan...");
  task = await postAction(`/api/tasks/${task.id}/plan`);
  const recommendedProviderId = task.plan?.recommendedProviderId ?? "execution-research-expert";
  console.log(`      recommendedProviderId = ${recommendedProviderId}`);
  if (task.plan) {
    console.log(`      evidenceNeed          = ${task.plan.evidenceNeed}`);
    console.log(`      verificationMethod    = ${task.plan.verificationMethod}`);
  }
  console.log(`      status = ${task.status}`);

  // 3. Submit Pact
  console.log("\n[3/7] Submitting Cobo Pact...");
  task = await postAction(`/api/tasks/${task.id}/pact`);
  const pactId = task.pact?.pactId ?? "(unknown)";
  console.log(`      pactId = ${pactId}`);
  console.log(`      pact.status = ${task.pact?.status ?? "(unknown)"}`);
  console.log(`      task.status = ${task.status}`);

  // 4. Poll pact-status until PactActive (max 30 tries × 10s = 5 min)
  console.log("\n[4/7] Waiting for Pact to become active...");
  const MAX_PACT_TRIES = 30;
  let pactActive = task.status === "PactActive";

  for (let attempt = 1; attempt <= MAX_PACT_TRIES && !pactActive; attempt++) {
    if (attempt > 1) {
      console.log(
        `      [attempt ${attempt}/${MAX_PACT_TRIES}] waiting for Cobo approval — approve in the Cobo app if paired`
      );
      await sleep(10_000);
    } else {
      console.log(`      [attempt ${attempt}/${MAX_PACT_TRIES}] checking pact status...`);
    }
    task = await postAction(`/api/tasks/${task.id}/pact-status`);
    console.log(`      pact.status=${task.pact?.status} task.status=${task.status}`);
    pactActive = task.status === "PactActive";
  }

  if (!pactActive) {
    console.error(
      `\nERROR: Pact did not become active after ${MAX_PACT_TRIES} attempts. ` +
        `Last task.status=${task.status}. If wallet is paired, approve the pact in the Cobo app.`
    );
    process.exit(1);
  }
  console.log(`      Pact is active.`);

  // 5. Execute escrow (fund)
  console.log("\n[5/7] Executing escrow (funding job)...");
  task = await postAction(`/api/tasks/${task.id}/execute`);
  console.log(`      txRecords (${task.txRecords.length}):`);
  for (const tx of task.txRecords) {
    console.log(`        ${tx.label}: ${tx.txHash} [${tx.status}]`);
    if (tx.txHash && tx.txHash !== "0x0000000000000000000000000000000000000000000000000000000000000000") {
      console.log(`          etherscan: ${etherscanLink(tx.txHash)}`);
    }
  }
  console.log(`      task.status = ${task.status}`);

  // 6. Provider: submit deliverable
  console.log(`\n[6/7] Running provider (${recommendedProviderId})...`);
  task = await postAction(`/api/tasks/${task.id}/provider`, {
    providerId: recommendedProviderId
  });
  const packageHash = task.providerPackage?.packageHash ?? "(unknown)";
  console.log(`      packageHash = ${packageHash}`);
  // Log submit txHash if present
  const submitTx = task.txRecords.find((tx) => tx.label === "submit");
  if (submitTx) {
    console.log(`      submit txHash = ${submitTx.txHash}`);
    if (submitTx.txHash) {
      console.log(`        etherscan: ${etherscanLink(submitTx.txHash)}`);
    }
  }
  console.log(`      task.status = ${task.status}`);

  // 7a. Verify
  console.log("\n[7a/7] Verifying evidence...");
  task = await postAction(`/api/tasks/${task.id}/verify`);
  const verifyAudit = task.audit.filter((a) => a.source === "verifier").at(-1);
  console.log(
    `      verify result = ${verifyAudit?.result ?? task.status} — ${verifyAudit?.message ?? ""}`
  );
  console.log(`      task.status = ${task.status}`);

  // 7b. Settle
  console.log("\n[7b/7] Settling payment...");
  task = await postAction(`/api/tasks/${task.id}/settle`);
  const completeTx = task.txRecords.find((tx) => tx.label === "complete");
  if (completeTx) {
    console.log(`      complete txHash = ${completeTx.txHash}`);
    if (completeTx.txHash) {
      console.log(`        etherscan: ${etherscanLink(completeTx.txHash)}`);
    }
  }
  console.log(`      task.status = ${task.status}`);

  return { task, providerId: recommendedProviderId };
}

async function runDenialPath(): Promise<void> {
  console.log("\n=== DENIAL DEMO PATH ===\n");

  // Fresh task
  console.log("[1/4] Creating fresh task for denial demo...");
  let task = await postAction("/api/tasks", {
    question: DEFAULT_QUESTION,
    budget: DEFAULT_BUDGET
  });
  console.log(`      task.id = ${task.id}`);

  // Plan
  console.log("\n[2/4] Generating plan...");
  task = await postAction(`/api/tasks/${task.id}/plan`);
  console.log(`      status = ${task.status}`);

  // Pact
  console.log("\n[3/4] Submitting pact...");
  task = await postAction(`/api/tasks/${task.id}/pact`);
  console.log(`      pactId = ${task.pact?.pactId ?? "(unknown)"}`);
  console.log(`      status = ${task.status}`);

  // Pact-status (just once — denial demo doesn't need a funded pact)
  console.log("\n[pact-status] Checking pact status once...");
  task = await postAction(`/api/tasks/${task.id}/pact-status`);
  console.log(`      pact.status = ${task.pact?.status}, task.status = ${task.status}`);

  // Denial demo
  console.log("\n[4/4] Triggering denial demo...");
  task = await postAction(`/api/tasks/${task.id}/denial-demo`);
  console.log(`      task.status = ${task.status}`);
  if (task.denial) {
    console.log(`      denial.exitCode     = ${task.denial.exitCode}`);
    console.log(`      denial.attemptedAction = ${task.denial.attemptedAction}`);
    console.log(
      `      denial.rawOutput (first 200 chars) = ${task.denial.rawOutput.slice(0, 200)}`
    );
    console.log("      Denial recorded correctly.");
  } else {
    console.warn("      WARNING: task.denial is null — denial may not have been recorded.");
  }
}

function printSummary(task: Task): void {
  console.log("\n=== SUMMARY ===\n");
  console.log(`Task ID:     ${task.id}`);
  console.log(`Final status: ${task.status}`);
  console.log(`Pact ID:     ${task.pact?.pactId ?? "(none)"}`);
  console.log(`Package hash: ${task.providerPackage?.packageHash ?? "(none)"}`);
  console.log(`Audit file:  data/demo-state/audit-${task.id}.jsonl`);

  if (task.txRecords.length > 0) {
    console.log("\nTransaction records:");
    for (const tx of task.txRecords) {
      const link =
        tx.txHash &&
        tx.txHash !== "0x0000000000000000000000000000000000000000000000000000000000000000"
          ? `  → ${etherscanLink(tx.txHash)}`
          : "";
      console.log(`  ${tx.label.padEnd(12)} ${tx.txHash ?? "(pending)"}  [${tx.status}]${link}`);
    }
  } else {
    console.log("\n(No on-chain tx records — running in fixture mode?)");
  }

  if (task.audit.length > 0) {
    console.log(`\nAudit events (${task.audit.length}):`);
    for (const ev of task.audit) {
      console.log(
        `  [${ev.result.padEnd(7)}] ${ev.source.padEnd(14)} ${ev.type} — ${ev.message.slice(0, 80)}`
      );
    }
  }
}

async function main(): Promise<void> {
  console.log(`=== ProofMarket Real-Mode Headless Driver ===`);
  console.log(`Web server: ${WEB_URL}`);
  console.log(`Started at: ${new Date().toISOString()}\n`);

  // Verify server is reachable before starting
  try {
    // Any HTTP response means the web server is listening — no need to inspect the status
    await fetch(`${WEB_URL}/api/tasks`, { method: "HEAD" });
  } catch (err) {
    console.error(
      `ERROR: Cannot reach web server at ${WEB_URL}.\n` +
        `  Make sure the web server is running: PROOFMARKET_MODE=real pnpm dev\n` +
        `  Error: ${String(err)}`
    );
    process.exit(1);
  }

  const { task } = await runSuccessPath();
  printSummary(task);

  await runDenialPath();

  console.log("\n=== Real-mode driver complete ===");
  console.log(`Finished at: ${new Date().toISOString()}`);
}

main().catch((err) => {
  console.error("\nDriver crashed unexpectedly:", err);
  process.exit(1);
});

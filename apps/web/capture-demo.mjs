// Drives the real-mode wizard end-to-end and captures the screenshots the
// demo script references. Run from apps/web (resolves @playwright/test there)
// with the real-mode web + services servers already running on :3000 / :4010.
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";

const BASE = "http://localhost:3000";
const SHOTS =
  "/Users/luke/agents/product_designer/proofmarket/spec/proofmarket-demo/demo-shots";
mkdirSync(SHOTS, { recursive: true });

const log = (m) => console.log(`[capture] ${m}`);

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    viewport: { width: 1480, height: 1000 },
    deviceScaleFactor: 2
  });

  const shot = async (name) => {
    await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
    log(`shot ${name}`);
  };
  const clickBtn = (name) => page.getByRole("button", { name, exact: true }).click();
  const waitBtn = (name, timeout) =>
    page.getByRole("button", { name, exact: true }).waitFor({ state: "visible", timeout });
  const waitText = (text, timeout) =>
    page.getByText(text, { exact: false }).first().waitFor({ state: "visible", timeout });

  // Allow running just one path: `node capture-demo.mjs challenge`.
  const only = process.argv[2]; // undefined | "success" | "challenge"

  // ─────────────────────────── SUCCESS PATH ───────────────────────────
  if (only !== "challenge") {
  log("=== SUCCESS PATH ===");
  await page.goto(BASE, { waitUntil: "networkidle" });
  await waitBtn("生成采购方案", 30_000);
  await shot("01-step1-question");

  log("plan (real Claude call)…");
  await clickBtn("生成采购方案");
  await waitBtn("确认方案，去授权", 200_000); // Claude + on-chain reputation reads
  await page.waitForTimeout(800);
  await shot("02-step2-plan-candidates");

  log("confirm expert → pact…");
  await clickBtn("确认方案，去授权");
  await waitBtn("执行链上采购", 90_000);
  await page.waitForTimeout(500);
  await shot("03-step3-pact-active");

  log("denial demo…");
  await clickBtn("演示越权拦截");
  await waitText("越权操作已被 Cobo 拦截", 90_000);
  await page.waitForTimeout(500);
  await shot("04-step3-denial");

  log("execute escrow (4 on-chain txs)…");
  await clickBtn("执行链上采购");
  await waitBtn("获取证据", 360_000);
  await page.waitForTimeout(800);
  await shot("05-step4-onchain-funded");

  log("run provider (submit on-chain)…");
  await clickBtn("获取证据");
  await waitBtn("核验证据", 200_000);
  await page.waitForTimeout(800);
  await shot("06-step5-evidence");

  log("verify…");
  await clickBtn("核验证据");
  // W_c gate: the settle button is disabled with a countdown until the
  // challenge window (300s after submit) passes. Shoot the gated state first.
  await page.getByTestId("settle-window-note").waitFor({ state: "visible", timeout: 90_000 });
  await page.waitForTimeout(500);
  await shot("07-step6-verified");

  log("waiting out the challenge window W_c (up to 6 min)…");
  await waitBtn("确认结算", 360_000);
  await page.waitForTimeout(500);
  await shot("07b-step6-window-closed");

  log("settle (on-chain)…");
  // The settle Cobo call occasionally hits transient API errors; the task
  // stays Verified, so clicking again retries safely.
  let settled = false;
  for (let attempt = 1; attempt <= 3 && !settled; attempt++) {
    await clickBtn("确认结算");
    try {
      await waitText("最终回答", 200_000);
      settled = true;
    } catch {
      log(`settle attempt ${attempt} did not land, retrying…`);
      await waitBtn("确认结算", 30_000); // back to Verified with button re-enabled
    }
  }
  if (!settled) throw new Error("settle failed after 3 attempts");
  await page.waitForTimeout(800);
  await shot("08-step6-settled");
  } // end success path

  // ─────────────────────────── CHALLENGE PATH ───────────────────────────
  if (only !== "success") {
  log("=== CHALLENGE PATH ===");
  await page.goto(BASE, { waitUntil: "networkidle" });
  await waitBtn("生成采购方案", 30_000);

  log("plan…");
  await clickBtn("生成采购方案");
  await waitBtn("确认方案，去授权", 200_000);
  await page.waitForTimeout(500);

  log("select shallow provider (faulty package → real coverage miss)…");
  await page
    .locator('[data-provider-row="shallow-search-provider"] input[type="radio"]')
    .click();
  await page.waitForTimeout(400);
  await shot("10-challenge-step2-select-shallow");

  log("confirm → pact → execute…");
  await clickBtn("确认方案，去授权");
  await waitBtn("执行链上采购", 90_000);
  await clickBtn("执行链上采购");
  await waitBtn("获取证据", 360_000);
  await clickBtn("获取证据");
  await waitBtn("核验证据", 200_000);

  log("open challenge (deposit + fee + openChallenge + defense on-chain)…");
  await clickBtn("发起挑战");
  await waitBtn("请求审判团裁决", 300_000);
  // Defense card is filed automatically right after the challenge opens.
  await page.getByTestId("defense-card").waitFor({ state: "visible", timeout: 30_000 });
  await page.waitForTimeout(800);
  await shot("11-challenge-opened-materials");

  log("request jury verdict (waits out R_w 120s, then 3 castVote txs)…");
  await clickBtn("请求审判团裁决");
  await page.getByText("审判团投票 2 : 1", { exact: false }).waitFor({ state: "visible", timeout: 600_000 });
  await page.waitForTimeout(500);
  await shot("12-challenge-vote");

  log("resolve (permissionless majority execution on-chain)…");
  await page.getByRole("button", { name: /执行裁决/ }).click();
  await waitText("裁决已执行", 240_000);
  await page.waitForTimeout(800);
  await shot("13-challenge-resolved");
  } // end challenge path

  await browser.close();
  log("DONE — all screenshots in demo-shots/");
}

main().catch(async (e) => {
  console.error("[capture] FAILED:", e?.message ?? e);
  process.exit(1);
});

// One-off: resume task_002 (ChallengeWon) via /?taskId= and capture shots 12/13.
import { chromium } from "@playwright/test";
const SHOTS = "/Users/luke/agents/product_designer/proofmarket/spec/proofmarket-demo/demo-shots";
const log = (m) => console.log(`[capture] ${m}`);

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1480, height: 1000 }, deviceScaleFactor: 2 });
await page.goto("http://localhost:3000/?taskId=task_002", { waitUntil: "networkidle" });
await page.getByText("审判团投票 2 : 1", { exact: false }).waitFor({ state: "visible", timeout: 30_000 });
await page.waitForTimeout(800);
await page.screenshot({ path: `${SHOTS}/12-challenge-vote.png`, fullPage: true });
log("shot 12-challenge-vote");

log("resolve (permissionless majority execution on-chain)…");
await page.getByRole("button", { name: /执行裁决/ }).click();
await page.getByText("裁决已执行", { exact: false }).first().waitFor({ state: "visible", timeout: 240_000 });
await page.waitForTimeout(800);
await page.screenshot({ path: `${SHOTS}/13-challenge-resolved.png`, fullPage: true });
log("shot 13-challenge-resolved");
await browser.close();
log("DONE");

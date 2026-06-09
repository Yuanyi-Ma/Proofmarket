import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildResearchPrompt, runClaudeResearchAgent } from "../src/claudeResearchAgent";

/**
 * Creates a fake `claude` binary in a temp dir.
 * The script receives the prompt via STDIN (`cat > /dev/null` discards it).
 * The JSON envelope is written to a temp file and `cat`-ed — most robust
 * approach to avoid shell-quoting issues with complex JSON strings.
 */
function fakeClaude(script: string): string {
  const dir = mkdtempSync(join(tmpdir(), "fake-claude-"));
  const file = join(dir, "claude");
  writeFileSync(file, `#!/bin/bash\n${script}`);
  chmodSync(file, 0o755);
  return file;
}

function fakeClaudeWithEnvelope(envelope: object): string {
  const dir = mkdtempSync(join(tmpdir(), "fake-claude-"));
  const file = join(dir, "claude");
  const responseFile = join(dir, "response.json");
  writeFileSync(responseFile, JSON.stringify(envelope));
  writeFileSync(file, `#!/bin/bash\ncat > /dev/null\ncat ${responseFile}`);
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
    expect(prompt).toMatch(/never output a contract address/i);
  });
});

describe("runClaudeResearchAgent", () => {
  it("parses and validates a good run", async () => {
    const bin = fakeClaudeWithEnvelope({ type: "result", subtype: "success", result: validPlan });
    const run = await runClaudeResearchAgent(context, { claudeBin: bin });
    expect(run.plan.recommendedProviderId).toBe("execution-research-expert");
    expect(run.rawStdout).toContain("result");
    expect(run.attempts).toBe(1);
  });

  it("extracts JSON when the result has prose around it", async () => {
    // result field contains prose + fenced JSON
    const resultText = "Here is the plan:\n```json\n" + validPlan + "\n```";
    const bin = fakeClaudeWithEnvelope({ type: "result", subtype: "success", result: resultText });
    const run = await runClaudeResearchAgent(context, { claudeBin: bin });
    expect(run.plan.taskId).toBe("task_001");
  });

  it("retries once then fails hard on invalid output", async () => {
    const bin = fakeClaudeWithEnvelope({
      type: "result",
      subtype: "success",
      result: '{"taskId":"task_001"}'
    });
    await expect(runClaudeResearchAgent(context, { claudeBin: bin })).rejects.toThrow(
      /after retry/i
    );
  });

  it("rejects with timeout message when claude exceeds timeoutMs", async () => {
    const bin = fakeClaude("cat > /dev/null\nsleep 2");
    await expect(
      runClaudeResearchAgent(context, { claudeBin: bin, timeoutMs: 100 })
    ).rejects.toThrow(/after retry/i);
    await expect(
      runClaudeResearchAgent(context, { claudeBin: bin, timeoutMs: 100 })
    ).rejects.toThrow(/timed out after 100ms/i);
  }, 10_000);

  it("counts attempts on flaky-then-good runs", async () => {
    // script fails first call, succeeds second — use a state file
    const stateDir = mkdtempSync(join(tmpdir(), "fake-claude-state-"));
    const stateFile = join(stateDir, "state");
    const responseDir = mkdtempSync(join(tmpdir(), "fake-claude-resp-"));
    const goodResponseFile = join(responseDir, "good.json");
    writeFileSync(
      goodResponseFile,
      JSON.stringify({ type: "result", subtype: "success", result: validPlan })
    );
    const bin = fakeClaude(
      `cat > /dev/null
if [ ! -f ${stateFile} ]; then touch ${stateFile}; echo 'garbage not json'; else cat ${goodResponseFile}; fi`
    );
    const run = await runClaudeResearchAgent(context, { claudeBin: bin });
    expect(run.attempts).toBe(2);
  });
});

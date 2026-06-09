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
    // NOTE: prompt injection via question is accepted — validateResearchPlanOutput is the security gate
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
    const child = execFile(
      claudeBin,
      ["-p", "--output-format", "json", "--max-turns", "1"],
      { timeout: timeoutMs, maxBuffer: 10 * 1024 * 1024 },
      (error, stdout) => {
        if (error) {
          const err = error as NodeJS.ErrnoException & { killed?: boolean };
          if (err.code === "ENOENT") {
            reject(
              new Error(
                `claude binary not found (ENOENT) — set CLAUDE_BIN or install claude: ${claudeBin}`
              )
            );
          } else if (err.killed) {
            reject(new Error(`claude timed out after ${timeoutMs}ms (SIGTERM)`));
          } else {
            reject(new Error(`claude failed (exit ${err.code ?? "unknown"}): ${error.message}`));
          }
        } else {
          resolve({ stdout: stdout ?? "" });
        }
      }
    );
    child.stdin?.write(prompt);
    child.stdin?.end();
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

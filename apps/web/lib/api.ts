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

function repoRoot(): string {
  // Next dev/build runs with cwd = apps/web
  return join(process.cwd(), "..", "..");
}

function buildRealService(): TaskService {
  const root = repoRoot();
  const deployment = parseDeploymentArtifact(
    JSON.parse(readFileSync(join(root, "deployments", "sepolia.json"), "utf8"))
  );
  // No fallback to the deployer: createJob pins the provider address, and the
  // provider service signs submit() with PROVIDER_SIGNER_PRIVATE_KEY — a
  // mismatched identity would make every submit revert.
  const providerAddress = process.env.PROVIDER_SIGNER_ADDRESS;
  if (!providerAddress) {
    throw new Error(
      "PROVIDER_SIGNER_ADDRESS is not set. Real mode requires the provider signer address " +
        "(the account matching PROVIDER_SIGNER_PRIVATE_KEY) in .env — see .env.example."
    );
  }
  const servicesUrl = process.env.SERVICES_URL ?? "http://localhost:4010";
  const chain = createChainReader(process.env.SEPOLIA_RPC_URL ?? "");
  const cobo = createCliCoboClient({ srcAddress: deployment.coboWallet });

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
    providerAddress,
    runResearchAgent: (context) => runClaudeResearchAgent(context),
    cobo,
    chain,
    services: {
      runProvider: (input) => post("/provider/run", input),
      submitDeliverable: (input) => post("/provider/submit", input),
      judgeVerify: (input) => post("/judge/verify", input)
    },
    audit: createAuditFileLog(root),
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

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
import { createChallengeResolver } from "@proofmarket/chain/src/challengeResolver";
import {
  createReputationClient,
  readReputationSummary,
  reputationSummaryToScore1000
} from "@proofmarket/chain/src/erc8004";
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

  // resolveChallenge is only needed when a ChallengeManager is deployed AND the
  // resolver key is available.  Neither is required for the success path, so we
  // build a call-time-throwing stub when either is absent instead of failing at
  // startup.
  const resolverKey = process.env.RESOLVER_PRIVATE_KEY;
  const challengeManagerAddress = deployment.contracts.ProofMarketChallengeManager;
  const resolveChallenge =
    challengeManagerAddress && resolverKey
      ? createChallengeResolver({
          rpcUrl: process.env.SEPOLIA_RPC_URL ?? "",
          privateKey: resolverKey as `0x${string}`,
          challengeManagerAddress: challengeManagerAddress as `0x${string}`
        })
      : async (): Promise<{ txHash: string }> => {
          if (!resolverKey) {
            throw new Error(
              "RESOLVER_PRIVATE_KEY not set — required to resolve challenges"
            );
          }
          throw new Error(
            "deployment artifact has no contracts.ProofMarketChallengeManager — " +
              "redeploy with the P0-2 script before resolving challenges"
          );
        };

  // ERC-8004 reputation deps (P1-2). Same lazy/guarded pattern as
  // resolveChallenge: when the artifact has no erc8004 section (or the rater
  // key is absent for writes), build a stub that throws only when called —
  // a missing reputation config must not break startup, and the service
  // treats both deps' failures as non-fatal (plan falls back to fixture
  // scores; feedback failure is audited without failing settlement).
  const rpcUrl = process.env.SEPOLIA_RPC_URL ?? "";
  const erc8004 = deployment.erc8004;
  // Rater = PROVIDER_SIGNER key: the ReputationRegistry rejects self-feedback,
  // and the agent NFTs are owned by the deployer — so the provider signer is a
  // valid (non-owner) rater. Reuses an existing env var; nothing new needed.
  const raterKey = process.env.PROVIDER_SIGNER_PRIVATE_KEY;
  const reputationClient =
    erc8004 && raterKey
      ? createReputationClient({
          rpcUrl,
          privateKey: raterKey as `0x${string}`,
          reputationAddress: erc8004.reputationRegistry as `0x${string}`
        })
      : null;
  const publishFeedback = reputationClient
    ? async (input: { agentId: number; value: number; tag2: string }) =>
        reputationClient.giveFeedback({
          agentId: BigInt(input.agentId),
          value: BigInt(input.value),
          valueDecimals: 2,
          tag1: "proofmarket",
          tag2: input.tag2,
          endpoint: "",
          feedbackURI: `proofmarket://feedback/${input.tag2}`
        })
    : async (): Promise<{ txHash: `0x${string}` }> => {
        throw new Error(
          erc8004
            ? "PROVIDER_SIGNER_PRIVATE_KEY not set — required as the ERC-8004 feedback rater"
            : "deployment artifact has no erc8004 section — re-run the P1-1 registration script"
        );
      };
  const readReputation = erc8004
    ? async (agentId: number): Promise<{ score: number }> => {
        const summary = await readReputationSummary(
          rpcUrl,
          erc8004.reputationRegistry as `0x${string}`,
          BigInt(agentId)
        );
        if (summary.count === 0n) {
          // No feedback on-chain yet: let the service fall back to the fixture
          // score instead of rendering a misleading 0.
          throw new Error(`agent ${agentId} has no on-chain feedback yet`);
        }
        return { score: reputationSummaryToScore1000(summary) };
      }
    : async (): Promise<{ score: number }> => {
        throw new Error(
          "deployment artifact has no erc8004 section — re-run the P1-1 registration script"
        );
      };

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
      judgeVerify: (input) => post("/judge/verify", input),
      resolverVote: (input) => post("/resolver/vote", input)
    },
    resolveChallenge,
    publishFeedback,
    readReputation,
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

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseDeploymentArtifact } from "@proofmarket/shared/src/realMode";
import { createProviderSubmitter } from "./providerSigner";
import { startServicesServer, type SubmitOnChain } from "./server";

async function main(): Promise<void> {
  const port = Number(process.env.SERVICES_PORT ?? 4010);
  const rpcUrl = process.env.SEPOLIA_RPC_URL ?? "";
  const providerKey = process.env.PROVIDER_SIGNER_PRIVATE_KEY ?? "";

  let submitOnChain: SubmitOnChain | null = null;
  if (rpcUrl && providerKey) {
    const artifact = parseDeploymentArtifact(
      JSON.parse(readFileSync(join(process.cwd(), "..", "..", "deployments", "sepolia.json"), "utf8"))
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
}

main().catch((error) => {
  console.error("boot error:", error);
  process.exit(1);
});

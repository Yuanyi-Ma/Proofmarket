import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseDeploymentArtifact } from "@proofmarket/shared/src/realMode";
import { createDefenseSubmitter, createJuryVoter } from "@proofmarket/chain/src/jurySigner";
import { createProviderSubmitter } from "./providerSigner";
import {
  startServicesServer,
  type DefenseOnChain,
  type JuryVoterEntry,
  type SubmitOnChain
} from "./server";

const moduleDir = fileURLToPath(new URL(".", import.meta.url));

async function main(): Promise<void> {
  const port = Number(process.env.SERVICES_PORT ?? 4010);
  const rpcUrl = process.env.SEPOLIA_RPC_URL ?? "";
  const providerKey = process.env.PROVIDER_SIGNER_PRIVATE_KEY ?? "";

  const artifact = parseDeploymentArtifact(
    JSON.parse(readFileSync(join(moduleDir, "..", "..", "..", "deployments", "sepolia.json"), "utf8"))
  );
  const challengeManagerAddress = artifact.contracts.ProofMarketChallengeManager;

  let submitOnChain: SubmitOnChain | null = null;
  let defenseOnChain: DefenseOnChain | null = null;
  if (rpcUrl && providerKey) {
    submitOnChain = createProviderSubmitter({
      rpcUrl,
      privateKey: providerKey as `0x${string}`,
      escrowAddress: artifact.contracts.ProofMarketEscrow as `0x${string}`
    });
    console.log("Provider on-chain submitter: ENABLED");
    if (challengeManagerAddress) {
      defenseOnChain = createDefenseSubmitter({
        rpcUrl,
        privateKey: providerKey as `0x${string}`,
        challengeManagerAddress: challengeManagerAddress as `0x${string}`
      });
      console.log("Provider defense submitter: ENABLED");
    }
  } else {
    console.log("Provider on-chain submitter: disabled (no key/rpc)");
  }

  // Jury operators: one castVote signer per seat, keys from JUROR{1,2,3}_PRIVATE_KEY,
  // seat order matching artifact.jurors (registration order on-chain).
  let juryVoters: JuryVoterEntry[] | null = null;
  const jurorKeys = [
    process.env.JUROR1_PRIVATE_KEY ?? "",
    process.env.JUROR2_PRIVATE_KEY ?? "",
    process.env.JUROR3_PRIVATE_KEY ?? ""
  ];
  const jurors = artifact.jurors ?? [];
  if (
    rpcUrl &&
    challengeManagerAddress &&
    jurors.length === 3 &&
    jurorKeys.every((key) => key.length > 0)
  ) {
    juryVoters = jurors.map((juror, i) => ({
      jurorAddress: juror.address,
      castVote: createJuryVoter({
        rpcUrl,
        privateKey: jurorKeys[i] as `0x${string}`,
        challengeManagerAddress: challengeManagerAddress as `0x${string}`
      })
    }));
    console.log(`Jury voters: ENABLED (${juryVoters.length} seats)`);
  } else {
    console.log("Jury voters: disabled (need rpc, challenge manager, artifact.jurors and 3 JURORn_PRIVATE_KEY)");
  }

  const defenseWindowMs =
    Number(artifact.challengeManagerParams?.defenseWindow ?? 0) * 1000;

  const server = await startServicesServer({
    port,
    submitOnChain,
    defenseOnChain,
    juryVoters,
    defenseWindowMs
  });
  console.log(`ProofMarket services listening at ${server.url}`);
}

main().catch((error) => {
  console.error("boot error:", error);
  process.exit(1);
});

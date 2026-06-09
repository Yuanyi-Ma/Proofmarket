import { createWalletClient, http, publicActions } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import { escrowAbi } from "@proofmarket/chain/src/escrowAbi";
import type { SubmitOnChain } from "./server";

export function createProviderSubmitter(input: {
  rpcUrl: string;
  privateKey: `0x${string}`;
  escrowAddress: `0x${string}`;
}): SubmitOnChain {
  const account = privateKeyToAccount(input.privateKey);
  const client = createWalletClient({
    account,
    chain: sepolia,
    transport: http(input.rpcUrl)
  }).extend(publicActions);

  return async ({ jobId, deliverableHash }) => {
    const hash = await client.writeContract({
      address: input.escrowAddress,
      abi: escrowAbi,
      functionName: "submit",
      args: [jobId, deliverableHash]
    });
    await client.waitForTransactionReceipt({ hash, timeout: 180_000 });
    return { txHash: hash };
  };
}

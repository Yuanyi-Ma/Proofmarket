/**
 * ERC-8004 client helpers: identity registration, reputation feedback, and
 * read-back helpers against the official Sepolia registries.
 *
 * Write clients sign with a local private key (no Cobo in this path — agent
 * registration and seed reputation are operator actions, not demo-flow txs).
 */

import {
  AbiEventSignatureNotFoundError,
  createPublicClient,
  createWalletClient,
  decodeEventLog,
  http,
  type Hash,
  type TransactionReceipt
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import { assertReceiptSuccess } from "./chainReader";
import { identityRegistryAbi, reputationRegistryAbi } from "./erc8004Abi";

type Hex = `0x${string}`;

export const ZERO_BYTES32 =
  "0x0000000000000000000000000000000000000000000000000000000000000000" as Hex;

/**
 * Pull the agentId out of the IdentityRegistry `Registered` event in a receipt.
 * Exported separately so the decode path is unit-testable without a chain.
 */
export function extractAgentId(receipt: TransactionReceipt, identityAddress: string): bigint {
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== identityAddress.toLowerCase()) continue;
    try {
      const event = decodeEventLog({
        abi: identityRegistryAbi,
        data: log.data,
        topics: log.topics
      });
      if (event.eventName === "Registered") {
        return (event.args as { agentId: bigint }).agentId;
      }
      // Known event (ERC-721 Transfer) but not Registered — skip
    } catch (error) {
      // Only swallow "topic0 not in ABI" — other decode failures should surface
      if (!(error instanceof AbiEventSignatureNotFoundError)) throw error;
    }
  }
  throw new Error(`No Registered event found in receipt ${receipt.transactionHash}`);
}

export type IdentityClient = {
  register(agentURI: string): Promise<{ agentId: bigint; txHash: Hash }>;
};

export function createIdentityClient(opts: {
  rpcUrl: string;
  privateKey: Hex;
  identityAddress: Hex;
}): IdentityClient {
  const account = privateKeyToAccount(opts.privateKey);
  const publicClient = createPublicClient({ chain: sepolia, transport: http(opts.rpcUrl) });
  const walletClient = createWalletClient({
    account,
    chain: sepolia,
    transport: http(opts.rpcUrl)
  });

  return {
    async register(agentURI) {
      const txHash = await walletClient.writeContract({
        address: opts.identityAddress,
        abi: identityRegistryAbi,
        functionName: "register",
        args: [agentURI]
      });
      const receipt = await publicClient.waitForTransactionReceipt({
        hash: txHash,
        timeout: 180_000
      });
      assertReceiptSuccess(receipt, txHash);
      return { agentId: extractAgentId(receipt, opts.identityAddress), txHash };
    }
  };
}

export type GiveFeedbackArgs = {
  agentId: bigint;
  /** Scaled by 10^valueDecimals (e.g. 480 with valueDecimals 2 → 4.80). */
  value: bigint;
  valueDecimals: number;
  tag1: string;
  tag2: string;
  endpoint?: string;
  feedbackURI?: string;
  feedbackHash?: Hex;
};

export type ReputationClient = {
  giveFeedback(args: GiveFeedbackArgs): Promise<{ txHash: Hash }>;
};

export function createReputationClient(opts: {
  rpcUrl: string;
  privateKey: Hex;
  reputationAddress: Hex;
}): ReputationClient {
  const account = privateKeyToAccount(opts.privateKey);
  const publicClient = createPublicClient({ chain: sepolia, transport: http(opts.rpcUrl) });
  const walletClient = createWalletClient({
    account,
    chain: sepolia,
    transport: http(opts.rpcUrl)
  });

  return {
    async giveFeedback(args) {
      const txHash = await walletClient.writeContract({
        address: opts.reputationAddress,
        abi: reputationRegistryAbi,
        functionName: "giveFeedback",
        args: [
          args.agentId,
          args.value,
          args.valueDecimals,
          args.tag1,
          args.tag2,
          args.endpoint ?? "",
          args.feedbackURI ?? "",
          args.feedbackHash ?? ZERO_BYTES32
        ]
      });
      const receipt = await publicClient.waitForTransactionReceipt({
        hash: txHash,
        timeout: 180_000
      });
      assertReceiptSuccess(receipt, txHash);
      return { txHash };
    }
  };
}

/**
 * Maps an on-chain reputation summary (value scaled by 10^decimals on a 0-5
 * scale, e.g. value 480 / decimals 2 → 4.80) to the fixture providerProfiles
 * display scale of 0-1000 (4.80/5.00 → 960). Clamped to [0, 1000].
 */
export function reputationSummaryToScore1000(summary: {
  value: bigint;
  decimals: number;
}): number {
  const score = (Number(summary.value) / 10 ** summary.decimals) * 200;
  return Math.max(0, Math.min(1000, Math.round(score)));
}

// ── Read helpers (public client, no key) ─────────────────────────────────────

export async function readAgent(
  rpcUrl: string,
  identityAddress: Hex,
  agentId: bigint
): Promise<{ owner: Hex; agentURI: string }> {
  const client = createPublicClient({ chain: sepolia, transport: http(rpcUrl) });
  const [owner, agentURI] = await Promise.all([
    client.readContract({
      address: identityAddress,
      abi: identityRegistryAbi,
      functionName: "ownerOf",
      args: [agentId]
    }),
    client.readContract({
      address: identityAddress,
      abi: identityRegistryAbi,
      functionName: "tokenURI",
      args: [agentId]
    })
  ]);
  return { owner, agentURI };
}

export async function readReputationSummary(
  rpcUrl: string,
  reputationAddress: Hex,
  agentId: bigint,
  tag1 = "",
  tag2 = "",
  clientAddresses?: readonly Hex[]
): Promise<{ count: bigint; value: bigint; decimals: number }> {
  const client = createPublicClient({ chain: sepolia, transport: http(rpcUrl) });
  // The deployed Sepolia ReputationRegistry REJECTS an empty clientAddresses
  // array (reverts "clientAddresses required") — verified against the live
  // contract 2026-06-11. When the caller doesn't scope to specific raters,
  // default to the full on-chain client list via getClients(agentId).
  const clients =
    clientAddresses ??
    (await client.readContract({
      address: reputationAddress,
      abi: reputationRegistryAbi,
      functionName: "getClients",
      args: [agentId]
    }));
  if (clients.length === 0) {
    // No feedback yet — getSummary would revert; return an empty summary.
    return { count: 0n, value: 0n, decimals: 0 };
  }
  // Empty tag = ignore that filter
  const [count, summaryValue, summaryValueDecimals] = await client.readContract({
    address: reputationAddress,
    abi: reputationRegistryAbi,
    functionName: "getSummary",
    args: [agentId, clients, tag1, tag2]
  });
  return { count: BigInt(count), value: summaryValue, decimals: Number(summaryValueDecimals) };
}

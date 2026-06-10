import { describe, expect, it } from "vitest";
import {
  decodeFunctionData,
  encodeAbiParameters,
  encodeEventTopics,
  encodeFunctionData,
  toFunctionSelector
} from "viem";
import type { Log, TransactionReceipt } from "viem";
import { identityRegistryAbi, reputationRegistryAbi } from "../src/erc8004Abi";
import {
  extractAgentId,
  reputationSummaryToScore1000,
  ZERO_BYTES32
} from "../src/erc8004";

const addr = (c: string) => `0x${c.padEnd(40, "0")}` as `0x${string}`;
const identityAddr = addr("8004");
const ownerAddr = addr("a1");
const otherAddr = addr("dead");

/** Build a minimal synthetic TransactionReceipt */
function makeReceipt(logs: Log[]): TransactionReceipt {
  return {
    transactionHash: "0xabc" as `0x${string}`,
    blockHash: "0x0" as `0x${string}`,
    blockNumber: 1n,
    contractAddress: null,
    cumulativeGasUsed: 0n,
    effectiveGasPrice: 0n,
    from: ownerAddr,
    gasUsed: 0n,
    logs,
    logsBloom: "0x0" as `0x${string}`,
    status: "success",
    to: identityAddr,
    transactionIndex: 0,
    type: "eip1559"
  } as unknown as TransactionReceipt;
}

function makeRegisteredLog(
  agentId: bigint,
  address: `0x${string}`,
  logIndex = 0
): Log {
  const topics = encodeEventTopics({
    abi: identityRegistryAbi,
    eventName: "Registered",
    args: { agentId, owner: ownerAddr }
  });
  // Non-indexed agentURI (string) goes in data
  const data = encodeAbiParameters([{ type: "string" }], ["proofmarket://agent/test"]);
  return {
    address,
    data,
    topics: topics as [`0x${string}`, ...`0x${string}`[]],
    blockHash: "0x0" as `0x${string}`,
    blockNumber: 1n,
    logIndex,
    removed: false,
    transactionHash: "0xabc" as `0x${string}`,
    transactionIndex: 0
  };
}

function makeTransferLog(tokenId: bigint, address: `0x${string}`, logIndex = 0): Log {
  const topics = encodeEventTopics({
    abi: identityRegistryAbi,
    eventName: "Transfer",
    args: { from: addr("0"), to: ownerAddr, tokenId }
  });
  return {
    address,
    data: "0x" as `0x${string}`,
    topics: topics as [`0x${string}`, ...`0x${string}`[]],
    blockHash: "0x0" as `0x${string}`,
    blockNumber: 1n,
    logIndex,
    removed: false,
    transactionHash: "0xabc" as `0x${string}`,
    transactionIndex: 0
  };
}

describe("extractAgentId", () => {
  it("extracts agentId 7n from a Registered log", () => {
    const receipt = makeReceipt([makeRegisteredLog(7n, identityAddr)]);
    expect(extractAgentId(receipt, identityAddr)).toBe(7n);
  });

  it("skips the ERC-721 Transfer log (registration mint) and reads the Registered log", () => {
    // A real register() receipt contains both a Transfer(0x0 → owner) and a
    // Registered log from the identity registry — the Transfer must be skipped.
    const receipt = makeReceipt([
      makeTransferLog(7n, identityAddr, 0),
      makeRegisteredLog(7n, identityAddr, 1)
    ]);
    expect(extractAgentId(receipt, identityAddr)).toBe(7n);
  });

  it("ignores Registered logs from a different contract address", () => {
    const receipt = makeReceipt([makeRegisteredLog(7n, otherAddr)]);
    expect(() => extractAgentId(receipt, identityAddr)).toThrow(/No Registered/);
  });

  it("throws when no Registered log exists", () => {
    expect(() => extractAgentId(makeReceipt([]), identityAddr)).toThrow(/No Registered/);
  });
});

describe("giveFeedback calldata encoding", () => {
  it("encodes with the giveFeedback selector and round-trips all 8 args", () => {
    const args = [
      1n, // agentId
      480n, // value (4.80 at decimals=2)
      2, // valueDecimals
      "proofmarket",
      "seed",
      "", // endpoint
      "proofmarket://seed/execution-research-expert",
      ZERO_BYTES32
    ] as const;
    const calldata = encodeFunctionData({
      abi: reputationRegistryAbi,
      functionName: "giveFeedback",
      args
    });

    const expectedSelector = toFunctionSelector(
      "giveFeedback(uint256,int128,uint8,string,string,string,string,bytes32)"
    );
    expect(calldata.slice(0, 10)).toBe(expectedSelector);

    const decoded = decodeFunctionData({ abi: reputationRegistryAbi, data: calldata });
    expect(decoded.functionName).toBe("giveFeedback");
    expect(decoded.args).toHaveLength(8);
    expect(decoded.args).toEqual([...args]);
  });
});

describe("reputationSummaryToScore1000", () => {
  it("maps a 0-5 scaled summary onto the fixture 0-1000 scale", () => {
    // P1-1 seed values: 480/2 → 4.80 → 960, 350/2 → 700, 200/2 → 400
    expect(reputationSummaryToScore1000({ value: 480n, decimals: 2 })).toBe(960);
    expect(reputationSummaryToScore1000({ value: 350n, decimals: 2 })).toBe(700);
    expect(reputationSummaryToScore1000({ value: 200n, decimals: 2 })).toBe(400);
    // Runtime feedback values: 500 → 5.00 → 1000, 100 → 1.00 → 200
    expect(reputationSummaryToScore1000({ value: 500n, decimals: 2 })).toBe(1000);
    expect(reputationSummaryToScore1000({ value: 100n, decimals: 2 })).toBe(200);
  });

  it("handles other decimals and clamps to [0, 1000]", () => {
    expect(reputationSummaryToScore1000({ value: 5n, decimals: 0 })).toBe(1000);
    expect(reputationSummaryToScore1000({ value: 4800n, decimals: 3 })).toBe(960);
    expect(reputationSummaryToScore1000({ value: 0n, decimals: 2 })).toBe(0);
    // Out-of-range summaries never escape the display scale
    expect(reputationSummaryToScore1000({ value: 700n, decimals: 2 })).toBe(1000);
    expect(reputationSummaryToScore1000({ value: -100n, decimals: 2 })).toBe(0);
  });
});

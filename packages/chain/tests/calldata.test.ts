import { describe, expect, it } from "vitest";
import {
  encodeApprove,
  encodeCreateJob,
  encodeSetBudget,
  encodeFund,
  encodeComplete,
  encodeSubmit,
  encodeReject,
  encodeMarkChallenged,
  encodeRefundForChallenge,
  encodeUnfreezeForChallenge,
  encodeSetChallengeManager,
  encodeDepositStake,
  encodeWithdrawStake,
  encodeLockStakeForJob,
  encodeUnlockStakeForJob,
  encodeOpenChallenge,
  encodeResolve,
  encodeSubmitDefense,
  encodeCastVote,
  ChallengeType,
  ChallengeResult
} from "../src/calldata";

const addr = (c: string) => `0x${c.repeat(40)}` as `0x${string}`;
const hash32 = (c: string) => `0x${c.repeat(64)}` as `0x${string}`;

// Helper: extract the 4-byte selector hex (no 0x prefix) from encoded calldata
function selector(data: string): string {
  return data.slice(2, 10); // after "0x", first 8 hex chars = 4 bytes
}

// 2 + 8 + N * 64 chars: "0x" + selector + N 32-byte words
const wordLen = (n: number) => 2 + 8 + n * 64;

describe("calldata encoding", () => {
  it("encodes approve(spender, amount)", () => {
    const data = encodeApprove(addr("4"), 5_000_000n);
    expect(data.startsWith("0x095ea7b3")).toBe(true); // approve selector
  });

  it("encodes createJob with 8 args", () => {
    const data = encodeCreateJob({
      providerAgentId: 1n,
      provider: addr("a"),
      verifierAgentId: 2n,
      evaluator: addr("b"),
      token: addr("3"),
      expiredAt: 1_900_000_000n,
      descriptionHash: hash32("1"),
      coverageHash: hash32("2")
    });
    expect(data.length).toBe(wordLen(8)); // selector + 8 words
  });

  it("encodes setBudget, fund, complete, submit", () => {
    expect(encodeSetBudget(1n, 5_000_000n).length).toBe(wordLen(2));
    expect(encodeFund(1n, 5_000_000n).length).toBe(wordLen(2));
    expect(encodeComplete(1n, hash32("3")).length).toBe(wordLen(2));
    expect(encodeSubmit(1n, hash32("4")).length).toBe(wordLen(2));
  });

  // ── Escrow P0 additions ───────────────────────────────────────────────────

  it("encodes reject(jobId, reasonHash) — 2 words", () => {
    const data = encodeReject(7n, hash32("r"));
    expect(data.length).toBe(wordLen(2));
  });

  it("encodes markChallenged(jobId) — 1 word", () => {
    const data = encodeMarkChallenged(3n);
    expect(data.length).toBe(wordLen(1));
  });

  it("encodes refundForChallenge(jobId) — 1 word", () => {
    const data = encodeRefundForChallenge(3n);
    expect(data.length).toBe(wordLen(1));
  });

  it("encodes unfreezeForChallenge(jobId) — 1 word", () => {
    const data = encodeUnfreezeForChallenge(3n);
    expect(data.length).toBe(wordLen(1));
  });

  it("encodes setChallengeManager(addr) — 1 word", () => {
    const data = encodeSetChallengeManager(addr("c"));
    expect(data.length).toBe(wordLen(1));
  });

  it("markChallenged / refundForChallenge / unfreezeForChallenge have distinct selectors", () => {
    const s1 = selector(encodeMarkChallenged(1n));
    const s2 = selector(encodeRefundForChallenge(1n));
    const s3 = selector(encodeUnfreezeForChallenge(1n));
    expect(s1).not.toBe(s2);
    expect(s1).not.toBe(s3);
    expect(s2).not.toBe(s3);
  });

  // ── ChallengeManager stake ────────────────────────────────────────────────

  it("encodes depositStake(amount) — 1 word", () => {
    const data = encodeDepositStake(1_000n);
    expect(data.length).toBe(wordLen(1));
  });

  it("encodes withdrawStake(amount) — 1 word", () => {
    const data = encodeWithdrawStake(500n);
    expect(data.length).toBe(wordLen(1));
  });

  it("depositStake and withdrawStake have distinct selectors", () => {
    expect(selector(encodeDepositStake(1n))).not.toBe(selector(encodeWithdrawStake(1n)));
  });

  // ── ChallengeManager escrow hooks ─────────────────────────────────────────

  it("encodes lockStakeForJob(provider) — 1 word", () => {
    const data = encodeLockStakeForJob(addr("d"));
    expect(data.length).toBe(wordLen(1));
  });

  it("encodes unlockStakeForJob(provider) — 1 word", () => {
    const data = encodeUnlockStakeForJob(addr("d"));
    expect(data.length).toBe(wordLen(1));
  });

  it("lockStakeForJob and unlockStakeForJob have distinct selectors", () => {
    expect(selector(encodeLockStakeForJob(addr("d")))).not.toBe(
      selector(encodeUnlockStakeForJob(addr("d")))
    );
  });

  // ── ChallengeManager challenge lifecycle ──────────────────────────────────

  it("encodes openChallenge(jobId, challengeType, challengeHash) — 3 words", () => {
    const data = encodeOpenChallenge(5n, ChallengeType.CoverageMiss, hash32("h"));
    expect(data.length).toBe(wordLen(3));
  });

  it("encodes resolve(challengeId) — 1 word (v2: outcome comes from on-chain votes)", () => {
    const data = encodeResolve(1n);
    expect(data.length).toBe(wordLen(1));
  });

  it("encodes submitDefense(challengeId, defenseHash) — 2 words", () => {
    const data = encodeSubmitDefense(1n, hash32("d"));
    expect(data.length).toBe(wordLen(2));
  });

  it("encodes castVote(challengeId, result, reasonHash) — 3 words", () => {
    const data = encodeCastVote(1n, ChallengeResult.ProviderFault, hash32("r"));
    expect(data.length).toBe(wordLen(3));
  });

  it("openChallenge and resolve have distinct selectors from each other and from escrow fns", () => {
    const sOpen   = selector(encodeOpenChallenge(1n, 0, hash32("a")));
    const sResolve = selector(encodeResolve(1n));
    const sMark   = selector(encodeMarkChallenged(1n));
    expect(sOpen).not.toBe(sResolve);
    expect(sOpen).not.toBe(sMark);
    expect(sResolve).not.toBe(sMark);
  });

  // ── ChallengeType enum map ─────────────────────────────────────────────────

  it("ChallengeType enum values match .sol declaration order", () => {
    // enum ChallengeType { SourceNotFound, LocatorInvalid, ExcerptMismatch, NumericMismatch, CoverageMiss }
    expect(ChallengeType.SourceNotFound).toBe(0);
    expect(ChallengeType.LocatorInvalid).toBe(1);
    expect(ChallengeType.ExcerptMismatch).toBe(2);
    expect(ChallengeType.NumericMismatch).toBe(3);
    expect(ChallengeType.CoverageMiss).toBe(4);
  });

  it("ChallengeResult enum values match .sol declaration order", () => {
    // enum ChallengeResult { Pending, ProviderFault, ProviderNotFault }
    expect(ChallengeResult.Pending).toBe(0);
    expect(ChallengeResult.ProviderFault).toBe(1);
    expect(ChallengeResult.ProviderNotFault).toBe(2);
  });

  it("encodeOpenChallenge with CoverageMiss encodes enum value 4 in calldata", () => {
    const data = encodeOpenChallenge(1n, ChallengeType.CoverageMiss, hash32("z"));
    // Layout: 0x + selector(8) + jobId(64) + challengeType(64) + challengeHash(64)
    // challengeType word starts at char index 2 + 8 + 64 = 74, length 64
    const challengeTypeWord = data.slice(2 + 8 + 64, 2 + 8 + 64 + 64);
    // The uint8 value 4 is ABI-encoded as a 32-byte big-endian word ending in "04"
    expect(challengeTypeWord).toBe("0".repeat(62) + "04");
  });
});

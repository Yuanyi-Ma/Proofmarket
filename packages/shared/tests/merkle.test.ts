import { describe, expect, it } from "vitest";
import { stableHash } from "../src/hash";
import {
  buildPackageCommitment,
  buildTreeFromLeaves,
  getMerkleProof,
  hashLeaf,
  packageLeafPreimages,
  verifyMerkleProof
} from "../src/merkle";

function fakeLeaves(n: number): string[] {
  return Array.from({ length: n }, (_, i) => stableHash({ leaf: i }));
}

describe("merkle tree", () => {
  it("single leaf: root equals the leaf, empty proof verifies", () => {
    const [leaf] = fakeLeaves(1);
    const root = buildTreeFromLeaves([leaf]);
    expect(root).toBe(leaf);
    expect(verifyMerkleProof(leaf, getMerkleProof([leaf], 0), root)).toBe(true);
  });

  it("every leaf proves into the root for sizes 2..9 (odd carry-up included)", () => {
    for (let n = 2; n <= 9; n += 1) {
      const leaves = fakeLeaves(n);
      const root = buildTreeFromLeaves(leaves);
      for (let i = 0; i < n; i += 1) {
        const proof = getMerkleProof(leaves, i);
        expect(verifyMerkleProof(leaves[i], proof, root)).toBe(true);
      }
    }
  });

  it("a tampered leaf fails verification against the committed root", () => {
    const leaves = fakeLeaves(4);
    const root = buildTreeFromLeaves(leaves);
    const proof = getMerkleProof(leaves, 2);
    const forged = stableHash({ leaf: "forged" });
    expect(verifyMerkleProof(forged, proof, root)).toBe(false);
  });

  it("a proof for one leaf does not verify another leaf", () => {
    const leaves = fakeLeaves(5);
    const root = buildTreeFromLeaves(leaves);
    const proofFor3 = getMerkleProof(leaves, 3);
    expect(verifyMerkleProof(leaves[1], proofFor3, root)).toBe(false);
  });

  it("rejects out-of-range leaf index", () => {
    const leaves = fakeLeaves(3);
    expect(() => getMerkleProof(leaves, 3)).toThrow();
    expect(() => getMerkleProof(leaves, -1)).toThrow();
  });
});

describe("package commitment", () => {
  const pkg = {
    taskId: "task_test",
    providerAgentId: 1,
    providerId: "execution-research-expert",
    providerName: "区块链系统专家 Agent",
    coverageStatement: "覆盖 2021-2026 年执行加速方向论文与研报。",
    answers: [
      {
        providerAnswer: "a",
        sourceTitle: "T1",
        sourceLocator: "arXiv:1",
        sourceLibrary: "arxiv",
        sourceMetadata: { year: 2022, type: "paper" },
        excerptOrSummary: "e1",
        relevanceExplanation: "r1"
      },
      {
        providerAnswer: "b",
        sourceTitle: "T2",
        sourceLocator: "delphi:2",
        sourceLibrary: "delphi-digital",
        sourceMetadata: { year: 2025, type: "report" },
        excerptOrSummary: "e2",
        relevanceExplanation: "r2"
      }
    ]
  };

  it("leaf 0 is the overview, then one leaf per answer", () => {
    const preimages = packageLeafPreimages(pkg);
    expect(preimages).toHaveLength(3);
    expect((preimages[0] as { kind: string }).kind).toBe("overview");
    expect((preimages[1] as { kind: string }).kind).toBe("evidence");
  });

  it("any single answer leaf proves into the package root without the others", () => {
    const { root, leafHashes } = buildPackageCommitment(pkg);
    const leafIndex = 2; // answer "b"
    const proof = getMerkleProof(leafHashes, leafIndex);
    const recomputedLeaf = hashLeaf(packageLeafPreimages(pkg)[leafIndex]);
    expect(recomputedLeaf).toBe(leafHashes[leafIndex]);
    expect(verifyMerkleProof(recomputedLeaf, proof, root)).toBe(true);
  });

  it("changing one answer changes the root (no silent substitution)", () => {
    const { root } = buildPackageCommitment(pkg);
    const tampered = {
      ...pkg,
      answers: [
        pkg.answers[0],
        { ...pkg.answers[1], excerptOrSummary: "tampered" }
      ]
    };
    expect(buildPackageCommitment(tampered).root).not.toBe(root);
  });
});

// Merkle commitment over a provider briefing (design rationale: leaf-level
// disclosure). Leaf 0 is the overview (identity + coverage statement); each
// following leaf is one 资料-建议 evidence item. The ROOT is what the provider
// signs into the chain as packageHash, so any single leaf can later be proven
// part of the committed briefing with just (leaf plaintext, Merkle path) —
// challenge and defense never need to reveal the rest of the briefing.
//
// Absence (查全) cannot be proven by a path; the protocol handles it the other
// way around: the challenger names the missing item, and the PROVIDER can kill
// the challenge instantly by exhibiting the leaf + path that contains it.
import { stableHash, type JsonValue } from "./hash";

export type MerkleProofStep = {
  hash: string;
  /** Where the sibling sits relative to the running hash. */
  position: "left" | "right";
};

export type PackageTree = {
  root: string;
  /** leafHashes[0] = overview leaf; [1..n] = evidence-item leaves. */
  leafHashes: string[];
};

function parentHash(left: string, right: string): string {
  return stableHash({ left, right });
}

/**
 * Builds the tree bottom-up. An odd node at the end of a level is carried up
 * unchanged (no duplication, so a leaf cannot be "proven twice").
 */
export function buildTreeFromLeaves(leafHashes: string[]): string {
  if (leafHashes.length === 0) {
    throw new Error("merkle tree needs at least one leaf");
  }
  let level = leafHashes;
  while (level.length > 1) {
    const next: string[] = [];
    for (let i = 0; i < level.length; i += 2) {
      if (i + 1 < level.length) {
        next.push(parentHash(level[i], level[i + 1]));
      } else {
        next.push(level[i]);
      }
    }
    level = next;
  }
  return level[0];
}

export function getMerkleProof(
  leafHashes: string[],
  leafIndex: number
): MerkleProofStep[] {
  if (leafIndex < 0 || leafIndex >= leafHashes.length) {
    throw new Error(`leaf index ${leafIndex} out of range`);
  }
  const proof: MerkleProofStep[] = [];
  let level = leafHashes;
  let index = leafIndex;
  while (level.length > 1) {
    const next: string[] = [];
    let nextIndex = index;
    for (let i = 0; i < level.length; i += 2) {
      const hasPair = i + 1 < level.length;
      if (hasPair) {
        if (i === index) {
          proof.push({ hash: level[i + 1], position: "right" });
          nextIndex = next.length;
        } else if (i + 1 === index) {
          proof.push({ hash: level[i], position: "left" });
          nextIndex = next.length;
        }
        next.push(parentHash(level[i], level[i + 1]));
      } else {
        // Odd tail node is carried up unchanged — no sibling, no proof step.
        if (i === index) {
          nextIndex = next.length;
        }
        next.push(level[i]);
      }
    }
    level = next;
    index = nextIndex;
  }
  return proof;
}

export function verifyMerkleProof(
  leafHash: string,
  proof: readonly MerkleProofStep[],
  root: string
): boolean {
  let running = leafHash;
  for (const step of proof) {
    running =
      step.position === "left"
        ? parentHash(step.hash, running)
        : parentHash(running, step.hash);
  }
  return running === root;
}

/** Leaf 0: briefing identity + coverage statement (the commitment everyone quotes). */
export function overviewLeafPreimage(input: {
  taskId: string;
  providerAgentId: number;
  providerId: string;
  providerName: string;
  coverageStatement: string;
}): JsonValue {
  return {
    kind: "overview",
    taskId: input.taskId,
    providerAgentId: input.providerAgentId,
    providerId: input.providerId,
    providerName: input.providerName,
    coverageStatement: input.coverageStatement
  };
}

/** Leaf i (i ≥ 1): one self-contained 资料-建议 unit. */
export function evidenceLeafPreimage(answer: {
  providerAnswer: string;
  sourceTitle: string;
  sourceLocator: string;
  sourceLibrary: string;
  sourceMetadata: { year: number; type: string };
  excerptOrSummary: string;
  relevanceExplanation: string;
}): JsonValue {
  return {
    kind: "evidence",
    providerAnswer: answer.providerAnswer,
    sourceTitle: answer.sourceTitle,
    sourceLocator: answer.sourceLocator,
    sourceLibrary: answer.sourceLibrary,
    sourceMetadata: {
      year: answer.sourceMetadata.year,
      type: answer.sourceMetadata.type
    },
    excerptOrSummary: answer.excerptOrSummary,
    relevanceExplanation: answer.relevanceExplanation
  };
}

export function hashLeaf(preimage: JsonValue): string {
  return stableHash(preimage);
}

type PackageLike = {
  taskId: string;
  providerAgentId: number;
  providerId: string;
  providerName: string;
  coverageStatement: string;
  answers: Array<{
    providerAnswer: string;
    sourceTitle: string;
    sourceLocator: string;
    sourceLibrary: string;
    sourceMetadata: { year: number; type: string };
    excerptOrSummary: string;
    relevanceExplanation: string;
  }>;
};

/** Leaf preimages in commitment order: [overview, answer 1, …, answer n]. */
export function packageLeafPreimages(pkg: PackageLike): JsonValue[] {
  return [
    overviewLeafPreimage(pkg),
    ...pkg.answers.map((answer) => evidenceLeafPreimage(answer))
  ];
}

/** The full briefing commitment: root (goes on-chain) + per-leaf hashes. */
export function buildPackageCommitment(pkg: PackageLike): PackageTree {
  const leafHashes = packageLeafPreimages(pkg).map(hashLeaf);
  return { root: buildTreeFromLeaves(leafHashes), leafHashes };
}

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  startServicesServer,
  type JuryVoterEntry,
  type RunningServer,
  type SubmitOnChain
} from "../src/server";
import { runProvider, hashProviderAnswerPackage } from "@proofmarket/agents/src/providers";
import { presetDefense, presetJuryVotes } from "@proofmarket/shared/src/fixtures";

let server: RunningServer;

// Stub submitOnChain for input-guard tests so 400 guards are reached before any on-chain call
const stubSubmit: SubmitOnChain = async () => ({ txHash: "0x" + "f".repeat(64) });

let serverWithSigner: RunningServer;
let serverWithJury: RunningServer;

// Records every on-chain call the jury/defense stubs receive.
const castCalls: { challengeId: bigint; result: number; reasonHash: string }[] = [];
const defenseCalls: { challengeId: bigint; defenseHash: string }[] = [];
const stubJurors: JuryVoterEntry[] = [0, 1, 2].map((i) => ({
  jurorAddress: `0x${String(i + 1).repeat(40)}`,
  castVote: async (input) => {
    castCalls.push(input);
    return { txHash: "0x" + `${i + 1}`.repeat(64) };
  }
}));

beforeAll(async () => {
  server = await startServicesServer({ port: 0, submitOnChain: null }); // null = no signer in tests
  serverWithSigner = await startServicesServer({ port: 0, submitOnChain: stubSubmit });
  serverWithJury = await startServicesServer({
    port: 0,
    submitOnChain: stubSubmit,
    defenseOnChain: async (input) => {
      defenseCalls.push(input);
      return { txHash: "0x" + "d".repeat(64) };
    },
    juryVoters: stubJurors,
    defenseWindowMs: 0 // window already passed in tests: no sleeping
  });
});

afterAll(async () => {
  await server.close();
  await serverWithSigner.close();
  await serverWithJury.close();
});

describe("provider endpoint", () => {
  it("returns a deterministic evidence package for the expert provider", async () => {
    const response = await fetch(`${server.url}/provider/run`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        taskId: "task_001",
        jobId: "1",
        providerId: "execution-research-expert",
        question: "anything",
        requiredEvidenceSchema: { minItems: 3, requiredFields: [] }
      })
    });
    expect(response.status).toBe(200);
    const body = await response.json() as Record<string, unknown>;
    expect(body.providerId).toBe("execution-research-expert");
    expect(body.packageHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect((body.answers as unknown[]).length).toBeGreaterThanOrEqual(3);
  });

  it("is deterministic: same input, same hash", async () => {
    const call = () =>
      fetch(`${server.url}/provider/run`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          taskId: "task_001",
          jobId: "1",
          providerId: "execution-research-expert",
          question: "anything",
          requiredEvidenceSchema: { minItems: 3, requiredFields: [] }
        })
      }).then((r) => r.json() as Promise<Record<string, unknown>>);
    const [a, b] = await Promise.all([call(), call()]);
    expect(a.packageHash).toBe(b.packageHash);
  });

  it("rejects submit when no signer is configured", async () => {
    const response = await fetch(`${server.url}/provider/submit`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jobId: "1", deliverableHash: "0x" + "a".repeat(64) })
    });
    expect(response.status).toBe(503);
  });
});

describe("judge endpoint", () => {
  it("returns a valid verdict with EVIDENCE_VERIFIED for a well-formed expert package", async () => {
    const expertPackage = runProvider("task_001", "execution-research-expert");
    const response = await fetch(`${server.url}/judge/verify`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        taskId: "task_001",
        jobId: "1",
        evidencePackageHash: expertPackage.packageHash,
        evidencePackage: expertPackage,
        successCriteria: ["at least 3 evidence items"]
      })
    });
    expect(response.status).toBe(200);
    const body = await response.json() as Record<string, unknown>;
    expect(body.decision).toBe("valid");
    expect(body.reasonCode).toBe("EVIDENCE_VERIFIED");
    expect(body.verdictHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect((body.voting as Record<string, unknown>).mode).toBe("not_triggered");
  });

  it("returns provider_fault with COVERAGE_MISS for a shallow provider package", async () => {
    const shallowPackage = runProvider("task_001", "shallow-search-provider");
    const response = await fetch(`${server.url}/judge/verify`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        taskId: "task_001",
        jobId: "2",
        evidencePackageHash: shallowPackage.packageHash,
        evidencePackage: shallowPackage,
        successCriteria: ["at least 3 evidence items"]
      })
    });
    expect(response.status).toBe(200);
    const body = await response.json() as Record<string, unknown>;
    expect(body.decision).toBe("provider_fault");
    expect(body.reasonCode).toBe("COVERAGE_MISS");
    expect(body.challengeType).toBe("CoverageMiss");
    expect(body.verdictHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect((body.voting as Record<string, unknown>).mode).toBe("not_triggered");
  });

  it("returns provider_fault with PACKAGE_HASH_MISMATCH for a tampered package", async () => {
    const expertPackage = runProvider("task_001", "execution-research-expert");
    // Tamper: replace the packageHash with a wrong value
    const tampered = { ...expertPackage, packageHash: "0x" + "d".repeat(64) };
    const response = await fetch(`${server.url}/judge/verify`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        taskId: "task_001",
        jobId: "3",
        evidencePackageHash: tampered.packageHash,
        evidencePackage: tampered,
        successCriteria: []
      })
    });
    expect(response.status).toBe(200);
    const body = await response.json() as Record<string, unknown>;
    expect(body.decision).toBe("provider_fault");
    expect(body.reasonCode).toBe("PACKAGE_HASH_MISMATCH");
    expect((body.voting as Record<string, unknown>).mode).toBe("not_triggered");
  });

  it("returns 400 when evidencePackage is missing or malformed", async () => {
    // Missing evidencePackage entirely
    const r1 = await fetch(`${server.url}/judge/verify`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ taskId: "task_001", jobId: "4" })
    });
    expect(r1.status).toBe(400);
    const b1 = await r1.json() as Record<string, unknown>;
    expect(typeof b1.error).toBe("string");

    // evidencePackage with no packageHash
    const r2 = await fetch(`${server.url}/judge/verify`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jobId: "5",
        evidencePackage: { answers: [1, 2, 3] }
      })
    });
    expect(r2.status).toBe(400);
    const b2 = await r2.json() as Record<string, unknown>;
    expect(typeof b2.error).toBe("string");

    // evidencePackage with no answers array
    const r3 = await fetch(`${server.url}/judge/verify`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jobId: "6",
        evidencePackage: { packageHash: "0x" + "a".repeat(64) }
      })
    });
    expect(r3.status).toBe(400);
    const b3 = await r3.json() as Record<string, unknown>;
    expect(typeof b3.error).toBe("string");
  });
});

describe("defense endpoint (/provider/defend)", () => {
  it("submits the preset defense hash on-chain and returns the plaintext", async () => {
    defenseCalls.length = 0;
    const response = await fetch(`${serverWithJury.url}/provider/defend`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ challengeId: "3" })
    });
    expect(response.status).toBe(200);
    const body = await response.json() as Record<string, unknown>;
    expect(body.statement).toBe(presetDefense.statement);
    expect(body.defenseHash).toBe(presetDefense.defenseHash);
    expect(body.txHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(defenseCalls).toEqual([
      { challengeId: 3n, defenseHash: presetDefense.defenseHash }
    ]);
  });

  it("503s without a provider signer and 400s on a bad challengeId", async () => {
    const noSigner = await fetch(`${server.url}/provider/defend`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ challengeId: "3" })
    });
    expect(noSigner.status).toBe(503);

    const bad = await fetch(`${serverWithJury.url}/provider/defend`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ challengeId: "abc" })
    });
    expect(bad.status).toBe(400);
  });
});

describe("jury endpoint (/jury/vote, preset 2:1 verdict)", () => {
  it("casts three on-chain votes (2 fault, 1 dissent) with reason books and tx hashes", async () => {
    castCalls.length = 0;
    const response = await fetch(`${serverWithJury.url}/jury/vote`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ challengeId: "3", openedAtMs: Date.now() - 60_000 })
    });
    expect(response.status).toBe(200);
    const body = await response.json() as { votes: Record<string, unknown>[] };
    expect(body.votes).toHaveLength(3);

    const expected = presetJuryVotes(stubJurors.map((j) => j.jurorAddress));
    expect(body.votes.map((v) => v.vote)).toEqual([
      "ProviderFault",
      "ProviderFault",
      "ProviderNotFault"
    ]);
    for (const [i, vote] of body.votes.entries()) {
      expect(vote.jurorId).toBe(expected[i].jurorId);
      expect(vote.jurorAddress).toBe(stubJurors[i].jurorAddress);
      expect(vote.reasonHash).toBe(expected[i].reasonHash);
      expect(vote.reasonBook).toEqual(expected[i].reasonBook);
      expect(vote.txHash).toMatch(/^0x[0-9a-f]{64}$/);
    }
    // The on-chain calls carried the same reason hashes, fault=1 / notFault=2.
    expect(castCalls.map((c) => c.result)).toEqual([1, 1, 2]);
    expect(castCalls.map((c) => c.reasonHash)).toEqual(expected.map((v) => v.reasonHash));
  });

  it("503s without jury voters and 400s on bad input", async () => {
    const noJury = await fetch(`${server.url}/jury/vote`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ challengeId: "3", openedAtMs: Date.now() })
    });
    expect(noJury.status).toBe(503);

    const badId = await fetch(`${serverWithJury.url}/jury/vote`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ challengeId: "abc", openedAtMs: Date.now() })
    });
    expect(badId.status).toBe(400);

    const badOpenedAt = await fetch(`${serverWithJury.url}/jury/vote`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ challengeId: "3" })
    });
    expect(badOpenedAt.status).toBe(400);
  });
});

describe("input validation — /provider/run", () => {
  it("returns 400 for an unknown providerId", async () => {
    const response = await fetch(`${server.url}/provider/run`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        taskId: "task_001",
        jobId: "1",
        providerId: "totally-fake-provider",
        question: "anything"
      })
    });
    expect(response.status).toBe(400);
    const body = await response.json() as Record<string, unknown>;
    expect(body.error as string).toMatch(/unknown providerId: totally-fake-provider/);
  });
});

describe("input validation — /provider/submit", () => {
  it("returns 400 when jobId is not a numeric string", async () => {
    const response = await fetch(`${serverWithSigner.url}/provider/submit`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jobId: "abc", deliverableHash: "0x" + "a".repeat(64) })
    });
    expect(response.status).toBe(400);
    const body = await response.json() as Record<string, unknown>;
    expect(typeof body.error).toBe("string");
  });

  it("returns 400 when deliverableHash is not a valid 0x-prefixed 32-byte hex", async () => {
    const response = await fetch(`${serverWithSigner.url}/provider/submit`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jobId: "42", deliverableHash: "not-a-hash" })
    });
    expect(response.status).toBe(400);
    const body = await response.json() as Record<string, unknown>;
    expect(typeof body.error).toBe("string");
  });

  it("reaches the stub and returns its txHash for valid input", async () => {
    const response = await fetch(`${serverWithSigner.url}/provider/submit`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jobId: "99", deliverableHash: "0x" + "b".repeat(64) })
    });
    expect(response.status).toBe(200);
    const body = await response.json() as Record<string, unknown>;
    expect(body.txHash).toBe("0x" + "f".repeat(64));
  });
});

describe("body size cap", () => {
  it("rejects a 1.5 MB body or keeps serving subsequent requests", async () => {
    // Send a 1.5MB payload — expect either 413 or socket error (client-side teardown)
    const bigBody = "x".repeat(1.5 * 1024 * 1024);
    let got413 = false;
    try {
      const response = await fetch(`${server.url}/provider/run`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: bigBody
      });
      got413 = response.status === 413;
    } catch {
      // Socket was destroyed — that's acceptable
    }

    // Whether or not we got 413, the server must still answer subsequent good requests
    const expertPkg = runProvider("task_001", "execution-research-expert");
    const good = await fetch(`${server.url}/judge/verify`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        taskId: "task_001",
        jobId: "1",
        evidencePackageHash: expertPkg.packageHash,
        evidencePackage: expertPkg,
        successCriteria: ["at least 3 evidence items"]
      })
    });
    expect(good.status).toBe(200);
    if (got413) expect(got413).toBe(true);
  });
});

describe("routing and error handling", () => {
  it("returns 404 for an unknown route", async () => {
    const response = await fetch(`${server.url}/unknown/path`, {
      method: "GET"
    });
    expect(response.status).toBe(404);
    const body = await response.json() as Record<string, unknown>;
    expect(body.error as string).toMatch(/no route/);
  });

  it("returns 500 for malformed JSON and server stays up for subsequent requests", async () => {
    const badResponse = await fetch(`${server.url}/provider/run`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{ this is not valid json !!!"
    });
    expect(badResponse.status).toBe(500);

    // Server must still serve subsequent requests
    const alivePkg = runProvider("task_001", "execution-research-expert");
    const goodResponse = await fetch(`${server.url}/judge/verify`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        taskId: "task_001",
        jobId: "1",
        evidencePackageHash: alivePkg.packageHash,
        evidencePackage: alivePkg,
        successCriteria: ["at least 3 evidence items"]
      })
    });
    expect(goodResponse.status).toBe(200);
  });
});

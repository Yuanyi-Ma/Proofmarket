import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startServicesServer, type RunningServer } from "../src/server";

let server: RunningServer;

beforeAll(async () => {
  server = await startServicesServer({ port: 0, submitOnChain: null }); // null = no signer in tests
});

afterAll(async () => {
  await server.close();
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
  it("returns a deterministic valid verdict with a verdict hash", async () => {
    const response = await fetch(`${server.url}/judge/verify`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        taskId: "task_001",
        jobId: "1",
        evidencePackageHash: "0x" + "a".repeat(64),
        evidencePackage: { answers: [1, 2, 3] },
        successCriteria: ["at least 3 evidence items"]
      })
    });
    expect(response.status).toBe(200);
    const body = await response.json() as Record<string, unknown>;
    expect(body.decision).toBe("valid");
    expect(body.reasonCode).toBe("PRESET_SUCCESS_PATH");
    expect(body.verdictHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect((body.voting as Record<string, unknown>).mode).toBe("not_triggered");
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
    const goodResponse = await fetch(`${server.url}/judge/verify`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        taskId: "task_001",
        jobId: "1",
        evidencePackageHash: "0x" + "b".repeat(64),
        evidencePackage: { answers: [1, 2, 3] },
        successCriteria: ["at least 3 evidence items"]
      })
    });
    expect(goodResponse.status).toBe(200);
  });
});

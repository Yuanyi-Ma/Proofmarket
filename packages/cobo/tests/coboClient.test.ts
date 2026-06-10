import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildRealPactSubmission } from "../src/pactPolicy";
import { createCliCoboClient } from "../src/coboClient";

function fakeCaw(script: string): string {
  const dir = mkdtempSync(join(tmpdir(), "fake-caw-"));
  const file = join(dir, "caw");
  writeFileSync(file, `#!/bin/bash\n${script}`);
  chmodSync(file, 0o755);
  return dir;
}

const submission = buildRealPactSubmission({
  escrowAddress: "0x" + "4".repeat(40),
  tokenAddress: "0x" + "3".repeat(40),
  budgetAmount: "5",
  taskId: "task_001"
});

describe("createCliCoboClient", () => {
  it("submits a pact and returns the pact id", async () => {
    const dir = fakeCaw(`echo '{"pact_id":"p-123","status":"pending_approval"}'`);
    const client = createCliCoboClient({ pathPrepend: dir });
    const result = await client.submitPact(submission);
    expect(result.pactId).toBe("p-123");
    expect(result.raw).toContain("p-123");
  });

  it("unwraps the real caw envelope {message, result, success}", async () => {
    const dir = fakeCaw(
      `echo '{"message":"","result":{"pact_id":"p-real","status":"active","message":"Pact submitted and auto-approved for unpaired agent."},"success":true}'`
    );
    const client = createCliCoboClient({ pathPrepend: dir });
    const result = await client.submitPact(submission);
    expect(result.pactId).toBe("p-real");
    expect(result.status).toBe("active");
  });

  it("passes required flags to pact submit", async () => {
    const dir = fakeCaw(`echo "$@" > "$0.args"; echo '{"pact_id":"p-1"}'`);
    const client = createCliCoboClient({ pathPrepend: dir });
    await client.submitPact(submission);
    const { readFileSync } = await import("node:fs");
    const args = readFileSync(join(dir, "caw.args"), "utf8");
    expect(args).toContain("pact submit");
    expect(args).toContain("--intent");
    expect(args).toContain("--execution-plan");
    expect(args).toContain("--policies");
    expect(args).toContain("--completion-conditions");
  });

  it("reads pact status", async () => {
    const dir = fakeCaw(`echo '{"pact_id":"p-123","status":"active"}'`);
    const client = createCliCoboClient({ pathPrepend: dir });
    const status = await client.getPactStatus("p-123");
    expect(status.status).toBe("active");
  });

  it("submits a contract call and returns the tx record id", async () => {
    const dir = fakeCaw(`echo '{"tx_id":"tx-9","status":"submitted"}'`);
    const client = createCliCoboClient({ pathPrepend: dir });
    const result = await client.callContract({
      pactId: "p-123",
      contract: "0x" + "4".repeat(40),
      calldata: "0xdeadbeef",
      requestId: "task_001-createJob",
      description: "createJob"
    });
    expect(result.coboTxId).toBe("tx-9");
  });

  it("passes --src-address to tx call when srcAddress is configured", async () => {
    const dir = fakeCaw(`echo "$@" > "$0.args"; echo '{"tx_id":"tx-1"}'`);
    const client = createCliCoboClient({ pathPrepend: dir, srcAddress: "0x" + "e".repeat(40) });
    await client.callContract({
      pactId: "p-1",
      contract: "0x" + "4".repeat(40),
      calldata: "0x00",
      requestId: "r",
      description: "approve"
    });
    const { readFileSync } = await import("node:fs");
    const args = readFileSync(join(dir, "caw.args"), "utf8");
    expect(args).toContain("--src-address");
    expect(args).toContain("0x" + "e".repeat(40));
  });

  it("omits --src-address when not configured", async () => {
    const dir = fakeCaw(`echo "$@" > "$0.args"; echo '{"tx_id":"tx-1"}'`);
    const client = createCliCoboClient({ pathPrepend: dir });
    await client.callContract({
      pactId: "p-1",
      contract: "0x" + "4".repeat(40),
      calldata: "0x00",
      requestId: "r",
      description: "approve"
    });
    const { readFileSync } = await import("node:fs");
    const args = readFileSync(join(dir, "caw.args"), "utf8");
    expect(args).not.toContain("--src-address");
  });

  it("maps exit code 5 to a denial record instead of throwing", async () => {
    const dir = fakeCaw(`echo '{"error":"policy denied: no matching policy"}' >&2; exit 5`);
    const client = createCliCoboClient({ pathPrepend: dir });
    const denial = await client.attemptDeniedTransfer({
      pactId: "p-123",
      dstAddress: "0x" + "d".repeat(40),
      amount: "0.001"
    });
    expect(denial.denied).toBe(true);
    expect(denial.exitCode).toBe(5);
    expect(denial.rawOutput).toContain("policy denied");
  });

  it("throws on non-policy errors", async () => {
    const dir = fakeCaw(`echo 'network broke' >&2; exit 7`);
    const client = createCliCoboClient({ pathPrepend: dir });
    await expect(
      client.callContract({
        pactId: "p-1",
        contract: "0x" + "4".repeat(40),
        calldata: "0x00",
        requestId: "r",
        description: "d"
      })
    ).rejects.toThrow(/exit 7/);
  });

  // C1: exit 7 during attemptDeniedTransfer must reject, not return a denial record
  it("rejects when attemptDeniedTransfer exits 7 (not a policy denial)", async () => {
    const dir = fakeCaw(`echo 'network broke' >&2; exit 7`);
    const client = createCliCoboClient({ pathPrepend: dir });
    await expect(
      client.attemptDeniedTransfer({
        pactId: "p-1",
        dstAddress: "0x" + "d".repeat(40),
        amount: "0.001"
      })
    ).rejects.toThrow(/exit 7/);
    await expect(
      client.attemptDeniedTransfer({
        pactId: "p-1",
        dstAddress: "0x" + "d".repeat(40),
        amount: "0.001"
      })
    ).rejects.toThrow(/not a policy denial/);
  });

  // C1: exit 0 during attemptDeniedTransfer must throw DENIAL DEMO FAILED OPEN
  it("throws DENIAL DEMO FAILED OPEN when attemptDeniedTransfer exits 0", async () => {
    const dir = fakeCaw(`echo '{"tx_id":"tx-bad","status":"submitted"}'`);
    const client = createCliCoboClient({ pathPrepend: dir });
    await expect(
      client.attemptDeniedTransfer({
        pactId: "p-1",
        dstAddress: "0x" + "d".repeat(40),
        amount: "0.001"
      })
    ).rejects.toThrow(/DENIAL DEMO FAILED OPEN/);
  });

  // I1 (timeout): fake caw script that sleeps; timeoutMs: 100 causes a timeout error
  it("surfaces a clear timeout message when caw takes too long", async () => {
    const dir = fakeCaw(`sleep 2`);
    const client = createCliCoboClient({ pathPrepend: dir, timeoutMs: 100 });
    await expect(
      client.callContract({
        pactId: "p-1",
        contract: "0x" + "4".repeat(40),
        calldata: "0x00",
        requestId: "r",
        description: "d"
      })
    ).rejects.toThrow(/timed out after 100ms/);
  });

  // I1 (ENOENT): Cannot reliably test ENOENT via pathPrepend alone because the real
  // caw binary remains available later on PATH, meaning execFile will find it there
  // and never emit ENOENT. The ENOENT branch in runCaw (effectiveStderr rewrite) is
  // covered by code inspection; a deterministic test would require controlling the
  // entire PATH at exec-time, which conflicts with the test environment setup.
});

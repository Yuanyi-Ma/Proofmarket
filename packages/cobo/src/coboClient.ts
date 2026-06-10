import { execFile } from "node:child_process";

import type { RealPactSubmission } from "./pactPolicy";

export type CoboClientOptions = {
  pathPrepend?: string; // tests inject a fake caw directory
  timeoutMs?: number;
  // Source wallet address for on-chain ops. Cobo's server-side auto-select of
  // the highest-balance address is not reliable in every environment, so we
  // pass --src-address explicitly when this is set (the Cobo wallet address).
  srcAddress?: string;
};

export type PactSubmitResult = { pactId: string; status: string; raw: string };
export type PactStatusResult = { pactId: string; status: string; raw: string };
export type ContractCallResult = { coboTxId: string; status: string; raw: string };
export type DenialResult = {
  denied: true;
  exitCode: number;
  attemptedAction: string;
  rawOutput: string;
};

export interface CoboClient {
  submitPact(submission: RealPactSubmission): Promise<PactSubmitResult>;
  getPactStatus(pactId: string): Promise<PactStatusResult>;
  callContract(input: {
    pactId: string;
    contract: string;
    calldata: string;
    requestId: string;
    description: string;
  }): Promise<ContractCallResult>;
  getTx(coboTxId: string): Promise<{ raw: string; parsed: Record<string, unknown> }>;
  attemptDeniedTransfer(input: {
    pactId: string;
    dstAddress: string;
    amount: string;
  }): Promise<DenialResult>;
}

type RunResult = { stdout: string; stderr: string; exitCode: number };

function runCaw(args: string[], options: CoboClientOptions): Promise<RunResult> {
  const env = { ...process.env };
  if (options.pathPrepend) env.PATH = `${options.pathPrepend}:${env.PATH}`;
  return new Promise((resolve) => {
    execFile(
      "caw",
      args,
      { env, timeout: options.timeoutMs ?? 120_000 },
      (error, stdout, stderr) => {
        const rawCode = (error as NodeJS.ErrnoException | null)?.code;
        const exitCode = typeof rawCode === "number" ? rawCode : error ? 1 : 0;
        const timedOut = (error as { killed?: boolean } | null)?.killed === true;
        let effectiveStderr = stderr ?? "";
        if (rawCode === "ENOENT") {
          effectiveStderr = `caw not found on PATH (ENOENT): ${error?.message ?? ""}`;
        } else if (timedOut) {
          effectiveStderr = `caw timed out after ${options.timeoutMs ?? 120_000}ms (SIGTERM)`;
        }
        resolve({ stdout: stdout ?? "", stderr: effectiveStderr, exitCode });
      }
    );
  });
}

function parseLooseJson(raw: string): Record<string, unknown> {
  let parsed: Record<string, unknown> = {};
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    const match = raw.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        parsed = JSON.parse(match[0]) as Record<string, unknown>;
      } catch {
        /* fall through */
      }
    }
  }
  // caw wraps payloads as {message, result: {...}, success} — unwrap when present
  if (parsed.result && typeof parsed.result === "object" && !Array.isArray(parsed.result)) {
    return { ...parsed, ...(parsed.result as Record<string, unknown>) };
  }
  return parsed;
}

function pickString(obj: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === "string" && value) return value;
  }
  return "";
}

export function createCliCoboClient(options: CoboClientOptions = {}): CoboClient {
  async function expectSuccess(args: string[], action: string): Promise<RunResult> {
    const result = await runCaw(args, options);
    if (result.exitCode !== 0) {
      throw new Error(
        `caw ${action} failed with exit ${result.exitCode}: ${result.stderr || result.stdout}`
      );
    }
    return result;
  }

  return {
    async submitPact(submission) {
      const result = await expectSuccess(
        [
          "pact",
          "submit",
          "--intent",
          submission.intent,
          "--execution-plan",
          submission.executionPlan,
          "--policies",
          JSON.stringify(submission.policies),
          "--completion-conditions",
          JSON.stringify(submission.completionConditions)
        ],
        "pact submit"
      );
      const parsed = parseLooseJson(result.stdout);
      const pactId = pickString(parsed, ["pact_id", "pactId", "id"]);
      if (!pactId) throw new Error(`caw pact submit returned no pact id: ${result.stdout}`);
      return { pactId, status: pickString(parsed, ["status"]), raw: result.stdout };
    },

    async getPactStatus(pactId) {
      const result = await expectSuccess(
        ["pact", "status", "--pact-id", pactId],
        "pact status"
      );
      const parsed = parseLooseJson(result.stdout);
      return {
        pactId,
        status: pickString(parsed, ["status", "state"]),
        raw: result.stdout
      };
    },

    async callContract(input) {
      const result = await expectSuccess(
        [
          "tx",
          "call",
          "--pact-id",
          input.pactId,
          "--chain-id",
          "SETH",
          "--contract",
          input.contract,
          "--calldata",
          input.calldata,
          "--request-id",
          input.requestId,
          "--description",
          input.description,
          ...(options.srcAddress ? ["--src-address", options.srcAddress] : [])
        ],
        "tx call"
      );
      const parsed = parseLooseJson(result.stdout);
      const coboTxId = pickString(parsed, ["tx_id", "txId", "transaction_id", "id"]);
      if (!coboTxId) throw new Error(`caw tx call returned no tx id: ${result.stdout}`);
      return { coboTxId, status: pickString(parsed, ["status"]), raw: result.stdout };
    },

    async getTx(coboTxId) {
      const result = await expectSuccess(["tx", "get", "--tx-id", coboTxId], "tx get");
      return { raw: result.stdout, parsed: parseLooseJson(result.stdout) };
    },

    async attemptDeniedTransfer(input) {
      const args = [
        "tx",
        "transfer",
        "--pact-id",
        input.pactId,
        "--chain-id",
        "SETH",
        "--token-id",
        "SETH",
        "--dst-address",
        input.dstAddress,
        "--amount",
        input.amount,
        ...(options.srcAddress ? ["--src-address", options.srcAddress] : [])
      ];
      const POLICY_DENIAL_EXIT = 5;
      const result = await runCaw(args, options);
      if (result.exitCode === POLICY_DENIAL_EXIT) {
        return {
          denied: true,
          exitCode: result.exitCode,
          attemptedAction: `tx transfer ${input.amount} SETH -> ${input.dstAddress}`,
          rawOutput: result.stderr || result.stdout
        };
      }
      if (result.exitCode === 0) {
        throw new Error(
          `DENIAL DEMO FAILED OPEN: caw allowed a transfer that must be denied. Output: ${result.stdout}`
        );
      }
      throw new Error(
        `caw tx transfer failed with unexpected exit ${result.exitCode} (not a policy denial): ${result.stderr || result.stdout}`
      );
    }
  };
}

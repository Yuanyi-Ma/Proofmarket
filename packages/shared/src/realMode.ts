export const SEPOLIA_CHAIN_ID = 11155111;
export const ALLOWED_CHAIN_ACTIONS = [
  "createJob",
  "fund",
  "submitEvidenceHash",
  "complete"
] as const;
export type ChainAction = (typeof ALLOWED_CHAIN_ACTIONS)[number];

export type ProviderEntry = {
  address: string;
  mintedUsdc: string;
  stakedAmount: string;
  stakePending: boolean;
  stakePendingReason?: string;
  // ── Optional P1-1 fields (ERC-8004 registration) ──────────────────────────
  /** ERC-8004 agentId (ERC-721 tokenId) on the official IdentityRegistry. */
  agentId?: number;
  /** agentURI stored at registration (returned by tokenURI). */
  agentURI?: string;
};

export type DeploymentArtifact = {
  chainId: number;
  network: string;
  deployer: string;
  blockNumber: number;
  coboWallet: string;
  contracts: {
    MockUSDC: string;
    ProofMarketEscrow: string;
    /** Present in artifacts produced by the P0-2 deploy script and later. */
    ProofMarketChallengeManager?: string;
  };
  mint: { to: string; rawAmount: string; txHash: string };
  deployedAt: string;
  // ── Optional P0-2 fields ──────────────────────────────────────────────────
  /** Constructor parameters used for ProofMarketChallengeManager. */
  challengeManagerParams?: {
    minStake: string;
    challengeDeposit: string;
    slashBps: string;
    slashRewardBps: string;
  };
  /** Resolver address (backend/verifier in demo). */
  resolver?: string;
  /** Protocol treasury address. */
  treasury?: string;
  /** Challenger account that was funded for the challenge-path demo. */
  challenger?: { address: string; mintedUsdc: string };
  /** Per-provider stake information keyed by provider id. */
  providers?: Record<string, ProviderEntry>;
  // ── Optional P1-1 section ─────────────────────────────────────────────────
  /** Official ERC-8004 registry proxy addresses used for registration. */
  erc8004?: {
    identityRegistry: string;
    reputationRegistry: string;
  };
};

export type ResearchPlanOutput = {
  taskId: string;
  recommendedProviderId: string;
  reason: string;
  maxPayment: string;
  requiredEvidenceSchema: { minItems: number; requiredFields: string[] };
  chainActions: ChainAction[];
};

export type TxRecord = {
  label:
    | "approve"
    | "createJob"
    | "setBudget"
    | "fund"
    | "submit"
    | "complete"
    // Challenge path: deposit approval + openChallenge go through Cobo,
    // resolve is signed directly by the resolver key.
    | "approveDeposit"
    | "openChallenge"
    | "resolve"
    // ERC-8004 reputation feedback after settle/refundOrSlash, signed directly
    // by the rater key (PROVIDER_SIGNER), not Cobo.
    | "feedback";
  coboTxId: string | null;
  txHash: string;
  status: "pending" | "confirmed" | "failed";
};

export type CoboDenialRecord = {
  denied: true;
  exitCode: number;
  attemptedAction: string;
  rawOutput: string;
};

function isHexAddress(value: unknown): value is string {
  return typeof value === "string" && /^0x[0-9a-fA-F]{40}$/.test(value);
}

export function parseDeploymentArtifact(input: unknown): DeploymentArtifact {
  const a = input as DeploymentArtifact;
  if (!a || typeof a !== "object") throw new Error("artifact must be an object");
  if (a.chainId !== SEPOLIA_CHAIN_ID) {
    throw new Error(`artifact chainId must be ${SEPOLIA_CHAIN_ID}, got ${a.chainId}`);
  }
  // Required addresses — always present.
  for (const [name, addr] of [
    ["deployer", a.deployer],
    ["coboWallet", a.coboWallet],
    ["contracts.MockUSDC", a.contracts?.MockUSDC],
    ["contracts.ProofMarketEscrow", a.contracts?.ProofMarketEscrow]
  ] as const) {
    if (!isHexAddress(addr)) throw new Error(`artifact ${name} is not a valid address`);
  }
  // Optional P0-2 fields: validate address shape when present.
  const cm = a.contracts?.ProofMarketChallengeManager;
  if (cm !== undefined && !isHexAddress(cm)) {
    throw new Error("artifact contracts.ProofMarketChallengeManager is not a valid address");
  }
  if (a.resolver !== undefined && !isHexAddress(a.resolver)) {
    throw new Error("artifact resolver is not a valid address");
  }
  if (a.treasury !== undefined && !isHexAddress(a.treasury)) {
    throw new Error("artifact treasury is not a valid address");
  }
  if (a.challenger !== undefined && !isHexAddress(a.challenger.address)) {
    throw new Error("artifact challenger.address is not a valid address");
  }
  if (a.providers !== undefined) {
    for (const [id, entry] of Object.entries(a.providers)) {
      if (!isHexAddress(entry.address)) {
        throw new Error(`artifact providers["${id}"].address is not a valid address`);
      }
      // Optional P1-1 fields: validate shape when present (lenient when absent).
      if (entry.agentId !== undefined && !Number.isInteger(entry.agentId)) {
        throw new Error(`artifact providers["${id}"].agentId must be an integer`);
      }
      if (entry.agentURI !== undefined && typeof entry.agentURI !== "string") {
        throw new Error(`artifact providers["${id}"].agentURI must be a string`);
      }
    }
  }
  // Optional P1-1 section: ERC-8004 registry addresses.
  if (a.erc8004 !== undefined) {
    if (!isHexAddress(a.erc8004.identityRegistry)) {
      throw new Error("artifact erc8004.identityRegistry is not a valid address");
    }
    if (!isHexAddress(a.erc8004.reputationRegistry)) {
      throw new Error("artifact erc8004.reputationRegistry is not a valid address");
    }
  }
  return a;
}

const ADDRESS_PATTERN = /0x[0-9a-fA-F]{40}(?![0-9a-fA-F])/;

export function validateResearchPlanOutput(
  input: unknown,
  context: { taskId: string; budgetAmount: string; providerIds: string[] }
): ResearchPlanOutput {
  const p = input as ResearchPlanOutput;
  if (!p || typeof p !== "object") throw new Error("plan must be an object");
  if (p.taskId !== context.taskId) throw new Error("plan taskId mismatch");
  if (!context.providerIds.includes(p.recommendedProviderId)) {
    throw new Error(`unknown provider: ${p.recommendedProviderId}`);
  }
  if (typeof p.reason !== "string" || p.reason.length === 0) {
    throw new Error("plan reason required");
  }
  const payment = Number(p.maxPayment);
  if (!Number.isFinite(payment) || payment <= 0) {
    throw new Error(`maxPayment must be a positive finite number, got "${p.maxPayment}"`);
  }
  if (payment > Number(context.budgetAmount)) {
    throw new Error(`maxPayment ${p.maxPayment} exceeds budget ${context.budgetAmount}`);
  }
  if (!Array.isArray(p.chainActions)) {
    throw new Error("chainActions contains a disallowed action");
  }
  if (p.chainActions.length === 0 || !p.chainActions.every((action) =>
    (ALLOWED_CHAIN_ACTIONS as readonly string[]).includes(action)
  )) {
    throw new Error(
      p.chainActions.length === 0
        ? "chainActions must not be empty"
        : "chainActions contains a disallowed action"
    );
  }
  const schema = p.requiredEvidenceSchema;
  if (!schema || typeof schema.minItems !== "number" || !Array.isArray(schema.requiredFields)) {
    throw new Error("requiredEvidenceSchema malformed");
  }
  if (ADDRESS_PATTERN.test(JSON.stringify(p))) {
    throw new Error("plan output must not contain contract addresses");
  }
  return p;
}

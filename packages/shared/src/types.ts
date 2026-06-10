export type TaskStatus =
  | "Created"
  | "Planned"
  | "PactSubmitted"
  | "PactActive"
  | "PactRejected"
  | "JobFunded"
  | "DeniedByCobo"
  | "Delivered"
  | "Verified"
  | "Challenged"
  | "ChallengeWon"
  | "ChallengeLost"
  | "RefundedOrSlashed"
  | "Settled"
  | "Audited";

export type AuditSource =
  | "user"
  | "research-agent"
  | "provider"
  | "verifier"
  | "cobo"
  | "chain"
  | "settlement";

export type AuditResult = "success" | "pending" | "denied" | "failed";

export type ProviderId =
  | "execution-research-expert"
  | "shallow-search-provider"
  | "general-web-summary";

export type EvidenceItem = {
  providerAnswer: string;
  sourceTitle: string;
  sourceLocator: string;
  sourceMetadata: {
    year: number;
    type: "paper" | "report" | "chain-data";
  };
  excerptOrSummary: string;
  relevanceExplanation: string;
};

export type ProviderAnswerPackage = {
  taskId: string;
  providerAgentId: number;
  providerId: ProviderId;
  providerName: string;
  coverageStatement: string;
  answers: EvidenceItem[];
  packageHash: string;
};

export type ProviderProfile = {
  id: ProviderId;
  agentId: number;
  name: string;
  role: "recommended" | "risky" | "comparison";
  coverage: string;
  price: string;
  stake: string;
  reputationScore: number;
  challengeHistory: string;
  demoBehavior: "happy" | "challenge" | "unused";
};

export type ProviderReputation = {
  providerId: ProviderId;
  /** Display score on the fixture 0-1000 scale (e.g. on-chain 4.80/5.00 → 960). */
  score: number;
  /** Where the score came from: live ERC-8004 read, or the local fixture fallback. */
  source: "erc8004" | "fixture";
};

export type ProcurementPlan = {
  taskId: string;
  userQuestion: string;
  evidenceNeed: string;
  totalBudget: string;
  perJobCap: string;
  recommendedProviderId: ProviderId;
  providerCount: 3;
  coverage: string;
  returnType: "provider-answer-package";
  verificationMethod: string;
  /**
   * Real mode only: per-provider reputation read from the ERC-8004
   * ReputationRegistry at plan time (fixture fallback per provider on read
   * failure). Absent in fixture mode — the front-end keeps the local
   * providerProfiles score there.
   */
  providerReputations?: ProviderReputation[];
};

export type PactSummary = {
  intent: string;
  totalBudget: string;
  perJobCap: string;
  allowedTargets: string[];
  allowedFunctions: string[];
  denyRules: string[];
  expiresInMinutes: number;
  pactId: string;
  status: "draft" | "submitted" | "active" | "rejected";
};

export type AuditEvent = {
  id: string;
  taskId: string;
  source: AuditSource;
  type: string;
  result: AuditResult;
  message: string;
  txHash: string | null;
  pactId: string | null;
  jobId: number | null;
  createdAt: string;
};

export type ChallengeVote = {
  voterId: string;
  vote: "ProviderFault";
  reasonCode: string;
  reason: string;
  resultHash: string;
};

export type TaskChallenge = {
  type: "CoverageMiss";
  counterEvidenceHash: string;
  /** On-chain challenge id from ChallengeManager.openChallenge (real mode). */
  challengeId?: number | null;
  vote?: ChallengeVote | null;
  /** Settlement tx of ChallengeManager.resolve (real mode). */
  resolvedTxHash?: string | null;
};

export type Task = {
  id: string;
  userQuestion: string;
  status: TaskStatus;
  budgetLimit: string;
  selectedProviderIds: ProviderId[];
  plan: ProcurementPlan | null;
  pact: PactSummary | null;
  providerPackage: ProviderAnswerPackage | null;
  /** Optional for backwards compatibility: absent until a challenge is opened. */
  challenge?: TaskChallenge | null;
  audit: AuditEvent[];
  jobId: number | null;
  mode: "fixture" | "real";
  txRecords: import("./realMode").TxRecord[];
  claudePlanRaw: string | null;
  denial: import("./realMode").CoboDenialRecord | null;
  createdAt: string;
  updatedAt: string;
};

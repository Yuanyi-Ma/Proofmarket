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
  /** Which authoritative library this source came from (registry in libraries.ts). */
  sourceLibrary: import("./libraries").LibraryId;
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
  /**
   * Merkle ROOT over the briefing leaves (leaf 0 = overview/coverage, leaf
   * 1..n = one evidence item each; see merkle.ts). This is what the provider
   * signs on-chain at submit — any single leaf can later be proven part of
   * the briefing with just (leaf plaintext, Merkle path).
   */
  packageHash: string;
};

export type ProviderProfile = {
  id: ProviderId;
  agentId: number;
  /** On-chain wallet address (Sepolia). Preset; matches deployments/sepolia.json. */
  address: string;
  name: string;
  role: "recommended" | "risky" | "comparison";
  coverage: string;
  /** Libraries this expert self-declares licensed/able access to. */
  libraries: import("./libraries").LibraryId[];
  price: string;
  stake: string;
  reputationScore: number;
  /**
   * Structured challenge counts (design doc §7: structured, never free text).
   * challenged = times this provider was challenged; upheld = challenges that
   * succeeded against it.
   */
  challengeStats: { challenged: number; upheld: number };
  demoBehavior: "happy" | "challenge" | "unused";
};

/**
 * One entry in the research agent's ranked shortlist. The user picks one of
 * these before authorizing. `reason` is written by the real Claude Code call in
 * real mode (preset in fixture mode); provider facts come from providerProfiles.
 */
export type PlanCandidate = {
  providerId: ProviderId;
  reason: string;
  /** 1-based rank, 1 = top recommendation. */
  rank: number;
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
  /**
   * Ranked shortlist the user chooses from (rank 1 = recommendedProviderId).
   * Real mode: built from the Claude ranking. Fixture mode: preset.
   */
  candidates?: PlanCandidate[];
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

/**
 * One juror's reasoned vote. The reason book is the L2 three-question ruling
 * (design doc §4.2): plaintext shown in the UI, only its hash goes on-chain
 * with the vote.
 */
export type JuryVote = {
  jurorId: string;
  jurorAddress: string;
  /** Heterogeneous model-family commitment registered on-chain. */
  modelFamily: string;
  vote: "ProviderFault" | "ProviderNotFault";
  reasonCode: string;
  reasonBook: {
    /** 审判方凭自有库授权调取反证原文核对的结果。 */
    sourceCheck: string;
    /** 反例在承诺范围内吗？ */
    inScope: string;
    /** 字面或语义命中声明检索词吗？ */
    hitsDeclaredQuery: string;
    /** Provider 未返回且未声明排除吗？ */
    notReturnedNotExcluded: string;
    conclusion: string;
  };
  reasonHash: string;
  /** castVote tx (real mode). */
  txHash?: string | null;
};

/** The provider's defense statement, filed within the defense window R_w. */
export type ChallengeDefense = {
  statement: string;
  defenseHash: string;
  /** submitDefense tx (real mode). */
  txHash?: string | null;
};

export type TaskChallenge = {
  type: "CoverageMiss";
  /** 挑战书：挑战者陈述（明文进 UI，哈希上链）。 */
  statement: string;
  /** 命中覆盖声明的哪一条。 */
  hitCoverageClause: string;
  counterEvidenceHash: string;
  /** On-chain challenge id from ChallengeManager.openChallenge (real mode). */
  challengeId?: number | null;
  defense?: ChallengeDefense | null;
  /** Jury votes in casting order; majority decides. */
  votes?: JuryVote[] | null;
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
  /**
   * End of the challenge window W_c (ISO timestamp), set when the provider's
   * deliverable is confirmed on-chain. Settlement is blocked (on-chain and in
   * the UI) until this passes; challenges are expected within it.
   */
  challengeWindowEndsAt?: string | null;
  mode: "fixture" | "real";
  txRecords: import("./realMode").TxRecord[];
  claudePlanRaw: string | null;
  denial: import("./realMode").CoboDenialRecord | null;
  createdAt: string;
  updatedAt: string;
};

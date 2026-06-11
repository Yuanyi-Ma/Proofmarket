export const escrowAbi = [
  {
    type: "function",
    name: "createJob",
    stateMutability: "nonpayable",
    inputs: [
      { name: "providerAgentId", type: "uint256" },
      { name: "provider", type: "address" },
      { name: "verifierAgentId", type: "uint256" },
      { name: "evaluator", type: "address" },
      { name: "token", type: "address" },
      { name: "expiredAt", type: "uint256" },
      { name: "descriptionHash", type: "bytes32" },
      { name: "coverageHash", type: "bytes32" }
    ],
    outputs: [{ name: "jobId", type: "uint256" }]
  },
  {
    type: "function",
    name: "setBudget",
    stateMutability: "nonpayable",
    inputs: [
      { name: "jobId", type: "uint256" },
      { name: "amount", type: "uint256" }
    ],
    outputs: []
  },
  {
    type: "function",
    name: "fund",
    stateMutability: "nonpayable",
    inputs: [
      { name: "jobId", type: "uint256" },
      { name: "expectedAmount", type: "uint256" }
    ],
    outputs: []
  },
  {
    type: "function",
    name: "submit",
    stateMutability: "nonpayable",
    inputs: [
      { name: "jobId", type: "uint256" },
      { name: "deliverableHash", type: "bytes32" }
    ],
    outputs: []
  },
  {
    type: "function",
    name: "complete",
    stateMutability: "nonpayable",
    inputs: [
      { name: "jobId", type: "uint256" },
      { name: "reasonHash", type: "bytes32" }
    ],
    outputs: []
  },
  {
    type: "function",
    name: "reject",
    stateMutability: "nonpayable",
    inputs: [
      { name: "jobId", type: "uint256" },
      { name: "reasonHash", type: "bytes32" }
    ],
    outputs: []
  },
  // P0 additions: challenge lifecycle hooks callable only by challengeManager
  {
    type: "function",
    name: "markChallenged",
    stateMutability: "nonpayable",
    inputs: [{ name: "jobId", type: "uint256" }],
    outputs: []
  },
  {
    type: "function",
    name: "refundForChallenge",
    stateMutability: "nonpayable",
    inputs: [{ name: "jobId", type: "uint256" }],
    outputs: []
  },
  {
    type: "function",
    name: "unfreezeForChallenge",
    stateMutability: "nonpayable",
    inputs: [{ name: "jobId", type: "uint256" }],
    outputs: []
  },
  {
    type: "function",
    name: "setChallengeManager",
    stateMutability: "nonpayable",
    inputs: [{ name: "challengeManager_", type: "address" }],
    outputs: []
  },
  // View: return all three parties for a job (used by ChallengeManager.openChallenge)
  {
    type: "function",
    name: "jobParties",
    stateMutability: "view",
    inputs: [{ name: "jobId", type: "uint256" }],
    outputs: [
      { name: "client", type: "address" },
      { name: "provider", type: "address" },
      { name: "evaluator", type: "address" }
    ]
  },
  // Challenge window W_c: timestamp of submit() and the gate length, used by
  // the backend to compute when complete() becomes callable.
  {
    type: "function",
    name: "submittedAt",
    stateMutability: "view",
    inputs: [{ name: "", type: "uint256" }],
    outputs: [{ name: "", type: "uint256" }]
  },
  {
    type: "function",
    name: "challengeWindow",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }]
  },
  {
    type: "function",
    name: "jobs",
    stateMutability: "view",
    inputs: [{ name: "", type: "uint256" }],
    outputs: [
      { name: "jobId", type: "uint256" },
      { name: "client", type: "address" },
      { name: "providerAgentId", type: "uint256" },
      { name: "provider", type: "address" },
      { name: "verifierAgentId", type: "uint256" },
      { name: "evaluator", type: "address" },
      { name: "token", type: "address" },
      { name: "budget", type: "uint256" },
      { name: "expiredAt", type: "uint256" },
      { name: "state", type: "uint8" },
      { name: "descriptionHash", type: "bytes32" },
      { name: "deliverableHash", type: "bytes32" },
      { name: "coverageHash", type: "bytes32" }
    ]
  },
  {
    type: "event",
    name: "JobCreated",
    inputs: [
      { name: "jobId", type: "uint256", indexed: true },
      { name: "client", type: "address", indexed: true },
      { name: "provider", type: "address", indexed: true }
    ]
  },
  {
    type: "event",
    name: "JobFunded",
    inputs: [
      { name: "jobId", type: "uint256", indexed: true },
      { name: "amount", type: "uint256", indexed: false }
    ]
  },
  {
    type: "event",
    name: "DeliverableSubmitted",
    inputs: [
      { name: "jobId", type: "uint256", indexed: true },
      { name: "deliverableHash", type: "bytes32", indexed: false }
    ]
  },
  {
    type: "event",
    name: "JobCompleted",
    inputs: [
      { name: "jobId", type: "uint256", indexed: true },
      { name: "reasonHash", type: "bytes32", indexed: false }
    ]
  },
  {
    type: "event",
    name: "JobRejected",
    inputs: [
      { name: "jobId", type: "uint256", indexed: true },
      { name: "reasonHash", type: "bytes32", indexed: false }
    ]
  },
  // P0 challenge-lifecycle events
  {
    type: "event",
    name: "JobChallenged",
    inputs: [
      { name: "jobId", type: "uint256", indexed: true }
    ]
  },
  {
    type: "event",
    name: "JobRefundedForChallenge",
    inputs: [
      { name: "jobId", type: "uint256", indexed: true }
    ]
  },
  {
    type: "event",
    name: "JobUnfrozenForChallenge",
    inputs: [
      { name: "jobId", type: "uint256", indexed: true }
    ]
  },
  {
    type: "event",
    name: "ChallengeManagerSet",
    inputs: [
      { name: "challengeManager", type: "address", indexed: true }
    ]
  }
] as const;

/**
 * ABI for ProofMarketChallengeManager.
 *
 * Enum encoding (uint8 in ABI):
 *   ChallengeType  — 0 SourceNotFound | 1 LocatorInvalid | 2 ExcerptMismatch
 *                    3 NumericMismatch | 4 CoverageMiss
 *   ChallengeResult — 0 Pending | 1 ProviderFault | 2 ProviderNotFault
 *
 * See ChallengeType / ChallengeResult in calldata.ts for named enum maps.
 */
export const challengeManagerAbi = [
  // ── Admin ──────────────────────────────────────────────────────────────────
  {
    type: "function",
    name: "setEscrow",
    stateMutability: "nonpayable",
    inputs: [{ name: "escrow_", type: "address" }],
    outputs: []
  },
  // ── Stake management ───────────────────────────────────────────────────────
  {
    type: "function",
    name: "depositStake",
    stateMutability: "nonpayable",
    inputs: [{ name: "amount", type: "uint256" }],
    outputs: []
  },
  {
    type: "function",
    name: "withdrawStake",
    stateMutability: "nonpayable",
    inputs: [{ name: "amount", type: "uint256" }],
    outputs: []
  },
  {
    type: "function",
    name: "hasMinStake",
    stateMutability: "view",
    inputs: [{ name: "provider", type: "address" }],
    outputs: [{ name: "", type: "bool" }]
  },
  // ── Escrow hooks (callable only by escrow) ─────────────────────────────────
  {
    type: "function",
    name: "lockStakeForJob",
    stateMutability: "nonpayable",
    inputs: [{ name: "provider", type: "address" }],
    outputs: []
  },
  {
    type: "function",
    name: "unlockStakeForJob",
    stateMutability: "nonpayable",
    inputs: [{ name: "provider", type: "address" }],
    outputs: []
  },
  // ── Challenge lifecycle ────────────────────────────────────────────────────
  {
    type: "function",
    name: "openChallenge",
    stateMutability: "nonpayable",
    inputs: [
      { name: "jobId", type: "uint256" },
      { name: "challengeType", type: "uint8" },   // ChallengeType enum
      { name: "challengeHash", type: "bytes32" }
    ],
    outputs: [{ name: "challengeId", type: "uint256" }]
  },
  // ── Defense + jury voting (v2) ─────────────────────────────────────────────
  {
    type: "function",
    name: "submitDefense",
    stateMutability: "nonpayable",
    inputs: [
      { name: "challengeId", type: "uint256" },
      { name: "defenseHash", type: "bytes32" }
    ],
    outputs: []
  },
  {
    type: "function",
    name: "castVote",
    stateMutability: "nonpayable",
    inputs: [
      { name: "challengeId", type: "uint256" },
      { name: "result", type: "uint8" },           // ChallengeResult enum
      { name: "reasonHash", type: "bytes32" }
    ],
    outputs: []
  },
  // Permissionless majority execution: votes are on-chain, no discretion.
  {
    type: "function",
    name: "resolve",
    stateMutability: "nonpayable",
    inputs: [{ name: "challengeId", type: "uint256" }],
    outputs: []
  },
  {
    type: "function",
    name: "registerJuror",
    stateMutability: "nonpayable",
    inputs: [
      { name: "account", type: "address" },
      { name: "modelHash", type: "bytes32" },
      { name: "promptHash", type: "bytes32" }
    ],
    outputs: []
  },
  // ── Public getters ─────────────────────────────────────────────────────────
  {
    type: "function",
    name: "stake",
    stateMutability: "view",
    inputs: [{ name: "", type: "address" }],
    outputs: [{ name: "", type: "uint256" }]
  },
  {
    type: "function",
    name: "lockedStake",
    stateMutability: "view",
    inputs: [{ name: "", type: "address" }],
    outputs: [{ name: "", type: "uint256" }]
  },
  {
    type: "function",
    name: "activeChallenges",
    stateMutability: "view",
    inputs: [{ name: "", type: "address" }],
    outputs: [{ name: "", type: "uint256" }]
  },
  {
    type: "function",
    name: "challenges",
    stateMutability: "view",
    inputs: [{ name: "", type: "uint256" }],
    outputs: [
      { name: "challengeId", type: "uint256" },
      { name: "jobId", type: "uint256" },
      { name: "challengeType", type: "uint8" },
      { name: "challengeHash", type: "bytes32" },
      { name: "result", type: "uint8" },
      { name: "challenger", type: "address" },
      { name: "provider", type: "address" },
      { name: "openedAt", type: "uint64" },
      { name: "defenseHash", type: "bytes32" },
      { name: "faultVotes", type: "uint8" },
      { name: "notFaultVotes", type: "uint8" }
    ]
  },
  {
    type: "function",
    name: "jurorCount",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }]
  },
  {
    type: "function",
    name: "jurySize",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }]
  },
  {
    type: "function",
    name: "minStake",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }]
  },
  {
    type: "function",
    name: "challengeDeposit",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }]
  },
  {
    type: "function",
    name: "jurors",
    stateMutability: "view",
    inputs: [{ name: "", type: "address" }],
    outputs: [
      { name: "modelHash", type: "bytes32" },
      { name: "promptHash", type: "bytes32" },
      { name: "registered", type: "bool" }
    ]
  },
  {
    type: "function",
    name: "juryFee",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }]
  },
  {
    type: "function",
    name: "defenseWindow",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }]
  },
  // ── Events ─────────────────────────────────────────────────────────────────
  {
    type: "event",
    name: "EscrowSet",
    inputs: [
      { name: "escrow", type: "address", indexed: true }
    ]
  },
  {
    type: "event",
    name: "StakeDeposited",
    inputs: [
      { name: "provider", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
      { name: "totalStake", type: "uint256", indexed: false }
    ]
  },
  {
    type: "event",
    name: "StakeWithdrawn",
    inputs: [
      { name: "provider", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
      { name: "remainingStake", type: "uint256", indexed: false }
    ]
  },
  {
    type: "event",
    name: "StakeLocked",
    inputs: [
      { name: "provider", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
      { name: "totalLocked", type: "uint256", indexed: false }
    ]
  },
  {
    type: "event",
    name: "StakeUnlocked",
    inputs: [
      { name: "provider", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
      { name: "totalLocked", type: "uint256", indexed: false }
    ]
  },
  {
    type: "event",
    name: "ChallengeOpened",
    inputs: [
      { name: "challengeId", type: "uint256", indexed: true },
      { name: "jobId", type: "uint256", indexed: true },
      { name: "challengeType", type: "uint8", indexed: false },
      { name: "challengeHash", type: "bytes32", indexed: false },
      { name: "challenger", type: "address", indexed: true },
      { name: "provider", type: "address", indexed: false }
    ]
  },
  {
    type: "event",
    name: "JurorRegistered",
    inputs: [
      { name: "juror", type: "address", indexed: true },
      { name: "modelHash", type: "bytes32", indexed: false },
      { name: "promptHash", type: "bytes32", indexed: false }
    ]
  },
  {
    type: "event",
    name: "DefenseSubmitted",
    inputs: [
      { name: "challengeId", type: "uint256", indexed: true },
      { name: "defenseHash", type: "bytes32", indexed: false }
    ]
  },
  {
    type: "event",
    name: "JurorVoted",
    inputs: [
      { name: "challengeId", type: "uint256", indexed: true },
      { name: "juror", type: "address", indexed: true },
      { name: "result", type: "uint8", indexed: false },
      { name: "reasonHash", type: "bytes32", indexed: false }
    ]
  },
  {
    type: "event",
    name: "ChallengeResolved",
    inputs: [
      { name: "challengeId", type: "uint256", indexed: true },
      { name: "result", type: "uint8", indexed: false },
      { name: "slashAmount", type: "uint256", indexed: false },
      { name: "challengerPayout", type: "uint256", indexed: false },
      { name: "juryPayout", type: "uint256", indexed: false },
      { name: "treasuryPayout", type: "uint256", indexed: false }
    ]
  }
] as const;

export const erc20Abi = [
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" }
    ],
    outputs: [{ name: "", type: "bool" }]
  },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "", type: "address" }],
    outputs: [{ name: "", type: "uint256" }]
  }
] as const;

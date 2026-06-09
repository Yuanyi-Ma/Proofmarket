import { stableHash, type JsonValue } from "@proofmarket/shared/src/hash";
import type { ProviderAnswerPackage, ProviderId } from "@proofmarket/shared/src/types";

export type ProviderAnswerPackagePreimage = Omit<
  ProviderAnswerPackage,
  "packageHash"
>;

export function hashProviderAnswerPackage(
  input: ProviderAnswerPackagePreimage
): string {
  const hashInput = {
    taskId: input.taskId,
    providerAgentId: input.providerAgentId,
    providerId: input.providerId,
    providerName: input.providerName,
    coverageStatement: input.coverageStatement,
    answers: input.answers.map((answer) => ({
      providerAnswer: answer.providerAnswer,
      sourceTitle: answer.sourceTitle,
      sourceLocator: answer.sourceLocator,
      sourceMetadata: {
        year: answer.sourceMetadata.year,
        type: answer.sourceMetadata.type
      },
      excerptOrSummary: answer.excerptOrSummary,
      relevanceExplanation: answer.relevanceExplanation
    }))
  } satisfies JsonValue;

  return stableHash(hashInput);
}

export function runProvider(
  taskId: string,
  providerId: ProviderId
): ProviderAnswerPackage {
  if (providerId === "execution-research-expert") {
    const preimage: ProviderAnswerPackagePreimage = {
      taskId,
      providerAgentId: 1,
      providerId,
      providerName: "Execution Research Expert Agent",
      coverageStatement:
        "Searched 2021-2026 blockchain transaction execution acceleration sources across parallel execution, speculative execution, conflict detection, state access optimization, Block-STM, EVM parallelization, Sei, Sui, and Solana runtime.",
      answers: [
        {
          providerAnswer:
            "Recent blockchain execution acceleration work centers on optimistic parallel execution, speculative execution, conflict detection, and state access optimization.",
          sourceTitle:
            "Block-STM: Scaling Blockchain Execution by Turning Ordering Curse to a Performance Blessing",
          sourceLocator: "arXiv:2203.06871",
          sourceMetadata: { year: 2022, type: "paper" },
          excerptOrSummary:
            "Block-STM uses optimistic parallel execution and conflict detection to execute ordered blockchain transactions concurrently while preserving deterministic results.",
          relevanceExplanation:
            "This supports speculative parallel execution as a major direction, but does not prove linear speedup for all workloads."
        },
        {
          providerAnswer:
            "Execution acceleration is limited by transaction conflicts, state hotspots, and storage access costs.",
          sourceTitle: "State Hotspots in High-Throughput Smart Contract Execution",
          sourceLocator: "mock-report:state-hotspots-2025",
          sourceMetadata: { year: 2025, type: "report" },
          excerptOrSummary:
            "State hotspots and storage I/O can dominate execution latency even when scheduling allows parallel execution.",
          relevanceExplanation:
            "This limits overclaims about parallel execution and explains why workload structure matters."
        },
        {
          providerAnswer:
            "EVM parallelization in Sei v2 and Monad achieves significant throughput gains through optimistic concurrency and pipelined execution stages.",
          sourceTitle: "Sei v2: Parallelized EVM Execution",
          sourceLocator: "mock-report:sei-v2-parallel-evm-2024",
          sourceMetadata: { year: 2024, type: "report" },
          excerptOrSummary:
            "Sei v2 introduces a parallelized EVM that pipelines transaction execution, state access, and block commitment to maximize hardware utilization.",
          relevanceExplanation:
            "This provides a concrete production example of EVM parallelization beyond research prototypes."
        }
      ]
    };
    return {
      ...preimage,
      packageHash: hashProviderAnswerPackage(preimage)
    };
  }

  const shallow: ProviderAnswerPackagePreimage = {
    taskId,
    providerAgentId: 2,
    providerId,
    providerName: "Shallow Search Provider Agent",
    coverageStatement:
      "Claims broad 2021-2026 blockchain execution acceleration paper coverage.",
    answers: [
      {
        providerAnswer:
          "Blockchain performance has improved through better consensus and hardware.",
        sourceTitle: "General Blockchain Performance Overview",
        sourceLocator: "mock-web:generic-performance-overview",
        sourceMetadata: { year: 2024, type: "report" },
        excerptOrSummary:
          "Generic public-web summary of throughput and consensus performance.",
        relevanceExplanation:
          "This is related to blockchain performance but misses execution-specific work such as Block-STM."
      }
    ]
  };
  return {
    ...shallow,
    packageHash: hashProviderAnswerPackage(shallow)
  };
}

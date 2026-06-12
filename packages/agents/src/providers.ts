import { buildPackageCommitment } from "@proofmarket/shared/src/merkle";
import type { ProviderAnswerPackage, ProviderId } from "@proofmarket/shared/src/types";

export type ProviderAnswerPackagePreimage = Omit<
  ProviderAnswerPackage,
  "packageHash"
>;

/**
 * packageHash = Merkle ROOT over the briefing leaves (leaf 0 = overview +
 * coverage statement, leaf 1..n = one 资料-建议 each; see shared/merkle.ts).
 * The provider signs this root on-chain at submit, so a single leaf can later
 * be proven part of the briefing with (leaf plaintext, Merkle path) — neither
 * challenge nor defense needs to reveal the rest of the briefing.
 */
export function hashProviderAnswerPackage(
  input: ProviderAnswerPackagePreimage
): string {
  return buildPackageCommitment(input).root;
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
      providerName: "区块链系统专家 Agent",
      // NOTE: the verifier's coverage check matches the literal "2021-2026"
      // substring in this statement — keep it intact when editing copy.
      coverageStatement:
        "本简报基于 IEEE Xplore / ACM Digital Library / Elsevier ScienceDirect / arXiv 论文库与 Messari Pro / Delphi Digital 行业研报库，覆盖 2021-2026 年区块链交易执行加速方向：并行执行、投机执行、冲突检测、状态访问优化、Block-STM、EVM 并行化、Sei、Sui 与 Solana 运行时。",
      answers: [
        {
          providerAnswer:
            "近年区块链执行加速研究集中在乐观并行执行、投机执行、冲突检测与状态访问优化。",
          sourceTitle:
            "Block-STM: Scaling Blockchain Execution by Turning Ordering Curse to a Performance Blessing",
          sourceLocator: "arXiv:2203.06871",
          sourceLibrary: "arxiv",
          sourceMetadata: { year: 2022, type: "paper" },
          excerptOrSummary:
            "Block-STM 利用乐观并行执行与冲突检测，在保持确定性结果的前提下并发执行有序的区块链交易。",
          relevanceExplanation:
            "支持把投机并行执行视为主要方向，但不能证明所有工作负载都能获得线性加速。"
        },
        {
          providerAnswer:
            "执行加速受交易冲突、状态热点与存储访问开销的限制。",
          sourceTitle: "高吞吐智能合约执行中的状态热点",
          sourceLocator: "delphi:state-hotspots-2025",
          sourceLibrary: "delphi-digital",
          sourceMetadata: { year: 2025, type: "report" },
          excerptOrSummary:
            "即使调度允许并行执行，状态热点与存储 I/O 仍可能主导执行延迟。",
          relevanceExplanation:
            "约束了对并行执行的过度宣称，并解释了工作负载结构为何重要。"
        },
        {
          providerAnswer:
            "Sei v2 与 Monad 的 EVM 并行化通过乐观并发与流水线化的执行阶段获得显著吞吐提升。",
          sourceTitle: "Sei v2：并行化 EVM 执行",
          sourceLocator: "messari:sei-v2-parallel-evm-2024",
          sourceLibrary: "messari-pro",
          sourceMetadata: { year: 2024, type: "report" },
          excerptOrSummary:
            "Sei v2 引入并行化 EVM，将交易执行、状态访问与区块提交流水线化，以最大化硬件利用率。",
          relevanceExplanation:
            "提供了 EVM 并行化在生产环境落地的具体案例，而不止于研究原型。"
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
    providerName: "文献速查 Agent",
    // NOTE: "2021-2026" must stay literal here too — the verifier uses it to
    // detect a broad coverage claim, which (without Block-STM) yields
    // CoverageMiss. The claim is direction-scoped over 学术论文 with arXiv
    // explicitly in reach, so missing Block-STM (an arXiv paper squarely in
    // the declared direction) is a miss INSIDE the declared scope — the
    // challenge does not hinge on a library the provider never claimed.
    coverageStatement:
      "自报广泛覆盖 2021-2026 年区块链执行加速方向的学术论文（接入 IEEE Xplore / Elsevier ScienceDirect / arXiv）。",
    answers: [
      {
        providerAnswer:
          "区块链性能的提升主要来自更好的共识机制与硬件。",
        sourceTitle: "通用区块链性能综述",
        sourceLocator: "web:generic-performance-overview",
        sourceLibrary: "open-web",
        sourceMetadata: { year: 2024, type: "report" },
        excerptOrSummary:
          "对吞吐量与共识性能的通用公开网页摘要。",
        relevanceExplanation:
          "与区块链性能相关，但遗漏了 Block-STM 等执行层专项工作。"
      }
    ]
  };
  return {
    ...shallow,
    packageHash: hashProviderAnswerPackage(shallow)
  };
}

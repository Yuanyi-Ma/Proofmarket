import type { ChallengeDefense, JuryVote, ProviderProfile } from "./types";
import { stableHash } from "./hash";

export const defaultQuestion = "请调研近几年区块链交易执行加速的最新研究进展。";

/**
 * Preset counter-evidence for the deterministic challenge flow (P2-c).
 * The challenge content is fixed by design — the protocol and fund movements
 * are real, the arbitration content is preset. Only its stableHash goes
 * on-chain; this object is the off-chain audit-layer original.
 */
export const presetCounterEvidence = {
  challengeType: "CoverageMiss",
  sourceLocator: "arXiv:2203.06871",
  // Real paper title (arXiv:2203.06871) — counter-evidence must be verifiable
  // by anyone who follows the locator, so the title cannot be paraphrased.
  sourceTitle:
    "Block-STM: Scaling Blockchain Execution by Turning Ordering Curse to a Performance Blessing",
  /** 反证所在库：开放获取，审判方无需订阅即可调原文核对。 */
  sourceLibrary: "arxiv",
  claim:
    "专家声明覆盖 2021-2026 年区块链执行加速方向，但交付的研究简报中遗漏了 Block-STM——该声明范围内公认的代表性工作。"
} as const;

/**
 * Preset L2 challenge document (挑战书, design doc §4.2): the challenger's
 * structured statement around the counter-evidence above. Plaintext for the
 * UI/audit layer; its hash is the on-chain challengeHash.
 */
export const presetChallengeDocument = {
  statement:
    "交付的研究简报未包含 Block-STM（arXiv:2203.06871）——区块链并行执行方向被广泛引用的代表性工作，" +
    "且该专家未在覆盖声明中排除该子方向。属于承诺范围内漏检（CoverageMiss）。",
  hitCoverageClause:
    "覆盖声明：『广泛覆盖 2021-2026 年区块链执行加速方向的学术论文（接入 IEEE Xplore / Elsevier ScienceDirect / arXiv）』",
  /**
   * 指派依据：审判方必须持有反证所在库的访问权限，才能自行调取原文核对，
   * 不必轻信挑战者提交件。本案反证在 arXiv（开放获取），三位注册审判方均可达。
   */
  juryAssignmentBasis:
    "反证位于 arXiv（开放获取）；三位注册审判方均持有 arXiv 与声明范围库（IEEE Xplore / Elsevier ScienceDirect）的访问权限，全部入席。"
} as const;

/**
 * Preset provider defense (应辩书): deliberately weak — it concedes the paper
 * exists and only argues scope, which the three-question ruling can reject.
 */
export const presetDefense: Omit<ChallengeDefense, "txHash"> = (() => {
  const statement =
    "检索按声明的关键词字面执行，未触达 Block-STM 一文；该文属并行执行子方向，" +
    "我方认为不构成对『执行加速』整体声明的漏检。";
  return { statement, defenseHash: stableHash({ defense: statement }) };
})();

/**
 * Preset jury operators (heterogeneous model families, design doc §5.1).
 * modelTag / promptTag hash into the on-chain registration commitments — the
 * same tags are hashed by the deploy script, so UI text and chain commitments
 * stay consistent.
 */
export const presetJurors = [
  {
    jurorId: "juror-anthropic",
    modelFamily: "Anthropic Claude 系",
    modelTag: "claude-sonnet-4-6",
    promptTag: "proofmarket-jury-prompt-v1",
    /** 运营方自报的资料库访问授权——指派审判方时必须覆盖反证所在库。 */
    libraryAccess: ["ieee-xplore", "acm-dl", "sciencedirect", "arxiv", "springer-link"]
  },
  {
    jurorId: "juror-openai",
    modelFamily: "OpenAI GPT 系",
    modelTag: "gpt-5",
    promptTag: "proofmarket-jury-prompt-v1",
    libraryAccess: ["ieee-xplore", "sciencedirect", "arxiv", "usenix"]
  },
  {
    jurorId: "juror-google",
    modelFamily: "Google Gemini 系",
    modelTag: "gemini-2.5-pro",
    promptTag: "proofmarket-jury-prompt-v1",
    libraryAccess: ["ieee-xplore", "acm-dl", "sciencedirect", "arxiv", "cnki"]
  }
] as const;

/**
 * Preset jury verdict, 2:1 ProviderFault. Deliberately NOT unanimous: the demo
 * shows majority rule with a dissenting reason book, not a rubber stamp. Each
 * reason book answers the L2 three questions (design doc §4.2); reasonHash is
 * what goes on-chain with castVote.
 */
export function presetJuryVotes(jurorAddresses: readonly string[]): JuryVote[] {
  const books = [
    {
      vote: "ProviderFault" as const,
      reasonCode: "COVERAGE_MISS",
      reasonBook: {
        sourceCheck:
          "已凭自有 arXiv 访问权限调取 arXiv:2203.06871 原文：该文真实存在，主题为区块链交易乐观并行执行；其对应叶子哈希不在被挑战简报承诺根的任何叶子中，缺失属实。",
        inScope:
          "是。Block-STM 直接研究区块链交易并行执行加速，落在声明的『执行加速』范围内。",
        hitsDeclaredQuery:
          "是。『并行执行 / 投机执行』与声明检索词在语义上直接命中。",
        notReturnedNotExcluded:
          "是。交付简报未含该文，覆盖声明也未排除并行执行子方向。",
        conclusion: "原文核对与三问皆成立，构成承诺范围内漏检，判 ProviderFault。"
      }
    },
    {
      vote: "ProviderFault" as const,
      reasonCode: "COVERAGE_MISS",
      reasonBook: {
        sourceCheck:
          "已自行检索 arXiv 确认反证原文存在且与挑战书描述一致；逐一核对简报各叶子，均不含该文。",
        inScope: "是。该文为执行加速方向被广泛引用的代表性工作。",
        hitsDeclaredQuery: "是。声明覆盖语句按字面即包含交易执行优化。",
        notReturnedNotExcluded:
          "是。应辩书承认未触达且未事先排除，仅作范围抗辩，不能成立。",
        conclusion: "覆盖缺失成立，判 ProviderFault。"
      }
    },
    {
      vote: "ProviderNotFault" as const,
      reasonCode: "SCOPE_AMBIGUOUS",
      reasonBook: {
        sourceCheck:
          "已调取 arXiv 原文确认其存在、确认简报未包含——事实无分歧，分歧在声明范围的解释。",
        inScope: "存疑。『执行加速』未逐项列举子方向，对并行执行的涵盖存在解释空间。",
        hitsDeclaredQuery: "部分。字面检索词未直接包含 Block-STM 同义词。",
        notReturnedNotExcluded: "是，未返回亦未排除。",
        conclusion: "三问未全部明确成立，按宽容原则倾向不构成失职，持异议票。"
      }
    }
  ];
  return books.map((book, i) => {
    const juror = presetJurors[i];
    return {
      jurorId: juror.jurorId,
      jurorAddress: jurorAddresses[i] ?? "",
      modelFamily: juror.modelFamily,
      vote: book.vote,
      reasonCode: book.reasonCode,
      reasonBook: book.reasonBook,
      reasonHash: stableHash({ jurorId: juror.jurorId, ...book.reasonBook })
    };
  });
}

export const providerProfiles: ProviderProfile[] = [
  {
    id: "execution-research-expert",
    agentId: 6388,
    address: "0x0866e2b066d1D04e4a5A4Cccc380E7Da2c1c2f3a",
    name: "区块链系统专家 Agent",
    role: "recommended",
    coverage:
      "持有 IEEE Xplore、ACM Digital Library 与 Elsevier ScienceDirect 论文库授权，订阅 Messari Pro 与 Delphi Digital 行业研报库；专注交易执行、并行/投机执行与共识优化方向，简报逐条附来源库、来源定位与关键摘录。",
    libraries: ["ieee-xplore", "acm-dl", "sciencedirect", "arxiv", "messari-pro", "delphi-digital"],
    price: "1 mUSDC",
    stake: "10 mUSDC",
    reputationScore: 970,
    challengeStats: { challenged: 0, upheld: 0 },
    demoBehavior: "happy"
  },
  {
    id: "shallow-search-provider",
    agentId: 6389,
    address: "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC",
    name: "文献速查 Agent",
    role: "risky",
    coverage:
      "接入 IEEE Xplore、Elsevier ScienceDirect 与 arXiv，按关键词快速检索区块链性能方向论文，当天交付，价格实惠。",
    libraries: ["ieee-xplore", "sciencedirect", "arxiv"],
    price: "0.2 mUSDC",
    stake: "2 mUSDC",
    reputationScore: 620,
    challengeStats: { challenged: 5, upheld: 3 },
    demoBehavior: "challenge"
  },
  {
    id: "general-web-summary",
    agentId: 6390,
    address: "0x90F79bf6EB2c4f870365E785982E1f101E93b906",
    name: "共识层研究专家 Agent",
    role: "comparison",
    coverage:
      "持有 IEEE Xplore 论文库授权，覆盖 USENIX 与 arXiv 开放论文，专注共识与网络层方向（BFT 共识、P2P 网络、出块与传播）；执行层论文覆盖有限。",
    libraries: ["ieee-xplore", "usenix", "arxiv"],
    price: "0.1 mUSDC",
    stake: "1 mUSDC",
    reputationScore: 800,
    challengeStats: { challenged: 1, upheld: 0 },
    demoBehavior: "unused"
  }
];

/**
 * Authoritative source-library registry. Every provider declares which
 * libraries it holds access to, every briefing answer is tagged with the
 * library its source came from, and every juror declares which libraries it
 * can reach for original-text verification. Juror assignment requires the
 * juror's access to cover the counter-evidence's library.
 *
 * Names are real, well-known databases so the catalog reads like a
 * professional research marketplace; access kinds distinguish paid
 * subscriptions from open archives (open archives need no license to verify
 * against, which matters for juror assignment).
 */
export type LibraryId =
  // 学术论文库
  | "ieee-xplore"
  | "acm-dl"
  | "sciencedirect"
  | "springer-link"
  | "arxiv"
  | "usenix"
  | "cnki"
  // 行业研究 / 咨询报告库
  | "messari-pro"
  | "delphi-digital"
  | "galaxy-research"
  | "gartner"
  | "idc"
  | "forrester"
  | "statista"
  | "cb-insights"
  // 法规 / 判例库
  | "pkulaw"
  | "wolters-kluwer"
  | "lexisnexis"
  | "westlaw"
  | "eur-lex"
  | "npc-flk"
  // 链上数据
  | "dune"
  | "glassnode"
  // 兜底：未经授权库背书的公开网页
  | "open-web";

export type LibraryKind = "学术论文库" | "行业研究库" | "法规数据库" | "链上数据" | "公开网页";

export type LibraryInfo = {
  /** Display name, the official product name. */
  name: string;
  kind: LibraryKind;
  /** 订阅授权 = paid license; 开放获取 = anyone can fetch the original. */
  access: "订阅授权" | "开放获取" | "官方公开";
};

export const LIBRARIES: Record<LibraryId, LibraryInfo> = {
  "ieee-xplore": { name: "IEEE Xplore", kind: "学术论文库", access: "订阅授权" },
  "acm-dl": { name: "ACM Digital Library", kind: "学术论文库", access: "订阅授权" },
  sciencedirect: { name: "Elsevier ScienceDirect", kind: "学术论文库", access: "订阅授权" },
  "springer-link": { name: "SpringerLink", kind: "学术论文库", access: "订阅授权" },
  arxiv: { name: "arXiv", kind: "学术论文库", access: "开放获取" },
  usenix: { name: "USENIX", kind: "学术论文库", access: "开放获取" },
  cnki: { name: "中国知网 CNKI", kind: "学术论文库", access: "订阅授权" },
  "messari-pro": { name: "Messari Pro", kind: "行业研究库", access: "订阅授权" },
  "delphi-digital": { name: "Delphi Digital", kind: "行业研究库", access: "订阅授权" },
  "galaxy-research": { name: "Galaxy Research", kind: "行业研究库", access: "开放获取" },
  gartner: { name: "Gartner", kind: "行业研究库", access: "订阅授权" },
  idc: { name: "IDC", kind: "行业研究库", access: "订阅授权" },
  forrester: { name: "Forrester", kind: "行业研究库", access: "订阅授权" },
  statista: { name: "Statista", kind: "行业研究库", access: "订阅授权" },
  "cb-insights": { name: "CB Insights", kind: "行业研究库", access: "订阅授权" },
  pkulaw: { name: "北大法宝", kind: "法规数据库", access: "订阅授权" },
  "wolters-kluwer": { name: "威科先行（Wolters Kluwer）", kind: "法规数据库", access: "订阅授权" },
  lexisnexis: { name: "LexisNexis", kind: "法规数据库", access: "订阅授权" },
  westlaw: { name: "Westlaw", kind: "法规数据库", access: "订阅授权" },
  "eur-lex": { name: "EUR-Lex", kind: "法规数据库", access: "官方公开" },
  "npc-flk": { name: "国家法律法规数据库", kind: "法规数据库", access: "官方公开" },
  dune: { name: "Dune Analytics", kind: "链上数据", access: "开放获取" },
  glassnode: { name: "Glassnode", kind: "链上数据", access: "订阅授权" },
  "open-web": { name: "公开网页", kind: "公开网页", access: "开放获取" }
};

export function libraryName(id: LibraryId): string {
  return LIBRARIES[id].name;
}

export function libraryNames(ids: readonly LibraryId[]): string {
  return ids.map((id) => LIBRARIES[id].name).join(" · ");
}

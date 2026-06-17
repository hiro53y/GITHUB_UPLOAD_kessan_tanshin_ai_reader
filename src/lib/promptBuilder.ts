import type { AnalysisReport, SourceCheckpoint, TopicAnalysis, WarningItem } from "./types";
import { compactText, formatDateTime } from "./utils";

export const DISCLAIMER =
  "本アプリは、決算資料を読むための補助ツールです。投資助言、売買推奨、将来の株価予測を行うものではありません。抽出・要約は自動処理のため誤差を含む可能性があります。";

export function buildAiPrompt(input: {
  ticker?: string;
  companyName?: string;
  title?: string;
  checkpoints: SourceCheckpoint[];
  topics: TopicAnalysis[];
  warnings: WarningItem[];
  textSample: string;
}): string {
  const topicLines = input.topics
    .filter((topic) => topic.detected)
    .map((topic) => `- ${topic.category}: ${topic.keywords.join("、")} / ページ ${topic.pages.join("、")}`)
    .join("\n");
  const warningLines = input.warnings.map((warning) => `- ${warning.label}: ページ ${warning.pages.join("、")}`).join("\n");
  const checkpointLines = input.checkpoints
    .slice(0, 10)
    .map((checkpoint) => `- ${checkpoint.pageNumber}ページ: ${checkpoint.reason} / ${compactText(checkpoint.excerpt, 100)}`)
    .join("\n");

  return `以下は日本株の決算短信から抽出したテキストです。投資助言ではなく、決算資料を読むための補助として分析してください。

禁止事項:
- 買い、売り、保有、目標株価、投資推奨を出さない
- 断定的な将来予測をしない
- 株価の予測をしない

整理してほしい観点:
- 決算結果が良好寄りか、弱含みか、強弱混在か
- 売上
- 利益
- 通期予想
- 配当
- セグメント
- キャッシュフロー
- リスク
- 根拠ページと読みどころ

銘柄コード: ${input.ticker || "不明"}
会社名: ${input.companyName || "不明"}
資料タイトル: ${input.title || "不明"}

検出トピック:
${topicLines || "- 主要トピックは自動検出できませんでした"}

注意語句:
${warningLines || "- 強い注意語句は自動検出できませんでした"}

根拠ページ候補:
${checkpointLines || "- 根拠ページ候補は自動検出できませんでした"}

抽出テキスト:
${input.textSample}

資料を読む補助として、決算の要点、良い点、注意点、通期予想、配当、セグメント、数値候補を端的に整理してください。投資判断や株価予測には踏み込まないでください。`;
}

export function buildMarkdownReport(report: AnalysisReport): string {
  const dig = report.freeAiDigest;

  const metricsTable = dig.keyMetrics.length
    ? ["| 項目 | 値 | 前年同期比 |", "|---|---:|---:|", ...dig.keyMetrics.map((r) => `| ${r.label} | ${r.value} | ${r.growth ?? "—"} |`)].join("\n")
    : "";

  const forecastTable = dig.forecastMetrics.length
    ? ["| 通期予想 | 値 | 前期比 |", "|---|---:|---:|", ...dig.forecastMetrics.map((r) => `| ${r.label} | ${r.value} | ${r.growth ?? "—"} |`)].join("\n")
    : "";

  const otherTopics = dig.topicSummaries.length
    ? dig.topicSummaries.map((t) => `- **${t.category}**: ${t.summary}${t.pages.length ? `（${t.pages.slice(0, 3).join("・")}P）` : ""}`).join("\n")
    : "";

  const checkpoints = report.sourceCheckpoints
    .slice(0, 8)
    .map((cp) => `- ${cp.pageNumber}P: ${cp.reason}`)
    .join("\n");

  const warningsBlock = report.warnings.length
    ? report.warnings.map((w) => `- ${w.label}（${w.level === "high" ? "要注意" : "参考"}・${w.pages.slice(0, 3).join("・")}P）`).join("\n")
    : "- 強い注意語句は検出されませんでした";

  const goodBlock = dig.goodPoints.map((p) => `- ${p}`).join("\n");
  const concernBlock = dig.concernPoints.map((p) => `- ${p}`).join("\n");

  const sections: string[] = [];

  sections.push(`# 決算分析レポート

- 銘柄コード: ${report.ticker || "不明"}
- 会社名: ${report.companyName || "不明"}
- 資料: ${report.sourceDisclosure?.title || "手動PDF資料"}
- 開示日時: ${formatDateTime(report.sourceDisclosure?.disclosedAt)}
- 分析日時: ${formatDateTime(report.analyzedAt)}

## 結論
**${dig.verdictLabel}**

${report.oneLineSummary}`);

  if (metricsTable || forecastTable) {
    const blocks: string[] = ["## 主要数値"];
    if (metricsTable) blocks.push("### 実績\n" + metricsTable);
    if (forecastTable) blocks.push("### 通期予想\n" + forecastTable);
    if (dig.forecastRevisionLine) blocks.push(`- ${dig.forecastRevisionLine}`);
    if (dig.dividendLine) blocks.push(`- ${dig.dividendLine}`);
    sections.push(blocks.join("\n\n"));
  }

  sections.push(`## ポジティブ
${goodBlock}

## 注意点
${concernBlock}`);

  if (otherTopics) {
    sections.push(`## その他の記載
${otherTopics}`);
  }

  if (report.warnings.length) {
    sections.push(`## 検出された注意語句
${warningsBlock}`);
  }

  if (checkpoints) {
    sections.push(`## 原文を確認すべきページ
${checkpoints}`);
  }

  sections.push(`---
${report.disclaimer}`);

  return sections.join("\n\n") + "\n";
}

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
  const topics = report.topics
    .map((topic) => {
      const status = topic.detected ? "検出" : "未検出";
      return `## ${topic.category}（${status}）\n${topic.comment}\n\n関連ページ: ${topic.pages.join("、") || "なし"}\n\n${topic.excerpts
        .map((excerpt) => `> ${excerpt}`)
        .join("\n")}`;
    })
    .join("\n\n");

  const warnings = report.warnings
    .map((warning) => `- ${warning.label}（${warning.level}）: ${warning.comment} / ページ ${warning.pages.join("、")}`)
    .join("\n");

  const checkpoints = report.sourceCheckpoints
    .map((checkpoint) => `- ${checkpoint.pageNumber}ページ: ${checkpoint.reason} / ${checkpoint.excerpt}`)
    .join("\n");

  const numbers = report.extractedNumbers
    .slice(0, 30)
    .map((item) => `- ${item.label}: ${item.valueText}（${item.pageNumber}ページ）`)
    .join("\n");

  return `# 決算分析レポート

- 銘柄コード: ${report.ticker || "不明"}
- 会社名: ${report.companyName || "不明"}
- 分析日時: ${formatDateTime(report.analyzedAt)}
- 分析方式: 標準ルール分析 + 無料AI要約

## 一言サマリー
${report.oneLineSummary}

## 無料AI診断
- 判定: ${report.freeAiDigest?.verdictLabel || "不明"}
- 要約: ${report.freeAiDigest?.plainSummary || report.freeAiDigest?.headline || report.oneLineSummary}

### 良い点
${report.freeAiDigest?.goodPoints?.map((item) => `- ${item}`).join("\n") || "- なし"}

### 注意点
${report.freeAiDigest?.concernPoints?.map((item) => `- ${item}`).join("\n") || "- なし"}

## 主要トピック
${topics}

## 注意ポイント
${warnings || "強い注意語句は自動検出されませんでした。"}

## 根拠ページ・読みどころ
${checkpoints || "根拠ページ候補は自動検出されませんでした。"}

## 抽出数値
${numbers || "数値候補は自動抽出されませんでした。"}

## 免責事項
${report.disclaimer}
`;
}

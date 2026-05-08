import type {
  AnalysisReport,
  DisclosureItem,
  ExtractedNumber,
  SourceCheckpoint,
  TopicAnalysis,
  TopicCategory,
  WarningItem
} from "./types";
import { buildAiPrompt, DISCLAIMER } from "./promptBuilder";
import { compactText, unique } from "./utils";

const topicKeywords: Record<TopicCategory, string[]> = {
  売上: ["売上高", "売上収益", "営業収益", "増収", "減収", "前年同期比"],
  利益: [
    "営業利益",
    "事業利益",
    "経常利益",
    "税引前利益",
    "親会社株主に帰属する当期純利益",
    "四半期純利益",
    "当期純利益",
    "包括利益",
    "EBITDA",
    "EPS",
    "1株当たり当期純利益",
    "増益",
    "減益"
  ],
  通期予想: ["通期予想", "業績予想", "連結業績予想", "修正", "上方修正", "下方修正", "据え置き", "未定", "合理的な算定が困難"],
  配当: ["配当", "配当予想", "増配", "減配", "無配", "中間配当", "期末配当", "配当性向", "自己株式取得", "株主還元"],
  セグメント: ["セグメント", "事業別", "地域別", "主力事業", "事業ポートフォリオ"],
  キャッシュフロー: [
    "営業活動によるキャッシュ・フロー",
    "投資活動によるキャッシュ・フロー",
    "財務活動によるキャッシュ・フロー",
    "フリーキャッシュフロー",
    "現金及び現金同等物"
  ],
  財務状態: ["総資産", "資産合計", "負債合計", "純資産", "自己資本比率", "財政状態", "有利子負債"],
  "リスク・注記": [
    "継続企業の前提",
    "重要な後発事象",
    "会計方針の変更",
    "不確実性",
    "リスク",
    "訴訟",
    "減損",
    "貸倒",
    "棚卸資産",
    "為替",
    "原材料価格",
    "金利",
    "物価上昇"
  ]
};

const warningRules: Array<{ label: string; keywords: string[]; level: WarningItem["level"]; comment: string }> = [
  { label: "減収", keywords: ["減収"], level: "medium", comment: "売上の減少に関する記載があるため、該当箇所を原文で確認してください。" },
  { label: "減益", keywords: ["減益"], level: "medium", comment: "利益の減少に関する記載があるため、要因と一過性の有無を確認してください。" },
  { label: "下方修正", keywords: ["下方修正"], level: "high", comment: "業績予想の下方修正に関する記載があるため、修正理由を確認してください。" },
  { label: "赤字・損失", keywords: ["赤字", "営業損失", "経常損失", "純損失", "赤字転落"], level: "high", comment: "損失または赤字に関する記載があるため、継続性と改善策を確認してください。" },
  { label: "減配・無配", keywords: ["減配", "無配"], level: "high", comment: "配当の減少または無配に関する記載があるため、配当方針を確認してください。" },
  { label: "継続企業の前提", keywords: ["継続企業の前提"], level: "high", comment: "継続企業の前提に関する注記がある場合は重要な確認対象です。" },
  { label: "重要な後発事象", keywords: ["重要な後発事象"], level: "medium", comment: "期末後の重要事象が記載されている可能性があります。" },
  { label: "不確実性", keywords: ["不確実性", "合理的な算定が困難"], level: "medium", comment: "見通しや前提の不確実性に関する記載を確認してください。" },
  { label: "減損・訴訟", keywords: ["減損", "訴訟"], level: "medium", comment: "損失発生や法的リスクに関する記載がないか確認してください。" }
];

const checkpointRules: Array<{ reason: string; keywords: string[] }> = [
  { reason: "決算サマリー", keywords: ["決算短信", "連結業績", "経営成績"] },
  { reason: "経営成績", keywords: ["経営成績", "売上高", "営業利益"] },
  { reason: "財政状態", keywords: ["財政状態", "総資産", "純資産"] },
  { reason: "セグメント情報", keywords: ["セグメント", "事業別"] },
  { reason: "通期予想", keywords: ["通期予想", "業績予想", "連結業績予想"] },
  { reason: "配当", keywords: ["配当", "配当予想"] },
  { reason: "リスク・注記", keywords: ["継続企業の前提", "重要な後発事象", "リスク", "不確実性"] }
];

const numberLabels = [
  "売上高",
  "売上収益",
  "営業収益",
  "営業利益",
  "経常利益",
  "当期純利益",
  "四半期純利益",
  "親会社株主に帰属する当期純利益",
  "EPS",
  "1株当たり当期純利益",
  "総資産",
  "純資産",
  "自己資本比率",
  "配当"
];

function findKeywordPages(pages: Array<{ pageNumber: number; text: string }>, keywords: string[]): Array<{ pageNumber: number; keyword: string; text: string }> {
  const hits: Array<{ pageNumber: number; keyword: string; text: string }> = [];
  for (const page of pages) {
    for (const keyword of keywords) {
      if (page.text.includes(keyword)) hits.push({ pageNumber: page.pageNumber, keyword, text: page.text });
    }
  }
  return hits;
}

function excerptAround(text: string, keyword: string, maxLength = 120): string {
  const index = text.indexOf(keyword);
  if (index < 0) return compactText(text, maxLength);
  const start = Math.max(0, index - Math.floor(maxLength / 2));
  return compactText(text.slice(start, start + maxLength), maxLength);
}

function analyzeTopics(pages: Array<{ pageNumber: number; text: string }>): TopicAnalysis[] {
  return (Object.entries(topicKeywords) as Array<[TopicCategory, string[]]>).map(([category, keywords]) => {
    const hits = findKeywordPages(pages, keywords);
    const detectedKeywords = unique(hits.map((hit) => hit.keyword)).slice(0, 8);
    const pageNumbers = unique(hits.map((hit) => hit.pageNumber)).slice(0, 8);
    const excerpts = hits.slice(0, 3).map((hit) => excerptAround(hit.text, hit.keyword));
    const detected = hits.length > 0;
    return {
      category,
      detected,
      keywords: detectedKeywords,
      pages: pageNumbers,
      excerpts,
      comment: detected
        ? `${category}に関連する語句が検出されました。数値や前提条件は該当ページの原文で確認してください。`
        : `${category}に関連する主要語句は自動検出できませんでした。PDFの表崩れや表記差異の可能性があります。`
    };
  });
}

function analyzeWarnings(pages: Array<{ pageNumber: number; text: string }>): WarningItem[] {
  return warningRules
    .map((rule) => {
      const hits = findKeywordPages(pages, rule.keywords);
      if (!hits.length) return undefined;
      return {
        level: rule.level,
        label: rule.label,
        pages: unique(hits.map((hit) => hit.pageNumber)).slice(0, 8),
        excerpts: hits.slice(0, 3).map((hit) => excerptAround(hit.text, hit.keyword)),
        comment: rule.comment
      };
    })
    .filter(Boolean) as WarningItem[];
}

function buildCheckpoints(pages: Array<{ pageNumber: number; text: string }>): SourceCheckpoint[] {
  const checkpoints: SourceCheckpoint[] = [];
  for (const rule of checkpointRules) {
    const hit = findKeywordPages(pages, rule.keywords)[0];
    if (!hit) continue;
    if (checkpoints.some((checkpoint) => checkpoint.pageNumber === hit.pageNumber && checkpoint.reason === rule.reason)) continue;
    checkpoints.push({
      pageNumber: hit.pageNumber,
      reason: rule.reason,
      excerpt: excerptAround(hit.text, hit.keyword, 130)
    });
  }

  if (!checkpoints.length && pages[0]) {
    checkpoints.push({
      pageNumber: pages[0].pageNumber,
      reason: "冒頭ページ",
      excerpt: compactText(pages[0].text, 130)
    });
  }

  return checkpoints.slice(0, 12);
}

function extractNumbers(pages: Array<{ pageNumber: number; text: string }>): ExtractedNumber[] {
  const results: ExtractedNumber[] = [];
  const valuePattern = /[△▲\-]?\d[\d,]*(?:\.\d+)?\s*(?:百万円|千円|億円|円|％|%|ポイント|株|倍)?/g;

  for (const page of pages) {
    for (const label of numberLabels) {
      const labelIndex = page.text.indexOf(label);
      if (labelIndex < 0) continue;
      const windowText = page.text.slice(labelIndex, labelIndex + 180);
      const values = windowText.match(valuePattern) || [];
      for (const value of values.slice(0, 2)) {
        results.push({
          label,
          valueText: value.replace(/\s+/g, ""),
          pageNumber: page.pageNumber,
          context: compactText(windowText, 120)
        });
      }
    }
  }

  const seen = new Set<string>();
  return results
    .filter((item) => {
      const key = `${item.label}:${item.valueText}:${item.pageNumber}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 40);
}

function decideTone(topics: TopicAnalysis[], warnings: WarningItem[]): AnalysisReport["overallTone"] {
  const detectedText = topics.flatMap((topic) => topic.excerpts).join(" ");
  const positiveCount = ["増収", "増益", "黒字転換", "上方修正", "増配"].filter((word) => detectedText.includes(word)).length;
  const cautionCount = warnings.filter((warning) => warning.level !== "low").length;
  if (!detectedText) return "unknown";
  if (positiveCount > 0 && cautionCount > 0) return "mixed";
  if (cautionCount > 0) return "caution";
  if (positiveCount > 0) return "positive";
  return "neutral";
}

function decideConfidence(rawTextLength: number, detectedTopics: number): AnalysisReport["confidence"] {
  if (rawTextLength > 3000 && detectedTopics >= 5) return "high";
  if (rawTextLength > 1000 && detectedTopics >= 3) return "medium";
  return "low";
}

function buildSummary(topics: TopicAnalysis[], warnings: WarningItem[]): string {
  const detected = topics.filter((topic) => topic.detected).map((topic) => topic.category);
  const warningLabels = warnings.map((warning) => warning.label);
  if (!detected.length) {
    return "抽出テキストから主要トピックを十分に検出できませんでした。PDFの原文確認を優先してください。";
  }
  const first = `最新資料では、${detected.slice(0, 6).join("・")}に関する記載が確認されました。`;
  const second = warningLabels.length
    ? `${warningLabels.slice(0, 3).join("・")}に関する注意語句もあるため、該当ページの原文確認が必要です。`
    : "強い注意語句は自動検出されませんでしたが、数値と前提条件は原文で確認してください。";
  return `${first}${second}`;
}

export function analyzeDisclosureText(input: {
  ticker?: string;
  companyName?: string;
  disclosure?: DisclosureItem;
  pages: Array<{ pageNumber: number; text: string }>;
}): AnalysisReport {
  const pages = input.pages;
  const rawText = pages.map((page) => page.text).join("\n");
  const topics = analyzeTopics(pages);
  const warnings = analyzeWarnings(pages);
  const sourceCheckpoints = buildCheckpoints(pages);
  const extractedNumbers = extractNumbers(pages);
  const detectedTopicCount = topics.filter((topic) => topic.detected).length;
  const oneLineSummary = buildSummary(topics, warnings);

  const aiPrompt = buildAiPrompt({
    ticker: input.ticker || input.disclosure?.ticker,
    companyName: input.companyName || input.disclosure?.companyName,
    title: input.disclosure?.title,
    checkpoints: sourceCheckpoints,
    topics,
    warnings,
    textSample: compactText(rawText, 6000)
  });

  return {
    ticker: input.ticker || input.disclosure?.ticker,
    companyName: input.companyName || input.disclosure?.companyName,
    analyzedAt: new Date().toISOString(),
    sourceDisclosure: input.disclosure,
    oneLineSummary,
    overallTone: decideTone(topics, warnings),
    confidence: decideConfidence(rawText.length, detectedTopicCount),
    topics,
    warnings,
    sourceCheckpoints,
    extractedNumbers,
    aiPrompt,
    disclaimer: DISCLAIMER
  };
}

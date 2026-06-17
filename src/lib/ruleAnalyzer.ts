import type {
  AnalysisReport,
  DisclosureItem,
  ExtractedNumber,
  FreeAiDigest,
  FreeAiVerdict,
  KeyMetricRow,
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
  { label: "減収", keywords: ["減収"], level: "medium", comment: "売上の減少に関する記載があります。対象期間、事業領域、主な要因を中心に要約します。" },
  { label: "減益", keywords: ["減益"], level: "medium", comment: "利益の減少に関する記載があります。費用増、売上構成、為替などの要因を中心に要約します。" },
  { label: "下方修正", keywords: ["下方修正"], level: "high", comment: "業績予想の下方修正に関する記載があります。修正理由と前提条件を中心に要約します。" },
  { label: "赤字・損失", keywords: ["赤字", "営業損失", "経常損失", "純損失", "赤字転落"], level: "high", comment: "損失または赤字に関する記載があります。発生要因と改善策の記載を中心に要約します。" },
  { label: "減配・無配", keywords: ["減配", "無配"], level: "high", comment: "配当の減少または無配に関する記載があります。配当方針と業績前提の記載を中心に要約します。" },
  { label: "継続企業の前提", keywords: ["継続企業の前提"], level: "high", comment: "継続企業の前提に関する注記語句が検出されました。財務面の重要な注記として扱います。" },
  { label: "重要な後発事象", keywords: ["重要な後発事象"], level: "medium", comment: "期末後の重要事象に関する記載候補があります。決算期後の変化として要約します。" },
  { label: "不確実性", keywords: ["不確実性", "合理的な算定が困難"], level: "medium", comment: "見通しや前提の不確実性に関する記載があります。業績予想の前提として扱います。" },
  { label: "減損・訴訟", keywords: ["減損", "訴訟"], level: "medium", comment: "減損または訴訟に関する記載があります。費用・損失・リスク要因として要約します。" }
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

const positiveWords = ["増収", "増益", "黒字転換", "上方修正", "増配", "過去最高", "伸長", "拡大", "改善", "好調", "堅調", "増加", "上回"];
const negativeWords = ["減収", "減益", "赤字", "赤字転落", "下方修正", "減配", "無配", "営業損失", "経常損失", "純損失", "減少", "悪化", "低迷", "減損"];
const neutralWords = ["据え置き", "変更なし", "未定", "合理的な算定が困難"];

type FinancialMetricRow = {
  period: string;
  sales: string;
  salesGrowth: string;
  operatingProfit: string;
  operatingProfitGrowth: string;
  ordinaryProfit: string;
  ordinaryProfitGrowth: string;
  netProfit: string;
  netProfitGrowth: string;
};

type ForecastMetricRow = {
  sales: string;
  salesGrowth: string;
  operatingProfit: string;
  operatingProfitGrowth: string;
  ordinaryProfit: string;
  ordinaryProfitGrowth: string;
  netProfit: string;
  netProfitGrowth: string;
};

type FinancialDigestBase = {
  performance?: FinancialMetricRow;
  forecast?: ForecastMetricRow;
  forecastRevision?: string;
  dividend?: string;
  dividendRevision?: string;
  performanceSummary?: string;
  forecastSummary?: string;
  dividendSummary?: string;
  verdict?: FreeAiVerdict;
  keyFigures: string[];
  keyMetrics: KeyMetricRow[];
  forecastMetrics: KeyMetricRow[];
  dividendLine?: string;
  forecastRevisionLine?: string;
};

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

function topicComment(category: TopicCategory, detected: boolean, _excerpts: string[], keywords: string[]): string {
  if (!detected) return `${category}に関するキーワードは検出されませんでした。`;
  const kws = keywords.slice(0, 5).join("・");
  return `${kws}などの記載を検出。詳細は原文で確認を。`;
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
      comment: topicComment(category, detected, excerpts, detectedKeywords)
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
      for (const value of values.filter((candidate) => isLikelyMetricValue(candidate, label)).slice(0, 2)) {
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

function isLikelyMetricValue(value: string, label: string): boolean {
  const normalized = value.replace(/\s+/g, "");
  if (!normalized) return false;
  if (/^20[0-3]\d$/.test(normalized)) return false;
  if (/^\d{1,2}$/.test(normalized) && !["EPS", "1株当たり当期純利益", "配当"].includes(label)) return false;
  return /[,△▲\-％%円百万円億ポイント.]/.test(normalized) || normalized.length >= 4;
}

function countSignals(text: string, words: string[]): number {
  return words.reduce((total, word) => total + (text.includes(word) ? 1 : 0), 0);
}

function normalizeGrowth(value: string): string {
  return value.replace(/[▲△]/g, "-").replace(/％/g, "%").trim();
}

function growthNumber(value: string): number | undefined {
  const normalized = normalizeGrowth(value).replace("%", "");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function growthPhrase(value: string): string {
  const parsed = growthNumber(value);
  if (typeof parsed !== "number") return `${value}%`;
  if (parsed < 0) return `${Math.abs(parsed).toFixed(1)}%減`;
  if (parsed > 0) return `${parsed.toFixed(1)}%増`;
  return "横ばい";
}

function growthTone(value: string): KeyMetricRow["growthTone"] {
  const parsed = growthNumber(value);
  if (typeof parsed !== "number") return "unknown";
  if (parsed < 0) return "down";
  if (parsed > 0) return "up";
  return "flat";
}

function formatYenAmount(rawValue: string): string {
  const cleaned = rawValue.replace(/[△▲]/g, "-").replace(/,/g, "").trim();
  const num = Number(cleaned);
  if (!Number.isFinite(num)) return `${rawValue}百万円`;
  const abs = Math.abs(num);
  if (abs >= 1_000_000) {
    const oku = num / 100;
    return `${oku.toLocaleString("ja-JP", { maximumFractionDigits: 0 })}億円`;
  }
  if (abs >= 10_000) {
    const oku = num / 100;
    return `${oku.toLocaleString("ja-JP", { maximumFractionDigits: 1 })}億円`;
  }
  return `${num.toLocaleString("ja-JP")}百万円`;
}

function metricWithGrowth(label: string, value: string, growth: string): string {
  return `${label}${formatYenAmount(value)}（${growthPhrase(growth)}）`;
}

function parseFinancialDigest(rawText: string): FinancialDigestBase {
  const text = rawText.replace(/[　\s]+/g, " ");
  const metricValue = "([△▲\\-]?\\d[\\d,]*(?:\\.\\d+)?)";
  const performanceRegex = new RegExp(
    `(20\\d{2}年[0-9０-９]+月期第[0-9０-９一二三四１-４]+四半期)\\s+${metricValue}\\s+${metricValue}\\s+${metricValue}\\s+${metricValue}\\s+${metricValue}\\s+${metricValue}\\s+${metricValue}\\s+${metricValue}`
  );
  const performanceMatch = text.match(performanceRegex);
  const performance = performanceMatch
    ? {
        period: performanceMatch[1],
        sales: performanceMatch[2],
        salesGrowth: performanceMatch[3],
        operatingProfit: performanceMatch[4],
        operatingProfitGrowth: performanceMatch[5],
        ordinaryProfit: performanceMatch[6],
        ordinaryProfitGrowth: performanceMatch[7],
        netProfit: performanceMatch[8],
        netProfitGrowth: performanceMatch[9]
      }
    : undefined;

  const forecastRegex = new RegExp(
    `通期\\s+${metricValue}\\s+${metricValue}\\s+${metricValue}\\s+${metricValue}\\s+${metricValue}\\s+${metricValue}\\s+${metricValue}\\s+${metricValue}`
  );
  const forecastMatch = text.match(forecastRegex);
  const forecast = forecastMatch
    ? {
        sales: forecastMatch[1],
        salesGrowth: forecastMatch[2],
        operatingProfit: forecastMatch[3],
        operatingProfitGrowth: forecastMatch[4],
        ordinaryProfit: forecastMatch[5],
        ordinaryProfitGrowth: forecastMatch[6],
        netProfit: forecastMatch[7],
        netProfitGrowth: forecastMatch[8]
      }
    : undefined;

  const forecastRevision = text.match(/業績予想からの修正の有無[:：]\s*([有無])/u)?.[1];
  const dividendRevision = text.match(/配当予想からの修正の有無[:：]\s*([有無])/u)?.[1];
  const dividendMatch = text.match(/20\d{2}年[0-9０-９]+月期（予想）\s+([△▲\-\d.,]+)\s+([△▲\-\d.,]+)/u);
  const dividend = dividendMatch ? `期末${dividendMatch[1]}円、年間${dividendMatch[2]}円` : undefined;

  const growthValues = performance
    ? [performance.salesGrowth, performance.operatingProfitGrowth, performance.ordinaryProfitGrowth, performance.netProfitGrowth]
    : [];
  const negativeCount = growthValues.filter((value) => (growthNumber(value) ?? 0) < 0).length;
  const positiveCount = growthValues.filter((value) => (growthNumber(value) ?? 0) > 0).length;
  const verdict =
    negativeCount >= 3 ? "weak" : positiveCount >= 3 ? "good" : positiveCount > 0 && negativeCount > 0 ? "mixed" : undefined;

  const performanceSummary = performance
    ? `${performance.period}は${negativeCount >= 3 ? "減収・減益" : positiveCount >= 3 ? "増収・増益" : "強弱混在"}。${metricWithGrowth("売上高", performance.sales, performance.salesGrowth)}、${metricWithGrowth("営業利益", performance.operatingProfit, performance.operatingProfitGrowth)}、${metricWithGrowth("経常利益", performance.ordinaryProfit, performance.ordinaryProfitGrowth)}、${metricWithGrowth("純利益", performance.netProfit, performance.netProfitGrowth)}。`
    : undefined;

  const forecastSummary = forecast
    ? `通期予想は${metricWithGrowth("売上高", forecast.sales, forecast.salesGrowth)}、${metricWithGrowth("営業利益", forecast.operatingProfit, forecast.operatingProfitGrowth)}、${metricWithGrowth("純利益", forecast.netProfit, forecast.netProfitGrowth)}。${forecastRevision === "無" ? "直近予想からの修正はありません。" : forecastRevision === "有" ? "直近予想から修正されています。" : ""}`
    : undefined;

  const dividendSummary = dividend
    ? `配当予想は${dividend}。${dividendRevision === "無" ? "直近予想からの修正はありません。" : dividendRevision === "有" ? "直近予想から修正されています。" : ""}`
    : undefined;

  const keyFigures = [
    performance ? `売上高: ${formatYenAmount(performance.sales)}（${growthPhrase(performance.salesGrowth)}）` : undefined,
    performance ? `営業利益: ${formatYenAmount(performance.operatingProfit)}（${growthPhrase(performance.operatingProfitGrowth)}）` : undefined,
    performance ? `経常利益: ${formatYenAmount(performance.ordinaryProfit)}（${growthPhrase(performance.ordinaryProfitGrowth)}）` : undefined,
    performance ? `純利益: ${formatYenAmount(performance.netProfit)}（${growthPhrase(performance.netProfitGrowth)}）` : undefined,
    forecast ? `通期予想売上高: ${formatYenAmount(forecast.sales)}（${growthPhrase(forecast.salesGrowth)}）` : undefined,
    forecast ? `通期予想営業利益: ${formatYenAmount(forecast.operatingProfit)}（${growthPhrase(forecast.operatingProfitGrowth)}）` : undefined,
    dividend ? `配当予想: ${dividend}` : undefined
  ].filter(Boolean) as string[];

  const keyMetrics: KeyMetricRow[] = performance
    ? [
        { label: "売上高", value: formatYenAmount(performance.sales), growth: growthPhrase(performance.salesGrowth), growthTone: growthTone(performance.salesGrowth) },
        { label: "営業利益", value: formatYenAmount(performance.operatingProfit), growth: growthPhrase(performance.operatingProfitGrowth), growthTone: growthTone(performance.operatingProfitGrowth) },
        { label: "経常利益", value: formatYenAmount(performance.ordinaryProfit), growth: growthPhrase(performance.ordinaryProfitGrowth), growthTone: growthTone(performance.ordinaryProfitGrowth) },
        { label: "純利益", value: formatYenAmount(performance.netProfit), growth: growthPhrase(performance.netProfitGrowth), growthTone: growthTone(performance.netProfitGrowth) }
      ]
    : [];

  const forecastMetrics: KeyMetricRow[] = forecast
    ? [
        { label: "売上高", value: formatYenAmount(forecast.sales), growth: growthPhrase(forecast.salesGrowth), growthTone: growthTone(forecast.salesGrowth) },
        { label: "営業利益", value: formatYenAmount(forecast.operatingProfit), growth: growthPhrase(forecast.operatingProfitGrowth), growthTone: growthTone(forecast.operatingProfitGrowth) },
        { label: "経常利益", value: formatYenAmount(forecast.ordinaryProfit), growth: growthPhrase(forecast.ordinaryProfitGrowth), growthTone: growthTone(forecast.ordinaryProfitGrowth) },
        { label: "純利益", value: formatYenAmount(forecast.netProfit), growth: growthPhrase(forecast.netProfitGrowth), growthTone: growthTone(forecast.netProfitGrowth) }
      ]
    : [];

  const dividendLine = dividend
    ? `配当予想 ${dividend}${dividendRevision === "有" ? "（直近予想から修正あり）" : dividendRevision === "無" ? "（修正なし）" : ""}`
    : undefined;

  const forecastRevisionLine =
    forecastRevision === "有"
      ? "通期業績予想は直近予想から修正あり"
      : forecastRevision === "無"
        ? "通期業績予想の修正なし"
        : undefined;

  return {
    performance,
    forecast,
    forecastRevision,
    dividend,
    dividendRevision,
    performanceSummary,
    forecastSummary,
    dividendSummary,
    verdict,
    keyFigures,
    keyMetrics,
    forecastMetrics,
    dividendLine,
    forecastRevisionLine
  };
}

function classifyVerdict(rawText: string, financialDigest?: FinancialDigestBase): AnalysisReport["freeAiDigest"]["verdict"] {
  if (financialDigest?.verdict) return financialDigest.verdict;
  const positive = countSignals(rawText, positiveWords);
  const negative = countSignals(rawText, negativeWords);
  if (positive >= negative + 2) return "good";
  if (negative >= positive + 2) return "weak";
  if (positive > 0 && negative > 0) return "mixed";
  if (positive > 0) return "good";
  if (negative > 0) return "weak";
  if (countSignals(rawText, neutralWords) > 0) return "neutral";
  return "unknown";
}

function verdictLabel(verdict: AnalysisReport["freeAiDigest"]["verdict"]): string {
  if (verdict === "good") return "業績は良好寄り";
  if (verdict === "weak") return "業績は弱含み";
  if (verdict === "mixed") return "業績は強弱混在";
  if (verdict === "neutral") return "業績は中立";
  return "業績判断は材料不足";
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

function buildSummary(topics: TopicAnalysis[], warnings: WarningItem[], financialDigest: FinancialDigestBase): string {
  // 数値パース成功時：判定 + 業績一行のみ（短く）
  if (financialDigest.performance) {
    const p = financialDigest.performance;
    const judgement = verdictLabel(financialDigest.verdict || "unknown");
    return `${judgement}。${p.period}は売上${growthPhrase(p.salesGrowth)}・営業利益${growthPhrase(p.operatingProfitGrowth)}・純利益${growthPhrase(p.netProfitGrowth)}。`;
  }

  // 数値パース不可の場合
  const rawText = topics.flatMap((t) => t.excerpts).join(" ");
  const verdict = verdictLabel(classifyVerdict(rawText, financialDigest));
  const warningLabels = warnings.slice(0, 2).map((w) => w.label);
  const tail = warningLabels.length ? ` 注意: ${warningLabels.join("・")}。` : "";
  return `${verdict}。${tail}`.trim();
}

function buildFreeAiDigest(
  topics: TopicAnalysis[],
  warnings: WarningItem[],
  numbers: ExtractedNumber[],
  rawText: string,
  financialDigest: FinancialDigestBase
): FreeAiDigest {
  const detectedTopics = topics.filter((topic) => topic.detected);
  const verdict = classifyVerdict(rawText, financialDigest);
  const label = verdictLabel(verdict);

  // 数値パース済みのキーフィギュアを優先。なければ抽出数値から補完
  const extractedKeyFigures = numbers
    .filter((item, index, all) => all.findIndex((c) => c.label === item.label) === index)
    .slice(0, 8)
    .map((item) => `${item.label}: ${item.valueText}（${item.pageNumber}P）`);
  const keyFigures = financialDigest.keyFigures.length ? financialDigest.keyFigures : extractedKeyFigures;

  // headline：1行のみ
  const headline = financialDigest.performance
    ? `${label}（売上${growthPhrase(financialDigest.performance.salesGrowth)}・営業利益${growthPhrase(financialDigest.performance.operatingProfitGrowth)}）`
    : label;

  // plainSummary：判定 + 業績/予想/配当を簡潔に
  const plainSummaryLines: string[] = [label];
  if (financialDigest.performanceSummary) plainSummaryLines.push(financialDigest.performanceSummary);
  if (financialDigest.forecastSummary) plainSummaryLines.push(financialDigest.forecastSummary);
  if (financialDigest.dividendSummary) plainSummaryLines.push(financialDigest.dividendSummary);
  if (!financialDigest.performanceSummary) {
    const cats = detectedTopics.map((t) => t.category).slice(0, 5).join("・");
    if (cats) plainSummaryLines.push(`検出項目: ${cats}`);
  }
  const plainSummary = plainSummaryLines.join("\n");

  // bullets：売上利益以外（セグメント・キャッシュフロー・財務状態・リスク）に集約
  const bullets: string[] = [];
  for (const t of detectedTopics.filter((t) => !["売上", "利益", "通期予想", "配当"].includes(t.category)).slice(0, 4)) {
    bullets.push(`${t.category}: ${t.keywords.slice(0, 4).join("・")}（${t.pages.slice(0, 3).join("・")}P）`);
  }

  // goodPoints：ポジティブな根拠のみ（前年比の伸び項目 or 検出キーワード）。keyFiguresとは別物にする
  const goodPoints: string[] = [];
  if (financialDigest.performance) {
    const p = financialDigest.performance;
    const checks: Array<[string, string]> = [
      ["売上", p.salesGrowth],
      ["営業利益", p.operatingProfitGrowth],
      ["経常利益", p.ordinaryProfitGrowth],
      ["純利益", p.netProfitGrowth]
    ];
    for (const [name, g] of checks) {
      const n = growthNumber(g);
      if (typeof n === "number" && n > 0) goodPoints.push(`${name}が前年同期比 ${n.toFixed(1)}% 増`);
    }
  }
  if (financialDigest.forecast) {
    const f = financialDigest.forecast;
    const n = growthNumber(f.operatingProfitGrowth);
    if (typeof n === "number" && n > 0) goodPoints.push(`通期予想 営業利益 ${n.toFixed(1)}% 増`);
  }
  if (financialDigest.dividendRevision === "有" && financialDigest.dividend) {
    goodPoints.push(`配当予想の修正あり（${financialDigest.dividend}）`);
  }
  if (!goodPoints.length) {
    const posKws = unique(detectedTopics.flatMap((t) => t.keywords.filter((kw) => positiveWords.includes(kw)))).slice(0, 4);
    if (posKws.length) goodPoints.push(...posKws.map((kw) => `「${kw}」の記載あり`));
  }
  if (!goodPoints.length) goodPoints.push("自動検出ではポジティブ材料を抽出できませんでした");

  // concernPoints：警告ラベルのみ（コメントは詳細ページへ）
  const concernPoints: string[] = [];
  if (financialDigest.performance) {
    const p = financialDigest.performance;
    const checks: Array<[string, string]> = [
      ["売上", p.salesGrowth],
      ["営業利益", p.operatingProfitGrowth],
      ["経常利益", p.ordinaryProfitGrowth],
      ["純利益", p.netProfitGrowth]
    ];
    for (const [name, g] of checks) {
      const n = growthNumber(g);
      if (typeof n === "number" && n < 0) concernPoints.push(`${name}が前年同期比 ${Math.abs(n).toFixed(1)}% 減`);
    }
  }
  for (const w of warnings.slice(0, 
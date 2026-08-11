export type DisclosureSource = "tdnet-public" | "jpx-company-service" | "company-ir" | "manual";

export type DisclosureDocumentType =
  | "earnings_release"
  | "earnings_presentation"
  | "forecast_revision"
  | "dividend_revision"
  | "other";

export type DisclosureSourceState = "success" | "empty" | "failed" | "truncated";

export type DisclosureItem = {
  id: string;
  disclosedAt?: string;
  title: string;
  ticker?: string;
  companyName?: string;
  pdfUrl?: string;
  htmlUrl?: string;
  xbrlUrl?: string;
  sourceUrl: string;
  documentType: DisclosureDocumentType;
  score: number;
  scoreReasons: string[];
};

export type DisclosureFetchResult = {
  status: "success" | "not_found" | "error" | "manual_required";
  ticker: string;
  companyName?: string;
  searchedAt: string;
  source: DisclosureSource;
  selectedDisclosure?: DisclosureItem;
  candidates: DisclosureItem[];
  errorMessage?: string;
  /** ソースごとの取得結果。旧キャッシュとの互換のため省略可能。 */
  sourceStates?: Partial<Record<"tdnet" | "jpx", DisclosureSourceState>>;
  userMessage: string;
};

export type PdfExtractResult = {
  pages: Array<{
    pageNumber: number;
    text: string;
    /** PDF.js の座標から復元した、読み順を保つページ行。text は従来互換の平坦な本文。 */
    lines?: PdfExtractLine[];
    quality?: PdfPageQuality;
  }>;
  totalPages: number;
  rawText: string;
  warnings: string[];
  quality?: PdfExtractQuality;
};

export type PdfExtractItem = { text: string; x: number; y: number; width?: number; height?: number };

export type PdfExtractLine = {
  y: number;
  text: string;
  items: PdfExtractItem[];
  /** X 座標の大きな空白から復元したセル。表でない行では通常1セル。 */
  cells: string[];
};

export type PdfPageQuality = {
  score: number;
  flags: Array<"empty" | "short_text" | "table_ambiguous" | "table_header_missing">;
  tableLike: boolean;
  /** 主要指標ヘッダと期間付き数値行の両方を座標復元できたページ。 */
  financialTableCandidate: boolean;
  lineCount: number;
};

export type PdfExtractQuality = {
  score: number;
  flags: Array<"empty_page_rate_high" | "table_ambiguous" | "text_sparse">;
  emptyPageRate: number;
  ambiguousTablePages: number[];
  safeForAutomaticFacts: boolean;
};

export type TopicCategory =
  | "売上"
  | "利益"
  | "通期予想"
  | "配当"
  | "セグメント"
  | "キャッシュフロー"
  | "財務状態"
  | "リスク・注記";

export type TopicAnalysis = {
  category: TopicCategory;
  detected: boolean;
  keywords: string[];
  pages: number[];
  excerpts: string[];
  comment: string;
};

export type WarningItem = {
  level: "low" | "medium" | "high";
  label: string;
  pages: number[];
  excerpts: string[];
  comment: string;
};

export type SourceCheckpoint = {
  pageNumber: number;
  reason: string;
  excerpt: string;
};

export type ExtractedNumber = {
  label: string;
  valueText: string;
  pageNumber: number;
  context: string;
};

export type FreeAiVerdict = "good" | "weak" | "mixed" | "neutral" | "unknown";

export type KeyMetricRow = {
  label: string;
  value: string;
  growth?: string;
  growthTone?: "up" | "down" | "flat" | "unknown";
};

export type FinancialMetricKey = "sales" | "operatingProfit" | "ordinaryProfit" | "netProfit";
export type FinancialFactSource = "pdf" | "xbrl";
export type FinancialFactQuality = "high" | "medium" | "low";

export type FinancialMetricFact = {
  key: FinancialMetricKey;
  valueYen: number;
  growthRate?: number;
  source: FinancialFactSource;
  quality: FinancialFactQuality;
  period?: string;
  pageNumber?: number;
  contextRef?: string;
  consolidation: "consolidated" | "non_consolidated" | "unknown";
  uncertainty: string[];
};

export type FinancialFactGroup = {
  period?: string;
  periodStart?: string;
  periodEnd?: string;
  consolidation: "consolidated" | "non_consolidated" | "unknown";
  source: FinancialFactSource | "mixed";
  quality: FinancialFactQuality;
  contextRef?: string;
  metrics: Partial<Record<FinancialMetricKey, FinancialMetricFact>>;
  uncertainty: string[];
};

export type FinancialFacts = {
  performance?: FinancialFactGroup;
  forecast?: FinancialFactGroup;
  dividendAnnualYen?: number;
  dividendYearEndYen?: number;
  forecastRevision?: "有" | "無";
  dividendRevision?: "有" | "無";
  quality: FinancialFactQuality;
  uncertainty: string[];
};

export type AiSummaryAudit = {
  inputHash?: string;
  model?: string;
  valid: boolean;
  errors: string[];
};

export type FreeAiDigest = {
  verdict: FreeAiVerdict;
  verdictLabel: string;
  headline: string;
  plainSummary: string;
  bullets: string[];
  goodPoints: string[];
  concernPoints: string[];
  topicSummaries: Array<{ category: string; summary: string; pages: number[] }>;
  keyFigures: string[];
  keyMetrics: KeyMetricRow[];
  forecastMetrics: KeyMetricRow[];
  dividendLine?: string;
  forecastRevisionLine?: string;
  /** 営業利益率（アプリ側計算）例: "営業利益率は約12.0%（4,528百万円÷37,585百万円）" */
  marginLine?: string;
  /** 通期予想に対する進捗率（中間・四半期決算のみ）例: "売上高進捗率は49.1%、営業利益進捗率は48.0%" */
  progressLines?: string[];
  /** 財務安全性 例: "自己資本比率は84.2%" */
  equityLine?: string;
  method: string;
};

/** 画面表示用の構造化レポート（スクリーンショットUI互換の「決算分析レポート」） */
export type StructuredReportItem = {
  label: string;
  text: string;
};

export type StructuredReportSection = {
  heading: string;
  items: StructuredReportItem[];
};

export type StructuredReport = {
  /** 一言サマリー（レポート最上部に強調表示） */
  oneLine: string;
  sections: StructuredReportSection[];
  generatedBy: "rule" | "ai";
  /** 表示用の分析方式ラベル 例: "標準ルール分析" / "Workers AI (llama-3.1-8b)" */
  methodLabel: string;
};

export type AnalysisReport = {
  ticker?: string;
  companyName?: string;
  analyzedAt: string;
  sourceDisclosure?: DisclosureItem;
  oneLineSummary: string;
  overallTone: "positive" | "neutral" | "caution" | "mixed" | "unknown";
  confidence: "low" | "medium" | "high";
  topics: TopicAnalysis[];
  warnings: WarningItem[];
  sourceCheckpoints: SourceCheckpoint[];
  extractedNumbers: ExtractedNumber[];
  /** PDFとXBRLを同じ単位・期間・出所で扱う、レポート生成の唯一の数値ソース。 */
  financialFacts?: FinancialFacts;
  freeAiDigest: FreeAiDigest;
  /** 構造化レポート（ルールベース。AI要約成功時はAI版が優先表示される） */
  structuredReport?: StructuredReport;
  aiPrompt: string;
  aiSummary?: string;
  aiSummaryAudit?: AiSummaryAudit;
  disclaimer: string;
};

export type LoadingStepStatus = "waiting" | "processing" | "success" | "failed" | "skipped";

export type LoadingStep = {
  id: number;
  label: string;
  status: LoadingStepStatus;
  detail?: string;
};

export type AppSettings = {
  lookbackDays: 30 | 60 | 90 | 120 | 180 | 365;
  tdnetEnabled: boolean;
  proxyUrl: string;
  aiSummaryEnabled: boolean;
};

export type HistoryItem = {
  id: string;
  ticker?: string;
  companyName?: string;
  analyzedAt: string;
  disclosedAt?: string;
  title?: string;
  pdfUrl?: string;
  oneLineSummary: string;
  warningCount: number;
  reportMarkdown: string;
  extractedTextSample: string;
  status: "success" | "failed";
  report?: AnalysisReport;
  fetchResult?: DisclosureFetchResult;
};

export type AnalysisInputSource =
  | { kind: "ticker"; ticker: string; companyName?: string }
  | { kind: "file"; file: File; ticker?: string; companyName?: string }
  | { kind: "url"; url: string; ticker?: string; companyName?: string };

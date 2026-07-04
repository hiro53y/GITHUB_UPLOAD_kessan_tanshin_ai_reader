export type DisclosureSource = "tdnet-public" | "jpx-company-service" | "company-ir" | "manual";

export type DisclosureDocumentType =
  | "earnings_release"
  | "earnings_presentation"
  | "forecast_revision"
  | "dividend_revision"
  | "other";

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
  userMessage: string;
};

export type PdfExtractResult = {
  pages: Array<{
    pageNumber: number;
    text: string;
  }>;
  totalPages: number;
  rawText: string;
  warnings: string[];
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
  freeAiDigest: FreeAiDigest;
  /** 構造化レポート（ルールベース。AI要約成功時はAI版が優先表示される） */
  structuredReport?: StructuredReport;
  aiPrompt: string;
  aiSummary?: string;
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

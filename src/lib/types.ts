export type DisclosureSource = "tdnet-public" | "company-ir" | "manual";

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
  aiPrompt: string;
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
  showSourceCheckpoints: boolean;
  analysisSensitivity: "low" | "standard" | "high";
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

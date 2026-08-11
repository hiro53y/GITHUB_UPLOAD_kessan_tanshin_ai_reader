import type { AiFact } from "./aiSummarizer";
import type { AccuracyMetric } from "./accuracyEvaluator";
import type {
  AnalysisReport,
  FinancialFactGroup,
  FinancialFactQuality,
  FinancialFacts,
  FinancialMetricFact,
  FinancialMetricKey,
  KeyMetricRow,
  PdfExtractQuality,
  PdfPageQuality,
  WarningItem
} from "./types";
import type { XbrlExtractResult, XbrlMetricRow } from "./xbrlExtract";

export type AmountUnit = "億円" | "百万円" | "千円" | "円" | "不明";

export type ParsedFinancialRow = {
  period?: string;
  sales: string;
  salesGrowth: string;
  operatingProfit: string;
  operatingProfitGrowth: string;
  ordinaryProfit: string;
  ordinaryProfitGrowth: string;
  netProfit: string;
  netProfitGrowth: string;
};

type CreatePdfFactsInput = {
  performance?: ParsedFinancialRow;
  forecast?: ParsedFinancialRow;
  unit: AmountUnit;
  consolidated: FinancialFactGroup["consolidation"];
  performancePage?: number;
  forecastPage?: number;
  forecastRevision?: string;
  dividendRevision?: string;
  dividendAnnual?: string;
  dividendYearEnd?: string;
  extractQuality?: PdfExtractQuality;
  performancePageQuality?: PdfPageQuality;
  forecastPageQuality?: PdfPageQuality;
  dividendPageQuality?: PdfPageQuality;
};

type ParsedFinancialValueKey = Exclude<keyof ParsedFinancialRow, "period">;

const metricMeta: Array<{
  key: FinancialMetricKey;
  label: string;
  value: ParsedFinancialValueKey;
  growth: ParsedFinancialValueKey;
}> = [
  { key: "sales", label: "売上高", value: "sales", growth: "salesGrowth" },
  { key: "operatingProfit", label: "営業利益", value: "operatingProfit", growth: "operatingProfitGrowth" },
  { key: "ordinaryProfit", label: "経常利益", value: "ordinaryProfit", growth: "ordinaryProfitGrowth" },
  { key: "netProfit", label: "純利益", value: "netProfit", growth: "netProfitGrowth" }
];

function numeric(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const value = Number(raw.replace(/[△▲]/g, "-").replace(/,/g, "").replace(/[％%円]/g, "").trim());
  return Number.isFinite(value) ? value : undefined;
}

function unitMultiplier(unit: AmountUnit): number {
  return unit === "億円" ? 100_000_000 : unit === "百万円" ? 1_000_000 : unit === "千円" ? 1_000 : 1;
}

function rowToGroup(
  row: ParsedFinancialRow | Omit<ParsedFinancialRow, "period">,
  unit: AmountUnit,
  period: string | undefined,
  pageNumber: number | undefined,
  consolidation: FinancialFactGroup["consolidation"],
  quality: FinancialFactQuality,
  uncertainty: string[]
): FinancialFactGroup | undefined {
  const metrics: FinancialFactGroup["metrics"] = {};
  for (const meta of metricMeta) {
    const rawValue = String(row[meta.value] ?? "");
    const value = numeric(rawValue);
    if (typeof value !== "number") continue;
    const growthRate = numeric(String(row[meta.growth] ?? ""));
    metrics[meta.key] = {
      key: meta.key,
      valueYen: value * unitMultiplier(unit),
      growthRate,
      source: "pdf",
      quality,
      period,
      pageNumber,
      consolidation,
      uncertainty: [...uncertainty]
    };
  }
  if (!Object.keys(metrics).length) return undefined;
  return { period, consolidation, source: "pdf", quality, metrics, uncertainty: [...uncertainty] };
}

export function createPdfFinancialFacts(input: CreatePdfFactsInput): FinancialFacts {
  const globallyAutomatic = input.extractQuality?.safeForAutomaticFacts !== false && input.unit !== "不明";
  const financialPageIsSafe = (pageQuality: PdfPageQuality | undefined) => !pageQuality
    || (pageQuality.score >= 70 && pageQuality.financialTableCandidate && !pageQuality.flags.includes("table_ambiguous"));
  const dividendPageIsSafe = (pageQuality: PdfPageQuality | undefined) => !pageQuality
    || (pageQuality.score >= 70 && !pageQuality.flags.includes("table_ambiguous"));
  const performanceAutomatic = globallyAutomatic && financialPageIsSafe(input.performancePageQuality);
  const forecastAutomatic = globallyAutomatic && financialPageIsSafe(input.forecastPageQuality);
  const dividendAutomatic = globallyAutomatic && dividendPageIsSafe(input.dividendPageQuality);
  const uncertainty: string[] = [];
  if (input.unit === "不明") uncertainty.push("主要表の金額単位を確認できないため、主要数値を確定していません");
  else if (!globallyAutomatic) uncertainty.push("PDFの表構造または抽出品質が不十分なため、主要数値を確定していません");
  else {
    if (input.performance && !performanceAutomatic) uncertainty.push("実績表ページの構造が曖昧なため、実績値を確定していません");
    if (input.forecast && !forecastAutomatic) uncertainty.push("予想表ページの構造が曖昧なため、予想値を確定していません");
    if ((input.dividendAnnual || input.dividendYearEnd) && !dividendAutomatic) uncertainty.push("配当表ページの構造が曖昧なため、配当値を確定していません");
  }
  const quality: FinancialFactQuality = !globallyAutomatic
    ? "low"
    : uncertainty.length || (input.extractQuality && input.extractQuality.score < 80) ? "medium" : "high";
  const performance = performanceAutomatic && input.performance
    ? rowToGroup(input.performance, input.unit, input.performance.period, input.performancePage, input.consolidated, quality, uncertainty)
    : undefined;
  const forecast = forecastAutomatic && input.forecast
    ? rowToGroup(input.forecast, input.unit, input.forecast.period || "通期予想", input.forecastPage, input.consolidated, quality, uncertainty)
    : undefined;
  return {
    performance,
    forecast,
    dividendAnnualYen: dividendAutomatic ? numeric(input.dividendAnnual) : undefined,
    dividendYearEndYen: dividendAutomatic ? numeric(input.dividendYearEnd) : undefined,
    forecastRevision: forecastAutomatic && (input.forecastRevision === "有" || input.forecastRevision === "無") ? input.forecastRevision : undefined,
    dividendRevision: dividendAutomatic && (input.dividendRevision === "有" || input.dividendRevision === "無") ? input.dividendRevision : undefined,
    quality,
    uncertainty
  };
}

function xbrlRowToGroup(
  row: XbrlMetricRow | undefined,
  unit: AmountUnit,
  periodFallback: string
): FinancialFactGroup | undefined {
  if (!row || row.quality !== "high" || (row.uncertainty?.length ?? 0) > 0) return undefined;
  const metrics: FinancialFactGroup["metrics"] = {};
  for (const meta of metricMeta) {
    const value = numeric(String(row[meta.value] ?? ""));
    if (typeof value !== "number") continue;
    metrics[meta.key] = {
      key: meta.key,
      valueYen: value * unitMultiplier(unit),
      growthRate: numeric(String(row[meta.growth] ?? "")),
      source: "xbrl",
      quality: "high",
      period: row.period || periodFallback,
      contextRef: row.context,
      consolidation: row.consolidation ?? "unknown",
      uncertainty: []
    };
  }
  if (!Object.keys(metrics).length) return undefined;
  return {
    period: row.period || periodFallback,
    periodStart: row.periodStart,
    periodEnd: row.periodEnd,
    consolidation: row.consolidation ?? "unknown",
    source: "xbrl",
    quality: "high",
    contextRef: row.context,
    metrics,
    uncertainty: []
  };
}

function mergeGroup(base: FinancialFactGroup | undefined, incoming: FinancialFactGroup | undefined): FinancialFactGroup | undefined {
  if (!incoming) return base;
  if (!base) return incoming;
  const metrics = { ...base.metrics, ...incoming.metrics };
  const sources = new Set(Object.values(metrics).map((fact) => fact?.source).filter(Boolean));
  const period = base.period || incoming.period;
  for (const fact of Object.values(metrics)) {
    if (fact) fact.period = period;
  }
  return {
    ...base,
    ...incoming,
    period,
    metrics,
    source: sources.size > 1 ? "mixed" : incoming.source,
    quality: sources.size > 1 ? "medium" : incoming.quality,
    uncertainty: Array.from(new Set([...base.uncertainty, ...incoming.uncertainty]))
  };
}

function normalizedPeriodMonth(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const normalized = value.normalize("NFKC");
  const iso = normalized.match(/(20\d{2})-(\d{2})(?:-\d{2})?/u);
  if (iso) return `${iso[1]}-${iso[2]}`;
  const japanese = normalized.match(/(20\d{2})年(\d{1,2})月期(?:第([1-4])四半期)?/u);
  if (!japanese) return undefined;
  let year = Number(japanese[1]);
  let month = Number(japanese[2]);
  const quarter = japanese[3] ? Number(japanese[3]) : 4;
  month -= (4 - quarter) * 3;
  while (month <= 0) { month += 12; year -= 1; }
  return `${year}-${String(month).padStart(2, "0")}`;
}

function compatibleIncomingGroup(
  base: FinancialFactGroup | undefined,
  incoming: FinancialFactGroup | undefined,
  label: string,
  reasons: string[]
): FinancialFactGroup | undefined {
  if (!base || !incoming) return incoming;
  if (base.consolidation !== "unknown" && incoming.consolidation !== "unknown" && base.consolidation !== incoming.consolidation) {
    reasons.push(`${label}のPDFとXBRLで連結・個別区分が一致しません`);
    return undefined;
  }
  const baseMonth = normalizedPeriodMonth(base.periodEnd || base.period);
  const incomingMonth = normalizedPeriodMonth(incoming.periodEnd || incoming.period);
  if (baseMonth && incomingMonth && baseMonth !== incomingMonth) {
    reasons.push(`${label}のPDFとXBRLで対象期間が一致しません（${baseMonth} / ${incomingMonth}）`);
    return undefined;
  }
  return incoming;
}

export function mergeVerifiedXbrlFacts(base: FinancialFacts, xbrl: XbrlExtractResult): { facts: FinancialFacts; applied: boolean; reasons: string[] } {
  const parsedPerformance = xbrlRowToGroup(xbrl.performance, xbrl.unit, "当期");
  const forecastRow = xbrl.forecast ? ({ ...xbrl.forecast, period: xbrl.forecast.periodEnd || "通期予想" } as XbrlMetricRow) : undefined;
  const parsedForecast = xbrlRowToGroup(forecastRow, xbrl.unit, "通期予想");
  const reasons: string[] = [];
  if (xbrl.performance && !parsedPerformance) reasons.push(...(xbrl.performance.uncertainty?.length ? xbrl.performance.uncertainty : ["XBRL実績contextの品質が不十分です"]));
  if (xbrl.forecast && !parsedForecast) reasons.push(...(xbrl.forecast.uncertainty?.length ? xbrl.forecast.uncertainty : ["XBRL予想contextの品質が不十分です"]));
  const performance = compatibleIncomingGroup(base.performance, parsedPerformance, "実績", reasons);
  const forecast = compatibleIncomingGroup(base.forecast, parsedForecast, "予想", reasons);
  const applied = Boolean(performance || forecast);
  if (!applied) return { facts: base, applied: false, reasons: Array.from(new Set(reasons)) };
  const mergedPerformance = mergeGroup(base.performance, performance);
  const mergedForecast = mergeGroup(base.forecast, forecast);
  const mergedGroups = [mergedPerformance, mergedForecast].filter(Boolean) as FinancialFactGroup[];
  const mergedQuality: FinancialFactQuality = mergedGroups.length && mergedGroups.every((group) => group.quality === "high")
    ? "high"
    : mergedGroups.some((group) => group.quality !== "low") ? "medium" : "low";
  const merged: FinancialFacts = {
    ...base,
    performance: mergedPerformance,
    forecast: mergedForecast,
    quality: mergedQuality,
    uncertainty: Array.from(new Set([...base.uncertainty, ...reasons]))
  };
  return { facts: merged, applied: true, reasons: Array.from(new Set(reasons)) };
}

function formatYen(valueYen: number): string {
  const abs = Math.abs(valueYen);
  if (abs >= 1_000_000_000_000) return `${(valueYen / 1_000_000_000_000).toLocaleString("ja-JP", { maximumFractionDigits: 2 })}兆円`;
  if (abs >= 100_000_000) return `${(valueYen / 100_000_000).toLocaleString("ja-JP", { maximumFractionDigits: 1 })}億円`;
  if (abs >= 1_000_000) return `${(valueYen / 1_000_000).toLocaleString("ja-JP", { maximumFractionDigits: 1 })}百万円`;
  if (abs >= 10_000) return `${(valueYen / 10_000).toLocaleString("ja-JP", { maximumFractionDigits: 1 })}万円`;
  return `${valueYen.toLocaleString("ja-JP")}円`;
}

function formatGrowth(value: number | undefined): { text?: string; tone: KeyMetricRow["growthTone"] } {
  if (typeof value !== "number") return { tone: "unknown" };
  if (value < 0) return { text: `${Math.abs(value).toFixed(1)}%減`, tone: "down" };
  if (value > 0) return { text: `${value.toFixed(1)}%増`, tone: "up" };
  return { text: "横ばい", tone: "flat" };
}

function metricLabel(key: FinancialMetricKey): string {
  return metricMeta.find((item) => item.key === key)?.label ?? key;
}

function groupRows(group: FinancialFactGroup | undefined): KeyMetricRow[] {
  if (!group) return [];
  return metricMeta.flatMap(({ key, label }) => {
    const fact = group.metrics[key];
    if (!fact) return [];
    const growth = formatGrowth(fact.growthRate);
    return [{ label, value: formatYen(fact.valueYen), growth: growth.text, growthTone: growth.tone }];
  });
}

function verdictFromFacts(facts: FinancialFacts): AnalysisReport["freeAiDigest"]["verdict"] {
  const growth = Object.values(facts.performance?.metrics ?? {}).flatMap((fact) => typeof fact?.growthRate === "number" ? [fact.growthRate] : []);
  if (growth.length < 2) return "unknown";
  const positive = growth.filter((value) => value > 0).length;
  const negative = growth.filter((value) => value < 0).length;
  if (negative >= 3) return "weak";
  if (positive >= 3) return "good";
  if (positive && negative) return "mixed";
  if (positive) return "good";
  if (negative) return "weak";
  return "neutral";
}

function verdictLabel(verdict: AnalysisReport["freeAiDigest"]["verdict"]): string {
  if (verdict === "good") return "業績は良好寄り";
  if (verdict === "weak") return "業績は弱含み";
  if (verdict === "mixed") return "業績は強弱混在";
  if (verdict === "neutral") return "業績は中立";
  return "業績判断は不確実";
}

function performanceSentence(group: FinancialFactGroup | undefined): string | undefined {
  if (!group) return undefined;
  const parts = metricMeta.flatMap(({ key, label }) => {
    const fact = group.metrics[key];
    if (!fact) return [];
    const growth = formatGrowth(fact.growthRate).text;
    return [`${label}${formatYen(fact.valueYen)}${growth ? `（${growth}）` : ""}`];
  });
  return parts.length ? `${group.period || "当期"}は${parts.join("、")}。` : undefined;
}

function pointsFromGrowth(group: FinancialFactGroup | undefined, positive: boolean): string[] {
  if (!group) return [];
  return metricMeta.flatMap(({ key, label }) => {
    const growth = group.metrics[key]?.growthRate;
    if (typeof growth !== "number" || (positive ? growth <= 0 : growth >= 0)) return [];
    return [`${label}が${positive ? "前年同期比" : "前年同期比"} ${Math.abs(growth).toFixed(1)}% ${positive ? "増" : "減"}`];
  });
}

function warningPoints(warnings: WarningItem[]): string[] {
  return warnings.slice(0, 4).map((warning) => `${warning.label}（${warning.level === "high" ? "要注意" : "参考"}）`);
}

export function rebuildReportFromFinancialFacts(report: AnalysisReport, facts: FinancialFacts): AnalysisReport {
  report.financialFacts = facts;
  const keyMetrics = groupRows(facts.performance);
  const forecastMetrics = groupRows(facts.forecast);
  const verdict = verdictFromFacts(facts);
  const label = verdictLabel(verdict);
  const performance = performanceSentence(facts.performance);
  const forecast = performanceSentence(facts.forecast)?.replace(/^通期予想は/, "通期予想は");
  const dividendLine = typeof facts.dividendAnnualYen === "number"
    ? `配当予想 年間${facts.dividendAnnualYen.toLocaleString("ja-JP")}円${typeof facts.dividendYearEndYen === "number" ? `（期末${facts.dividendYearEndYen.toLocaleString("ja-JP")}円）` : ""}${facts.dividendRevision === "有" ? "（修正あり）" : facts.dividendRevision === "無" ? "（修正なし）" : ""}`
    : undefined;
  const forecastRevisionLine = facts.forecastRevision === "有"
    ? "通期業績予想は直近予想から修正あり"
    : facts.forecastRevision === "無" ? "通期業績予想の修正なし" : undefined;

  const goodPoints = pointsFromGrowth(facts.performance, true);
  const concernPoints = [...pointsFromGrowth(facts.performance, false), ...warningPoints(report.warnings)];
  if (facts.uncertainty.length) concernPoints.push(...facts.uncertainty.map((item) => `不確実: ${item}`));
  if (!goodPoints.length) goodPoints.push("確定できるポジティブ材料は抽出されませんでした");
  if (!concernPoints.length) concernPoints.push("強い注意語句は検出されませんでした");

  const keyFigures = [facts.performance, facts.forecast].flatMap((group) => group
    ? metricMeta.flatMap(({ key, label: metricName }) => {
        const fact = group.metrics[key];
        if (!fact) return [];
        const source = fact.source === "xbrl" ? `XBRL${fact.contextRef ? ` ${fact.contextRef}` : ""}` : `PDF${fact.pageNumber ? ` ${fact.pageNumber}P` : ""}`;
        return [`${group === facts.forecast ? "通期予想" : ""}${metricName}: ${formatYen(fact.valueYen)}（${source}）`];
      })
    : []);

  const summaryParts = [performance, forecast, dividendLine ? `${dividendLine}。` : undefined].filter(Boolean) as string[];
  const oneLineSummary = summaryParts.length ? `${label}。${summaryParts.join("")}` : `${label}。主要数値は抽出品質を満たさず確定していません。`;
  report.oneLineSummary = oneLineSummary;
  report.overallTone = verdict === "good" ? (report.warnings.length ? "mixed" : "positive") : verdict === "weak" ? "caution" : verdict === "mixed" ? "mixed" : "unknown";
  report.confidence = facts.quality === "high" && facts.uncertainty.length === 0 ? "high" : (facts.performance || facts.forecast) ? "medium" : "low";
  report.freeAiDigest = {
    ...report.freeAiDigest,
    verdict,
    verdictLabel: label,
    headline: performance ? `${label}（${facts.performance?.period || "当期"}）` : label,
    plainSummary: [label, ...summaryParts].join("\n"),
    goodPoints: Array.from(new Set(goodPoints)),
    concernPoints: Array.from(new Set(concernPoints)),
    keyFigures,
    keyMetrics,
    forecastMetrics,
    dividendLine,
    forecastRevisionLine,
    method: "統一facts（PDF座標解析 + 検証済みXBRL）"
  };
  return report;
}

export function applyVerifiedXbrlToReport(report: AnalysisReport, xbrl: XbrlExtractResult): { applied: boolean; reasons: string[] } {
  const base = report.financialFacts ?? { quality: "low" as const, uncertainty: ["PDFから統一factsを生成できませんでした"] };
  const merged = mergeVerifiedXbrlFacts(base, xbrl);
  if (merged.applied) rebuildReportFromFinancialFacts(report, merged.facts);
  return { applied: merged.applied, reasons: merged.reasons };
}

export function financialFactsToAiFacts(facts: FinancialFacts | undefined): AiFact[] {
  if (!facts) return [];
  return [facts.performance, facts.forecast].flatMap((group) => group
    ? metricMeta.flatMap(({ key, label }) => {
        const fact = group.metrics[key];
        if (!fact) return [];
        return [{
          label: `${group === facts.forecast ? "通期予想" : "実績"}${label}`,
          value: `${formatYen(fact.valueYen)}${typeof fact.growthRate === "number" ? ` / ${formatGrowth(fact.growthRate).text}` : ""}`,
          page: fact.pageNumber,
          source: fact.source === "xbrl" ? `XBRL:${fact.contextRef || "context確認済み"}` : "PDF"
        }];
      })
    : []);
}

export function financialFactsToAccuracyMetrics(facts: FinancialFacts | undefined): Record<string, AccuracyMetric> {
  if (!facts) return {};
  const output: Record<string, AccuracyMetric> = {};
  for (const [groupName, group] of [["performance", facts.performance], ["forecast", facts.forecast]] as const) {
    for (const [key, fact] of Object.entries(group?.metrics ?? {}) as Array<[FinancialMetricKey, FinancialMetricFact]>) {
      output[`${groupName}.${key}`] = { value: fact.valueYen, unit: "JPY" };
    }
  }
  if (typeof facts.dividendAnnualYen === "number") {
    output["dividend.annual"] = { value: facts.dividendAnnualYen, unit: "JPY_PER_SHARE" };
  }
  if (typeof facts.dividendYearEndYen === "number") {
    output["dividend.yearEnd"] = { value: facts.dividendYearEndYen, unit: "JPY_PER_SHARE" };
  }
  return output;
}

export type AccuracyMetric = {
  value: number;
  unit: "JPY" | "JPY_PER_SHARE" | "PERCENT";
  tolerance?: number;
};

export type AccuracyRecord = {
  documentId?: string;
  documentType?: string;
  period?: string;
  consolidated?: boolean;
  metrics: Record<string, AccuracyMetric>;
  warnings: string[];
  referencePages: number[];
};

export type AccuracyCase = {
  id: string;
  source: "real_local_pdf" | "official_excerpt" | "synthetic_regression";
  expected: AccuracyRecord;
  actual: AccuracyRecord;
};

export type AccuracyRate = { matched: number; total: number; rate: number };

export type AccuracySummary = {
  caseCount: number;
  selection: AccuracyRate;
  metricExact: AccuracyRate;
  unit: AccuracyRate;
  period: AccuracyRate;
  consolidation: AccuracyRate;
  warningPrecision: number;
  warningRecall: number;
  warningF1: number;
  referencePageCoverage: AccuracyRate;
  criticalErrors: string[];
};

export type AccuracyGate = {
  passed: boolean;
  reasons: string[];
};

function rate(matched: number, total: number): AccuracyRate {
  return { matched, total, rate: total === 0 ? 1 : matched / total };
}

function sameMetric(expected: AccuracyMetric, actual: AccuracyMetric | undefined): boolean {
  if (!actual || expected.unit !== actual.unit) return false;
  const tolerance = expected.tolerance ?? 0;
  return Math.abs(expected.value - actual.value) <= tolerance;
}

function samePeriod(expected: string, actual: string | undefined): boolean {
  if (!actual) return false;
  const normalize = (value: string) => value.normalize("NFKC").replace(/[\s　]+/g, "");
  return normalize(expected) === normalize(actual);
}

export function evaluateAccuracy(cases: AccuracyCase[]): AccuracySummary {
  let selectionMatched = 0;
  let selectionTotal = 0;
  let metricMatched = 0;
  let metricTotal = 0;
  let unitMatched = 0;
  let unitTotal = 0;
  let periodMatched = 0;
  let periodTotal = 0;
  let consolidationMatched = 0;
  let consolidationTotal = 0;
  let warningTruePositive = 0;
  let warningFalsePositive = 0;
  let warningFalseNegative = 0;
  let pageMatched = 0;
  let pageTotal = 0;
  const criticalErrors: string[] = [];

  for (const testCase of cases) {
    const { expected, actual } = testCase;
    if (expected.documentId || expected.documentType) {
      selectionTotal += 1;
      const selected = (!expected.documentId || expected.documentId === actual.documentId)
        && (!expected.documentType || expected.documentType === actual.documentType);
      if (selected) selectionMatched += 1;
      else criticalErrors.push(`${testCase.id}: document_selection_mismatch`);
    }

    if (expected.period) {
      periodTotal += 1;
      if (samePeriod(expected.period, actual.period)) periodMatched += 1;
      else criticalErrors.push(`${testCase.id}: period_mismatch`);
    }

    if (typeof expected.consolidated === "boolean") {
      consolidationTotal += 1;
      if (expected.consolidated === actual.consolidated) consolidationMatched += 1;
      else criticalErrors.push(`${testCase.id}: consolidation_mismatch`);
    }

    for (const [name, expectedMetric] of Object.entries(expected.metrics)) {
      const actualMetric = actual.metrics[name];
      metricTotal += 1;
      unitTotal += 1;
      if (actualMetric?.unit === expectedMetric.unit) unitMatched += 1;
      else criticalErrors.push(`${testCase.id}: ${name}_unit_mismatch`);
      if (sameMetric(expectedMetric, actualMetric)) metricMatched += 1;
      else criticalErrors.push(`${testCase.id}: ${name}_value_mismatch`);
    }

    const expectedWarnings = new Set(expected.warnings);
    const actualWarnings = new Set(actual.warnings);
    for (const warning of actualWarnings) {
      if (expectedWarnings.has(warning)) warningTruePositive += 1;
      else warningFalsePositive += 1;
    }
    for (const warning of expectedWarnings) {
      if (!actualWarnings.has(warning)) warningFalseNegative += 1;
    }

    const actualPages = new Set(actual.referencePages);
    for (const page of expected.referencePages) {
      pageTotal += 1;
      if (actualPages.has(page)) pageMatched += 1;
    }
  }

  const warningPrecision = warningTruePositive + warningFalsePositive === 0
    ? (warningFalseNegative === 0 ? 1 : 0)
    : warningTruePositive / (warningTruePositive + warningFalsePositive);
  const warningRecall = warningTruePositive + warningFalseNegative === 0
    ? 1
    : warningTruePositive / (warningTruePositive + warningFalseNegative);
  const warningF1 = warningPrecision + warningRecall === 0
    ? 0
    : (2 * warningPrecision * warningRecall) / (warningPrecision + warningRecall);

  return {
    caseCount: cases.length,
    selection: rate(selectionMatched, selectionTotal),
    metricExact: rate(metricMatched, metricTotal),
    unit: rate(unitMatched, unitTotal),
    period: rate(periodMatched, periodTotal),
    consolidation: rate(consolidationMatched, consolidationTotal),
    warningPrecision,
    warningRecall,
    warningF1,
    referencePageCoverage: rate(pageMatched, pageTotal),
    criticalErrors
  };
}

export function evaluateAccuracyGate(summary: AccuracySummary, baselineWarningF1 = 0): AccuracyGate {
  const reasons: string[] = [];
  if (summary.caseCount === 0) reasons.push("golden_cases_missing");
  // rate() は分母0を1として扱うため、空のgolden fixtureを完全一致と誤認しないよう
  // ゲート側で必須評価軸の実データ件数を確認する。
  if (summary.selection.total === 0) reasons.push("document_selection_cases_missing");
  if (summary.metricExact.total === 0) reasons.push("critical_metrics_missing");
  if (summary.period.total === 0) reasons.push("period_cases_missing");
  if (summary.consolidation.total === 0) reasons.push("consolidation_cases_missing");
  if (summary.referencePageCoverage.total === 0) reasons.push("reference_pages_missing");
  if (summary.selection.rate !== 1) reasons.push("document_selection_not_exact");
  if (summary.metricExact.rate !== 1) reasons.push("critical_metrics_not_exact");
  if (summary.unit.rate !== 1) reasons.push("metric_units_not_exact");
  if (summary.period.rate !== 1) reasons.push("period_not_exact");
  if (summary.consolidation.rate !== 1) reasons.push("consolidation_not_exact");
  if (summary.warningF1 < baselineWarningF1) reasons.push("warning_f1_regressed");
  if (summary.referencePageCoverage.rate < 0.9) reasons.push("reference_page_coverage_below_90_percent");
  if (summary.criticalErrors.length > 0) reasons.push("critical_errors_present");
  return { passed: reasons.length === 0, reasons };
}

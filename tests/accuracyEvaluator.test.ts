import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  evaluateAccuracy,
  evaluateAccuracyGate,
  type AccuracyCase
} from "../src/lib/accuracyEvaluator";
import { financialFactsToAccuracyMetrics } from "../src/lib/financialFacts";
import { analyzeDisclosureText } from "../src/lib/ruleAnalyzer";
import type { DisclosureItem, PdfExtractQuality } from "../src/lib/types";

function loadGoldenCases(): Array<Omit<AccuracyCase, "actual">> {
  const url = new URL("./fixtures/golden/cases.json", import.meta.url);
  return JSON.parse(readFileSync(fileURLToPath(url), "utf8")) as Array<Omit<AccuracyCase, "actual">>;
}

const syntheticText: Record<string, string> = {
  "jgaap-full-year-positive": `2026年3月期 決算短信〔日本基準〕（連結）\n（単位：百万円）\n2026年3月期 55000 10.5 8500 25.0 8700 24.0 6300 28.0\n売上高 営業利益 経常利益 当期純利益`,
  "jgaap-quarterly-loss": `2026年3月期第2四半期 決算短信〔日本基準〕（連結）\n（単位：百万円）\n2026年3月期第2四半期 8000 -12.5 -500 -150.0 -450 -148.0 -320 -160.0\n売上高 営業利益 経常利益 当期純利益\n業績予想を下方修正`,
  "jgaap-thousand-yen-unit": `2026年3月期 決算短信〔日本基準〕（連結）\n（単位：千円）\n2026年3月期 1500000 12.0 200000 15.0 210000 14.0 140000 20.0\n売上高 営業利益 経常利益 当期純利益`,
  "ifrs-revenue-profit": `2026年3月期第1四半期 決算短信〔IFRS〕（連結）\n（単位：百万円）\n2026年3月期第1四半期 72000 8.0 8000 7.0 7500 6.0 6400 9.0\n売上収益 営業利益 税引前利益 親会社の所有者に帰属する四半期利益`,
  "ambiguous-table-must-not-confirm": `2026年3月期 決算短信〔日本基準〕（連結）\n（単位：百万円）\n2026年3月期 99999 99.0 9999 99.0 9999 99.0 9999 99.0\n売上高 営業利益 経常利益 当期純利益`
};

function disclosureFor(id: string): DisclosureItem {
  return {
    id,
    title: "精度評価用 決算短信",
    ticker: "0000",
    sourceUrl: "https://example.invalid/",
    documentType: "earnings_release",
    score: 0,
    scoreReasons: []
  };
}

describe("accuracyEvaluator", () => {
  it("6件のゴールドケースを読み込み、完全一致を合格にできる", () => {
    const cases = loadGoldenCases();
    expect(cases).toHaveLength(6);
    expect(cases.some((item) => item.source === "real_local_pdf")).toBe(true);
    const summary = evaluateAccuracy(cases.map((item) => ({ ...item, actual: structuredClone(item.expected) })));
    expect(summary.metricExact.rate).toBe(1);
    expect(summary.unit.rate).toBe(1);
    expect(summary.warningF1).toBe(1);
    expect(evaluateAccuracyGate(summary, 1)).toEqual({ passed: true, reasons: [] });
  });

  it("単位違い・数値違い・ページ不足を重大エラーとして検出する", () => {
    const item = loadGoldenCases()[0];
    const actual = structuredClone(item.expected);
    actual.metrics["performance.sales"] = { value: 148966, unit: "JPY" };
    actual.referencePages = [1];
    const summary = evaluateAccuracy([{ ...item, actual }]);
    expect(summary.metricExact.rate).toBeLessThan(1);
    expect(summary.referencePageCoverage.rate).toBe(0.5);
    expect(evaluateAccuracyGate(summary).passed).toBe(false);
    expect(summary.criticalErrors).toContain("5451-2026-q3-real: performance.sales_value_mismatch");
  });

  it("5件の合成回帰ケースを実際の解析結果で定量評価する", () => {
    const lowQuality: PdfExtractQuality = {
      score: 40,
      flags: ["table_ambiguous"],
      emptyPageRate: 0,
      ambiguousTablePages: [1],
      safeForAutomaticFacts: false
    };
    const cases: AccuracyCase[] = loadGoldenCases()
      .filter((item) => item.source === "synthetic_regression")
      .map((item) => {
        const quality = item.id === "ambiguous-table-must-not-confirm" ? lowQuality : undefined;
        const report = analyzeDisclosureText({
          disclosure: disclosureFor(item.id),
          pages: [{ pageNumber: 1, text: syntheticText[item.id] }],
          quality
        });
        const extractionWarnings = report.financialFacts?.uncertainty.length ? ["抽出品質が不十分"] : [];
        return {
          ...item,
          actual: {
            documentId: report.sourceDisclosure?.id,
            documentType: report.sourceDisclosure?.documentType,
            period: report.financialFacts?.performance?.period,
            consolidated: report.financialFacts?.performance?.consolidation === "consolidated",
            metrics: financialFactsToAccuracyMetrics(report.financialFacts),
            warnings: [...report.warnings.map((warning) => warning.label), ...extractionWarnings],
            referencePages: Array.from(new Set(report.sourceCheckpoints.map((checkpoint) => checkpoint.pageNumber)))
          }
        };
      });
    const summary = evaluateAccuracy(cases);
    expect(evaluateAccuracyGate(summary, 1)).toEqual({ passed: true, reasons: [] });
  });

  it("期間の全角・半角差は同一期間として比較する", () => {
    const item = loadGoldenCases()[0];
    const actual = structuredClone(item.expected);
    actual.period = "２０２６年３月期第３四半期";
    const summary = evaluateAccuracy([{ ...item, actual }]);
    expect(summary.period.rate).toBe(1);
  });

  it("ケース数だけ存在して必須評価軸の分母が空のgolden fixtureを不合格にする", () => {
    const emptyCase: AccuracyCase = {
      id: "empty-golden-fixture",
      source: "synthetic_regression",
      expected: { metrics: {}, warnings: [], referencePages: [] },
      actual: { metrics: {}, warnings: [], referencePages: [] }
    };

    const summary = evaluateAccuracy([emptyCase]);
    const gate = evaluateAccuracyGate(summary);

    expect(summary.caseCount).toBe(1);
    expect(gate.passed).toBe(false);
    expect(gate.reasons).toEqual([
      "document_selection_cases_missing",
      "critical_metrics_missing",
      "period_cases_missing",
      "consolidation_cases_missing",
      "reference_pages_missing"
    ]);
  });
});

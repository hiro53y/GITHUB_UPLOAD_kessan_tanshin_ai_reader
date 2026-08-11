import { describe, expect, it } from "vitest";
import { applyVerifiedXbrlToReport } from "../src/lib/financialFacts";
import { analyzeDisclosureText } from "../src/lib/ruleAnalyzer";
import type { PdfExtractQuality, PdfPageQuality } from "../src/lib/types";
import type { XbrlExtractResult } from "../src/lib/xbrlExtract";

const positiveText = `
2026年3月期 決算短信〔日本基準〕（連結）
（単位：百万円）
経営成績
2026年3月期 55000 10.5 8500 25.0 8700 24.0 6300 28.0
売上高 営業利益 経常利益 親会社株主に帰属する当期純利益
`;

function reportFrom(text: string, quality?: PdfExtractQuality) {
  return analyzeDisclosureText({ pages: [{ pageNumber: 1, text }], quality });
}

describe("統一financial facts", () => {
  it("PDF品質ゲートが不合格なら、もっともらしい数値と判定を確定表示しない", () => {
    const quality: PdfExtractQuality = {
      score: 40,
      flags: ["table_ambiguous"],
      emptyPageRate: 0,
      ambiguousTablePages: [1],
      safeForAutomaticFacts: false
    };
    const report = reportFrom(`${positiveText}\n配当予想からの修正の有無：有\n2026年3月期（予想） 0 0 0 60 60`, quality);
    expect(report.financialFacts?.performance).toBeUndefined();
    expect(report.freeAiDigest.keyMetrics).toEqual([]);
    expect(report.freeAiDigest.verdict).toBe("unknown");
    expect(report.confidence).toBe("low");
    expect(report.freeAiDigest.concernPoints.join(" ")).toContain("不確実");
    expect(report.financialFacts?.dividendAnnualYen).toBeUndefined();
    expect(report.financialFacts?.dividendRevision).toBeUndefined();
  });

  it("全体品質が合格でも、曖昧な実績ページの値だけは確定しない", () => {
    const high: PdfPageQuality = { score: 100, flags: [], tableLike: true, financialTableCandidate: true, lineCount: 10 };
    const ambiguous: PdfPageQuality = { score: 70, flags: ["table_ambiguous"], tableLike: true, financialTableCandidate: true, lineCount: 8 };
    const report = analyzeDisclosureText({
      pages: [
        { pageNumber: 1, text: "（単位：百万円）\n連結業績予想\n通期 60000 5.0 9000 6.0 9200 7.0 7000 8.0", quality: high },
        { pageNumber: 2, text: positiveText, quality: ambiguous }
      ],
      quality: { score: 85, flags: ["table_ambiguous"], emptyPageRate: 0, ambiguousTablePages: [2], safeForAutomaticFacts: true }
    });
    expect(report.financialFacts?.performance).toBeUndefined();
    expect(report.financialFacts?.forecast?.metrics.sales?.valueYen).toBe(60_000_000_000);
    expect(report.financialFacts?.uncertainty.join(" ")).toContain("実績表ページ");
  });

  it("配当の説明ページが高品質でも、数値行ページが曖昧なら配当を確定しない", () => {
    const high: PdfPageQuality = { score: 100, flags: [], tableLike: true, financialTableCandidate: true, lineCount: 10 };
    const ambiguous: PdfPageQuality = { score: 70, flags: ["table_ambiguous"], tableLike: true, financialTableCandidate: true, lineCount: 8 };
    const report = analyzeDisclosureText({
      pages: [
        { pageNumber: 1, text: "（単位：百万円）\n連結業績予想\n通期 60000 5.0 9000 6.0 9200 7.0 7000 8.0\n配当予想に関する説明", quality: high },
        { pageNumber: 2, text: `${positiveText}\n配当予想からの修正の有無：無\n2026年3月期（予想） 0 0 0 40 60`, quality: ambiguous }
      ],
      quality: { score: 85, flags: ["table_ambiguous"], emptyPageRate: 0, ambiguousTablePages: [2], safeForAutomaticFacts: true }
    });
    expect(report.financialFacts?.dividendAnnualYen).toBeUndefined();
    expect(report.financialFacts?.uncertainty.join(" ")).toContain("配当表ページ");
  });

  it("検証済みXBRLを採用したら、数値・判定・要約・根拠を同じfactsから再生成する", () => {
    const report = reportFrom(positiveText);
    expect(report.freeAiDigest.verdict).toBe("good");
    const row = {
      period: "2026-03-31",
      sales: "100",
      salesGrowth: "-10.0",
      operatingProfit: "10",
      operatingProfitGrowth: "-20.0",
      ordinaryProfit: "9",
      ordinaryProfitGrowth: "-25.0",
      netProfit: "5",
      netProfitGrowth: "-30.0",
      source: "summary" as const,
      context: "CurrentConsolidatedDuration",
      contextKind: "current" as const,
      periodStart: "2025-04-01",
      periodEnd: "2026-03-31",
      consolidation: "consolidated" as const,
      quality: "high" as const,
      uncertainty: []
    };
    const xbrl: XbrlExtractResult = { ok: true, performance: row, unit: "百万円", source: "summary" };
    const applied = applyVerifiedXbrlToReport(report, xbrl);
    expect(applied).toEqual({ applied: true, reasons: [] });
    expect(report.financialFacts?.performance?.metrics.sales?.source).toBe("xbrl");
    expect(report.financialFacts?.performance?.metrics.sales?.valueYen).toBe(100_000_000);
    expect(report.freeAiDigest.keyMetrics.find((metric) => metric.label === "売上高")?.value).toBe("1億円");
    expect(report.freeAiDigest.verdict).toBe("weak");
    expect(report.oneLineSummary).toContain("10.0%減");
    expect(report.freeAiDigest.keyFigures.join(" ")).toContain("XBRL CurrentConsolidatedDuration");
    expect(report.financialFacts?.quality).toBe("high");
  });

  it("contextが不確実なXBRLはPDF factsを上書きしない", () => {
    const report = reportFrom(positiveText);
    const before = report.financialFacts?.performance?.metrics.sales?.valueYen;
    const xbrl: XbrlExtractResult = {
      ok: true,
      unit: "百万円",
      source: "summary",
      performance: {
        period: "当期",
        sales: "1",
        salesGrowth: "0",
        operatingProfit: "",
        operatingProfitGrowth: "",
        ordinaryProfit: "",
        ordinaryProfitGrowth: "",
        netProfit: "",
        netProfitGrowth: "",
        quality: "medium",
        consolidation: "unknown",
        uncertainty: ["連結・個別区分を確定できません"]
      }
    };
    const applied = applyVerifiedXbrlToReport(report, xbrl);
    expect(applied.applied).toBe(false);
    expect(report.financialFacts?.performance?.metrics.sales?.valueYen).toBe(before);
  });

  it("対象期間が異なるXBRLは高品質でもPDF factsを上書きしない", () => {
    const report = reportFrom(positiveText);
    const before = report.financialFacts?.performance?.metrics.sales?.valueYen;
    const xbrl: XbrlExtractResult = {
      ok: true,
      unit: "百万円",
      source: "summary",
      performance: {
        period: "2024-03-31",
        periodEnd: "2024-03-31",
        sales: "1", salesGrowth: "1", operatingProfit: "1", operatingProfitGrowth: "1",
        ordinaryProfit: "1", ordinaryProfitGrowth: "1", netProfit: "1", netProfitGrowth: "1",
        quality: "high", consolidation: "consolidated", uncertainty: []
      }
    };
    const applied = applyVerifiedXbrlToReport(report, xbrl);
    expect(applied.applied).toBe(false);
    expect(applied.reasons.join(" ")).toContain("対象期間");
    expect(report.financialFacts?.performance?.metrics.sales?.valueYen).toBe(before);
  });
});

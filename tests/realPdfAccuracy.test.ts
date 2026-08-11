import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { evaluateAccuracy, evaluateAccuracyGate, type AccuracyCase } from "../src/lib/accuracyEvaluator";
import { financialFactsToAccuracyMetrics } from "../src/lib/financialFacts";
import { extractPdfText } from "../src/lib/pdfExtract";
import { analyzeDisclosureText } from "../src/lib/ruleAnalyzer";
import type { DisclosureItem } from "../src/lib/types";

const sourceUrl = new URL("./fixtures/golden/5451_2026_q3_140120260206549899.pdf", import.meta.url);
const sourcePath = fileURLToPath(sourceUrl);
const goldenCases = JSON.parse(readFileSync(fileURLToPath(new URL("./fixtures/golden/cases.json", import.meta.url)), "utf8")) as Array<Omit<AccuracyCase, "actual">>;
const disclosure: DisclosureItem = {
  id: "140120260206549899",
  disclosedAt: "2026-02-06T15:30:00+09:00",
  title: "2026年3月期 第3四半期決算短信〔日本基準〕（連結）",
  ticker: "5451",
  companyName: "株式会社淀川製鋼所",
  pdfUrl: "https://example.invalid/140120260206549899.pdf",
  sourceUrl: "https://www.release.tdnet.info/",
  documentType: "earnings_release",
  score: 0,
  scoreReasons: []
};

describe("実PDFゴールドケース 5451 2026年3月期第3四半期", () => {
  it("座標復元した実PDFからページと品質情報を取得できる", async () => {
    expect(existsSync(sourcePath), "実PDFゴールドfixtureがありません").toBe(true);
    const bytes = readFileSync(sourcePath);
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    const pdf = await extractPdfText(buffer);
    expect(pdf.totalPages).toBe(10);
    expect(pdf.pages[0].lines?.length).toBeGreaterThan(10);
    expect(pdf.pages[0].text).toContain("148,966");
    expect(pdf.quality).toBeTruthy();

    const report = analyzeDisclosureText({ pages: pdf.pages, quality: pdf.quality, disclosure });
    // 公式PDFの正解値。表示文字列ではなく円に正規化したfactsを完全一致で検証する。
    expect(pdf.quality?.safeForAutomaticFacts).toBe(true);
    expect(report.financialFacts?.performance?.metrics.sales?.valueYen).toBe(148_966_000_000);
    expect(report.financialFacts?.performance?.metrics.operatingProfit?.valueYen).toBe(9_503_000_000);
    expect(report.financialFacts?.performance?.metrics.ordinaryProfit?.valueYen).toBe(13_485_000_000);
    expect(report.financialFacts?.performance?.metrics.netProfit?.valueYen).toBe(9_438_000_000);
    expect(report.financialFacts?.forecast?.metrics.sales?.valueYen).toBe(199_000_000_000);
    expect(report.financialFacts?.forecast?.metrics.operatingProfit?.valueYen).toBe(11_600_000_000);
    expect(report.financialFacts?.forecast?.metrics.ordinaryProfit?.valueYen).toBe(17_000_000_000);
    expect(report.financialFacts?.forecast?.metrics.netProfit?.valueYen).toBe(11_500_000_000);
    expect(report.financialFacts?.dividendAnnualYen).toBe(60);
    expect(report.freeAiDigest.verdict).toBe("weak");
    expect(report.oneLineSummary).toContain("売上高1,489.7億円");
    expect(report.warnings.map((warning) => warning.label)).toEqual(["減収", "減益", "減損・訴訟"]);

    const golden = goldenCases.find((item) => item.id === "5451-2026-q3-real");
    expect(golden).toBeTruthy();
    const actual = {
      documentId: report.sourceDisclosure?.id,
      documentType: report.sourceDisclosure?.documentType,
      period: report.financialFacts?.performance?.period,
      consolidated: report.financialFacts?.performance?.consolidation === "consolidated",
      metrics: financialFactsToAccuracyMetrics(report.financialFacts),
      warnings: report.warnings.map((warning) => warning.label),
      referencePages: Array.from(new Set(report.sourceCheckpoints.map((checkpoint) => checkpoint.pageNumber)))
    };
    const summary = evaluateAccuracy([{ ...golden!, actual }]);
    expect(evaluateAccuracyGate(summary, 1)).toEqual({ passed: true, reasons: [] });
  }, 30_000);
});

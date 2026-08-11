import { describe, expect, it } from "vitest";
import { classifyDocumentTitle } from "../src/lib/disclosureScorer";
import { analyzeDisclosureText } from "../src/lib/ruleAnalyzer";

/**
 * ruleAnalyzer の振る舞いを fixture テキストで検証する。
 *
 * 注：実在企業の決算短信PDFテキストではなく、構造を模した合成データ。
 * 数値・社名はテスト用のものであり、実在企業を指すものではない。
 */

const fixtureTypicalQuarterly = `
2026年3月期第1四半期決算短信〔日本基準〕（連結）
ABC株式会社
（単位：百万円）

連結業績予想
通期 50000 5.0 8000 10.0 8500 12.0 6000 8.0

経営成績
2026年3月期第1四半期 12345 8.5 1234 -2.3 1500 5.0 800 -1.0
売上高 営業利益 経常利益 親会社株主に帰属する四半期純利益
業績予想からの修正の有無：無
配当予想からの修正の有無：無
2026年3月期（予想） 期末 40.00 年間 80.00
`;

const fixtureFullYear = `
2026年3月期 決算短信〔日本基準〕（連結）
DEF株式会社
（単位：百万円）

通期業績予想
連結業績予想 売上高 60000 12.0 営業利益 9500 18.0 経常利益 9800 17.5 親会社株主に帰属する当期純利益 7000 22.0

経営成績
2026年3月期 55000 10.5 8500 25.0 8700 24.0 6300 28.0
業績予想からの修正の有無：有
配当予想からの修正の有無：有
2026年3月期（予想） 期末 50.00 年間 100.00
`;

const fixtureThousandYenUnit = `
2026年3月期 決算短信〔日本基準〕（連結）
GHI株式会社
（単位：千円）

経営成績
2026年3月期 売上高 1500000 12.0 営業利益 200000 15.0 経常利益 210000 14.0 当期純利益 140000 20.0
`;

const fixtureNegativeGrowth = `
2026年3月期第2四半期決算短信〔日本基準〕（連結）
JKL株式会社
（単位：百万円）

経営成績
2026年3月期第2四半期 売上高 8000 △12.5 営業利益 △500 △150.0 経常利益 △450 △148.0 親会社株主に帰属する四半期純利益 △320 △160.0

通期業績予想 売上高 15000 △10.0 営業利益 △800 △200.0 経常利益 △750 △195.0 当期純利益 △500 △200.0
業績予想からの修正の有無：有 下方修正
`;

function makePages(text: string) {
  return text.split("\n\n").map((chunk, i) => ({ pageNumber: i + 1, text: chunk }));
}

describe("ruleAnalyzer.analyzeDisclosureText - 業績抽出", () => {
  it("典型的な四半期短信から売上高・営業利益・経常利益・純利益を取得できる", () => {
    const report = analyzeDisclosureText({ pages: makePages(fixtureTypicalQuarterly) });
    const km = report.freeAiDigest.keyMetrics;
    expect(km.length).toBeGreaterThanOrEqual(3);
    const sales = km.find((k) => k.label === "売上高");
    expect(sales).toBeTruthy();
    expect(sales?.value).toMatch(/123|億円|百万円/);
  });

  it("通期予想も別テーブルとして抽出される", () => {
    const report = analyzeDisclosureText({ pages: makePages(fixtureFullYear) });
    expect(report.freeAiDigest.forecastMetrics.length).toBeGreaterThan(0);
  });

  it("千円単位の短信でも数値が出力される（桁数が極端に大きくならない）", () => {
    const report = analyzeDisclosureText({ pages: makePages(fixtureThousandYenUnit) });
    const km = report.freeAiDigest.keyMetrics;
    expect(km.length).toBeGreaterThan(0);
    const sales = km.find((k) => k.label === "売上高");
    expect(sales).toBeTruthy();
    // 千円単位なら 1500000千円 = 15億円。兆円表示にはならないこと
    expect(sales?.value).not.toMatch(/兆円/);
  });

  it("減収減益のときに concernPoints に「減」項目が入る", () => {
    const report = analyzeDisclosureText({ pages: makePages(fixtureNegativeGrowth) });
    const concerns = report.freeAiDigest.concernPoints.join(" ");
    expect(concerns).toMatch(/減|下方修正/);
  });
});

describe("ruleAnalyzer.analyzeDisclosureText - 判定（verdict）", () => {
  it("増収・増益が並ぶ通期短信で verdict が good になる", () => {
    const report = analyzeDisclosureText({ pages: makePages(fixtureFullYear) });
    expect(report.freeAiDigest.verdict === "good" || report.freeAiDigest.verdict === "mixed").toBe(true);
  });

  it("減収減益・下方修正で verdict が weak になる", () => {
    const report = analyzeDisclosureText({ pages: makePages(fixtureNegativeGrowth) });
    expect(report.freeAiDigest.verdict).toBe("weak");
  });
});

describe("ruleAnalyzer - 警告検出", () => {
  it("「下方修正」の検出で warnings が増える", () => {
    const report = analyzeDisclosureText({ pages: makePages(fixtureNegativeGrowth) });
    const labels = report.warnings.map((w) => w.label);
    expect(labels).toContain("下方修正");
  });

  it("典型短信では下方修正の警告は出ない", () => {
    const report = analyzeDisclosureText({ pages: makePages(fixtureTypicalQuarterly) });
    const labels = report.warnings.map((w) => w.label);
    expect(labels).not.toContain("下方修正");
  });

  it("目次と『該当事項はありません』だけでは重要注記の警告を出さない", () => {
    const report = analyzeDisclosureText({ pages: [
      { pageNumber: 1, text: "目次\n（継続企業の前提に関する注記）…………………… 7" },
      { pageNumber: 7, text: "（継続企業の前提に関する注記）\n該当事項はありません。\n（重要な後発事象）\n該当事項なし。" }
    ] });
    const labels = report.warnings.map((warning) => warning.label);
    expect(labels).not.toContain("継続企業の前提");
    expect(labels).not.toContain("重要な後発事象");
  });

  it("『不確実性が後退』をリスク警告として扱わない", () => {
    const report = analyzeDisclosureText({ pages: [
      { pageNumber: 1, text: "政策の不確実性が後退していることから、回復が期待されます。" }
    ] });
    expect(report.warnings.map((warning) => warning.label)).not.toContain("不確実性");
  });

  it("別の注記が『該当なし』でも、実額のある減損損失は警告に残す", () => {
    const report = analyzeDisclosureText({ pages: [
      { pageNumber: 1, text: "減損損失 56百万円\n（重要な後発事象）\n該当事項はありません。" }
    ] });
    expect(report.warnings.map((warning) => warning.label)).toContain("減損・訴訟");
  });

  it("後続の別注記が『該当なし』でも、継続企業の重要な疑義は警告に残す", () => {
    const report = analyzeDisclosureText({ pages: [{ pageNumber: 1, text: `
（継続企業の前提に関する注記）
継続企業の前提に重要な疑義を生じさせる事象があります。
（重要な後発事象）
該当事項はありません。
` }] });
    expect(report.warnings.map((warning) => warning.label)).toContain("継続企業の前提");
  });

  it("点線がない目次見出しや、損失を計上していない否定文を警告にしない", () => {
    const report = analyzeDisclosureText({ pages: [
      { pageNumber: 1, text: "目次\n（継続企業の前提に関する注記） 9" },
      { pageNumber: 2, text: "当期は営業損失を計上しておりません。" }
    ] });
    const labels = report.warnings.map((warning) => warning.label);
    expect(labels).not.toContain("継続企業の前提");
    expect(labels).not.toContain("赤字・損失");
  });

  it("後段の円単位表ではなく、主要業績表直前の百万円単位を採用する", () => {
    const report = analyzeDisclosureText({ pages: [{ pageNumber: 1, text: `
（単位：百万円）
2026年3月期 55000 10.5 8500 25.0 8700 24.0 6300 28.0
（単位：円）
1株当たり当期純利益 120.00
` }] });
    expect(report.financialFacts?.performance?.metrics.sales?.valueYen).toBe(55_000_000_000);
  });

  it("成長率が欠損したラベル式で、次の指標値を成長率に流用しない", () => {
    const report = analyzeDisclosureText({ pages: [{ pageNumber: 1, text: `
2026年3月期 決算短信〔日本基準〕（連結）
（単位：百万円）
2026年3月期 売上高 100 営業利益 20 経常利益 21 当期純利益 10
` }] });
    expect(report.financialFacts?.performance?.metrics.sales?.growthRate).toBeUndefined();
    expect(report.freeAiDigest.verdict).toBe("unknown");
  });

  it("連結短信の後段に個別決算の参考情報があっても連結として扱う", () => {
    const report = analyzeDisclosureText({ pages: [{ pageNumber: 1, text: `${fixtureFullYear}\n参考：個別決算の概要` }] });
    expect(report.financialFacts?.performance?.consolidation).toBe("consolidated");
  });

  it("億円単位を円へ正規化し、単位のない主要表は確定しない", () => {
    const withUnit = analyzeDisclosureText({ pages: [{ pageNumber: 1, text: `
2026年3月期 決算短信〔日本基準〕（連結）
（単位：億円）
2026年3月期 550 10.0 85 20.0 87 18.0 63 22.0
` }] });
    expect(withUnit.financialFacts?.performance?.metrics.sales?.valueYen).toBe(55_000_000_000);
    const withoutUnit = analyzeDisclosureText({ pages: [{ pageNumber: 1, text: "2026年3月期 550 10.0 85 20.0 87 18.0 63 22.0" }] });
    expect(withoutUnit.financialFacts?.performance).toBeUndefined();
    expect(withoutUnit.financialFacts?.uncertainty.join(" ")).toContain("単位");
  });
});

describe("disclosureScorer.classifyDocumentTitle", () => {
  it("「決算短信」は earnings_release", () => {
    expect(classifyDocumentTitle("2026年3月期 第1四半期決算短信")).toBe("earnings_release");
  });

  it("「業績予想の修正」は forecast_revision", () => {
    expect(classifyDocumentTitle("通期業績予想の修正に関するお知らせ")).toBe("forecast_revision");
  });

  it("「配当予想の修正」は dividend_revision", () => {
    expect(classifyDocumentTitle("配当予想の修正に関するお知らせ")).toBe("dividend_revision");
  });

  it("「配当に関する規約変更」のような単純な「配当」マッチは other に分類される", () => {
    expect(classifyDocumentTitle("配当に関する内部規約改定について")).toBe("other");
  });

  it("「決算説明資料」は earnings_presentation", () => {
    expect(classifyDocumentTitle("2026年3月期 決算説明資料")).toBe("earnings_presentation");
  });

  it("「人事異動」は other", () => {
    expect(classifyDocumentTitle("代表取締役の異動に関するお知らせ")).toBe("other");
  });
});

import { describe, expect, it } from "vitest";
import { parseAiSummaryToStructured, structuredReportToText } from "../src/lib/structuredReport";

const SAMPLE_AI_OUTPUT = `一言サマリー: 増収だが営業利益は横ばい、為替と買収費用が交錯。

【決算分析レポート】

1. 企業概要と事業の核心
- 企業名: 長谷川香料株式会社
- 決算短信発行日: 2026年5月8日
- クオーター: 2026年9月期 第2四半期（中間期）
- 事業内容: 香料の製造・販売

2. 業績ハイライト（定量的評価）
- 全体業績: 売上高は37,585百万円（前年同期比4.9%増）、営業利益は4,528百万円（同0.2%増）
- 利益率: 営業利益率は約12.0%
- 通期予想に対する進捗率: 売上高進捗率は49.1%、営業利益進捗率は48.0%
- 業績予想の修正有無: 無し
- 配当予想・株主還元: 年間配当予想は100.00円
- 財務安全性: 自己資本比率は84.2%

3. 注意点とリスク
- ベトナム子会社買収における一過性の買収費用
- 為替変動の影響

※この要約はAIによる自動生成です。`;

describe("parseAiSummaryToStructured", () => {
  it("所定フォーマットのAI出力をパースできる", () => {
    const result = parseAiSummaryToStructured(SAMPLE_AI_OUTPUT, "Workers AI (llama-3.1-8b-instruct)");
    expect(result).toBeDefined();
    expect(result?.oneLine).toBe("増収だが営業利益は横ばい、為替と買収費用が交錯。");
    expect(result?.generatedBy).toBe("ai");
    expect(result?.sections.length).toBeGreaterThanOrEqual(3);

    const overview = result?.sections.find((section) => section.heading.includes("企業概要"));
    expect(overview).toBeDefined();
    expect(overview?.items.some((item) => item.label === "企業名" && item.text.includes("長谷川香料"))).toBe(true);

    const highlight = result?.sections.find((section) => section.heading.includes("業績ハイライト"));
    expect(highlight?.items.some((item) => item.label === "利益率")).toBe(true);
  });

  it("markdown太字(**)入りでもパースできる", () => {
    const bolded = SAMPLE_AI_OUTPUT.replace("- 企業名:", "- **企業名**:");
    const result = parseAiSummaryToStructured(bolded, "Workers AI");
    const overview = result?.sections.find((section) => section.heading.includes("企業概要"));
    expect(overview?.items.some((item) => item.label === "企業名")).toBe(true);
  });

  it("フォーマット外の短い出力は undefined を返す（ルール版へフォールバック）", () => {
    expect(parseAiSummaryToStructured("こんにちは", "Workers AI")).toBeUndefined();
    expect(parseAiSummaryToStructured("", "Workers AI")).toBeUndefined();
  });

  it("structuredReportToText はコピー可能なテキストに変換する", () => {
    const result = parseAiSummaryToStructured(SAMPLE_AI_OUTPUT, "Workers AI");
    const text = structuredReportToText(result!);
    expect(text).toContain("一言サマリー: 増収だが営業利益は横ばい");
    expect(text).toContain("【決算分析レポート】");
    expect(text).toContain("- 企業名: 長谷川香料株式会社");
  });
});

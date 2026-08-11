import { afterEach, describe, expect, it, vi } from "vitest";
import {
  disclosureDeduplicationKey,
  fetchLatestDisclosureByTicker,
  hasUrlPathExtension,
  mergeDisclosures,
  tdnetDateFormHasOptions
} from "../src/lib/disclosureFetcher";
import { isCloseDecision, scoreDisclosure, selectBestDisclosure } from "../src/lib/disclosureScorer";
import type { DisclosureItem } from "../src/lib/types";

afterEach(() => {
  vi.unstubAllGlobals();
});

function disclosure(overrides: Partial<DisclosureItem>): DisclosureItem {
  return {
    id: "stable-id", ticker: "7203", companyName: "テスト自動車", disclosedAt: "2026-05-08T00:00:00+09:00",
    title: "2026年3月期 決算短信〔IFRS〕（連結）", pdfUrl: "https://example.test/a.pdf", sourceUrl: "https://example.test",
    documentType: "earnings_release", score: 0, scoreReasons: [], ...overrides
  };
}

describe("資料候補の統合と決定的選定", () => {
  it("TDnet/JPXでURLが異なる同一資料を正規化キーで一件に統合する", () => {
    const tdnet = disclosure({ id: "140120260508500001", pdfUrl: "https://tdnet.example/a.pdf" });
    const jpx = disclosure({ id: "140120260508500001.pdf", pdfUrl: "https://jpx.example/b.pdf", xbrlUrl: "https://jpx.example/a.zip" });
    expect(disclosureDeduplicationKey(tdnet)).toBe(disclosureDeduplicationKey(jpx));
    const merged = mergeDisclosures([tdnet], [jpx]);
    expect(merged).toHaveLength(1);
    expect(merged[0].xbrlUrl).toBe("https://jpx.example/a.zip");
  });

  it("同一日・同一種別では訂正・差替版を原本より優先する", () => {
    const candidates = [
      disclosure({ id: "z", title: "2026年3月期 決算説明資料", documentType: "earnings_presentation" }),
      disclosure({ id: "b", title: "2026年3月期 決算短信（訂正）", documentType: "earnings_release" }),
      disclosure({ id: "a", title: "2026年3月期 決算短信", documentType: "earnings_release" }),
      disclosure({ id: "forecast", title: "業績予想の修正に関するお知らせ", documentType: "forecast_revision" })
    ].map((item) => scoreDisclosure(item, { ticker: "7203" }));
    expect(selectBestDisclosure(candidates)?.id).toBe("b");
    expect(candidates.find((item) => item.id === "b")!.score)
      .toBeGreaterThan(candidates.find((item) => item.id === "a")!.score);
  });

  it("同一タイトル・同一日でも書類IDが異なれば統合せず、訂正版を残す", () => {
    const original = disclosure({ id: "140120260508500001", title: "2026年3月期 決算短信" });
    const correction = disclosure({ id: "140120260508500002", title: "2026年3月期 決算短信（訂正）" });
    expect(disclosureDeduplicationKey(original)).not.toBe(disclosureDeduplicationKey(correction));
    expect(mergeDisclosures([original], [correction])).toHaveLength(2);
  });

  it("同一IDの資産だけを補完し、訂正タイトルを優先して保持する", () => {
    const original = disclosure({ id: "140120260508500001.pdf", xbrlUrl: undefined });
    const correction = disclosure({
      id: "140120260508500001",
      title: "2026年3月期 決算短信（訂正）",
      pdfUrl: undefined,
      xbrlUrl: "https://example.test/140120260508500001.zip?download=1"
    });
    const merged = mergeDisclosures([original], [correction]);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({
      id: "140120260508500001",
      title: "2026年3月期 決算短信（訂正）",
      pdfUrl: "https://example.test/a.pdf",
      xbrlUrl: "https://example.test/140120260508500001.zip?download=1"
    });
  });

  it("予想・配当だけは自動選定しない", () => {
    const candidates = [
      disclosure({ title: "業績予想の修正に関するお知らせ", documentType: "forecast_revision" }),
      disclosure({ title: "配当予想の修正に関するお知らせ", documentType: "dividend_revision" })
    ].map((item) => scoreDisclosure(item, { ticker: "7203" }));
    expect(selectBestDisclosure(candidates)).toBeUndefined();
  });

  it("対象銘柄コードと異なる候補は選定対象外にする", () => {
    const mismatched = scoreDisclosure(disclosure({ ticker: "9999" }), { ticker: "7203" });
    expect(selectBestDisclosure([mismatched], "7203")).toBeUndefined();
  });

  it("close判定は決算短信・説明資料だけを対象にする", () => {
    const release = scoreDisclosure(disclosure({ id: "release" }), { ticker: "7203" });
    const unrelated = { ...release, id: "other", documentType: "other" as const, score: release.score - 1 };
    expect(isCloseDecision([release, unrelated])).toBe(false);

    const presentation = scoreDisclosure(disclosure({
      id: "presentation",
      title: "2026年3月期 決算説明資料",
      documentType: "earnings_presentation"
    }), { ticker: "7203" });
    expect(isCloseDecision([{ ...release, score: 100 }, { ...presentation, score: 95 }])).toBe(true);
  });

  it("URLはqueryではなくpathnameの拡張子でPDF/ZIPを判定する", () => {
    expect(hasUrlPathExtension("/inbs/140120260508500001.PDF?download=1", ".pdf")).toBe(true);
    expect(hasUrlPathExtension("https://example.test/a.zip?file=report.pdf", ".zip")).toBe(true);
    expect(hasUrlPathExtension("https://example.test/download?file=report.pdf", ".pdf")).toBe(false);
  });

  it("TDnet日付フォームに8桁日付optionがない構造は不正と判定する", () => {
    expect(tdnetDateFormHasOptions('<select name="t0"><option value="20260811">2026/08/11</option></select>')).toBe(true);
    expect(tdnetDateFormHasOptions('<select name="renamed"><option value="20260811">2026/08/11</option></select>')).toBe(false);
    expect(tdnetDateFormHasOptions('<select name="t0"><option value="today">今日</option></select>')).toBe(false);
  });

  it("TDnet日付フォーム破損をfailedとし、JPXのXBRL URLを選定資料へ伝播する", async () => {
    vi.stubGlobal("localStorage", {
      getItem: vi.fn(() => null),
      setItem: vi.fn(),
      removeItem: vi.fn(),
      key: vi.fn(() => null),
      length: 0
    });
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes("/api/disclosures?")) {
        return Response.json({
          ok: true,
          companyName: "テスト自動車",
          state: "success",
          disclosures: [{
            id: "140120260811500001",
            disclosedAt: "2026-08-11T00:00:00+09:00",
            title: "2026年3月期 決算短信（訂正）",
            ticker: "7203",
            companyName: "テスト自動車",
            pdfUrl: "https://www2.jpx.co.jp/disc/72030/140120260811500001.pdf?download=1",
            xbrlUrl: "https://www2.jpx.co.jp/disc/72030/140120260811500001.zip?download=1",
            sourceUrl: "https://www2.jpx.co.jp/tseHpFront/JJK010030Action.do"
          }]
        });
      }
      return new Response("<html><body>TDnet date form changed</body></html>");
    }));

    const result = await fetchLatestDisclosureByTicker({
      ticker: "7203",
      lookbackDays: 120,
      forceRefresh: true
    });

    expect(result.status).toBe("success");
    expect(result.sourceStates).toEqual({ tdnet: "failed", jpx: "success" });
    expect(result.selectedDisclosure?.xbrlUrl)
      .toBe("https://www2.jpx.co.jp/disc/72030/140120260811500001.zip?download=1");
  });
});

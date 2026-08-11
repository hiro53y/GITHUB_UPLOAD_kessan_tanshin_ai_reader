import { describe, expect, it, vi } from "vitest";
import {
  lookupJpxDisclosures,
  parseJpxCompanySearchResult,
  parseJpxDisclosureRows
} from "../functions/lib/jpxDisclosures";
import { effectiveEarningsLookbackDays } from "../src/lib/disclosureFetcher";

const searchResultHtml = `
  <form name="JJK010030Form" method="POST" action="/tseHpFront/JJK010030Action.do">
    <input type="hidden" name="ccJjCrpSelKekkLst_st[0].eqMgrCd" value="72030">
    <input type="hidden" name="ccJjCrpSelKekkLst_st[0].eqMgrNm" value="テスト自動車">
    <input type="hidden" name="ccJjCrpSelKekkLst_st[0].szkbuNm" value="プライム">
    <input type="hidden" name="ccJjCrpSelKekkLst_st[0].gyshDspNm" value="輸送用機器">
    <input type="hidden" name="ccJjCrpSelKekkLst_st[0].dspYuKssnKi" value="3月">
  </form>
`;

const detailHtml = `
  <div>72030 テスト自動車</div>
  <table>
    <tr>
      <td align="center">2026/05/08</td>
      <td><a href="/disc/72030/140120260508500001.pdf?download=1">2026年3月期 決算短信〔IFRS〕（連結）</a></td>
      <td><a href="/disc/72030/140120260508500001.zip?download=1">XBRL</a></td>
    </tr>
    <tr>
      <td align="center">2026/05/08</td>
      <td><a href="/disc/72030/140120260508500002.pdf">2026年3月期 決算説明資料</a></td>
    </tr>
    <tr>
      <td align="center">2026/06/01</td>
      <td><a href="/disc/72030/140120260601500003.pdf">役員人事に関するお知らせ</a></td>
    </tr>
    <tr>
      <td align="center">2025/01/10</td>
      <td><a href="/disc/72030/140120250110500004.pdf">2025年3月期 第3四半期決算短信</a></td>
    </tr>
  </table>
`;

const yodokoDetailHtml = `
  <div>54510 ヨドコウ</div>
  <table>
    <tr>
      <td align="center">2026/05/11</td>
      <td><a href="/disc/54510/140120260508519817.pdf">2026年３月期 決算短信〔日本基準〕（連結）</a></td>
    </tr>
  </table>
`;

describe("JPX上場会社情報の解析", () => {
  it("検索結果から対象会社の詳細遷移情報を取得する", () => {
    expect(parseJpxCompanySearchResult(searchResultHtml, "7203")).toEqual({
      managerCode: "72030",
      companyName: "テスト自動車",
      marketName: "プライム",
      industryName: "輸送用機器",
      fiscalMonth: "3月"
    });
  });

  it("検索期間内の決算関連PDFだけを抽出する", () => {
    const records = parseJpxDisclosureRows(detailHtml, {
      ticker: "7203",
      companyName: "テスト自動車",
      lookbackDays: 120,
      now: new Date("2026-06-20T00:00:00+09:00")
    });

    expect(records).toHaveLength(2);
    expect(records.map((item) => item.title)).toEqual([
      "2026年3月期 決算短信〔IFRS〕（連結）",
      "2026年3月期 決算説明資料"
    ]);
    expect(records[0].pdfUrl).toBe("https://www2.jpx.co.jp/disc/72030/140120260508500001.pdf?download=1");
    expect(records[0].xbrlUrl).toBe("https://www2.jpx.co.jp/disc/72030/140120260508500001.zip?download=1");
  });

  it("2つのセッションCookieを引き継いで詳細ページを取得する", async () => {
    const firstHeaders = new Headers();
    firstHeaders.append("Set-Cookie", "JSESSIONID=test-session; Path=/tseHpFront; Secure");
    firstHeaders.append("Set-Cookie", "mi-w1-pri=test-route; Path=/");

    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (fetchMock.mock.calls.length === 1) {
        return new Response('<form action="/tseHpFront/JJK010010Action.do;jsessionid=test-session"></form>', {
          status: 200,
          headers: firstHeaders
        });
      }
      if (fetchMock.mock.calls.length === 2) {
        return new Response(searchResultHtml, { status: 200 });
      }
      expect(new Headers(init?.headers).get("Cookie")).toContain("JSESSIONID=test-session");
      expect(new Headers(init?.headers).get("Cookie")).toContain("mi-w1-pri=test-route");
      return new Response(detailHtml, { status: 200 });
    });

    const result = await lookupJpxDisclosures({ ticker: "7203", lookbackDays: 120 }, fetchMock);
    expect(result.companyName).toBe("テスト自動車");
    expect(result.disclosures).toHaveLength(2);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("5451は設定が30日でも最新決算探索を120日へ拡張して取得対象にする", () => {
    const configuredLookbackDays = 30;
    expect(parseJpxDisclosureRows(yodokoDetailHtml, {
      ticker: "5451",
      companyName: "ヨドコウ",
      lookbackDays: configuredLookbackDays,
      now: new Date("2026-06-25T00:00:00+09:00")
    })).toHaveLength(0);

    const records = parseJpxDisclosureRows(yodokoDetailHtml, {
      ticker: "5451",
      companyName: "ヨドコウ",
      lookbackDays: effectiveEarningsLookbackDays(configuredLookbackDays),
      now: new Date("2026-06-25T00:00:00+09:00")
    });
    expect(effectiveEarningsLookbackDays(configuredLookbackDays)).toBe(120);
    expect(records).toHaveLength(1);
    expect(records[0].title).toBe("2026年３月期 決算短信〔日本基準〕（連結）");
  });

  it("JPX詳細履歴を明示された次ページまで探索する", async () => {
    const pagedFirst = `
      <div>72030 テスト自動車</div><table><tr><td>2026/05/08</td>
      <td><a href="/disc/72030/first.pdf">2026年3月期 決算説明資料</a></td></tr></table>
      <input name="lstDspPg" value="2">`;
    const pagedSecond = `
      <div>72030 テスト自動車</div><table><tr><td>2026/05/07</td>
      <td><a href="/disc/72030/second.pdf">2026年3月期 決算短信〔IFRS〕（連結）</a></td></tr></table>`;
    let calls = 0;
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      calls += 1;
      if (calls === 1) return new Response('<form action="/tseHpFront/JJK010010Action.do"></form>');
      if (calls === 2) return new Response(searchResultHtml);
      return new Response(String(init?.body).includes("lstDspPg=1") ? pagedFirst : pagedSecond);
    });
    const result = await lookupJpxDisclosures({ ticker: "7203", lookbackDays: 120 }, fetchMock);
    expect(calls).toBe(4);
    expect(result.disclosures.map((item) => item.id)).toContain("second");
    expect(result.state).toBe("success");
    expect(result.truncated).toBe(false);
  });

  it("50件満杯なのに次ページを確定できない場合はtruncatedを返す", async () => {
    const today = new Date().toISOString().slice(0, 10).replace(/-/g, "/");
    const rows = Array.from({ length: 50 }, (_, index) => `
      <tr><td>${today}</td><td><a href="/disc/72030/full-${index}.pdf">決算説明資料 ${index}</a></td></tr>
    `).join("");
    let calls = 0;
    const fetchMock = vi.fn(async () => {
      calls += 1;
      if (calls === 1) return new Response('<form action="/tseHpFront/JJK010010Action.do"></form>');
      if (calls === 2) return new Response(searchResultHtml);
      return new Response(`<div>72030 テスト自動車</div><table>${rows}</table>`);
    });

    const result = await lookupJpxDisclosures({ ticker: "7203", lookbackDays: 120 }, fetchMock);
    expect(calls).toBe(3);
    expect(result.disclosures).toHaveLength(50);
    expect(result.state).toBe("truncated");
    expect(result.truncated).toBe(true);
  });

  it("JPX詳細履歴は最大6ページで停止する", async () => {
    const today = new Date().toISOString().slice(0, 10).replace(/-/g, "/");
    let calls = 0;
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      calls += 1;
      if (calls === 1) return new Response('<form action="/tseHpFront/JJK010010Action.do"></form>');
      if (calls === 2) return new Response(searchResultHtml);
      const page = Number(new URLSearchParams(String(init?.body)).get("lstDspPg") || "1");
      const rows = Array.from({ length: 50 }, (_, index) => `
        <tr><td>${today}</td><td><a href="/disc/72030/page-${page}-${index}.pdf">決算説明資料 ${page}-${index}</a></td></tr>
      `).join("");
      return new Response(`<div>72030 テスト自動車</div><table>${rows}</table><input name="lstDspPg" value="${page + 1}">`);
    });

    const result = await lookupJpxDisclosures({ ticker: "7203", lookbackDays: 120 }, fetchMock);
    expect(calls).toBe(8);
    expect(result.disclosures).toHaveLength(300);
    expect(result.state).toBe("truncated");
    expect(result.truncated).toBe(true);
  });
});

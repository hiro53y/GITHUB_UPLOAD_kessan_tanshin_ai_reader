const JPX_BASE_URL = "https://www2.jpx.co.jp";
const JPX_SEARCH_URL = `${JPX_BASE_URL}/tseHpFront/JJK010010Action.do?Show=Show`;
const JPX_DETAIL_URL = `${JPX_BASE_URL}/tseHpFront/JJK010030Action.do`;

export type JpxDisclosureRecord = {
  id: string;
  disclosedAt: string;
  title: string;
  ticker: string;
  companyName: string;
  pdfUrl: string;
  sourceUrl: string;
};

export type JpxCompanySearchResult = {
  managerCode: string;
  companyName: string;
  marketName: string;
  industryName: string;
  fiscalMonth: string;
};

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

function decodeHtml(value: string): string {
  return value
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)))
    .replace(/\s+/g, " ")
    .trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function readNamedInput(html: string, name: string): string {
  const escaped = escapeRegExp(name);
  const tag = html.match(new RegExp(`<input[^>]*name=["']${escaped}["'][^>]*>`, "i"))?.[0];
  if (!tag) return "";
  return decodeHtml(tag.match(/value=["']([^"']*)["']/i)?.[1] || "");
}

function splitCombinedSetCookie(value: string): string[] {
  return value.split(/,(?=\s*[^;,=\s]+=[^;,]+)/g).map((item) => item.trim()).filter(Boolean);
}

function getSetCookieValues(headers: Headers): string[] {
  const extended = headers as Headers & { getSetCookie?: () => string[] };
  const values = extended.getSetCookie?.();
  if (values?.length) return values;
  const combined = headers.get("set-cookie");
  return combined ? splitCombinedSetCookie(combined) : [];
}

class CookieJar {
  private readonly values = new Map<string, string>();

  update(response: Response): void {
    for (const header of getSetCookieValues(response.headers)) {
      const pair = header.split(";", 1)[0];
      const separator = pair.indexOf("=");
      if (separator <= 0) continue;
      this.values.set(pair.slice(0, separator).trim(), pair.slice(separator + 1).trim());
    }
  }

  toHeader(): string {
    return Array.from(this.values, ([name, value]) => `${name}=${value}`).join("; ");
  }
}

export function parseJpxCompanySearchResult(html: string, ticker: string): JpxCompanySearchResult | undefined {
  const codeMatches = Array.from(html.matchAll(/name=["']ccJjCrpSelKekkLst_st\[(\d+)]\.eqMgrCd["'][^>]*value=["']([^"']+)["']/gi));
  const target = codeMatches.find((match) => match[2].startsWith(ticker));
  if (!target) return undefined;

  const index = target[1];
  const prefix = `ccJjCrpSelKekkLst_st[${index}]`;
  return {
    managerCode: decodeHtml(target[2]),
    companyName: readNamedInput(html, `${prefix}.eqMgrNm`),
    marketName: readNamedInput(html, `${prefix}.szkbuNm`),
    industryName: readNamedInput(html, `${prefix}.gyshDspNm`),
    fiscalMonth: readNamedInput(html, `${prefix}.dspYuKssnKi`)
  };
}

function toJstDateTime(dateText: string): string {
  return `${dateText.replace(/\//g, "-")}T00:00:00+09:00`;
}

function isRelevantDisclosure(title: string): boolean {
  return /決算短信|四半期決算短信|決算説明|決算補足|業績予想|配当予想|剰余金の配当/.test(title);
}

export function parseJpxDisclosureRows(
  html: string,
  input: { ticker: string; companyName: string; lookbackDays: number; now?: Date }
): JpxDisclosureRecord[] {
  const now = input.now ?? new Date();
  const cutoff = now.getTime() - input.lookbackDays * 24 * 60 * 60 * 1000;
  const records: JpxDisclosureRecord[] = [];
  const seen = new Set<string>();

  for (const rowMatch of html.matchAll(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi)) {
    const row = rowMatch[0];
    const pdfMatch = row.match(/<a[^>]*href=["']([^"']+\.pdf(?:\?[^"']*)?)["'][^>]*>([\s\S]*?)<\/a>/i);
    if (!pdfMatch) continue;
    const dateText = row.match(/>\s*(\d{4}\/\d{2}\/\d{2})\s*</)?.[1];
    if (!dateText) continue;
    const title = decodeHtml(pdfMatch[2]);
    if (!title || !isRelevantDisclosure(title)) continue;

    const disclosedAt = toJstDateTime(dateText);
    if (new Date(disclosedAt).getTime() < cutoff) continue;

    const pdfUrl = new URL(pdfMatch[1], JPX_BASE_URL).toString();
    if (seen.has(pdfUrl)) continue;
    seen.add(pdfUrl);
    const pdfName = new URL(pdfUrl).pathname.split("/").pop() || `${input.ticker}-${dateText}`;
    records.push({
      id: pdfName.replace(/\.pdf$/i, ""),
      disclosedAt,
      title,
      ticker: input.ticker,
      companyName: input.companyName,
      pdfUrl,
      sourceUrl: JPX_DETAIL_URL
    });
  }

  return records
    .sort((a, b) => new Date(b.disclosedAt).getTime() - new Date(a.disclosedAt).getTime())
    .slice(0, 50);
}

async function fetchText(responsePromise: Promise<Response>, cookieJar: CookieJar): Promise<{ response: Response; text: string }> {
  const response = await responsePromise;
  cookieJar.update(response);
  const text = await response.text();
  if (!response.ok) throw new Error(`JPX HTTP ${response.status}`);
  return { response, text };
}

export async function lookupJpxDisclosures(
  input: { ticker: string; lookbackDays: number },
  fetchImpl: FetchLike = fetch
): Promise<{ companyName: string; disclosures: JpxDisclosureRecord[] }> {
  if (!/^\d{4}$/.test(input.ticker)) throw new Error("invalid_ticker");
  const lookbackDays = Math.max(30, Math.min(365, Math.round(input.lookbackDays)));
  const cookieJar = new CookieJar();
  const commonHeaders = { "User-Agent": "Mozilla/5.0 kessan-tanshin-reader/1.0" };

  const searchPage = await fetchText(fetchImpl(JPX_SEARCH_URL, { headers: commonHeaders }), cookieJar);
  const searchAction = searchPage.text.match(/<form[^>]*action=["']([^"']+)["']/i)?.[1];
  if (!searchAction) throw new Error("jpx_search_form_not_found");

  const searchResponse = await fetchText(
    fetchImpl(new URL(searchAction, JPX_BASE_URL), {
      method: "POST",
      headers: {
        ...commonHeaders,
        "Content-Type": "application/x-www-form-urlencoded",
        Cookie: cookieJar.toHeader(),
        Referer: JPX_SEARCH_URL
      },
      body: new URLSearchParams({
        ListShow: "ListShow",
        sniMtGmnId: "",
        dspSsuPd: "10",
        mgrMiTxtBx: "",
        eqMgrCd: input.ticker
      }).toString()
    }),
    cookieJar
  );

  const company = parseJpxCompanySearchResult(searchResponse.text, input.ticker);
  if (!company) return { companyName: "", disclosures: [] };

  const detailBody = new URLSearchParams({
    BaseJh: "BaseJh",
    lstDspPg: "1",
    dspGs: "10",
    souKnsu: "1",
    sniMtGmnId: "JJK010010",
    dspJnKbn: "0",
    dspJnKmkNo: "0",
    mgrCd: company.managerCode,
    jjHisiFlg: "1",
    "ccJjCrpSelKekkLst_st[0].eqMgrCd": company.managerCode,
    "ccJjCrpSelKekkLst_st[0].eqMgrNm": company.companyName,
    "ccJjCrpSelKekkLst_st[0].szkbuNm": company.marketName,
    "ccJjCrpSelKekkLst_st[0].gyshDspNm": company.industryName,
    "ccJjCrpSelKekkLst_st[0].dspYuKssnKi": company.fiscalMonth
  });

  const detailResponse = await fetchText(
    fetchImpl(JPX_DETAIL_URL, {
      method: "POST",
      headers: {
        ...commonHeaders,
        "Content-Type": "application/x-www-form-urlencoded",
        Cookie: cookieJar.toHeader(),
        Referer: searchResponse.response.url
      },
      body: detailBody.toString()
    }),
    cookieJar
  );

  if (!detailResponse.text.includes(company.managerCode)) throw new Error("jpx_detail_not_found");
  return {
    companyName: company.companyName,
    disclosures: parseJpxDisclosureRows(detailResponse.text, {
      ticker: input.ticker,
      companyName: company.companyName,
      lookbackDays
    })
  };
}

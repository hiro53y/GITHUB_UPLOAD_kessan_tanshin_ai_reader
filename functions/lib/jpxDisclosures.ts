/** Pages Functions と外部Workerで共用するJPX開示履歴クライアント。 */
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
  xbrlUrl?: string;
  sourceUrl: string;
};

export type JpxLookupState = "success" | "empty" | "truncated";
export type JpxLookupResult = { companyName: string; disclosures: JpxDisclosureRecord[]; state: JpxLookupState; truncated: boolean };

const JPX_PAGE_SIZE = 50;
const JPX_MAX_PAGES = 6;

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

type JpxRowAnchor = { url: URL; body: string };

function parseRowAnchors(row: string): JpxRowAnchor[] {
  const anchors: JpxRowAnchor[] = [];
  for (const match of row.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    try {
      anchors.push({ url: new URL(match[1], JPX_BASE_URL), body: match[2] });
    } catch {
      // 壊れたhrefは当該アンカーだけ除外し、同じ行の他資産は解析する。
    }
  }
  return anchors;
}

function hasPathExtension(anchor: JpxRowAnchor, extension: ".pdf" | ".zip"): boolean {
  return anchor.url.pathname.toLowerCase().endsWith(extension);
}

function countDisclosureRows(html: string): number {
  let count = 0;
  for (const rowMatch of html.matchAll(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi)) {
    const row = rowMatch[0];
    if (!/>\s*\d{4}\/\d{2}\/\d{2}\s*</.test(row)) continue;
    if (parseRowAnchors(row).some((anchor) => hasPathExtension(anchor, ".pdf"))) count += 1;
  }
  return count;
}

function mergeSameIdRecords(current: JpxDisclosureRecord, incoming: JpxDisclosureRecord): JpxDisclosureRecord {
  const currentIsCorrection = /訂正|差替/.test(current.title);
  const incomingIsCorrection = /訂正|差替/.test(incoming.title);
  const preferred = incomingIsCorrection && !currentIsCorrection ? incoming : current;
  const supplement = preferred === current ? incoming : current;
  return {
    ...supplement,
    ...preferred,
    pdfUrl: preferred.pdfUrl || supplement.pdfUrl,
    xbrlUrl: preferred.xbrlUrl || supplement.xbrlUrl
  };
}

export function parseJpxDisclosureRows(
  html: string,
  input: { ticker: string; companyName: string; lookbackDays: number; now?: Date }
): JpxDisclosureRecord[] {
  const now = input.now ?? new Date();
  const cutoff = now.getTime() - input.lookbackDays * 24 * 60 * 60 * 1000;
  const records = new Map<string, JpxDisclosureRecord>();

  for (const rowMatch of html.matchAll(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi)) {
    const row = rowMatch[0];
    const anchors = parseRowAnchors(row);
    const pdfAnchor = anchors.find((anchor) => hasPathExtension(anchor, ".pdf"));
    if (!pdfAnchor) continue;
    const xbrlAnchor = anchors.find((anchor) => hasPathExtension(anchor, ".zip"));
    const dateText = row.match(/>\s*(\d{4}\/\d{2}\/\d{2})\s*</)?.[1];
    if (!dateText) continue;
    const title = decodeHtml(pdfAnchor.body);
    if (!title || !isRelevantDisclosure(title)) continue;

    const disclosedAt = toJstDateTime(dateText);
    if (new Date(disclosedAt).getTime() < cutoff) continue;

    const pdfUrl = pdfAnchor.url.toString();
    const xbrlUrl = xbrlAnchor?.url.toString();
    const pdfName = new URL(pdfUrl).pathname.split("/").pop() || `${input.ticker}-${dateText}`;
    const id = pdfName.replace(/\.pdf$/i, "");
    const record: JpxDisclosureRecord = {
      id,
      disclosedAt,
      title,
      ticker: input.ticker,
      companyName: input.companyName,
      pdfUrl,
      xbrlUrl,
      sourceUrl: JPX_DETAIL_URL
    };
    const existing = records.get(id);
    records.set(id, existing ? mergeSameIdRecords(existing, record) : record);
  }

  return Array.from(records.values())
    .sort((a, b) => new Date(b.disclosedAt).getTime() - new Date(a.disclosedAt).getTime())
    ;
}

/**
 * JPX(www2.jpx.co.jp) のHTMLは Shift_JIS で配信されるため、response.text()（UTF-8既定）では
 * 会社名などが文字化けする。bytes を取得し、HTTPヘッダ→<meta charset> から charset を判定して
 * TextDecoder でデコードする。判定不能時は UTF-8 にフォールバック。
 */
function decodeResponseBytes(buffer: ArrayBuffer, contentType: string | null): string {
  const bytes = new Uint8Array(buffer);
  const normalize = (cs: string): string => {
    const lower = cs.trim().toLowerCase().replace(/["']/g, "");
    if (/^(shift[_-]?jis|sjis|x-sjis|ms_kanji|windows-31j|cp932)$/.test(lower)) return "shift_jis";
    if (/^(euc-?jp|x-euc-jp)$/.test(lower)) return "euc-jp";
    if (/^utf-?8$/.test(lower)) return "utf-8";
    return lower;
  };
  const headerCharset = contentType?.match(/charset\s*=\s*["']?([^"';\s]+)/i)?.[1];
  let charset = headerCharset ? normalize(headerCharset) : "";
  if (!charset) {
    const head = new TextDecoder("ascii").decode(bytes.subarray(0, 2048));
    const metaCharset =
      head.match(/<meta[^>]+charset\s*=\s*["']?([^"'>\s;]+)/i)?.[1] ||
      head.match(/<meta[^>]+content\s*=\s*["'][^"']*charset=([^"'>\s;]+)/i)?.[1];
    if (metaCharset) charset = normalize(metaCharset);
  }
  if (!charset) charset = "utf-8";
  try {
    return new TextDecoder(charset).decode(bytes);
  } catch {
    return new TextDecoder("utf-8").decode(bytes);
  }
}

async function fetchText(responsePromise: Promise<Response>, cookieJar: CookieJar): Promise<{ response: Response; text: string }> {
  const response = await responsePromise;
  cookieJar.update(response);
  const buffer = await response.arrayBuffer();
  const text = decodeResponseBytes(buffer, response.headers.get("content-type"));
  if (!response.ok) throw new Error(`JPX HTTP ${response.status}`);
  return { response, text };
}

export async function lookupJpxDisclosures(
  input: { ticker: string; lookbackDays: number },
  fetchImpl: FetchLike = fetch
): Promise<JpxLookupResult> {
  if (!/^[0-9][0-9A-Z]{3}$/.test(input.ticker)) throw new Error("invalid_ticker");
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
  if (!company) return { companyName: "", disclosures: [], state: "empty", truncated: false };

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

  const disclosures: JpxDisclosureRecord[] = [];
  const seen = new Map<string, number>();
  let truncated = false;
  let reachedCutoff = false;
  for (let page = 1; page <= JPX_MAX_PAGES && !reachedCutoff; page += 1) {
    detailBody.set("lstDspPg", String(page));
    detailBody.set("dspGs", String(JPX_PAGE_SIZE));
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
    const pageRecords = parseJpxDisclosureRows(detailResponse.text, {
      ticker: input.ticker,
      companyName: company.companyName,
      lookbackDays
    });
    for (const record of pageRecords) {
      const existingIndex = seen.get(record.id);
      if (existingIndex === undefined) {
        seen.set(record.id, disclosures.length);
        disclosures.push(record);
      } else {
        disclosures[existingIndex] = mergeSameIdRecords(disclosures[existingIndex], record);
      }
    }
    const dates = Array.from(detailResponse.text.matchAll(/(\d{4}\/\d{2}\/\d{2})/g))
      .map((match) => new Date(toJstDateTime(match[1])).getTime());
    reachedCutoff = dates.length > 0 && Math.min(...dates) < Date.now() - lookbackDays * 24 * 60 * 60 * 1000;
    const hasNext = new RegExp(`lstDspPg[^>]*value=["']${page + 1}["']|>${page + 1}<`).test(detailResponse.text);
    const pageIsFull = countDisclosureRows(detailResponse.text) >= JPX_PAGE_SIZE;
    if (reachedCutoff) break;
    if (page === JPX_MAX_PAGES) {
      truncated = hasNext || pageIsFull;
      break;
    }
    if (!hasNext) {
      truncated = pageIsFull;
      break;
    }
  }
  disclosures.sort((a, b) => Date.parse(b.disclosedAt) - Date.parse(a.disclosedAt) || a.id.localeCompare(b.id));
  return {
    companyName: company.companyName,
    disclosures,
    state: truncated ? "truncated" : disclosures.length ? "success" : "empty",
    truncated
  };
}

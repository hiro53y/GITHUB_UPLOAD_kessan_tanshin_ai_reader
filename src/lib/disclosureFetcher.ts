import type { DisclosureFetchResult, DisclosureItem } from "./types";
import { classifyDocumentTitle, isCloseDecision, scoreDisclosure, selectBestDisclosure } from "./disclosureScorer";
import { getDisclosureCache, setDisclosureCache, getSettings } from "./storage";
import {
  absoluteTdnetUrl,
  fetchTextWithFallback,
  normalizeTicker,
  stripHtmlEntities,
  tdnetCodeToTicker,
  TDNET_INBS_URL,
  TDNET_SEARCH_HEAD_URL,
  TDNET_SEARCH_URL
} from "./utils";

type SearchDate = {
  value: string;
  label: string;
  date: Date;
};

const SEARCH_ERROR_MESSAGE =
  "TDnet公開ページまたはproxyにアクセスできませんでした。Cloudflare Pagesで公開する場合は同梱の/api/proxyを使えます。手動PDFアップロード、またはPDF URL貼り付けでも続行できます。";

function parseYmd(value: string): Date {
  return new Date(`${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}T00:00:00+09:00`);
}

function toIsoDateTime(value: string): string | undefined {
  const match = value.match(/(\d{4})\/(\d{2})\/(\d{2})\s+(\d{2}):(\d{2})/);
  if (!match) return undefined;
  const [, year, month, day, hour, minute] = match;
  return `${year}-${month}-${day}T${hour}:${minute}:00+09:00`;
}

function clean(value?: string | null): string {
  return stripHtmlEntities(value || "");
}

function parseSearchDates(html: string): SearchDate[] {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const options = Array.from(doc.querySelectorAll<HTMLSelectElement>("select[name='t0'] option"));
  return options
    .map((option) => ({
      value: option.value,
      label: option.textContent?.trim() || option.value,
      date: parseYmd(option.value)
    }))
    .filter((item) => /^\d{8}$/.test(item.value));
}

function formatYmd(date: Date): string {
  const parts = new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value || "";
  return `${get("year")}${get("month")}${get("day")}`;
}

function buildRecentSearchDates(days = 31): SearchDate[] {
  const today = new Date();
  return Array.from({ length: days }, (_, index) => {
    const date = new Date(today.getTime() - index * 24 * 60 * 60 * 1000);
    const value = formatYmd(date);
    return {
      value,
      label: value,
      date: parseYmd(value)
    };
  });
}

function filterDatesByLookback(dates: SearchDate[], lookbackDays: number): SearchDate[] {
  if (!dates.length) return [];
  const newest = Math.max(...dates.map((date) => date.date.getTime()));
  const oldestAllowed = newest - lookbackDays * 24 * 60 * 60 * 1000;
  return dates.filter((date) => date.date.getTime() >= oldestAllowed).sort((a, b) => b.date.getTime() - a.date.getTime());
}

function rowToDisclosure(row: Element, sourceUrl: string): DisclosureItem | undefined {
  const timeText = clean(row.querySelector(".time, .kjTime")?.textContent);
  const codeText = clean(row.querySelector(".code, .kjCode")?.textContent);
  const companyName = clean(row.querySelector(".companyname, .kjName")?.textContent);
  const titleCell = row.querySelector(".title, .kjTitle");
  const titleLink = titleCell?.querySelector<HTMLAnchorElement>("a[href$='.pdf'], a[href$='.PDF']");
  const title = clean(titleLink?.innerHTML || titleCell?.innerHTML || titleCell?.textContent);
  const xbrlLink = row.querySelector<HTMLAnchorElement>(".xbrl a[href$='.zip'], .kjXbrl a[href$='.zip']");
  const ticker = tdnetCodeToTicker(codeText);
  const pdfUrl = absoluteTdnetUrl(titleLink?.getAttribute("href"));
  const xbrlUrl = absoluteTdnetUrl(xbrlLink?.getAttribute("href"));

  if (!title || !ticker) return undefined;

  const disclosedAt = toIsoDateTime(timeText) ?? undefined;
  const pdfId = pdfUrl?.split("/").pop()?.replace(/\.[^.]+$/, "");
  return {
    id: pdfId || `${ticker}-${timeText}-${title}`.replace(/\s+/g, "-"),
    disclosedAt,
    title,
    ticker,
    companyName,
    pdfUrl,
    xbrlUrl,
    sourceUrl,
    documentType: classifyDocumentTitle(title),
    score: 0,
    scoreReasons: []
  };
}

function parseDisclosureRows(html: string, sourceUrl: string): DisclosureItem[] {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const rows = Array.from(doc.querySelectorAll("#maintable tr, #main-list-table tr"));
  return rows.map((row) => rowToDisclosure(row, sourceUrl)).filter(Boolean) as DisclosureItem[];
}

function parseListPageLinks(html: string, ymd: string): string[] {
  const matches = Array.from(html.matchAll(new RegExp(`I_list_\\d{3}_${ymd}\\.html`, "g"))).map((match) => match[0]);
  return Array.from(new Set(matches)).sort();
}

function buildResult(
  input: { ticker: string; companyName?: string },
  candidates: DisclosureItem[],
  searchedAt: string,
  note?: string
): DisclosureFetchResult {
  const selected = selectBestDisclosure(candidates);
  const close = isCloseDecision(candidates);
  const userMessage = selected
    ? close
      ? "上位候補の点差が小さいため、候補一覧を確認してください。最上位候補を仮選定しています。"
      : `タイトル、銘柄コード、開示日時、PDF有無をもとに「${selected.title}」を最新決算関連資料として選定しました。`
    : "検索期間内に決算短信候補が見つかりませんでした。";

  return {
    status: selected ? "success" : "not_found",
    ticker: input.ticker,
    companyName: input.companyName || selected?.companyName,
    searchedAt,
    source: "tdnet-public",
    selectedDisclosure: selected,
    candidates,
    userMessage: note ? `${userMessage} ${note}` : userMessage
  };
}

async function getAvailableDates(): Promise<SearchDate[]> {
  try {
    const { text } = await fetchTextWithFallback(TDNET_SEARCH_HEAD_URL);
    const parsed = parseSearchDates(text);
    return parsed.length ? parsed : buildRecentSearchDates();
  } catch {
    return buildRecentSearchDates();
  }
}

async function searchByKeyword(
  keyword: string,
  startYmd: string,
  endYmd: string,
  sourceTicker: string,
  sourceCompanyName?: string
): Promise<DisclosureItem[]> {
  const params = new URLSearchParams({
    t0: startYmd,
    t1: endYmd,
    q: keyword,
    m: "0"
  });
  const { text, finalUrl } = await fetchTextWithFallback(TDNET_SEARCH_URL, () => ({
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: params.toString()
  }));

  return parseDisclosureRows(text, finalUrl).filter((item) => {
    const tickerMatch = item.ticker === sourceTicker;
    const companyMatch = sourceCompanyName ? item.companyName?.includes(sourceCompanyName) : false;
    return tickerMatch || Boolean(companyMatch);
  });
}

async function fallbackListSearch(
  dates: SearchDate[],
  ticker: string,
  maxPages = 40
): Promise<{ candidates: DisclosureItem[]; truncated: boolean }> {
  const candidates: DisclosureItem[] = [];
  let pageCount = 0;

  for (const date of dates) {
    const firstPageUrl = `${TDNET_INBS_URL}I_list_001_${date.value}.html`;
    let text = "";
    try {
      text = (await fetchTextWithFallback(firstPageUrl)).text;
    } catch {
      continue;
    }
    pageCount += 1;
    const links = parseListPageLinks(text, date.value);
    const pageLinks = links.length ? links : [`I_list_001_${date.value}.html`];

    for (const link of pageLinks) {
      if (link !== `I_list_001_${date.value}.html`) {
        if (pageCount >= maxPages) return { candidates, truncated: true };
        pageCount += 1;
      }
      try {
        const html = link === `I_list_001_${date.value}.html` ? text : (await fetchTextWithFallback(`${TDNET_INBS_URL}${link}`)).text;
        candidates.push(...parseDisclosureRows(html, `${TDNET_INBS_URL}${link}`).filter((item) => item.ticker === ticker));
      } catch {
        continue;
      }
    }

    if (candidates.some((item) => item.documentType === "earnings_release")) break;
    if (pageCount >= maxPages) return { candidates, truncated: true };
  }

  return { candidates, truncated: false };
}

export async function fetchLatestDisclosureByTicker(input: {
  ticker: string;
  companyName?: string;
  lookbackDays: number;
}): Promise<DisclosureFetchResult> {
  const ticker = normalizeTicker(input.ticker);
  const searchedAt = new Date().toISOString();
  const settings = getSettings();
  const cacheKey = `${ticker}:${input.lookbackDays}:${input.companyName || ""}:${settings.proxyUrl || "direct"}`;
  const cached = getDisclosureCache(cacheKey);
  if (cached) return cached;

  if (!settings.tdnetEnabled) {
    return {
      status: "manual_required",
      ticker,
      companyName: input.companyName,
      searchedAt,
      source: "tdnet-public",
      candidates: [],
      userMessage: "TDnet公開ページ取得がOFFです。手動PDFアップロードまたはPDF URL貼り付けで分析してください。"
    };
  }

  try {
    const allDates = await getAvailableDates();
    const dates = filterDatesByLookback(allDates, input.lookbackDays);
    if (!dates.length) {
      return {
        status: "not_found",
        ticker,
        companyName: input.companyName,
        searchedAt,
        source: "tdnet-public",
        candidates: [],
        userMessage: "TDnet公開閲覧ページで利用可能な検索日付が見つかりませんでした。手動PDFで続行してください。"
      };
    }

    const newest = dates[0].value;
    const oldest = dates[dates.length - 1].value;
    let note = "";
    let rawCandidates: DisclosureItem[] = [];
    try {
      rawCandidates = await searchByKeyword(ticker, oldest, newest, ticker, input.companyName);
    } catch {
      note = "検索フォーム取得に失敗したため、日別一覧探索へ切り替えました。";
    }

    if (!rawCandidates.length && input.companyName) {
      try {
        rawCandidates = await searchByKeyword(input.companyName, oldest, newest, ticker, input.companyName);
      } catch {
        note = note || "会社名検索に失敗したため、日別一覧探索へ切り替えました。";
      }
    }

    if (!rawCandidates.length) {
      const fallback = await fallbackListSearch(dates, ticker);
      rawCandidates = fallback.candidates;
      if (fallback.truncated) note = "過剰アクセスを避けるため、一覧ページ探索は途中で停止しました。";
    }

    const dateMsValues = rawCandidates
      .map((item) => (item.disclosedAt ? new Date(item.disclosedAt).getTime() : undefined))
      .filter((value): value is number => typeof value === "number" && !Number.isNaN(value));
    const newestDateMs = dateMsValues.length ? Math.max(...dateMsValues) : Date.now();
    const oldestDateMs = dateMsValues.length ? Math.min(...dateMsValues) : newestDateMs - input.lookbackDays * 24 * 60 * 60 * 1000;

    const candidates = rawCandidates
      .map((item) => scoreDisclosure(item, { ticker, companyName: input.companyName, newestDateMs, oldestDateMs }))
      .sort((a, b) => b.score - a.score);

    const result = buildResult({ ticker, companyName: input.companyName }, candidates, searchedAt, note);
    if (result.status === "success") setDisclosureCache(cacheKey, result);
    return result;
  } catch (error) {
    return {
      status: "error",
      ticker,
      companyName: input.companyName,
      searchedAt,
      source: "tdnet-public",
      candidates: [],
      errorMessage: error instanceof Error ? error.message : String(error),
      userMessage: SEARCH_ERROR_MESSAGE
    };
  }
}

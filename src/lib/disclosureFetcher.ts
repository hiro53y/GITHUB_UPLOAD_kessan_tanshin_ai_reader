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
  "TDnet公開ページまたはproxyにアクセスできませんでした。手動PDFアップロード、またはPDF URL貼り付けで続行してください。";

export const MIN_LATEST_EARNINGS_LOOKBACK_DAYS = 120;

export function effectiveEarningsLookbackDays(requestedDays: number): number {
  return Math.max(MIN_LATEST_EARNINGS_LOOKBACK_DAYS, requestedDays);
}

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
  const selectable = candidates.filter((item) => item.documentType !== "other");
  const selected = selectBestDisclosure(selectable);
  const close = isCloseDecision(selectable);
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
    source: selected?.sourceUrl.includes("www2.jpx.co.jp") ? "jpx-company-service" : "tdnet-public",
    selectedDisclosure: selected,
    candidates,
    userMessage: note ? `${userMessage} ${note}` : userMessage
  };
}

async function getAvailableDates(signal?: AbortSignal): Promise<SearchDate[]> {
  const { text } = await fetchTextWithFallback(TDNET_SEARCH_HEAD_URL, undefined, signal);
  return parseSearchDates(text);
}

type ArchiveDisclosureResponse = {
  ok: boolean;
  companyName?: string;
  disclosures?: Array<{
    id: string;
    disclosedAt: string;
    title: string;
    ticker: string;
    companyName: string;
    pdfUrl: string;
    sourceUrl: string;
  }>;
  error?: string;
  message?: string;
};

async function searchJpxArchive(
  ticker: string,
  lookbackDays: number,
  proxyUrl: string,
  signal?: AbortSignal
): Promise<{ companyName?: string; candidates: DisclosureItem[] }> {
  const params = new URLSearchParams({ ticker, lookbackDays: String(lookbackDays) });
  const configuredWorker = proxyUrl ? `${proxyUrl.replace(/\/$/, "")}/disclosures?${params}` : undefined;
  const attempts = Array.from(new Set([configuredWorker, `/api/disclosures?${params}`].filter(Boolean))) as string[];
  const errors: string[] = [];

  for (const url of attempts) {
    if (signal?.aborted) throw new DOMException("中断されました", "AbortError");
    try {
      const response = await fetch(url, { cache: "no-store", signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const body = (await response.json()) as ArchiveDisclosureResponse;
      if (!body.ok || !Array.isArray(body.disclosures)) throw new Error(body.message || body.error || "invalid_response");
      return {
        companyName: body.companyName,
        candidates: body.disclosures.map((item) => ({
          ...item,
          documentType: classifyDocumentTitle(item.title),
          score: 0,
          scoreReasons: []
        }))
      };
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") throw error;
      errors.push(`${url}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  throw new Error(errors.join(" / "));
}

function mergeDisclosures(...groups: DisclosureItem[][]): DisclosureItem[] {
  const merged = new Map<string, DisclosureItem>();
  for (const item of groups.flat()) {
    const key = item.pdfUrl || item.id;
    if (!merged.has(key)) merged.set(key, item);
  }
  return Array.from(merged.values());
}

async function searchByKeyword(
  keyword: string,
  startYmd: string,
  endYmd: string,
  sourceTicker: string,
  sourceCompanyName?: string,
  signal?: AbortSignal
): Promise<DisclosureItem[]> {
  const params = new URLSearchParams({
    t0: startYmd,
    t1: endYmd,
    q: keyword,
    m: "0"
  });
  const { text, finalUrl } = await fetchTextWithFallback(
    TDNET_SEARCH_URL,
    () => ({
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: params.toString()
    }),
    signal
  );

  return parseDisclosureRows(text, finalUrl).filter((item) => {
    const tickerMatch = item.ticker === sourceTicker;
    const companyMatch = sourceCompanyName ? item.companyName?.includes(sourceCompanyName) : false;
    return tickerMatch || Boolean(companyMatch);
  });
}

async function fallbackListSearch(
  dates: SearchDate[],
  ticker: string,
  maxPages = 40,
  signal?: AbortSignal
): Promise<{ candidates: DisclosureItem[]; truncated: boolean }> {
  const candidates: DisclosureItem[] = [];
  let pageCount = 0;

  for (const date of dates) {
    if (signal?.aborted) throw new DOMException("中断されました", "AbortError");
    const firstPageUrl = `${TDNET_INBS_URL}I_list_001_${date.value}.html`;
    const { text } = await fetchTextWithFallback(firstPageUrl, undefined, signal);
    pageCount += 1;
    const links = parseListPageLinks(text, date.value);
    const pageLinks = links.length ? links : [`I_list_001_${date.value}.html`];

    for (const link of pageLinks) {
      if (signal?.aborted) throw new DOMException("中断されました", "AbortError");
      if (link !== `I_list_001_${date.value}.html`) {
        if (pageCount >= maxPages) return { candidates, truncated: true };
        pageCount += 1;
      }
      const html = link === `I_list_001_${date.value}.html`
        ? text
        : (await fetchTextWithFallback(`${TDNET_INBS_URL}${link}`, undefined, signal)).text;
      candidates.push(...parseDisclosureRows(html, `${TDNET_INBS_URL}${link}`).filter((item) => item.ticker === ticker));
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
  forceRefresh?: boolean;
  signal?: AbortSignal;
}): Promise<DisclosureFetchResult> {
  const ticker = normalizeTicker(input.ticker);
  const searchedAt = new Date().toISOString();
  const settings = getSettings();
  const cacheKey = `${ticker}:${input.lookbackDays}:${input.companyName || ""}:${settings.proxyUrl || "direct"}`;
  if (!input.forceRefresh) {
    const cached = getDisclosureCache(cacheKey);
    if (cached) return cached;
  }

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
    let dates: SearchDate[] = [];
    let rawCandidates: DisclosureItem[] = [];
    let tdnetError = "";
    const notes: string[] = [];

    try {
      const allDates = await getAvailableDates(input.signal);
      dates = filterDatesByLookback(allDates, input.lookbackDays);
      if (dates.length) {
        const newest = dates[0].value;
        const oldest = dates[dates.length - 1].value;
        rawCandidates = await searchByKeyword(ticker, oldest, newest, ticker, input.companyName, input.signal);
        if (!rawCandidates.length && input.companyName) {
          rawCandidates = await searchByKeyword(input.companyName, oldest, newest, ticker, input.companyName, input.signal);
        }
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") throw error;
      tdnetError = error instanceof Error ? error.message : String(error);
    }

    const hasEarningsCandidate = rawCandidates.some((item) =>
      item.documentType === "earnings_release" || item.documentType === "earnings_presentation"
    );
    let archiveError = "";
    if (!hasEarningsCandidate) {
      try {
        const archiveLookbackDays = effectiveEarningsLookbackDays(input.lookbackDays);
        const archive = await searchJpxArchive(ticker, archiveLookbackDays, settings.proxyUrl, input.signal);
        if (archive.candidates.length) {
          rawCandidates = mergeDisclosures(rawCandidates, archive.candidates);
          if (!input.companyName && archive.companyName) input.companyName = archive.companyName;
          if (archiveLookbackDays > input.lookbackDays) {
            notes.push(`設定期間${input.lookbackDays}日内に決算資料がなかったため、最新決算の探索を${archiveLookbackDays}日まで自動拡張しました。`);
          }
          notes.push("TDnetの公開期間外をJPX上場会社情報の開示履歴で補完しました。");
        }
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") throw error;
        archiveError = error instanceof Error ? error.message : String(error);
      }
    }

    if (!rawCandidates.length && dates.length) {
      try {
        const fallback = await fallbackListSearch(dates, ticker, 40, input.signal);
        rawCandidates = fallback.candidates;
        if (fallback.truncated) notes.push("過剰アクセスを避けるため、一覧ページ探索は途中で停止しました。");
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") throw error;
        if (!tdnetError) tdnetError = error instanceof Error ? error.message : String(error);
      }
    }

    if (!rawCandidates.length && tdnetError && archiveError) {
      throw new Error(`TDnet: ${tdnetError} / JPX: ${archiveError}`);
    }

    const dateMsValues = rawCandidates
      .map((item) => (item.disclosedAt ? new Date(item.disclosedAt).getTime() : undefined))
      .filter((value): value is number => typeof value === "number" && !Number.isNaN(value));
    const newestDateMs = dateMsValues.length ? Math.max(...dateMsValues) : Date.now();
    const oldestDateMs = dateMsValues.length ? Math.min(...dateMsValues) : newestDateMs - input.lookbackDays * 24 * 60 * 60 * 1000;

    const candidates = rawCandidates
      .map((item) => scoreDisclosure(item, { ticker, companyName: input.companyName, newestDateMs, oldestDateMs }))
      .sort((a, b) => b.score - a.score);

    const result = buildResult({ ticker, companyName: input.companyName }, candidates, searchedAt, notes.join(" "));
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

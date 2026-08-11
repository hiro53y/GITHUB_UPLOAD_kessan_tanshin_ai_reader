import { deflateSync, inflateSync, strFromU8, strToU8 } from "fflate";
import type { AppSettings, DisclosureFetchResult, HistoryItem, PdfExtractResult } from "./types";

export const SETTINGS_KEY = "kessan-reader-settings:v1";
const HISTORY_KEY = "kessan-reader-history:v1";
const DISCLOSURE_CACHE_PREFIX = "kessan-reader-disclosure-cache:v1:";
const LAST_TICKER_KEY = "kessan-reader-last-ticker:v1";
// v1 は座標復元前の平坦な本文だけを保存しており、精度ゲートを迂回してしまう。
// lines / quality を含む結果だけを再利用するため、互換性を切って v2 にする。
const PDF_TEXT_CACHE_PREFIX = "kessan-reader-pdftext:v2:";
const PDF_TEXT_CACHE_LIMIT = 12;
const PDF_TEXT_TTL_MS = 60 * 24 * 60 * 60 * 1000; // 60日

export type LastTickerRecord = {
  ticker: string;
  companyName?: string;
};

export function getLastTicker(): LastTickerRecord | undefined {
  try {
    const raw = localStorage.getItem(LAST_TICKER_KEY);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as LastTickerRecord;
    if (!parsed.ticker) return undefined;
    return parsed;
  } catch {
    return undefined;
  }
}

export function saveLastTicker(record: LastTickerRecord): void {
  try {
    localStorage.setItem(LAST_TICKER_KEY, JSON.stringify(record));
  } catch {
    /* ignore quota errors */
  }
}

export const defaultSettings: AppSettings = {
  lookbackDays: 120,
  tdnetEnabled: true,
  proxyUrl: "",
  // AI基盤未設定でも安全にスキップされるため、既定でONにして構造化レポートを最大限活用する
  aiSummaryEnabled: true
};

export function getSettings(): AppSettings {
  try {
    return {
      ...defaultSettings,
      ...(JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}") as Partial<AppSettings>)
    };
  } catch {
    return defaultSettings;
  }
}

export function saveSettings(settings: AppSettings): { ok: boolean; error?: string } {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: message };
  }
}

export function listHistory(): HistoryItem[] {
  try {
    const items = JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]") as HistoryItem[];
    return items.sort((a, b) => new Date(b.analyzedAt).getTime() - new Date(a.analyzedAt).getTime());
  } catch {
    return [];
  }
}

export const HISTORY_LIMIT = 50;

/**
 * 履歴を保存。50件超過で古いものをトリミングした場合は trimmed=true を返す。
 * QuotaExceededError 等で保存失敗した場合は ok=false を返す（呼び出し側で通知）。
 */
export function saveHistoryItem(item: HistoryItem): { ok: boolean; trimmed: boolean; error?: string } {
  const current = listHistory();
  const merged = [item, ...current.filter((entry) => entry.id !== item.id)];
  // 50→40→30→20→10→5 と段階的に減らしてリトライし、最少5件で失敗したら ok:false
  const tryLimits = [HISTORY_LIMIT, 40, 30, 20, 10, 5];
  let lastError: unknown;
  for (const limit of tryLimits) {
    const next = merged.slice(0, limit);
    try {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
      return { ok: true, trimmed: merged.length > limit };
    } catch (error) {
      lastError = error;
      // QuotaExceeded: 次のより小さい limit で再試行
    }
  }
  return {
    ok: false,
    trimmed: true,
    error: lastError instanceof Error ? lastError.message : String(lastError ?? "QuotaExceeded")
  };
}

export function deleteHistoryItem(id: string): void {
  localStorage.setItem(HISTORY_KEY, JSON.stringify(listHistory().filter((item) => item.id !== id)));
}

export function clearHistory(): void {
  localStorage.removeItem(HISTORY_KEY);
}

export function getHistoryCount(): number {
  return listHistory().length;
}

export function estimateStorageSize(): string {
  let total = 0;
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index);
    if (!key) continue;
    const value = localStorage.getItem(key) || "";
    total += key.length + value.length;
  }
  const mb = (total * 2) / 1024 / 1024;
  return `${mb.toFixed(1)} MB`;
}

export function getDisclosureCache(key: string, ttlMs = 10 * 60 * 1000): DisclosureFetchResult | undefined {
  try {
    const raw = localStorage.getItem(`${DISCLOSURE_CACHE_PREFIX}${key}`);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as { storedAt: number; value: DisclosureFetchResult };
    if (Date.now() - parsed.storedAt > ttlMs) return undefined;
    return {
      ...parsed.value,
      userMessage: `${parsed.value.userMessage}（短時間の再取得を避けるため、保存済み結果を表示しています）`
    };
  } catch {
    return undefined;
  }
}

export function setDisclosureCache(key: string, value: DisclosureFetchResult): void {
  localStorage.setItem(`${DISCLOSURE_CACHE_PREFIX}${key}`, JSON.stringify({ storedAt: Date.now(), value }));
}

// ─── PDF抽出テキストの永続キャッシュ ────────────────────────────
// 同じ資料の再分析時にPDFダウンロード＋テキスト抽出を丸ごと省略するための保存領域。
// deflate圧縮＋base64でlocalStorageに保存する（決算短信全文はテキスト換算で数十KB程度）。

function pdfCacheKey(pdfUrl: string): string {
  // URLそのままだと長いので簡易ハッシュ化（FNV-1a）
  let hash = 0x811c9dc5;
  for (let index = 0; index < pdfUrl.length; index += 1) {
    hash ^= pdfUrl.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `${PDF_TEXT_CACHE_PREFIX}${hash.toString(36)}`;
}

function compressToBase64(text: string): string {
  const compressed = deflateSync(strToU8(text));
  let binary = "";
  const CHUNK = 0x8000;
  for (let index = 0; index < compressed.length; index += CHUNK) {
    binary += String.fromCharCode(...compressed.subarray(index, index + CHUNK));
  }
  return btoa(binary);
}

function decompressFromBase64(base64: string): string {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return strFromU8(inflateSync(bytes));
}

type PdfTextCacheEnvelope = {
  storedAt: number;
  pdfUrl: string;
  payload: string; // deflate+base64 された PdfExtractResult JSON
};

function isReusablePdfExtractResult(value: PdfExtractResult): boolean {
  return Boolean(
    value
    && value.quality
    && typeof value.quality.safeForAutomaticFacts === "boolean"
    && Array.isArray(value.pages)
    && value.pages.length === value.totalPages
    && value.pages.every((page) => Array.isArray(page.lines) && Boolean(page.quality))
  );
}

export function getPdfTextCache(pdfUrl: string): PdfExtractResult | undefined {
  try {
    const raw = localStorage.getItem(pdfCacheKey(pdfUrl));
    if (!raw) return undefined;
    const envelope = JSON.parse(raw) as PdfTextCacheEnvelope;
    if (envelope.pdfUrl !== pdfUrl) return undefined; // ハッシュ衝突時は不使用
    if (Date.now() - envelope.storedAt > PDF_TEXT_TTL_MS) return undefined;
    const result = JSON.parse(decompressFromBase64(envelope.payload)) as PdfExtractResult;
    return isReusablePdfExtractResult(result) ? result : undefined;
  } catch {
    return undefined;
  }
}

function listPdfCacheKeys(): Array<{ key: string; storedAt: number }> {
  const keys: Array<{ key: string; storedAt: number }> = [];
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index);
    if (!key || !key.startsWith(PDF_TEXT_CACHE_PREFIX)) continue;
    try {
      const envelope = JSON.parse(localStorage.getItem(key) || "{}") as PdfTextCacheEnvelope;
      keys.push({ key, storedAt: envelope.storedAt || 0 });
    } catch {
      keys.push({ key, storedAt: 0 });
    }
  }
  return keys;
}

export function setPdfTextCache(pdfUrl: string, result: PdfExtractResult): void {
  if (!isReusablePdfExtractResult(result)) return;
  try {
    const envelope: PdfTextCacheEnvelope = {
      storedAt: Date.now(),
      pdfUrl,
      payload: compressToBase64(JSON.stringify(result))
    };
    // 保存前に件数上限を超えないよう古いものから削除（LRU相当）
    const existing = listPdfCacheKeys().sort((a, b) => a.storedAt - b.storedAt);
    while (existing.length >= PDF_TEXT_CACHE_LIMIT) {
      const oldest = existing.shift();
      if (oldest) localStorage.removeItem(oldest.key);
    }
    localStorage.setItem(pdfCacheKey(pdfUrl), JSON.stringify(envelope));
  } catch {
    // 容量不足時は全PDFキャッシュを削って1回だけ再試行
    try {
      for (const item of listPdfCacheKeys()) localStorage.removeItem(item.key);
      localStorage.setItem(
        pdfCacheKey(pdfUrl),
        JSON.stringify({ storedAt: Date.now(), pdfUrl, payload: compressToBase64(JSON.stringify(result)) } satisfies PdfTextCacheEnvelope)
      );
    } catch {
      /* 保存できなくても分析自体は成立しているため黙って続行 */
    }
  }
}

export function clearPdfTextCache(): void {
  for (const item of listPdfCacheKeys()) localStorage.removeItem(item.key);
}

import type { AppSettings, DisclosureFetchResult, HistoryItem } from "./types";

export const SETTINGS_KEY = "kessan-reader-settings:v1";
const HISTORY_KEY = "kessan-reader-history:v1";
const DISCLOSURE_CACHE_PREFIX = "kessan-reader-disclosure-cache:v1:";
const LAST_TICKER_KEY = "kessan-reader-last-ticker:v1";

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
  showSourceCheckpoints: true,
  analysisSensitivity: "standard",
  aiSummaryEnabled: false
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

export function saveSettings(settings: AppSettings): void {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
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
 */
export function saveHistoryItem(item: HistoryItem): { trimmed: boolean } {
  const current = listHistory();
  const merged = [item, ...current.filter((entry) => entry.id !== item.id)];
  const next = merged.slice(0, HISTORY_LIMIT);
  localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
  return { trimmed: merged.length > HISTORY_LIMIT };
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

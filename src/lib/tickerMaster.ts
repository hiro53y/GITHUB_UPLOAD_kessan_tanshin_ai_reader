/**
 * 銘柄マスタ（銘柄コード⇔会社名）。
 * JPX「東証上場銘柄一覧」由来のオープンデータ（kabu-json, 毎日自動更新）をCDNから取得し、
 * localStorage にキャッシュする。会社名インクリメンタル検索のデータソース。
 *
 * - 取得先はCORS対応のCDN（jsdelivr → raw.githubusercontent の順にフォールバック）
 * - キャッシュTTLは7日。期限切れでも旧データを即座に返し、裏で再取得する（stale-while-revalidate）
 * - 取得失敗時はキャッシュがあればそれを使い続ける。何もなければ空配列（コード直接入力は常に可能）
 */

export type TickerMasterEntry = {
  code: string;
  name: string;
  /** 検索用に正規化した名前（NFKC・小文字・空白除去） */
  key: string;
};

const MASTER_CACHE_KEY = "kessan-reader-ticker-master:v1";
const MASTER_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const MASTER_SOURCES = [
  "https://cdn.jsdelivr.net/gh/umihico/kabu-json-all-stock-list@main/all_stocks.json",
  "https://raw.githubusercontent.com/umihico/kabu-json-all-stock-list/main/all_stocks.json"
];

type RawStockRow = { コード?: string; 銘柄名?: string; code?: string; name?: string };

type MasterCache = {
  storedAt: number;
  entries: Array<{ code: string; name: string }>;
};

/** 検索キー正規化: 全角英数→半角、カナ大文字化、空白・記号ゆらぎ吸収 */
export function normalizeSearchKey(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s　・．.,、｡。()（）「」『』]/g, "")
    .replace(/株式会社|ホールディングス$/g, (m) => (m === "株式会社" ? "" : m));
}

function toEntries(rows: Array<{ code: string; name: string }>): TickerMasterEntry[] {
  return rows.map((row) => ({ code: row.code, name: row.name, key: normalizeSearchKey(row.name) }));
}

function readCache(): { entries: TickerMasterEntry[]; fresh: boolean } | undefined {
  try {
    const raw = localStorage.getItem(MASTER_CACHE_KEY);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as MasterCache;
    if (!Array.isArray(parsed.entries) || !parsed.entries.length) return undefined;
    return {
      entries: toEntries(parsed.entries),
      fresh: Date.now() - parsed.storedAt <= MASTER_TTL_MS
    };
  } catch {
    return undefined;
  }
}

function writeCache(rows: Array<{ code: string; name: string }>): void {
  try {
    localStorage.setItem(MASTER_CACHE_KEY, JSON.stringify({ storedAt: Date.now(), entries: rows } satisfies MasterCache));
  } catch {
    /* 容量不足時はキャッシュなしで動作継続 */
  }
}

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    window.clearTimeout(timer);
  }
}

async function fetchMasterFromNetwork(): Promise<Array<{ code: string; name: string }> | undefined> {
  for (const url of MASTER_SOURCES) {
    try {
      const response = await fetchWithTimeout(url, 15000);
      if (!response.ok) continue;
      const body = (await response.json()) as RawStockRow[];
      if (!Array.isArray(body)) continue;
      const rows = body
        .map((row) => ({
          code: String(row.コード ?? row.code ?? "").trim().toUpperCase(),
          name: String(row.銘柄名 ?? row.name ?? "").trim()
        }))
        .filter((row) => /^[0-9][0-9A-Z]{3}$/.test(row.code) && row.name.length > 0);
      if (rows.length > 1000) return rows;
    } catch {
      /* 次のソースへ */
    }
  }
  return undefined;
}

let inMemoryEntries: TickerMasterEntry[] | undefined;
let loadingPromise: Promise<TickerMasterEntry[]> | undefined;

/**
 * 銘柄マスタをロードする。
 * キャッシュがあれば即返し（期限切れなら裏で更新）、なければネットワーク取得。
 */
export function loadTickerMaster(): Promise<TickerMasterEntry[]> {
  if (inMemoryEntries?.length) return Promise.resolve(inMemoryEntries);
  if (loadingPromise) return loadingPromise;

  loadingPromise = (async () => {
    const cached = readCache();
    if (cached) {
      inMemoryEntries = cached.entries;
      if (!cached.fresh) {
        // 裏で更新（失敗しても旧データ継続）
        void fetchMasterFromNetwork().then((rows) => {
          if (rows) {
            writeCache(rows);
            inMemoryEntries = toEntries(rows);
          }
        });
      }
      return cached.entries;
    }
    const rows = await fetchMasterFromNetwork();
    if (rows) {
      writeCache(rows);
      inMemoryEntries = toEntries(rows);
      return inMemoryEntries;
    }
    return [];
  })().finally(() => {
    loadingPromise = undefined;
  });

  return loadingPromise;
}

export type TickerSuggestion = {
  code: string;
  name: string;
};

/**
 * コード前方一致 or 会社名部分一致でサジェスト候補を返す。
 * コード完全一致 → コード前方一致 → 名前前方一致 → 名前部分一致 の優先順。
 */
export function searchTickerMaster(entries: TickerMasterEntry[], query: string, limit = 8): TickerSuggestion[] {
  const trimmed = query.trim();
  if (!trimmed || !entries.length) return [];

  const codeQuery = trimmed.normalize("NFKC").toUpperCase();
  const isCodeLike = /^[0-9][0-9A-Z]{0,3}$/.test(codeQuery);
  const nameKey = normalizeSearchKey(trimmed);

  const exact: TickerSuggestion[] = [];
  const codePrefix: TickerSuggestion[] = [];
  const namePrefix: TickerSuggestion[] = [];
  const nameContains: TickerSuggestion[] = [];

  for (const entry of entries) {
    if (isCodeLike) {
      if (entry.code === codeQuery) {
        exact.push(entry);
        continue;
      }
      if (entry.code.startsWith(codeQuery)) {
        if (codePrefix.length < limit) codePrefix.push(entry);
        continue;
      }
    }
    if (nameKey.length >= 2) {
      if (entry.key.startsWith(nameKey)) {
        if (namePrefix.length < limit) namePrefix.push(entry);
      } else if (entry.key.includes(nameKey)) {
        if (nameContains.length < limit) nameContains.push(entry);
      }
    }
    if (exact.length + codePrefix.length >= limit && namePrefix.length >= limit) break;
  }

  const merged: TickerSuggestion[] = [];
  const seen = new Set<string>();
  for (const item of [...exact, ...codePrefix, ...namePrefix, ...nameContains]) {
    if (seen.has(item.code)) continue;
    seen.add(item.code);
    merged.push({ code: item.code, name: item.name });
    if (merged.length >= limit) break;
  }
  return merged;
}

/** 会社名からコードを解決（完全一致優先、なければ先頭候補） */
export function resolveTickerByName(entries: TickerMasterEntry[], query: string): TickerSuggestion | undefined {
  const nameKey = normalizeSearchKey(query);
  if (!nameKey) return undefined;
  const exact = entries.find((entry) => entry.key === nameKey);
  if (exact) return { code: exact.code, name: exact.name };
  const candidates = searchTickerMaster(entries, query, 1);
  return candidates[0];
}

/** コードから会社名を取得 */
export function lookupNameByCode(entries: TickerMasterEntry[], code: string): string | undefined {
  const normalized = code.trim().normalize("NFKC").toUpperCase();
  return entries.find((entry) => entry.code === normalized)?.name;
}

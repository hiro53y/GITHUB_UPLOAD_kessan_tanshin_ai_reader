import type { LoadingStep } from "./types";

const SETTINGS_KEY = "kessan-reader-settings:v1";

export const TDNET_BASE_URL = "https://www.release.tdnet.info";
export const TDNET_INBS_URL = `${TDNET_BASE_URL}/inbs/`;
export const TDNET_SEARCH_URL = `${TDNET_BASE_URL}/onsf/TDJFSearch/TDJFSearch`;
export const TDNET_SEARCH_HEAD_URL = `${TDNET_BASE_URL}/onsf/TDJFSearch/I_head`;

export function normalizeTicker(value: string): string {
  return value.trim().toUpperCase().replace(/[^0-9A-Z]/g, "");
}

export function tdnetCodeToTicker(value?: string): string | undefined {
  if (!value) return undefined;
  const normalized = normalizeTicker(value);
  if (normalized.length >= 5 && /^\d{5}$/.test(normalized)) return normalized.slice(0, 4);
  if (normalized.length >= 4) return normalized.slice(0, 4);
  return normalized || undefined;
}

export function isValidTicker(value: string): boolean {
  return /^\d{4}$/.test(normalizeTicker(value));
}

export function formatDateTime(value?: string): string {
  if (!value) return "不明";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("ja-JP", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

export function createId(prefix = "id"): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

export function unique<T>(values: T[]): T[] {
  return Array.from(new Set(values));
}

export function compactText(value: string, maxLength = 140): string {
  const text = value.replace(/\s+/g, " ").trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1)}…`;
}

export function stripHtmlEntities(value: string): string {
  const textarea = document.createElement("textarea");
  textarea.innerHTML = value;
  return textarea.value.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

export function absoluteTdnetUrl(url?: string | null): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url, TDNET_BASE_URL).toString();
  } catch {
    return undefined;
  }
}

function readProxyUrl(): string {
  try {
    const settings = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}") as { proxyUrl?: string };
    return (settings.proxyUrl || "").trim().replace(/\/$/, "");
  } catch {
    return "";
  }
}

function devProxyUrl(url: string): string | undefined {
  if (!import.meta.env?.DEV) return undefined;
  try {
    const parsed = new URL(url);
    if (parsed.hostname !== "www.release.tdnet.info") return undefined;
    if (parsed.pathname === "/onsf/TDJFSearch/TDJFSearch") return "/tdnet-search";
    return `/tdnet${parsed.pathname}${parsed.search}`;
  } catch {
    return undefined;
  }
}

function workerProxyUrl(url: string): string | undefined {
  const proxyUrl = readProxyUrl();
  if (!proxyUrl) return undefined;
  return `${proxyUrl}/?url=${encodeURIComponent(url)}`;
}

function buildAttempts(url: string): string[] {
  return [url, workerProxyUrl(url), devProxyUrl(url)].filter(Boolean) as string[];
}

export async function fetchTextWithFallback(
  url: string,
  initFactory?: () => RequestInit
): Promise<{ text: string; finalUrl: string; via: "direct" | "worker" | "dev-proxy" }> {
  const attempts = buildAttempts(url);
  const errors: string[] = [];

  for (const attemptUrl of attempts) {
    try {
      const response = await fetch(attemptUrl, {
        cache: "no-store",
        ...(initFactory ? initFactory() : undefined)
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const text = await response.text();
      return {
        text,
        finalUrl: attemptUrl,
        via: attemptUrl === url ? "direct" : attemptUrl.startsWith("/tdnet") ? "dev-proxy" : "worker"
      };
    } catch (error) {
      errors.push(`${attemptUrl}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  throw new Error(errors.join(" / "));
}

export async function fetchArrayBufferWithFallback(url: string): Promise<ArrayBuffer> {
  const attempts = buildAttempts(url);
  const errors: string[] = [];

  for (const attemptUrl of attempts) {
    try {
      const response = await fetch(attemptUrl, { cache: "force-cache" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.arrayBuffer();
    } catch (error) {
      errors.push(`${attemptUrl}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  throw new Error(errors.join(" / "));
}

export function createInitialSteps(): LoadingStep[] {
  return [
    { id: 1, label: "銘柄コード確認", status: "waiting" },
    { id: 2, label: "TDnet公開ページ検索", status: "waiting" },
    { id: 3, label: "最新決算短信候補抽出", status: "waiting" },
    { id: 4, label: "PDF取得", status: "waiting" },
    { id: 5, label: "PDFテキスト抽出", status: "waiting" },
    { id: 6, label: "重要語句検出", status: "waiting" },
    { id: 7, label: "AI要約", status: "waiting" },
    { id: 8, label: "レポート生成", status: "waiting" },
    { id: 9, label: "完了", status: "waiting" }
  ];
}

export function stepSummary(steps: LoadingStep[]): { completed: number; failed: number; total: number } {
  return {
    completed: steps.filter((step) => step.status === "success").length,
    failed: steps.filter((step) => step.status === "failed").length,
    total: steps.length
  };
}

/**
 * Cloudflare Workers AI を使った要約クライアント。
 * 1. 設定済みの外部Worker URL（`{proxyUrl}/ai/summarize`）
 * 2. 同一オリジンの Pages Function（`/api/ai/summarize`）
 * の順に試す。外部Worker URLの設定がなくても、PagesにAIバインディングがあれば動く。
 */

export type AiSummaryResult = {
  ok: boolean;
  summary?: string;
  /** 使用モデル名（例: llama-3.1-8b-instruct） */
  model?: string;
  error?: string;
  /** AI基盤が未設定（バインディング無し等）で「失敗」ではなく「利用不可」の場合 true */
  unavailable?: boolean;
};

const AI_TIMEOUT_MS = 60000;

type AiResponseBody = { ok: boolean; summary?: string; model?: string; error?: string };

export async function fetchAiSummary(
  proxyUrl: string,
  input: {
    text: string;
    ticker?: string;
    companyName?: string;
    title?: string;
    /** アプリ側で計算済みの確定数値（LLMの数値捏造防止用） */
    metrics?: string;
  },
  signal?: AbortSignal
): Promise<AiSummaryResult> {
  const endpoints: string[] = [];
  if (proxyUrl) endpoints.push(`${proxyUrl.replace(/\/+$/, "")}/ai/summarize`);
  endpoints.push("/api/ai/summarize");

  const payload = JSON.stringify({
    text: input.text.slice(0, 6000),
    ticker: input.ticker,
    companyName: input.companyName,
    title: input.title,
    metrics: input.metrics
  });

  const errors: string[] = [];
  let sawUnavailable = false;

  for (const endpoint of endpoints) {
    if (signal?.aborted) throw new DOMException("中断されました", "AbortError");
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), AI_TIMEOUT_MS);
    const onOuterAbort = () => controller.abort();
    signal?.addEventListener("abort", onOuterAbort);
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: payload,
        signal: controller.signal
      });
      const data = (await response.json().catch(() => ({ ok: false, error: `HTTP ${response.status}` }))) as AiResponseBody;
      if (data.ok && data.summary) {
        return { ok: true, summary: data.summary, model: data.model };
      }
      const errorCode = data.error || `HTTP ${response.status}`;
      if (errorCode === "ai_binding_missing" || response.status === 501 || response.status === 404) {
        sawUnavailable = true;
        errors.push(`${endpoint}: AI未設定（${errorCode}）`);
      } else {
        errors.push(`${endpoint}: ${errorCode}`);
      }
    } catch (error) {
      if (signal?.aborted) throw new DOMException("中断されました", "AbortError");
      errors.push(`${endpoint}: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      window.clearTimeout(timer);
      signal?.removeEventListener("abort", onOuterAbort);
    }
  }

  return {
    ok: false,
    unavailable: sawUnavailable && errors.length === endpoints.length,
    error: errors.join(" / ")
  };
}

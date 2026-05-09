/**
 * Cloudflare Workers AI を使った要約クライアント。
 * 既存の Worker proxy URL に `/ai/summarize` エンドポイントを追加した前提で呼び出す。
 */

export type AiSummaryResult = {
  ok: boolean;
  summary?: string;
  error?: string;
};

export async function fetchAiSummary(
  proxyUrl: string,
  text: string,
  ticker?: string,
  companyName?: string,
  title?: string
): Promise<AiSummaryResult> {
  if (!proxyUrl) {
    return { ok: false, error: "Worker URL が設定されていません" };
  }

  const baseUrl = proxyUrl.replace(/\/+$/, "");
  const endpoint = `${baseUrl}/ai/summarize`;

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: text.slice(0, 6000),
        ticker,
        companyName,
        title
      })
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: `HTTP ${response.status}` })) as { error?: string };
      return { ok: false, error: errorData.error || `HTTP ${response.status}` };
    }

    const data = await response.json() as { ok: boolean; summary?: string; error?: string };
    if (!data.ok || !data.summary) {
      return { ok: false, error: data.error || "AI要約の取得に失敗しました" };
    }

    return { ok: true, summary: data.summary };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: `AI要約リクエストに失敗しました: ${message}` };
  }
}

/**
 * 同一オリジンのAI要約エンドポイント（Cloudflare Pages Functions）。
 * 外部Worker URLを設定しなくても、Pages に AI バインディング（変数名: AI）を
 * 追加するだけでAI要約が動く。バインディング未設定時は ai_binding_missing を返し、
 * クライアントはAI要約をスキップ扱いにする（分析自体は止めない）。
 *
 * 設定方法: Cloudflare ダッシュボード → Pages プロジェクト → Settings → Functions →
 *           Workers AI バインディングを追加（変数名 AI）
 */
import { runAiSummarize, type AiSummarizeRequestBody } from "../../lib/aiSummarize";

type PagesContext = {
  request: Request;
  env: {
    AI?: {
      run(model: string, input: Record<string, unknown>): Promise<{ response?: string }>;
    };
  };
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Cache-Control": "no-store"
    }
  });
}

export async function onRequest(context: PagesContext): Promise<Response> {
  const { request, env } = context;
  if (request.method === "OPTIONS") return jsonResponse({});
  if (request.method !== "POST") return jsonResponse({ ok: false, error: "method_not_allowed" }, 405);

  if (!env.AI) {
    return jsonResponse({ ok: false, error: "ai_binding_missing" }, 501);
  }

  let body: AiSummarizeRequestBody;
  try {
    body = (await request.json()) as AiSummarizeRequestBody;
  } catch {
    return jsonResponse({ ok: false, error: "invalid_json" }, 400);
  }

  const result = await runAiSummarize(env.AI, body);
  if (!result.ok) return jsonResponse({ ok: false, error: result.error }, result.status);
  return jsonResponse({ ok: true, summary: result.summary, model: result.model });
}

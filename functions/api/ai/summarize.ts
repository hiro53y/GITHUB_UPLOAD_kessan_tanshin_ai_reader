/** 同一オリジンのWorkers AI要約エンドポイント（Cloudflare Pages Functions）。 */
import type { AiValidationResult } from "../../lib/aiSummarize";

type PagesContext = {
  request: Request;
  /** Durable Objectレート制限を備えた同梱WorkerへのService binding。 */
  env: { AI_GATEWAY?: Fetcher };
};

const MAX_AI_BODY_BYTES = 128 * 1024;

function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("Origin");
  if (!origin) return true;
  try {
    const parsed = new URL(origin);
    return origin === parsed.origin && parsed.origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

function corsHeaders(request: Request): Record<string, string> {
  const headers: Record<string, string> = {
    "Access-Control-Allow-Methods": "POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Vary": "Origin"
  };
  const origin = request.headers.get("Origin");
  if (origin && sameOrigin(request)) headers["Access-Control-Allow-Origin"] = origin;
  return headers;
}

function jsonResponse(request: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...corsHeaders(request),
      "Cache-Control": "no-store"
    }
  });
}

function jsonAiFailure(request: Request, error: string, status: number, validation: AiValidationResult): Response {
  return jsonResponse(request, { ok: false, status: "error", error, validation }, status);
}

async function readBoundedJson(request: Request): Promise<unknown> {
  const contentLength = Number(request.headers.get("Content-Length") || "0");
  if (!Number.isFinite(contentLength) || contentLength < 0 || contentLength > MAX_AI_BODY_BYTES) {
    throw new Error("body_too_large");
  }
  const reader = request.body?.getReader();
  if (!reader) throw new Error("invalid_json");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > MAX_AI_BODY_BYTES) throw new Error("body_too_large");
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder().decode(bytes));
}

export async function onRequest(context: PagesContext): Promise<Response> {
  const { request, env } = context;
  if (!sameOrigin(request)) {
    return jsonAiFailure(request, "origin_not_allowed", 403, { valid: false, errors: ["origin_not_allowed"] });
  }
  if (request.method === "OPTIONS") return jsonResponse(request, {});
  if (request.method !== "POST") {
    return jsonAiFailure(request, "method_not_allowed", 405, { valid: false, errors: ["method_not_allowed"] });
  }
  // PagesはRate Limiting bindingを構成できないため、DO制限付きWorkerへService bindingで委譲する。
  // binding未設定時は有料推論を直接実行せずfail closedにする。
  if (!env.AI_GATEWAY) {
    return jsonAiFailure(request, "ai_gateway_binding_missing", 501, { valid: false, errors: ["ai_request_failed"] });
  }

  let body: unknown;
  try {
    body = await readBoundedJson(request);
  } catch (error) {
    const tooLarge = error instanceof Error && error.message === "body_too_large";
    const code = tooLarge ? "body_too_large" : "invalid_json";
    return jsonAiFailure(request, code, tooLarge ? 413 : 400, { valid: false, errors: [code] });
  }

  try {
    const upstream = await env.AI_GATEWAY.fetch(new Request("https://ai-gateway.internal/ai/summarize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    }));
    const headers = new Headers({
      "Content-Type": upstream.headers.get("Content-Type") || "application/json; charset=utf-8",
      ...corsHeaders(request),
      "Cache-Control": "no-store"
    });
    const retryAfter = upstream.headers.get("Retry-After");
    if (retryAfter) headers.set("Retry-After", retryAfter);
    return new Response(upstream.body, { status: upstream.status, headers });
  } catch {
    return jsonAiFailure(request, "ai_gateway_failed", 502, { valid: false, errors: ["ai_request_failed"] });
  }
}

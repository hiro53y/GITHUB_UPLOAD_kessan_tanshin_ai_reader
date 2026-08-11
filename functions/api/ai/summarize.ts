/** 同一オリジンのWorkers AI要約エンドポイント（Cloudflare Pages Functions）。 */
import { runAiSummarize, type AiValidationResult } from "../../lib/aiSummarize";

type PagesContext = {
  request: Request;
  env: { AI?: Ai };
};

const MAX_AI_BODY_BYTES = 128 * 1024;

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

function jsonAiFailure(error: string, status: number, validation: AiValidationResult): Response {
  return jsonResponse({ ok: false, status: "error", error, validation }, status);
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
  if (request.method === "OPTIONS") return jsonResponse({});
  if (request.method !== "POST") {
    return jsonAiFailure("method_not_allowed", 405, { valid: false, errors: ["method_not_allowed"] });
  }
  if (!env.AI) {
    return jsonAiFailure("ai_binding_missing", 501, { valid: false, errors: ["ai_request_failed"] });
  }

  let body: unknown;
  try {
    body = await readBoundedJson(request);
  } catch (error) {
    const tooLarge = error instanceof Error && error.message === "body_too_large";
    const code = tooLarge ? "body_too_large" : "invalid_json";
    return jsonAiFailure(code, tooLarge ? 413 : 400, { valid: false, errors: [code] });
  }

  const result = await runAiSummarize(env.AI, body);
  return jsonResponse(result.body, result.status);
}

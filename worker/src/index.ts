import { lookupJpxDisclosures } from "./jpxDisclosures";
import {
  AI_MODEL,
  buildAiExecutionPayload,
  buildDisplaySummary,
  buildRuleFallbackSummary,
  hashAiExecutionPayload,
  parseAiStructuredSummary,
  parseAiSummaryInput,
  validateAiStructuredSummary,
  type AiSummaryInput,
  type AiValidationResult
} from "../../src/lib/aiSummarizer";

type Env = {
  AI: Ai;
  ALLOWED_EXTRA_HOSTS?: string;
  CACHE_TTL_SECONDS?: string;
  RATE_LIMITER: DurableObjectNamespace;
};

const baseAllowedHosts = new Set(["www.release.tdnet.info", "release.tdnet.info", "www2.jpx.co.jp"]);

/**
 * Durable Object ベースの IP 単位レートリミッタ。
 * モジュールスコープ Map と異なり、Workers の複数インスタンス間で正しく共有される。
 * 60秒に30リクエストまで（IP単位）。
 */
export class RateLimiterDO {
  private state: DurableObjectState;
  private count = 0;
  private resetAt = 0;

  constructor(state: DurableObjectState) {
    this.state = state;
  }

  async fetch(request: Request): Promise<Response> {
    return this.state.blockConcurrencyWhile(async () => {
      // 永続化されたカウンタを読む
      if (this.resetAt === 0) {
        const stored = await this.state.storage.get<{ count: number; resetAt: number }>("counter");
        if (stored) {
          this.count = stored.count;
          this.resetAt = stored.resetAt;
        }
      }
      const now = Date.now();
      if (!this.resetAt || this.resetAt < now) {
        this.count = 1;
        this.resetAt = now + 60_000;
      } else {
        this.count += 1;
      }
      await this.state.storage.put("counter", { count: this.count, resetAt: this.resetAt });
      const allowed = this.count <= 30;
      return new Response(JSON.stringify({ allowed, count: this.count, resetAt: this.resetAt }), {
        headers: { "Content-Type": "application/json" }
      });
    });
  }
}

function corsHeaders(origin = "*") {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Vary": "Origin"
  };
}

function jsonError(message: string, status = 400) {
  return new Response(JSON.stringify({ ok: false, error: message }, null, 2), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...corsHeaders()
    }
  });
}

function jsonOk(data: Record<string, unknown>) {
  return new Response(JSON.stringify({ ok: true, ...data }, null, 2), {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...corsHeaders()
    }
  });
}

function jsonAiFailure(
  error: string,
  status: number,
  validation: AiValidationResult,
  audit: { inputHash?: string; model?: string } = {}
) {
  return new Response(JSON.stringify({
    ok: false,
    status: "error",
    error,
    validation,
    ...audit
  }, null, 2), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...corsHeaders()
    }
  });
}

function allowedHosts(env: Env): Set<string> {
  const hosts = new Set(baseAllowedHosts);
  for (const host of (env.ALLOWED_EXTRA_HOSTS || "").split(",")) {
    const trimmed = host.trim().toLowerCase();
    if (trimmed) hosts.add(trimmed);
  }
  return hosts;
}

function isAllowedUrl(url: URL, env: Env): boolean {
  if (url.protocol !== "https:") return false;
  return allowedHosts(env).has(url.hostname.toLowerCase());
}

/** Durable Object ベースのレート制限チェック（複数インスタンス間で正しく共有） */
async function checkRateLimitDO(request: Request, env: Env): Promise<boolean> {
  try {
    const ip = request.headers.get("CF-Connecting-IP") || "unknown";
    const id = env.RATE_LIMITER.idFromName(ip);
    const stub = env.RATE_LIMITER.get(id);
    const resp = await stub.fetch(new Request("https://rate-limiter/check", { method: "POST" }));
    const data = await resp.json() as { allowed: boolean };
    return data.allowed;
  } catch {
    // DO に障害があってもアプリ全体を落とさない（fail-open）
    return true;
  }
}

const MAX_AI_BODY_BYTES = 128 * 1024;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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

async function handleAiSummarize(request: Request, env: Env): Promise<Response> {
  if (request.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders(request.headers.get("Origin") || "*") });
  }
  if (request.method !== "POST") {
    return jsonAiFailure("method_not_allowed", 405, { valid: false, errors: ["method_not_allowed"] });
  }
  if (!(await checkRateLimitDO(request, env))) {
    return jsonAiFailure("rate_limited", 429, { valid: false, errors: ["rate_limited"] });
  }

  let input: AiSummaryInput | undefined;
  try {
    input = parseAiSummaryInput(await readBoundedJson(request));
  } catch (error) {
    const tooLarge = error instanceof Error && error.message === "body_too_large";
    const code = tooLarge ? "body_too_large" : "invalid_json";
    return jsonAiFailure(code, tooLarge ? 413 : 400, { valid: false, errors: [code] });
  }
  if (!input) {
    return jsonAiFailure("invalid_ai_input", 400, { valid: false, errors: ["input_invalid"] });
  }
  const execution = buildAiExecutionPayload(input);
  let inputHash: string;
  try {
    inputHash = await hashAiExecutionPayload(execution);
  } catch {
    return jsonAiFailure(
      "input_hash_failed",
      500,
      { valid: false, errors: ["input_hash_failed"] },
      { model: AI_MODEL }
    );
  }

  try {
    const result = await env.AI.run(execution.model, execution.input);
    const responseValue = isRecord(result) ? result.response : undefined;
    let raw: unknown = responseValue;
    if (typeof responseValue === "string") {
      try {
        raw = JSON.parse(responseValue);
      } catch {
        raw = undefined;
      }
    }
    const structured = parseAiStructuredSummary(raw);
    const validation = structured
      ? validateAiStructuredSummary(structured, input)
      : { valid: false, errors: ["schema_invalid"] };
    if (!structured || !validation.valid) {
      return jsonOk({
        ok: false,
        status: "fallback",
        fallback: "rule_summary",
        fallbackSummary: buildRuleFallbackSummary(input),
        structured: structured ?? { claims: [] },
        validation,
        inputHash,
        model: execution.model
      });
    }
    return jsonOk({
      status: "validated",
      summary: buildDisplaySummary(structured),
      structured,
      validation,
      inputHash,
      model: execution.model
    });
  } catch (error) {
    console.error(JSON.stringify({
      message: "ai_summarize_failed",
      error: error instanceof Error ? error.message : "unknown_error",
      inputHash
    }));
    return jsonAiFailure(
      "ai_request_failed",
      502,
      { valid: false, errors: ["ai_request_failed"] },
      { inputHash, model: execution.model }
    );
  }
}

async function handleProxy(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders(request.headers.get("Origin") || "*") });
  if (!["GET", "POST"].includes(request.method)) return jsonError("method_not_allowed", 405);
  if (!(await checkRateLimitDO(request, env))) return jsonError("rate_limited", 429);

  const requestUrl = new URL(request.url);
  const targetRaw = requestUrl.searchParams.get("url");
  if (!targetRaw) return jsonError("missing_url", 400);

  let target: URL;
  try {
    target = new URL(targetRaw);
  } catch {
    return jsonError("invalid_url", 400);
  }

  if (!isAllowedUrl(target, env)) return jsonError("host_not_allowed", 403);

  const cacheTtl = Number(env.CACHE_TTL_SECONDS || "300");
  const cache = (caches as unknown as { default: Cache }).default;
  const cacheKey = new Request(`${requestUrl.origin}/cache/${encodeURIComponent(target.toString())}`, {
    method: request.method === "GET" ? "GET" : "POST"
  });

  if (request.method === "GET") {
    const cached = await cache.match(cacheKey);
    if (cached) {
      const response = new Response(cached.body, cached);
      response.headers.set("X-Proxy-Cache", "HIT");
      response.headers.set("Access-Control-Allow-Origin", "*");
      return response;
    }
  }

  const upstream = await fetch(target.toString(), {
    method: request.method,
    headers: {
      "User-Agent": "Mozilla/5.0 kessan-tanshin-reader/0.1",
      "Accept": request.headers.get("Accept") || "*/*",
      "Content-Type": request.headers.get("Content-Type") || "application/x-www-form-urlencoded"
    },
    body: request.method === "POST" ? await request.text() : undefined
  });

  const response = new Response(upstream.body, upstream);
  response.headers.set("Access-Control-Allow-Origin", "*");
  response.headers.set("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  response.headers.set("Access-Control-Allow-Headers", "Content-Type");
  response.headers.set("Cache-Control", `public, max-age=${cacheTtl}`);
  response.headers.set("X-Proxy-Cache", "MISS");

  if (request.method === "GET" && upstream.ok) {
    ctx.waitUntil(cache.put(cacheKey, response.clone()));
  }

  return response;
}

async function handleDisclosures(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders(request.headers.get("Origin") || "*") });
  if (request.method !== "GET") return jsonError("method_not_allowed", 405);
  if (!(await checkRateLimitDO(request, env))) return jsonError("rate_limited", 429);

  const requestUrl = new URL(request.url);
  const ticker = (requestUrl.searchParams.get("ticker") || "").trim();
  const lookbackDays = Number(requestUrl.searchParams.get("lookbackDays") || "120");
  if (!/^[0-9][0-9A-Z]{3}$/.test(ticker)) return jsonError("invalid_ticker", 400);
  if (!Number.isFinite(lookbackDays)) return jsonError("invalid_lookback", 400);

  const normalizedLookback = Math.max(30, Math.min(365, Math.round(lookbackDays)));
  const cache = (caches as unknown as { default: Cache }).default;
  const cacheKey = new Request(`${requestUrl.origin}/cache/jpx/${ticker}?lookbackDays=${normalizedLookback}`);
  const cached = await cache.match(cacheKey);
  if (cached) {
    const response = new Response(cached.body, cached);
    response.headers.set("Access-Control-Allow-Origin", "*");
    response.headers.set("X-Proxy-Cache", "HIT");
    return response;
  }

  try {
    const result = await lookupJpxDisclosures({ ticker, lookbackDays: normalizedLookback });
    const response = jsonOk(result);
    response.headers.set("Cache-Control", "public, max-age=600");
    response.headers.set("X-Proxy-Cache", "MISS");
    ctx.waitUntil(cache.put(cacheKey, response.clone()));
    return response;
  } catch (error) {
    console.error(JSON.stringify({
      message: "jpx_lookup_failed",
      error: error instanceof Error ? error.message : "unknown_error"
    }));
    return jsonError("jpx_lookup_failed", 502);
  }
}

function logUnhandled(path: string, error: unknown): void {
  console.error(JSON.stringify({
    message: "unhandled_worker_error",
    path,
    error: error instanceof Error ? error.message : "unknown_error"
  }));
}

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const url = new URL(request.url);
    if (url.pathname === "/ai/summarize") {
      return handleAiSummarize(request, env).catch((error) => {
        logUnhandled(url.pathname, error);
        return jsonAiFailure("internal_error", 500, { valid: false, errors: ["internal_error"] });
      });
    }
    if (url.pathname === "/disclosures") {
      return handleDisclosures(request, env, ctx).catch((error) => {
        logUnhandled(url.pathname, error);
        return jsonError("internal_error", 500);
      });
    }
    return handleProxy(request, env, ctx).catch((error) => {
      logUnhandled(url.pathname, error);
      return jsonError("internal_error", 500);
    });
  }
};

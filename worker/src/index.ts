import { lookupJpxDisclosures } from "./jpxDisclosures";

type Env = {
  AI: {
    run(model: string, input: Record<string, unknown>): Promise<{ response?: string }>;
  };
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

const AI_SYSTEM_PROMPT = `あなたは決算短信（日本企業の四半期・通期決算発表資料）を読むための補助AIです。

以下のルールを厳守してください:
- 投資助言、売買推奨、目標株価、投資判断の断定を絶対に行わない
- 将来の株価予測を行わない
- 「買い」「売り」「保有」などの投資行動を推奨しない
- 断定的な将来予測を避け、資料に記載された事実と企業側の見通しを区別して整理する

以下の観点で日本語で簡潔に整理してください（各項目2-3文程度）:
1. 売上・収益の状況
2. 利益の状況
3. 通期予想・業績予想の変更有無
4. 配当方針
5. 注意すべきリスクや特記事項

最後に「※この要約はAIによる自動生成です。正確性は保証されません。投資判断は必ず原文を確認のうえ、ご自身の責任で行ってください。」と付記してください。`;

async function handleAiSummarize(request: Request, env: Env): Promise<Response> {
  if (request.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders(request.headers.get("Origin") || "*") });
  }
  if (request.method !== "POST") return jsonError("method_not_allowed", 405);
  if (!(await checkRateLimitDO(request, env))) return jsonError("rate_limited", 429);

  let body: { text?: string; ticker?: string; companyName?: string; title?: string };
  try {
    body = await request.json() as typeof body;
  } catch {
    return jsonError("invalid_json", 400);
  }

  if (!body.text || typeof body.text !== "string" || body.text.trim().length < 50) {
    return jsonError("text_too_short", 400);
  }

  const trimmedText = body.text.slice(0, 6000);
  const userPrompt = `以下は${body.companyName || "企業"}（銘柄コード: ${body.ticker || "不明"}）の決算短信「${body.title || "決算資料"}」から抽出したテキストです。上記のルールに従って要約してください。

抽出テキスト:
${trimmedText}`;

  try {
    const result = await env.AI.run("@cf/meta/llama-3.1-8b-instruct", {
      messages: [
        { role: "system", content: AI_SYSTEM_PROMPT },
        { role: "user", content: userPrompt }
      ],
      max_tokens: 1024,
      temperature: 0.3
    });

    if (!result.response) {
      return jsonError("ai_no_response", 502);
    }

    return jsonOk({ summary: result.response });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return jsonError(`ai_error: ${message}`, 502);
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
  if (!/^\d{4}$/.test(ticker)) return jsonError("invalid_ticker", 400);
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
    return jsonError(`jpx_lookup_failed: ${error instanceof Error ? error.message : String(error)}`, 502);
  }
}

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const url = new URL(request.url);
    if (url.pathname === "/ai/summarize") {
      return handleAiSummarize(request, env).catch((error) => jsonError(error instanceof Error ? error.message : String(error), 500));
    }
    if (url.pathname === "/disclosures") {
      return handleDisclosures(request, env, ctx).catch((error) => jsonError(error instanceof Error ? error.message : String(error), 500));
    }
    return handleProxy(request, env, ctx).catch((error) => jsonError(error instanceof Error ? error.message : String(error), 500));
  }
};

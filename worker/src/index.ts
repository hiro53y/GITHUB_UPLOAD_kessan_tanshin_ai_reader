type Env = {
  ALLOWED_EXTRA_HOSTS?: string;
  CACHE_TTL_SECONDS?: string;
};

type ExecutionContext = {
  waitUntil(promise: Promise<unknown>): void;
};

const baseAllowedHosts = new Set(["www.release.tdnet.info", "release.tdnet.info"]);
const rateLimit = new Map<string, { count: number; resetAt: number }>();

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

function checkRateLimit(request: Request): boolean {
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const now = Date.now();
  const current = rateLimit.get(ip);
  if (!current || current.resetAt < now) {
    rateLimit.set(ip, { count: 1, resetAt: now + 60_000 });
    return true;
  }
  if (current.count >= 30) return false;
  current.count += 1;
  return true;
}

async function handleProxy(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders(request.headers.get("Origin") || "*") });
  if (!["GET", "POST"].includes(request.method)) return jsonError("method_not_allowed", 405);
  if (!checkRateLimit(request)) return jsonError("rate_limited", 429);

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

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext) {
    return handleProxy(request, env, ctx).catch((error) => jsonError(error instanceof Error ? error.message : String(error), 500));
  }
};

const DEFAULT_ALLOWED_HOSTS = ["www.release.tdnet.info", "release.tdnet.info", "www2.jpx.co.jp"];
const RATE_WINDOW_MS = 60_000;
const RATE_LIMIT = 60;
const hits = new Map<string, { count: number; expiresAt: number }>();

type ProxyContext = {
  request: Request;
  env: Record<string, unknown>;
  waitUntil?: (promise: Promise<unknown>) => void;
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type"
    }
  });
}

function allowedHosts(env: Record<string, unknown>): string[] {
  const extra = typeof env.ALLOWED_EXTRA_HOSTS === "string" ? env.ALLOWED_EXTRA_HOSTS.split(",").map((host) => host.trim()).filter(Boolean) : [];
  return [...DEFAULT_ALLOWED_HOSTS, ...extra];
}

function isAllowedTarget(target: URL, method: string, env: Record<string, unknown>): boolean {
  if (allowedHosts(env).includes(target.hostname)) return true;
  return method === "GET" && target.protocol === "https:" && target.pathname.toLowerCase().endsWith(".pdf");
}

function rateLimitKey(request: Request): string {
  return request.headers.get("CF-Connecting-IP") || request.headers.get("x-forwarded-for") || "anonymous";
}

function isRateLimited(request: Request): boolean {
  const now = Date.now();
  const key = rateLimitKey(request);
  const current = hits.get(key);
  if (!current || current.expiresAt < now) {
    hits.set(key, { count: 1, expiresAt: now + RATE_WINDOW_MS });
    return false;
  }
  current.count += 1;
  return current.count > RATE_LIMIT;
}

function withCors(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set("Access-Control-Allow-Origin", "*");
  headers.set("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  headers.set("Access-Control-Allow-Headers", "Content-Type");
  headers.delete("Set-Cookie");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export async function onRequest(context: ProxyContext): Promise<Response> {
  const { request, env } = context;
  if (request.method === "OPTIONS") return jsonResponse({});
  if (!["GET", "POST"].includes(request.method)) return jsonResponse({ error: "method_not_allowed" }, 405);
  if (isRateLimited(request)) return jsonResponse({ error: "rate_limited", message: "アクセスが集中しています。少し待ってから再実行してください。" }, 429);

  const requestUrl = new URL(request.url);
  const targetParam = requestUrl.searchParams.get("url");
  if (!targetParam) return jsonResponse({ error: "missing_url" }, 400);

  let target: URL;
  try {
    target = new URL(targetParam);
  } catch {
    return jsonResponse({ error: "invalid_url" }, 400);
  }

  if (!isAllowedTarget(target, request.method, env)) {
    return jsonResponse({ error: "host_not_allowed", host: target.hostname }, 403);
  }

  const cache = caches.default;
  const cacheKey = new Request(`https://kessan-reader-proxy.local/${target.toString()}`, { method: "GET" });
  if (request.method === "GET") {
    const cached = await cache.match(cacheKey);
    if (cached) return withCors(cached);
  }

  try {
    const headers = new Headers();
    const contentType = request.headers.get("content-type");
    if (contentType) headers.set("Content-Type", contentType);
    // 一般的なブラウザ User-Agent を装う（TDnet/JPXが独自UAを拒否するケースに対応）
    headers.set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36");
    headers.set("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8");
    headers.set("Accept-Language", "ja,en;q=0.9");
    // TDnet/JPX が Referer をチェックするケースに備えて同一オリジンを設定
    headers.set("Referer", `${target.protocol}//${target.host}/`);

    // POST body は ReadableStream のままだとランタイムによって転送失敗するため、
    // 一度文字列化してから upstream に渡す（小さなフォーム送信のみを想定）
    const bodyText = request.method === "POST" ? await request.text() : undefined;

    const upstream = await fetch(target.toString(), {
      method: request.method,
      headers,
      body: bodyText,
      cf: request.method === "GET" ? { cacheTtl: 300, cacheEverything: true } : undefined
    } as RequestInit);

    const response = withCors(upstream);
    if (request.method === "GET" && upstream.ok) context.waitUntil?.(cache.put(cacheKey, response.clone()));
    return response;
  } catch (error) {
    return jsonResponse(
      {
        error: "proxy_fetch_failed",
        message: error instanceof Error ? error.message : String(error)
      },
      502
    );
  }
}

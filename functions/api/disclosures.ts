import { lookupJpxDisclosures } from "../lib/jpxDisclosures";

type PagesContext = {
  request: Request;
  waitUntil?: (promise: Promise<unknown>) => void;
};

function jsonResponse(body: unknown, status = 200, cacheControl = "no-store"): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Cache-Control": cacheControl
    }
  });
}

export async function onRequest(context: PagesContext): Promise<Response> {
  const { request } = context;
  if (request.method === "OPTIONS") return jsonResponse({});
  if (request.method !== "GET") return jsonResponse({ ok: false, error: "method_not_allowed" }, 405);

  const url = new URL(request.url);
  const ticker = (url.searchParams.get("ticker") || "").trim();
  const lookbackDays = Number(url.searchParams.get("lookbackDays") || "120");
  if (!/^\d{4}$/.test(ticker)) return jsonResponse({ ok: false, error: "invalid_ticker" }, 400);
  if (!Number.isFinite(lookbackDays)) return jsonResponse({ ok: false, error: "invalid_lookback" }, 400);

  const normalizedLookback = Math.max(30, Math.min(365, Math.round(lookbackDays)));
  const cache = caches.default;
  const cacheKey = new Request(`https://kessan-reader-jpx.local/${ticker}?lookbackDays=${normalizedLookback}`);
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  try {
    const result = await lookupJpxDisclosures({ ticker, lookbackDays: normalizedLookback });
    const response = jsonResponse({ ok: true, ...result }, 200, "public, max-age=600");
    context.waitUntil?.(cache.put(cacheKey, response.clone()));
    return response;
  } catch (error) {
    return jsonResponse(
      {
        ok: false,
        error: "jpx_lookup_failed",
        message: error instanceof Error ? error.message : String(error)
      },
      502
    );
  }
}

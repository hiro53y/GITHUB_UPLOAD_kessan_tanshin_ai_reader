export const MAX_PROXY_BODY_BYTES = 128 * 1024;
const MAX_REDIRECTS = 5;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
type WorkerRequestInit = RequestInit & { cf?: { cacheTtl?: number; cacheEverything?: boolean } };

export class ProxyRequestError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ProxyRequestError";
    this.status = status;
  }
}

function parseIpv4(value: string): [number, number, number, number] | undefined {
  const parts = value.split(".");
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part))) return undefined;
  const bytes = parts.map(Number);
  if (bytes.some((part) => part < 0 || part > 255)) return undefined;
  return bytes as [number, number, number, number];
}

function mappedIpv4(value: string): [number, number, number, number] | undefined {
  const dotted = value.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i);
  if (dotted) return parseIpv4(dotted[1]);
  const hexadecimal = value.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i);
  if (!hexadecimal) return undefined;
  const high = Number.parseInt(hexadecimal[1], 16);
  const low = Number.parseInt(hexadecimal[2], 16);
  return [high >>> 8, high & 0xff, low >>> 8, low & 0xff];
}

function isPrivateIpv4(bytes: [number, number, number, number]): boolean {
  const [a, b] = bytes;
  return a === 0
    || a === 10
    || a === 127
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168);
}

/** URL.hostnameを受け取り、内部IPv4と表記揺れの多いIPv6 literalを遮断する。 */
export function isPrivateHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal") || host.endsWith(".local")) return true;

  const ipv4 = parseIpv4(host);
  if (ipv4) return isPrivateIpv4(ipv4);

  // IPv6 literalには圧縮表記など多数の別表現があるため、allowlist名との混同を避けて一律遮断する。
  if (mappedIpv4(host)) return true;
  if (host.includes(":")) return true;
  return false;
}

/** POST本文を上限付きで読み、Content-Length未指定・偽装時も実バイト数で止める。 */
export async function readBoundedProxyBody(request: Request): Promise<string> {
  const contentLength = Number(request.headers.get("Content-Length") || "0");
  if (!Number.isFinite(contentLength) || contentLength < 0 || contentLength > MAX_PROXY_BODY_BYTES) {
    throw new ProxyRequestError("body_too_large", 413);
  }
  const reader = request.body?.getReader();
  if (!reader) return "";

  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > MAX_PROXY_BODY_BYTES) throw new ProxyRequestError("body_too_large", 413);
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
  return new TextDecoder().decode(bytes);
}

/** redirectを自動追跡せず、各Locationを同じ許可規則で再検証する。 */
export async function fetchWithValidatedRedirects(input: {
  url: URL;
  method: "GET" | "POST";
  headers: Headers;
  body?: string;
  isAllowed: (url: URL, method: "GET" | "POST") => boolean;
  init?: WorkerRequestInit;
  fetchImpl?: FetchLike;
}): Promise<Response> {
  const fetchImpl = input.fetchImpl ?? fetch;
  let currentUrl = input.url;
  let method = input.method;
  let body = input.body;
  let headers = new Headers(input.headers);

  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
    if (!input.isAllowed(currentUrl, method)) throw new ProxyRequestError("host_not_allowed", 403);
    const response = await fetchImpl(currentUrl.toString(), {
      ...input.init,
      method,
      headers,
      body: method === "POST" ? body : undefined,
      redirect: "manual"
    });
    if (!REDIRECT_STATUSES.has(response.status)) return response;

    const location = response.headers.get("Location");
    if (!location) return response;
    if (redirects === MAX_REDIRECTS) {
      await response.body?.cancel();
      throw new ProxyRequestError("too_many_redirects", 502);
    }

    let nextUrl: URL;
    try {
      nextUrl = new URL(location, currentUrl);
    } catch {
      await response.body?.cancel();
      throw new ProxyRequestError("invalid_redirect", 502);
    }

    if (response.status === 303 || ((response.status === 301 || response.status === 302) && method === "POST")) {
      method = "GET";
      body = undefined;
      headers = new Headers(headers);
      headers.delete("Content-Type");
      headers.delete("Content-Length");
    }
    if (!input.isAllowed(nextUrl, method)) {
      await response.body?.cancel();
      throw new ProxyRequestError("host_not_allowed", 403);
    }
    await response.body?.cancel();
    currentUrl = nextUrl;
  }

  throw new ProxyRequestError("too_many_redirects", 502);
}

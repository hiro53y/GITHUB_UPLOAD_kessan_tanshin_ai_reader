import { afterEach, describe, expect, it, vi } from "vitest";
import { MAX_PROXY_BODY_BYTES } from "../functions/lib/proxySecurity";

const { onRequest: onPagesProxyRequest } = await vi.importActual<any>("../functions/api/proxy");
const { default: worker } = await vi.importActual<any>("../worker/src/index");

type InvokeOptions = { extraHosts?: string };
type ProxyAdapter = {
  name: string;
  endpoint: string;
  invoke: (request: Request, options?: InvokeOptions) => Promise<Response>;
};

function installCacheStub(): void {
  vi.stubGlobal("caches", {
    default: {
      match: vi.fn(async () => undefined),
      put: vi.fn(async () => undefined)
    }
  });
}

function workerEnv(extraHosts = "") {
  return {
    AI: { run: vi.fn() },
    ALLOWED_EXTRA_HOSTS: extraHosts,
    RATE_LIMITER: {
      idFromName: vi.fn(() => ({ name: "test" })),
      get: vi.fn(() => ({
        fetch: vi.fn(async () => Response.json({ allowed: true }))
      }))
    }
  };
}

const adapters: ProxyAdapter[] = [
  {
    name: "Pages Functions",
    endpoint: "https://pages.example/api/proxy",
    invoke: (request, options) => onPagesProxyRequest({
      request,
      env: { ALLOWED_EXTRA_HOSTS: options?.extraHosts ?? "" },
      waitUntil: () => undefined
    })
  },
  {
    name: "外部Worker",
    endpoint: "https://worker.example/proxy",
    invoke: (request, options) => worker.fetch(
      request,
      workerEnv(options?.extraHosts) as never,
      { waitUntil: () => undefined } as never
    )
  }
];

afterEach(() => {
  vi.unstubAllGlobals();
});

describe.each(adapters)("$name proxy境界", ({ endpoint, invoke }) => {
  it("IPv4-mapped IPv6のループバックを許可ホスト指定より先に遮断する", async () => {
    installCacheStub();
    const fetchMock = vi.fn(async () => new Response("should not fetch"));
    vi.stubGlobal("fetch", fetchMock);
    const target = new URL("https://[::ffff:127.0.0.1]/metadata.pdf");
    const request = new Request(`${endpoint}?url=${encodeURIComponent(target.toString())}`, {
      headers: { "CF-Connecting-IP": "203.0.113.10" }
    });

    const response = await invoke(request, { extraHosts: target.hostname });

    expect(response.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("IPv4-compatible形式の圧縮IPv6 literalも許可ホスト指定より先に遮断する", async () => {
    installCacheStub();
    const fetchMock = vi.fn(async () => new Response("should not fetch"));
    vi.stubGlobal("fetch", fetchMock);
    const target = new URL("https://[::7f00:1]/metadata.pdf");
    const request = new Request(`${endpoint}?url=${encodeURIComponent(target.toString())}`, {
      headers: { "CF-Connecting-IP": "203.0.113.10" }
    });

    const response = await invoke(request, { extraHosts: target.hostname });

    expect(response.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("許可先からprivate hostへのredirectを追跡前に遮断する", async () => {
    installCacheStub();
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(null, {
      status: 302,
      headers: { "Location": "https://[::ffff:127.0.0.1]/metadata.pdf" }
    }));
    vi.stubGlobal("fetch", fetchMock);
    const target = "https://www2.jpx.co.jp/redirect";
    const request = new Request(`${endpoint}?url=${encodeURIComponent(target)}`, {
      headers: { "CF-Connecting-IP": "203.0.113.11" }
    });

    const response = await invoke(request);

    expect(response.status).toBe(403);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ redirect: "manual" });
  });

  it("POST本文が上限を1 byte超えた時点で413にする", async () => {
    installCacheStub();
    const fetchMock = vi.fn(async () => new Response("should not fetch"));
    vi.stubGlobal("fetch", fetchMock);
    const target = "https://www2.jpx.co.jp/submit";
    const request = new Request(`${endpoint}?url=${encodeURIComponent(target)}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", "CF-Connecting-IP": "203.0.113.12" },
      body: "x".repeat(MAX_PROXY_BODY_BYTES + 1)
    });

    const response = await invoke(request);

    expect(response.status).toBe(413);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("許可されたredirectと上限内POSTは従来どおり転送する", async () => {
    installCacheStub();
    const fetchMock = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      if (String(url).endsWith("/start")) {
        return new Response(null, { status: 307, headers: { "Location": "/finish" } });
      }
      expect(String(url)).toBe("https://www2.jpx.co.jp/finish");
      expect(init?.method).toBe("POST");
      expect(init?.body).toBe("ticker=130A");
      return new Response("ok", { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const target = "https://www2.jpx.co.jp/start";
    const request = new Request(`${endpoint}?url=${encodeURIComponent(target)}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", "CF-Connecting-IP": "203.0.113.13" },
      body: "ticker=130A"
    });

    const response = await invoke(request);

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("予期しない上流例外の内部メッセージを応答へ露出しない", async () => {
    installCacheStub();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("secret-upstream-token");
    }));
    const target = "https://www2.jpx.co.jp/failure";
    const request = new Request(`${endpoint}?url=${encodeURIComponent(target)}`, {
      headers: { "CF-Connecting-IP": "203.0.113.14" }
    });

    const response = await invoke(request);
    const body = await response.text();

    expect(response.status).toBeGreaterThanOrEqual(500);
    expect(body).not.toContain("secret-upstream-token");
  });
});

import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { buildApp } from "./build.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const dist = path.join(root, "dist");
const distOnly = process.argv.includes("--dist-only");
const smoke = process.argv.includes("--smoke");
let jpxLookupModulePromise;

const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".pdf": "application/pdf",
  ".mjs": "text/javascript; charset=utf-8"
};

async function proxyTdnet(req, res) {
  const requestUrl = new URL(req.url || "/", "http://localhost");
  let target;
  if (requestUrl.pathname === "/tdnet-search") {
    target = "https://www.release.tdnet.info/onsf/TDJFSearch/TDJFSearch";
  } else if (requestUrl.pathname.startsWith("/tdnet/")) {
    target = `https://www.release.tdnet.info${requestUrl.pathname.replace(/^\/tdnet/, "")}${requestUrl.search}`;
  } else if (requestUrl.pathname === "/api/proxy") {
    const rawTarget = requestUrl.searchParams.get("url");
    if (!rawTarget) {
      res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ error: "missing_url" }));
      return true;
    }
    const parsedTarget = new URL(rawTarget);
    const allowedHost = ["www.release.tdnet.info", "release.tdnet.info", "www2.jpx.co.jp"].includes(parsedTarget.hostname);
    const allowedPdf = req.method === "GET" && parsedTarget.protocol === "https:" && parsedTarget.pathname.toLowerCase().endsWith(".pdf");
    if (!allowedHost && !allowedPdf) {
      res.writeHead(403, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ error: "host_not_allowed" }));
      return true;
    }
    target = parsedTarget.toString();
  } else {
    return false;
  }

  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = Buffer.concat(chunks);
  const upstream = await fetch(target, {
    method: req.method,
    headers: {
      "User-Agent": "Mozilla/5.0 kessan-tanshin-reader-dev",
      "Content-Type": req.headers["content-type"] || "application/x-www-form-urlencoded"
    },
    body: req.method === "POST" ? body : undefined
  });
  res.writeHead(upstream.status, {
    "Content-Type": upstream.headers.get("content-type") || "application/octet-stream",
    "Access-Control-Allow-Origin": "*"
  });
  const buffer = Buffer.from(await upstream.arrayBuffer());
  res.end(buffer);
  return true;
}

async function getJpxLookupModule() {
  if (!jpxLookupModulePromise) {
    jpxLookupModulePromise = readFile(path.join(root, "functions", "lib", "jpxDisclosures.ts"), "utf8").then((source) => {
      const output = ts.transpileModule(source, {
        compilerOptions: {
          target: ts.ScriptTarget.ES2020,
          module: ts.ModuleKind.ESNext
        }
      }).outputText;
      return import(`data:text/javascript;base64,${Buffer.from(output).toString("base64")}`);
    });
  }
  return jpxLookupModulePromise;
}

async function serveJpxDisclosures(req, res) {
  const requestUrl = new URL(req.url || "/", "http://localhost");
  if (requestUrl.pathname !== "/api/disclosures") return false;
  if (req.method !== "GET") {
    res.writeHead(405, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ ok: false, error: "method_not_allowed" }));
    return true;
  }

  const ticker = (requestUrl.searchParams.get("ticker") || "").trim();
  const lookbackDays = Number(requestUrl.searchParams.get("lookbackDays") || "120");
  if (!/^\d{4}$/.test(ticker) || !Number.isFinite(lookbackDays)) {
    res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ ok: false, error: "invalid_request" }));
    return true;
  }

  try {
    const { lookupJpxDisclosures } = await getJpxLookupModule();
    const result = await lookupJpxDisclosures({ ticker, lookbackDays });
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
    res.end(JSON.stringify({ ok: true, ...result }));
  } catch (error) {
    res.writeHead(502, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ ok: false, error: "jpx_lookup_failed", message: error instanceof Error ? error.message : String(error) }));
  }
  return true;
}

async function serveFile(req, res) {
  if (await serveJpxDisclosures(req, res)) return;
  if (await proxyTdnet(req, res)) return;
  const requestUrl = new URL(req.url || "/", "http://localhost");
  let filePath = path.normalize(path.join(dist, decodeURIComponent(requestUrl.pathname)));
  if (!filePath.startsWith(dist)) {
    res.writeHead(403);
    res.end("forbidden");
    return;
  }
  try {
    const info = await stat(filePath);
    if (info.isDirectory()) filePath = path.join(filePath, "index.html");
  } catch {
    filePath = path.join(dist, "index.html");
  }

  try {
    const body = await readFile(filePath);
    res.writeHead(200, {
      "Content-Type": mime[path.extname(filePath)] || "application/octet-stream",
      "Cache-Control": "no-cache"
    });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end("not found");
  }
}

async function listen(port) {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      serveFile(req, res).catch((error) => {
        res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
        res.end(error instanceof Error ? error.message : String(error));
      });
    });
    server.once("error", reject);
    server.listen(port, "0.0.0.0", () => resolve(server));
  });
}

if (!distOnly) await buildApp();

let port = Number(process.env.PORT || "5173");
for (;;) {
  try {
    const server = await listen(port);
    console.log(`決算短信AIリーダー dev server: http://localhost:${port}`);
    if (smoke) {
      server.close();
      console.log("smoke check passed");
    }
    break;
  } catch (error) {
    if (error?.code === "EADDRINUSE") {
      port += 1;
      continue;
    }
    throw error;
  }
}

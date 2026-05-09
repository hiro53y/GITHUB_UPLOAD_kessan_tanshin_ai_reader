import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildApp } from "./build.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const dist = path.join(root, "dist");
const distOnly = process.argv.includes("--dist-only");
const smoke = process.argv.includes("--smoke");

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
    const targetParam = requestUrl.searchParams.get("url");
    if (!targetParam) {
      res.writeHead(400, { "Content-Type": "application/json; charset=utf-8", "Access-Control-Allow-Origin": "*" });
      res.end(JSON.stringify({ error: "missing_url" }));
      return true;
    }
    const parsed = new URL(targetParam);
    if (!["www.release.tdnet.info", "release.tdnet.info"].includes(parsed.hostname)) {
      res.writeHead(403, { "Content-Type": "application/json; charset=utf-8", "Access-Control-Allow-Origin": "*" });
      res.end(JSON.stringify({ error: "host_not_allowed" }));
      return true;
    }
    target = parsed.toString();
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

async function serveFile(req, res) {
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

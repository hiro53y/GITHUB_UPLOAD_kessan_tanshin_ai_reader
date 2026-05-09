import { existsSync, statSync } from "node:fs";
import { copyFile, mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { rollup } from "rollup";
import commonjs from "@rollup/plugin-commonjs";
import json from "@rollup/plugin-json";
import ts from "typescript";
import postcss from "postcss";
import tailwindcss from "tailwindcss";
import autoprefixer from "autoprefixer";

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const dist = path.join(root, "dist");
const assets = path.join(dist, "assets");

async function copyDir(src, dest) {
  try {
    await mkdir(dest, { recursive: true });
    for (const entry of await readdir(src)) {
      const srcPath = path.join(src, entry);
      const destPath = path.join(dest, entry);
      const info = await stat(srcPath);
      if (info.isDirectory()) await copyDir(srcPath, destPath);
      else {
        try {
          const [sourceBody, destBody] = await Promise.all([readFile(srcPath), readFile(destPath).catch(() => undefined)]);
          if (destBody && Buffer.compare(sourceBody, destBody) === 0) continue;
        } catch {
          // Fall through to copy. This keeps locked identical files untouched on Windows/OneDrive.
        }
        await copyFile(srcPath, destPath);
      }
    }
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

function tsPlugin() {
  return {
    name: "typescript-transpile",
    transform(code, id) {
      if (!/\.(ts|tsx)$/.test(id) || id.includes("node_modules")) return null;
      const result = ts.transpileModule(code, {
        fileName: id,
        compilerOptions: {
          target: ts.ScriptTarget.ES2020,
          module: ts.ModuleKind.ESNext,
          moduleResolution: ts.ModuleResolutionKind.NodeJs,
          jsx: ts.JsxEmit.ReactJSX,
          jsxImportSource: "react",
          useDefineForClassFields: true,
          sourceMap: true
        }
      });
      return {
        code: result.outputText,
        map: result.sourceMapText ? JSON.parse(result.sourceMapText) : null
      };
    }
  };
}

function cssNullPlugin() {
  return {
    name: "css-null",
    load(id) {
      if (id.endsWith(".css")) return "export default \"\";";
      return null;
    }
  };
}

function pdfWorkerUrlPlugin() {
  return {
    name: "pdf-worker-url",
    resolveId(source) {
      if (source.endsWith("?url")) return `\0url:${source}`;
      return null;
    },
    async load(id) {
      if (!id.startsWith("\0url:")) return null;
      const source = id.slice("\0url:".length).replace("?url", "");
      const resolved = require.resolve(source);
      const fileName = "pdf.worker.mjs";
      await mkdir(assets, { recursive: true });
      await copyFile(resolved, path.join(assets, fileName));
      return `export default "/assets/${fileName}";`;
    }
  };
}

function nodeModuleResolverPlugin() {
  const extensions = ["", ".mjs", ".js", ".jsx", ".ts", ".tsx", ".json"];
  const isBareModule = (source) =>
    !source.startsWith(".") &&
    !source.startsWith("/") &&
    !source.startsWith("\\") &&
    !source.startsWith("\0");

  const resolveLocal = (candidate) => {
    for (const extension of extensions) {
      const filePath = `${candidate}${extension}`;
      if (existsSync(filePath) && statSync(filePath).isFile()) return filePath;
    }
    if (existsSync(candidate) && statSync(candidate).isDirectory()) {
      for (const extension of extensions.slice(1)) {
        const indexPath = path.join(candidate, `index${extension}`);
        if (existsSync(indexPath) && statSync(indexPath).isFile()) return indexPath;
      }
    }
    return null;
  };

  return {
    name: "node-module-resolver",
    resolveId(source, importer) {
      if (source.startsWith("\0") || source.endsWith("?url")) return null;
      if (!isBareModule(source)) {
        const importerDir = importer && !importer.startsWith("\0") ? path.dirname(importer) : root;
        return resolveLocal(path.resolve(importerDir, source));
      }
      try {
        const importerDir = importer && !importer.startsWith("\0") ? path.dirname(importer) : root;
        return require.resolve(source, { paths: [importerDir, root] });
      } catch {
        return null;
      }
    }
  };
}

function productionDefinesPlugin() {
  const replaceDefines = (code) =>
    code
      .replaceAll("process.env.NODE_ENV", JSON.stringify("production"))
      .replaceAll("import.meta.env?.DEV", "false")
      .replaceAll("import.meta.env?.PROD", "true")
      .replaceAll("import.meta.env.DEV", "false")
      .replaceAll("import.meta.env.PROD", "true");

  return {
    name: "production-defines",
    transform(code, id) {
      if (!/\.(js|mjs|ts|tsx)$/.test(id)) return null;
      const next = replaceDefines(code);
      return next === code ? null : { code: next, map: null };
    },
    renderChunk(code) {
      const next = replaceDefines(code);
      return next === code ? null : { code: next, map: null };
    }
  };
}

async function buildCss() {
  const input = await readFile(path.join(root, "src", "index.css"), "utf8");
  const result = await postcss([tailwindcss({ config: path.join(root, "tailwind.config.js") }), autoprefixer]).process(input, {
    from: path.join(root, "src", "index.css"),
    to: path.join(assets, "index.css")
  });
  await mkdir(assets, { recursive: true });
  await writeFile(path.join(assets, "index.css"), result.css);
}

async function buildJs() {
  const bundle = await rollup({
    input: path.join(root, "src", "main.tsx"),
    plugins: [
      productionDefinesPlugin(),
      cssNullPlugin(),
      pdfWorkerUrlPlugin(),
      tsPlugin(),
      nodeModuleResolverPlugin(),
      commonjs(),
      json()
    ],
    treeshake: true,
    onwarn(warning, warn) {
      if (warning.code === "MODULE_LEVEL_DIRECTIVE") return;
      warn(warning);
    }
  });

  await bundle.write({
    dir: dist,
    format: "es",
    sourcemap: false,
    entryFileNames: "assets/app.js",
    chunkFileNames: "assets/[name]-[hash].js",
    assetFileNames: "assets/[name]-[hash][extname]"
  });
  await bundle.close();
}

async function writeHtmlAndPwa() {
  await writeFile(
    path.join(dist, "index.html"),
    `<!doctype html>
<html lang="ja">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
    <meta name="theme-color" content="#0055c8" />
    <meta name="description" content="決算短信を読むための補助PWA" />
    <link rel="manifest" href="/manifest.webmanifest" />
    <link rel="icon" href="/icon.svg" type="image/svg+xml" />
    <link rel="stylesheet" href="/assets/index.css" />
    <title>決算短信AIリーダー</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/assets/app.js"></script>
    <script>
      if ("serviceWorker" in navigator) {
        window.addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(() => {}));
      }
    </script>
  </body>
</html>
`
  );

  await writeFile(
    path.join(dist, "manifest.webmanifest"),
    JSON.stringify(
      {
        name: "決算短信AIリーダー",
        short_name: "短信リーダー",
        description: "銘柄コードから決算短信を取得し、標準ルール分析で読む補助PWA",
        theme_color: "#0055c8",
        background_color: "#eef6ff",
        display: "standalone",
        orientation: "portrait",
        scope: "/",
        start_url: "/",
        icons: [
          { src: "/icon.svg", sizes: "192x192", type: "image/svg+xml", purpose: "any" },
          { src: "/maskable-icon.svg", sizes: "512x512", type: "image/svg+xml", purpose: "maskable" }
        ]
      },
      null,
      2
    )
  );

  await writeFile(
    path.join(dist, "sw.js"),
    `const CACHE = "kessan-reader-v1";
self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(["/", "/index.html", "/assets/index.css", "/assets/app.js", "/icon.svg", "/maskable-icon.svg"])));
});
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.pathname.startsWith("/tdnet")) return;
  if (url.pathname.startsWith("/api/proxy")) return;
  if (event.request.mode === "navigate") {
    event.respondWith(fetch(event.request).catch(() => caches.match("/index.html")));
    return;
  }
  if (event.request.method === "GET") {
    event.respondWith(caches.match(event.request).then((cached) => cached || fetch(event.request).then((response) => {
      const copy = response.clone();
      caches.open(CACHE).then((cache) => cache.put(event.request, copy));
      return response;
    })));
  }
});
`
  );
}

export async function buildApp() {
  await mkdir(assets, { recursive: true });
  await copyDir(path.join(root, "public"), dist);
  await buildCss();
  await buildJs();
  await writeHtmlAndPwa();
  console.log(`built ${dist}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  buildApp().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

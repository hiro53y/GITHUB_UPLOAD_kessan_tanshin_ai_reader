import ts from "typescript";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

function noSpawnTypeScript() {
  return {
    name: "no-spawn-typescript",
    enforce: "pre",
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

export default defineConfig({
  esbuild: false,
  optimizeDeps: {
    disabled: true
  },
  plugins: [
    noSpawnTypeScript(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["icon.svg", "maskable-icon.svg"],
      manifest: {
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
          {
            src: "/icon.svg",
            sizes: "192x192",
            type: "image/svg+xml",
            purpose: "any"
          },
          {
            src: "/maskable-icon.svg",
            sizes: "512x512",
            type: "image/svg+xml",
            purpose: "maskable"
          }
        ]
      },
      workbox: {
        navigateFallbackDenylist: [/^\/tdnet/, /^\/tdnet-search/, /^\/api\/proxy/],
        runtimeCaching: [
          {
            urlPattern: ({ request }) => request.destination === "document",
            handler: "NetworkFirst",
            options: {
              cacheName: "documents"
            }
          },
          {
            urlPattern: ({ request }) => ["script", "style", "image", "font"].includes(request.destination),
            handler: "StaleWhileRevalidate",
            options: {
              cacheName: "assets"
            }
          }
        ]
      }
    })
  ],
  build: {
    // 本番バンドルを最小化（esbuildは高速・依存追加なし）
    minify: "esbuild",
    sourcemap: false
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    globals: false
  },
  server: {
    proxy: {
      "/tdnet-search": {
        target: "https://www.release.tdnet.info",
        changeOrigin: true,
        secure: true,
        rewrite: () => "/onsf/TDJFSearch/TDJFSearch"
      },
      "/tdnet": {
        target: "https://www.release.tdnet.info",
        changeOrigin: true,
        secure: true,
        rewrite: (path) => path.replace(/^\/tdnet/, "")
      }
    }
  }
});

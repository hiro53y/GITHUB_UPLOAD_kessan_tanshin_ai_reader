import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("..", import.meta.url));
const readProjectFile = (relativePath: string) => readFileSync(path.join(root, relativePath), "utf8");

describe("build freshness", () => {
  it("画面表示用buildタグが精度向上版の日付へ更新されている", () => {
    expect(readProjectFile("src/lib/utils.ts")).toContain('APP_BUILD_TAG = "2026-08-11.1"');
  });

  it("Service Workerのcache名をbundle内容から生成し、precache時にHTTP cacheを迂回する", () => {
    const buildScript = readProjectFile("scripts/build.mjs");
    expect(buildScript).toContain('createHash("sha256")');
    expect(buildScript).toContain('cache: "reload"');
    expect(buildScript).not.toContain('const CACHE = "kessan-reader-v2"');
  });

  it("固定ファイル名のassetsへimmutableを指定しない", () => {
    const headers = readProjectFile("public/_headers");
    expect(headers).not.toMatch(/\/assets\/\*[\s\S]*?Cache-Control:\s*[^\n]*immutable/u);
  });

  it("build前に正本直下のdistだけを消して旧bundleの混在を防ぐ", () => {
    const buildScript = readProjectFile("scripts/build.mjs");
    expect(buildScript).toContain('path.basename(dist) !== "dist"');
    expect(buildScript).toContain("await rm(dist, { recursive: true, force: true })");
  });
});

import ts from "typescript";
import { startVitest } from "vitest/node";

const watch = process.argv.includes("--watch");

const typescriptNoSpawn = {
  name: "typescript-no-spawn",
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
        esModuleInterop: true
      }
    });
    return { code: result.outputText, map: null };
  }
};

const context = await startVitest(
  "test",
  [],
  {
    config: false,
    run: !watch,
    watch,
    passWithNoTests: false,
    environment: "node",
    include: ["tests/**/*.test.ts"],
    pool: "threads",
    poolOptions: { threads: { singleThread: true } }
  },
  {
    esbuild: false,
    optimizeDeps: { disabled: true },
    resolve: { preserveSymlinks: true },
    plugins: [typescriptNoSpawn]
  }
);

if (!context) process.exit(1);
if (watch) {
  await new Promise(() => {});
}

const failed =
  context.state.getFiles().some((file) => file.result?.state === "fail") ||
  context.state.getUnhandledErrors().length > 0 ||
  context.state.getFiles().length === 0;
await context.close();
process.exit(failed ? 1 : 0);

/**
 * 互換import用shim。Workers AIの入出力・検証ロジックはブラウザと同じ原本を使う。
 * Worker本体も `src/lib/aiSummarizer.ts` を直接参照する。
 */
export * from "../../src/lib/aiSummarizer";

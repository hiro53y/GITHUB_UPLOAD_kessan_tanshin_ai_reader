import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AI_DISCLAIMER,
  AI_MAX_CLAIMS,
  AI_MODEL,
  AI_TIMEOUT_MS,
  buildAiExecutionPayload,
  buildDisplaySummary,
  fetchAiSummary,
  hashAiExecutionPayload,
  parseAiStructuredSummary,
  parseAiSummaryInput,
  type AiStructuredSummary,
  type AiSummaryInput
} from "../src/lib/aiSummarizer";

const input: AiSummaryInput = {
  pages: [{ page: 2, excerpt: "売上高 1,200 百万円、営業利益 100 百万円" }],
  facts: [{ label: "売上高", value: "1,200百万円", page: 2 }],
  ticker: "1234",
  companyName: "テスト株式会社",
  title: "2026年3月期 決算短信"
};

const structured: AiStructuredSummary = {
  claims: [{
    category: "売上",
    fact: "売上高は1,200百万円です。",
    page: 2,
    evidence: "売上高 1,200 百万円",
    uncertainty: "表の列見出しは原文確認が必要です。"
  }]
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("AI structured summary boundary", () => {
  it("JSON Modeの模擬応答を構造化データとして受理し、表示文に免責を付ける", () => {
    const summary = parseAiStructuredSummary(structured);
    expect(summary).toBeDefined();
    expect(buildDisplaySummary(summary!)).toContain("投資判断は必ず原文を確認");
  });

  it("未知カテゴリ、余分なキー、空claims、9件目を受理しない", () => {
    expect(parseAiStructuredSummary({ claims: [] })).toBeUndefined();
    expect(parseAiStructuredSummary({ claims: [{ ...structured.claims[0], category: "推奨" }] })).toBeUndefined();
    expect(parseAiStructuredSummary({ claims: [{ ...structured.claims[0], extra: true }] })).toBeUndefined();
    expect(parseAiStructuredSummary({ claims: Array.from({ length: AI_MAX_CLAIMS }, () => structured.claims[0]) })).toBeDefined();
    expect(parseAiStructuredSummary({ claims: Array.from({ length: AI_MAX_CLAIMS + 1 }, () => structured.claims[0]) })).toBeUndefined();
  });

  it("ページは1以上かつ一意、fact.pageは指定ページ内に限る", () => {
    expect(parseAiSummaryInput(input)).toEqual(input);
    expect(parseAiSummaryInput({ pages: [{ page: 0, excerpt: "本文" }] })).toBeUndefined();
    expect(parseAiSummaryInput({ pages: [{ page: 1, excerpt: "本文" }, { page: 1, excerpt: "重複" }] })).toBeUndefined();
    expect(parseAiSummaryInput({ pages: [{ page: 1, excerpt: "本文" }], facts: [{ label: "売上高", value: "100", page: 2 }] })).toBeUndefined();
    expect(parseAiSummaryInput({ pages: [{ page: 1, excerpt: "本文" }], facts: [{ label: "売上高", value: "100", page: 0 }] })).toBeUndefined();
  });

  it("canonical実行payloadのモデル・messages・schema・生成パラメータを全てhash対象にする", async () => {
    const base = buildAiExecutionPayload(input);
    const reordered = { input: base.input, model: base.model };
    const changedModel = { ...base, model: base.model + "-changed" };
    const changedMessages = {
      ...base,
      input: {
        ...base.input,
        messages: base.input.messages.map((message, index) => index === 1 ? { ...message, content: message.content + " changed" } : message)
      }
    };
    const changedSchema = {
      ...base,
      input: {
        ...base.input,
        response_format: {
          ...base.input.response_format,
          json_schema: { ...base.input.response_format.json_schema, description: "changed" }
        }
      }
    };
    const changedParameters = { ...base, input: { ...base.input, max_tokens: base.input.max_tokens + 1 } };
    const hashes = await Promise.all([
      hashAiExecutionPayload(base),
      hashAiExecutionPayload(reordered),
      hashAiExecutionPayload(changedModel),
      hashAiExecutionPayload(changedMessages),
      hashAiExecutionPayload(changedSchema),
      hashAiExecutionPayload(changedParameters)
    ]);
    expect(hashes[0]).toBe(hashes[1]);
    expect(new Set([hashes[0], ...hashes.slice(2)]).size).toBe(5);
  });

  it("Workerのsummaryを信用せず、構造をクライアント再検証して表示文を再生成する", async () => {
    const execution = buildAiExecutionPayload(input);
    const inputHash = await hashAiExecutionPayload(execution);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      ok: true,
      status: "validated",
      summary: "この未検証文章は表示してはいけません",
      structured,
      validation: { valid: true, errors: [] },
      inputHash,
      model: AI_MODEL
    }), { status: 200, headers: { "Content-Type": "application/json" } })));

    const result = await fetchAiSummary("https://worker.example", input);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error);
    expect(result.status).toBe("validated");
    expect(result.summary).toBe(buildDisplaySummary(structured));
    expect(result.summary).not.toContain("未検証文章");
  });

  it("Workerがfallbackまたはvalidation falseを返したら成功扱いしない", async () => {
    const execution = buildAiExecutionPayload(input);
    const inputHash = await hashAiExecutionPayload(execution);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      ok: false,
      status: "fallback",
      summary: "Worker由来fallback",
      structured: { claims: [] },
      validation: { valid: false, errors: ["schema_invalid"] },
      fallback: "rule_summary",
      inputHash,
      model: AI_MODEL
    }), { status: 200 })));

    const result = await fetchAiSummary("https://worker.example", input);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("fallback must not be accepted");
    expect(result.status).toBe("fallback");
    expect(result.fallback).toBe("rule_summary");
    expect(result.summary).toBeUndefined();
    expect(result.fallbackSummary).toContain(AI_DISCLAIMER);
    expect(result.fallbackSummary).not.toContain("Worker由来fallback");
  });

  it("正しい構造でも実行hashまたはmodelが一致しなければ拒否する", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      ok: true,
      status: "validated",
      structured,
      validation: { valid: true, errors: [] },
      inputHash: "0".repeat(64),
      model: "untrusted-model"
    }), { status: 200 })));

    const result = await fetchAiSummary("https://worker.example", input);
    expect(result.ok).toBe(false);
    expect(result.validation.errors).toEqual(expect.arrayContaining(["input_hash_mismatch", "model_mismatch"]));
  });

  it("通信例外の内部メッセージをUI向けエラーへ露出しない", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("secret-token-and-internal-host");
    }));
    const result = await fetchAiSummary("https://worker.example", input);
    expect(result.ok).toBe(false);
    expect(result.error).toBe("AI要約リクエストに失敗しました");
    expect(result.error).not.toContain("secret-token");
  });

  it("404/501はAI基盤未設定としてfallback扱いにする", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("not configured", { status: 501 })));

    const result = await fetchAiSummary("", input);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unavailable endpoint must not be accepted");
    expect(result.status).toBe("fallback");
    expect(result.fallback).toBe("rule_summary");
    expect(result.validation.errors).toContain("http_501");
  });

  it("レスポンス本文の読取中でもユーザー中断を握り潰さない", async () => {
    const controller = new AbortController();
    let markFetchStarted!: () => void;
    const fetchStarted = new Promise<void>((resolve) => {
      markFetchStarted = resolve;
    });
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
      const requestSignal = init?.signal as AbortSignal;
      const response = new Response(new ReadableStream({
        start(streamController) {
          requestSignal.addEventListener("abort", () => {
            streamController.error(new DOMException("中断されました", "AbortError"));
          }, { once: true });
        }
      }), { status: 200 });
      markFetchStarted();
      return response;
    }));

    const pending = fetchAiSummary("", input, undefined, undefined, undefined, controller.signal);
    await fetchStarted;
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });

  it("endpointを60秒で中断し、次のendpointへフォールバックする", async () => {
    const execution = buildAiExecutionPayload(input);
    const inputHash = await hashAiExecutionPayload(execution);
    vi.useFakeTimers();
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      if (fetchMock.mock.calls.length === 1) {
        return await new Promise<Response>((_resolve, reject) => {
          const requestSignal = init?.signal as AbortSignal;
          requestSignal.addEventListener("abort", () => reject(new DOMException("timeout", "AbortError")), { once: true });
          vi.advanceTimersByTime(AI_TIMEOUT_MS);
        });
      }
      return new Response(JSON.stringify({
        ok: true,
        status: "validated",
        structured,
        validation: { valid: true, errors: [] },
        inputHash,
        model: AI_MODEL
      }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchAiSummary("https://worker.example", input);
    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "https://worker.example/ai/summarize",
      "/api/ai/summarize"
    ]);
  });
});

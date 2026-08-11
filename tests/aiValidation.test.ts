import { describe, expect, it, vi } from "vitest";
import {
  buildAiExecutionPayload,
  hashAiExecutionPayload,
  numericTokens,
  validateAiStructuredSummary,
  type AiStructuredSummary,
  type AiSummaryInput
} from "../src/lib/aiSummarizer";

const input: AiSummaryInput = {
  pages: [{ page: 2, excerpt: "売上高 1,200 百万円、営業利益 100 百万円" }],
  facts: [{ label: "売上高", value: "1,200百万円", page: 2 }]
};
const valid: AiStructuredSummary = {
  claims: [{
    category: "売上",
    fact: "売上高は1,200百万円です。",
    page: 2,
    evidence: "売上高 1,200 百万円",
    uncertainty: "表の列見出しは原文確認が必要です。"
  }]
};

function createWorkerEnv(aiResponse: unknown) {
  const run = vi.fn(async () => ({ response: JSON.stringify(aiResponse) }));
  const rateLimiter = {
    idFromName: vi.fn(() => ({ name: "test" })),
    get: vi.fn(() => ({
      fetch: vi.fn(async () => new Response(JSON.stringify({ allowed: true })))
    }))
  };
  return { env: { AI: { run }, RATE_LIMITER: rateLimiter }, run };
}

async function postToWorker(body: unknown, env: unknown): Promise<Response> {
  const workerModulePath = "../worker/src/index.ts";
  const workerModule = await import(/* @vite-ignore */ workerModulePath) as {
    default: { fetch(request: Request, workerEnv: never, context: never): Promise<Response> };
  };
  return workerModule.default.fetch(new Request("https://worker.example/ai/summarize", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  }), env as never, {} as never);
}

describe("AI後段検証", () => {
  it("ページ・根拠・数値が入力と整合する応答だけを通す", () => {
    expect(validateAiStructuredSummary(valid, input)).toEqual({ valid: true, errors: [] });
  });

  it("数値をNFKC・桁区切り・負号で正規化する", () => {
    expect(numericTokens("売上高１，２００、増減率△５．０％")).toEqual(["1200", "-5"]);
  });

  it("1,200に対する200の部分文字列一致を拒否する", () => {
    const invalid: AiStructuredSummary = {
      claims: [{ ...valid.claims[0], fact: "売上高は200百万円です。" }]
    };
    const result = validateAiStructuredSummary(invalid, input);
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      "claims[0]: numeric_not_in_evidence",
      "claims[0]: numeric_fact_mismatch"
    ]));
  });

  it("factsに数値があってもclaimのevidenceに無ければ拒否する", () => {
    const invalid: AiStructuredSummary = {
      claims: [{
        ...valid.claims[0],
        fact: "営業利益は100百万円です。",
        evidence: "売上高 1,200 百万円"
      }]
    };
    const result = validateAiStructuredSummary(invalid, input);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("claims[0]: numeric_not_in_evidence");
  });

  it("資料外数値、存在しないページ、投資助言を拒否する", () => {
    const invalid: AiStructuredSummary = {
      claims: [
        { ...valid.claims[0], page: 9 },
        { ...valid.claims[0], fact: "売上高は9,999百万円で買い推奨です。" }
      ]
    };
    const result = validateAiStructuredSummary(invalid, input);
    expect(result.valid).toBe(false);
    expect(result.errors.join(" ")).toMatch(/page_out_of_range|numeric_fact_mismatch|prohibited_expression/);
  });

  it("入力ページの重複や範囲外fact.pageも検証時に拒否する", () => {
    const invalidInput = {
      pages: [{ page: 2, excerpt: "本文" }, { page: 2, excerpt: "重複" }],
      facts: [{ label: "売上", value: "100", page: 3 }]
    };
    expect(validateAiStructuredSummary(valid, invalidInput)).toEqual({ valid: false, errors: ["input_invalid"] });
  });
});

describe("Workers AI応答契約", () => {
  it("canonical payloadを実行し、検証済みstatusとpayload全体のhashを返す", async () => {
    const { env, run } = createWorkerEnv(valid);
    const response = await postToWorker(input, env);
    const execution = buildAiExecutionPayload(input);
    const inputHash = await hashAiExecutionPayload(execution);

    expect(response.status).toBe(200);
    expect(run).toHaveBeenCalledWith(execution.model, execution.input);
    expect(await response.json()).toMatchObject({
      ok: true,
      status: "validated",
      structured: valid,
      validation: { valid: true, errors: [] },
      inputHash,
      model: execution.model
    });
  });

  it("モデル出力が不正ならfallbackとvalidation falseを明示する", async () => {
    const { env } = createWorkerEnv({ claims: [] });
    const response = await postToWorker(input, env);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      ok: false,
      status: "fallback",
      fallback: "rule_summary",
      validation: { valid: false, errors: ["schema_invalid"] }
    });
  });

  it("不正なpage/fact.page入力はAIを呼ばず安全なエラーコードだけを返す", async () => {
    const { env, run } = createWorkerEnv(valid);
    const response = await postToWorker({
      pages: [{ page: 1, excerpt: "本文" }],
      facts: [{ label: "売上", value: "100", page: 9 }]
    }, env);
    expect(response.status).toBe(400);
    expect(run).not.toHaveBeenCalled();
    expect(await response.json()).toMatchObject({
      ok: false,
      status: "error",
      error: "invalid_ai_input",
      validation: { valid: false, errors: ["input_invalid"] }
    });
  });
});

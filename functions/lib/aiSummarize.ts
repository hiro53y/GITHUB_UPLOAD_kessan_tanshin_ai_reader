/** Pages Functions 向けWorkers AI実行ロジック。検証規則はブラウザ／Workerと共有する。 */
import {
  AI_MODEL,
  buildAiExecutionPayload,
  buildDisplaySummary,
  buildRuleFallbackSummary,
  hashAiExecutionPayload,
  parseAiStructuredSummary,
  parseAiSummaryInput,
  validateAiStructuredSummary,
  type AiStructuredSummary,
  type AiValidationResult
} from "../../src/lib/aiSummarizer";

export * from "../../src/lib/aiSummarizer";

export type AiServerResponse =
  | {
      ok: true;
      status: "validated";
      summary: string;
      structured: AiStructuredSummary;
      validation: AiValidationResult;
      inputHash: string;
      model: string;
    }
  | {
      ok: false;
      status: "fallback";
      fallback: "rule_summary";
      fallbackSummary: string;
      structured: AiStructuredSummary;
      validation: AiValidationResult;
      inputHash: string;
      model: string;
    }
  | {
      ok: false;
      status: "error";
      error: string;
      validation: AiValidationResult;
      inputHash?: string;
      model?: string;
    };

export type AiServerResult = { status: number; body: AiServerResponse };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorResult(
  error: string,
  status: number,
  validationError: string,
  audit: { inputHash?: string; model?: string } = {}
): AiServerResult {
  return {
    status,
    body: {
      ok: false,
      status: "error",
      error,
      validation: { valid: false, errors: [validationError] },
      ...audit
    }
  };
}

/** 未型付けのHTTP入力を正規化し、AI応答が全検証を通った場合だけ採用する。 */
export async function runAiSummarize(ai: Ai, rawBody: unknown): Promise<AiServerResult> {
  const input = parseAiSummaryInput(rawBody);
  if (!input) return errorResult("invalid_ai_input", 400, "input_invalid");

  const execution = buildAiExecutionPayload(input);
  let inputHash: string;
  try {
    inputHash = await hashAiExecutionPayload(execution);
  } catch {
    return errorResult("input_hash_failed", 500, "input_hash_failed", { model: AI_MODEL });
  }

  try {
    const result = await ai.run(execution.model, execution.input);
    const responseValue = isRecord(result) ? result.response : undefined;
    let raw: unknown = responseValue;
    if (typeof responseValue === "string") {
      try {
        raw = JSON.parse(responseValue);
      } catch {
        raw = undefined;
      }
    }

    const structured = parseAiStructuredSummary(raw);
    const validation = structured
      ? validateAiStructuredSummary(structured, input)
      : { valid: false, errors: ["schema_invalid"] };
    if (!structured || !validation.valid) {
      return {
        status: 200,
        body: {
          ok: false,
          status: "fallback",
          fallback: "rule_summary",
          fallbackSummary: buildRuleFallbackSummary(input),
          structured: structured ?? { claims: [] },
          validation,
          inputHash,
          model: execution.model
        }
      };
    }

    return {
      status: 200,
      body: {
        ok: true,
        status: "validated",
        summary: buildDisplaySummary(structured),
        structured,
        validation,
        inputHash,
        model: execution.model
      }
    };
  } catch (error) {
    console.error(JSON.stringify({
      message: "pages_ai_summarize_failed",
      error: error instanceof Error ? error.message : "unknown_error",
      inputHash
    }));
    return errorResult("ai_request_failed", 502, "ai_request_failed", {
      inputHash,
      model: execution.model
    });
  }
}

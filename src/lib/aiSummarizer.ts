/** Workers AI 要約の入出力と、表示前に共有する安全検証。 */
export const AI_DISCLAIMER = "※この要約はAIによる自動生成です。正確性は保証されません。投資判断は必ず原文を確認のうえ、ご自身の責任で行ってください。";
export const AI_CATEGORIES = ["売上", "利益", "通期予想", "配当", "セグメント", "キャッシュフロー", "財務状態", "リスク・注記"] as const;
export const AI_MODEL = "@cf/meta/llama-3.1-8b-instruct-fast";
export const AI_MAX_CLAIMS = 8;
export const AI_MAX_PAGES = 24;
export const AI_MAX_FACTS = 80;
export const AI_MAX_EXCERPT_CHARS = 6000;
export const AI_MAX_RESPONSE_BYTES = 64 * 1024;

export type AiCategory = (typeof AI_CATEGORIES)[number];
export type AiPageExcerpt = { page: number; excerpt: string };
export type AiFact = { label: string; value: string; page?: number; source?: string };
export type AiClaim = { category: AiCategory; fact: string; page: number; evidence: string; uncertainty: string };
export type AiStructuredSummary = { claims: AiClaim[] };
export type AiSummaryInput = {
  pages: AiPageExcerpt[];
  facts?: AiFact[];
  ticker?: string;
  companyName?: string;
  title?: string;
};
export type AiValidationResult = { valid: boolean; errors: string[] };
export type AiSummaryFallback = "rule_summary";
export type AiValidatedSummaryResult = {
  ok: true;
  status: "validated";
  summary: string;
  structured: AiStructuredSummary;
  validation: AiValidationResult;
  inputHash: string;
  model: string;
  error?: undefined;
  fallback?: undefined;
  fallbackSummary?: undefined;
};
export type AiUnvalidatedSummaryResult = {
  ok: false;
  status: "fallback" | "error";
  summary?: undefined;
  structured?: AiStructuredSummary;
  validation: AiValidationResult;
  inputHash?: string;
  model?: string;
  error: string;
  fallback?: AiSummaryFallback;
  /** Worker由来の文章は採用せず、入力からクライアント側で生成した退避表示だけを保持する。 */
  fallbackSummary?: string;
};
export type AiSummaryResult = AiValidatedSummaryResult | AiUnvalidatedSummaryResult;

export const AI_RESPONSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    claims: {
      type: "array",
      minItems: 1,
      maxItems: AI_MAX_CLAIMS,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          category: { type: "string", enum: AI_CATEGORIES },
          fact: { type: "string" },
          page: { type: "integer", minimum: 1 },
          evidence: { type: "string" },
          uncertainty: { type: "string" }
        },
        required: ["category", "fact", "page", "evidence", "uncertainty"]
      }
    }
  },
  required: ["claims"]
};

export type AiExecutionPayload = {
  model: string;
  input: {
    messages: Array<{ role: "system" | "user"; content: string }>;
    response_format: { type: "json_schema"; json_schema: typeof AI_RESPONSE_SCHEMA };
    max_tokens: number;
    temperature: number;
  };
};

const AI_SYSTEM_PROMPT = "決算資料にある事実だけをJSONで整理する補助AIです。投資助言、売買推奨、目標株価、株価予測は禁止です。各claimは必ず指定ページの抜粋をevidenceへそのまま引用し、fact内の全数値はそのevidenceとfactsまたは同ページ抜粋の両方にある値だけを使い、不確実性を明記してください。";
const forbiddenPatterns = [/\b(?:buy|sell|hold)\b/i, /(?:買い|売り|保有)(?:推奨|すべき|がよい)/, /目標株価/, /(?:株価|株式).{0,10}(?:予想|上昇|下落)/, /投資(?:判断|推奨)/];
const AI_CATEGORY_SET: ReadonlySet<string> = new Set(AI_CATEGORIES);
const SUMMARY_KEYS = new Set(["claims"]);
const CLAIM_KEYS = new Set(["category", "fact", "page", "evidence", "uncertainty"]);
const VALIDATION_KEYS = new Set(["valid", "errors"]);
const SAFE_VALIDATION_ERROR = /^(?:schema_invalid|input_invalid|worker_validation_failed|method_not_allowed|rate_limited|body_too_large|invalid_json|input_hash_failed|ai_request_failed|internal_error|claims\[[0-7]\]: (?:page_out_of_range|evidence_not_in_source|prohibited_expression|numeric_not_in_evidence|numeric_fact_mismatch|uncertainty_invalid))$/;

function compact(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: ReadonlySet<string>): boolean {
  return Object.keys(value).every((key) => allowed.has(key));
}

function isAiCategory(value: unknown): value is AiCategory {
  return typeof value === "string" && AI_CATEGORY_SET.has(value);
}

function normalizeNumberToken(raw: string): string {
  const normalized = raw.normalize("NFKC").replace(/[△▲−–—]/g, "-").replace(/,/g, "");
  const negative = normalized.startsWith("-");
  const unsigned = normalized.replace(/^[+-]/, "");
  const [integerRaw, decimalRaw] = unsigned.split(".");
  const integer = (integerRaw || "0").replace(/^0+(?=\d)/, "");
  const decimal = decimalRaw?.replace(/0+$/, "") ?? "";
  const value = decimal ? `${integer}.${decimal}` : integer;
  return negative && value !== "0" ? `-${value}` : value;
}

/** 桁区切り・全角・負号を正規化し、部分文字列ではなく数値トークン単位で返す。 */
export function numericTokens(value: string): string[] {
  const normalized = value.normalize("NFKC").replace(/[△▲−–—]/g, "-");
  const pattern = /(?<![A-Za-z0-9])[+-]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?(?![A-Za-z0-9])/g;
  return normalized.match(pattern)?.map(normalizeNumberToken) ?? [];
}

function optionalString(value: unknown, maxLength: number): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") return undefined;
  const result = value.trim();
  return result && result.length <= maxLength ? result : undefined;
}

/** 旧text形式も含めて、AI入力をクライアントとWorkerで同じ条件に正規化する。 */
export function parseAiSummaryInput(value: unknown): AiSummaryInput | undefined {
  if (!isRecord(value)) return undefined;
  const legacy = typeof value.text === "string" ? value.text.trim() : "";
  if (value.text !== undefined && typeof value.text !== "string") return undefined;
  const rawPages: unknown[] = Array.isArray(value.pages)
    ? value.pages
    : legacy
      ? [{ page: 1, excerpt: legacy.slice(0, AI_MAX_EXCERPT_CHARS) }]
      : [];
  if (rawPages.length === 0 || rawPages.length > AI_MAX_PAGES) return undefined;

  const pages: AiPageExcerpt[] = [];
  const pageNumbers = new Set<number>();
  for (const rawPage of rawPages) {
    if (!isRecord(rawPage) || typeof rawPage.page !== "number" || !Number.isInteger(rawPage.page) || rawPage.page < 1 || typeof rawPage.excerpt !== "string") return undefined;
    const page = rawPage.page;
    const excerpt = rawPage.excerpt.trim();
    if (pageNumbers.has(page) || !excerpt || excerpt.length > AI_MAX_EXCERPT_CHARS) return undefined;
    pageNumbers.add(page);
    pages.push({ page, excerpt });
  }

  const rawFacts: unknown = value.facts === undefined ? [] : value.facts;
  if (!Array.isArray(rawFacts) || rawFacts.length > AI_MAX_FACTS) return undefined;
  const facts: AiFact[] = [];
  for (const rawFact of rawFacts) {
    if (!isRecord(rawFact) || typeof rawFact.label !== "string" || typeof rawFact.value !== "string") return undefined;
    const label = rawFact.label.trim();
    const factValue = rawFact.value.trim();
    if (!label || !factValue || label.length > 80 || factValue.length > 160) return undefined;
    let page: number | undefined;
    if (rawFact.page !== undefined) {
      if (typeof rawFact.page !== "number" || !Number.isInteger(rawFact.page) || rawFact.page < 1 || !pageNumbers.has(rawFact.page)) return undefined;
      page = rawFact.page;
    }
    let source: string | undefined;
    if (rawFact.source !== undefined) {
      source = optionalString(rawFact.source, 80);
      if (!source) return undefined;
    }
    facts.push({ label, value: factValue, page, source });
  }

  const metadata: Pick<AiSummaryInput, "ticker" | "companyName" | "title"> = {};
  for (const key of ["ticker", "companyName", "title"] as const) {
    if (value[key] !== undefined) {
      const parsed = optionalString(value[key], 160);
      if (!parsed) return undefined;
      metadata[key] = parsed;
    }
  }
  return { pages, facts, ...metadata };
}

/** JSON Modeの応答を型アサーションなしで境界検証する。 */
export function parseAiStructuredSummary(value: unknown): AiStructuredSummary | undefined {
  if (!isRecord(value) || !hasOnlyKeys(value, SUMMARY_KEYS) || !Array.isArray(value.claims)
    || value.claims.length === 0 || value.claims.length > AI_MAX_CLAIMS) return undefined;
  const claims: AiClaim[] = [];
  for (const raw of value.claims) {
    if (!isRecord(raw) || !hasOnlyKeys(raw, CLAIM_KEYS) || !isAiCategory(raw.category)
      || typeof raw.fact !== "string" || typeof raw.page !== "number" || !Number.isInteger(raw.page) || raw.page < 1
      || typeof raw.evidence !== "string" || typeof raw.uncertainty !== "string") return undefined;
    const claim: AiClaim = {
      category: raw.category,
      fact: compact(raw.fact),
      page: raw.page,
      evidence: compact(raw.evidence),
      uncertainty: compact(raw.uncertainty)
    };
    if (!claim.fact || claim.fact.length > 240 || claim.evidence.length < 8 || claim.evidence.length > 280 || claim.uncertainty.length > 120) return undefined;
    claims.push(claim);
  }
  return { claims };
}

/** 根拠ページ・抜粋・既知facts・禁止表現をすべて満たす場合だけ通す。 */
export function validateAiStructuredSummary(summary: AiStructuredSummary, input: Pick<AiSummaryInput, "pages" | "facts">): AiValidationResult {
  const parsedInput = parseAiSummaryInput(input);
  if (!parsedInput) return { valid: false, errors: ["input_invalid"] };

  const errors: string[] = [];
  const pages = new Map(parsedInput.pages.map((page) => [page.page, compact(page.excerpt)]));
  for (const [index, claim] of summary.claims.entries()) {
    const prefix = `claims[${index}]`;
    const source = pages.get(claim.page);
    if (!source) {
      errors.push(`${prefix}: page_out_of_range`);
    } else if (!source.includes(claim.evidence)) {
      errors.push(`${prefix}: evidence_not_in_source`);
    }

    const claimText = `${claim.fact} ${claim.evidence}`;
    if (forbiddenPatterns.some((pattern) => pattern.test(claimText))) errors.push(`${prefix}: prohibited_expression`);

    const factNumbers = numericTokens(claim.fact);
    const evidenceNumbers = new Set(numericTokens(claim.evidence));
    const allowedNumbers = new Set([
      ...numericTokens(source ?? ""),
      ...(parsedInput.facts ?? [])
        .filter((fact) => fact.page === undefined || fact.page === claim.page)
        .flatMap((fact) => numericTokens(`${fact.label} ${fact.value}`))
    ]);
    for (const token of factNumbers) {
      if (!evidenceNumbers.has(token)) errors.push(`${prefix}: numeric_not_in_evidence`);
      if (!allowedNumbers.has(token)) errors.push(`${prefix}: numeric_fact_mismatch`);
    }

    if (!claim.uncertainty || /(?:確実です|保証されます|間違いありません|断定できます)/.test(claim.uncertainty)) {
      errors.push(`${prefix}: uncertainty_invalid`);
    }
  }
  return { valid: errors.length === 0, errors: Array.from(new Set(errors)) };
}

/** UI表示用の文章は、検証済み構造だけから生成する。 */
export function buildDisplaySummary(summary: AiStructuredSummary): string {
  return `${summary.claims.map((claim) => `【${claim.category}】${claim.fact}（${claim.page}P：${claim.evidence}／不確実性：${claim.uncertainty}）`).join("\n")}\n\n${AI_DISCLAIMER}`;
}

/** AI検証失敗時の退避表示も、応答ではなく入力から生成する。 */
export function buildRuleFallbackSummary(input: Pick<AiSummaryInput, "pages">): string {
  return `${input.pages.slice(0, 3).map((page) => `【${page.page}P】${compact(page.excerpt).slice(0, 160)}`).join("\n")}\n\n${AI_DISCLAIMER}`;
}

export function buildAiPrompt(input: AiSummaryInput): string {
  const pages = input.pages.map((page) => `【${page.page}P】${page.excerpt}`).join("\n");
  const facts = (input.facts ?? []).map((fact) => `- ${fact.label}: ${fact.value}${fact.page ? ` (${fact.page}P)` : ""}`).join("\n") || "- 抽出済みfactsなし";
  return `対象: ${input.companyName || "企業"} / 銘柄コード: ${input.ticker || "不明"} / 資料: ${input.title || "決算資料"}\n\n抽出済みfacts（数値はこの情報か下記抜粋に存在するものだけ使用）:\n${facts}\n\nページ番号付き抜粋:\n${pages}`;
}

/** 実際にAI bindingへ渡すモデル・messages・schema・生成パラメータを1つの監査対象にする。 */
export function buildAiExecutionPayload(input: AiSummaryInput): AiExecutionPayload {
  return {
    model: AI_MODEL,
    input: {
      messages: [
        { role: "system", content: AI_SYSTEM_PROMPT },
        { role: "user", content: buildAiPrompt(input) }
      ],
      response_format: { type: "json_schema", json_schema: AI_RESPONSE_SCHEMA },
      max_tokens: 1024,
      temperature: 0.1
    }
  };
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("non_finite_number");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (isRecord(value)) {
    const entries = Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`);
    return `{${entries.join(",")}}`;
  }
  throw new Error("non_canonical_value");
}

export async function hashAiExecutionPayload(payload: AiExecutionPayload): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalJson(payload));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function normalizeInput(textOrInput: string | AiSummaryInput, ticker?: string, companyName?: string, title?: string): unknown {
  if (typeof textOrInput !== "string") return textOrInput;
  return { pages: [{ page: 1, excerpt: textOrInput.slice(0, AI_MAX_EXCERPT_CHARS) }], ticker, companyName, title };
}

function parseValidation(value: unknown): AiValidationResult | undefined {
  if (!isRecord(value) || !hasOnlyKeys(value, VALIDATION_KEYS) || typeof value.valid !== "boolean" || !Array.isArray(value.errors)
    || value.errors.length > 32 || !value.errors.every((error) => typeof error === "string" && SAFE_VALIDATION_ERROR.test(error))) return undefined;
  const errors = [...value.errors];
  if (value.valid !== (errors.length === 0)) return undefined;
  return { valid: value.valid, errors };
}

async function readBoundedResponseJson(response: Response): Promise<unknown> {
  const contentLength = Number(response.headers.get("Content-Length") || "0");
  if (!Number.isFinite(contentLength) || contentLength < 0 || contentLength > AI_MAX_RESPONSE_BYTES) throw new Error("response_too_large");
  const reader = response.body?.getReader();
  if (!reader) throw new Error("invalid_worker_response");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > AI_MAX_RESPONSE_BYTES) throw new Error("response_too_large");
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder().decode(bytes));
}

function failure(
  error: string,
  errors: string[],
  status: "fallback" | "error" = "error",
  details: Partial<Pick<AiUnvalidatedSummaryResult, "structured" | "inputHash" | "model" | "fallback" | "fallbackSummary">> = {}
): AiUnvalidatedSummaryResult {
  return { ok: false, status, error, validation: { valid: false, errors: Array.from(new Set(errors)) }, ...details };
}

async function requestAiSummaryEndpoint(
  endpoint: string,
  input: AiSummaryInput,
  execution: AiExecutionPayload,
  expectedHash: string,
  signal?: AbortSignal
): Promise<AiSummaryResult> {
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
      signal
    });
    let raw: unknown;
    try {
      raw = await readBoundedResponseJson(response);
    } catch {
      return failure("AI要約サービスの応答形式が不正です", ["invalid_worker_response"], "error", { inputHash: expectedHash, model: execution.model });
    }
    if (!response.ok) {
      const error = response.status === 429
        ? "AI要約のリクエスト上限に達しました"
        : response.status === 413
          ? "AI要約の入力が大きすぎます"
          : `AI要約サービスが応答できませんでした (HTTP ${response.status})`;
      return failure(error, [`http_${response.status}`], "error", { inputHash: expectedHash, model: execution.model });
    }
    if (!isRecord(raw) || typeof raw.ok !== "boolean" || typeof raw.status !== "string") {
      return failure("AI要約サービスの応答形式が不正です", ["invalid_worker_response"], "error", { inputHash: expectedHash, model: execution.model });
    }

    const serverValidation = parseValidation(raw.validation);
    const structured = parseAiStructuredSummary(raw.structured);
    const isFallback = raw.status === "fallback" || raw.fallback === "rule_summary";
    if (isFallback || !serverValidation?.valid) {
      const errors = serverValidation?.errors.length ? serverValidation.errors : ["worker_validation_failed"];
      const responseStatus = isFallback || raw.status === "validated" ? "fallback" : "error";
      if (responseStatus === "fallback") {
        return failure("AI要約を検証できなかったため採用しませんでした", errors, "fallback", {
          structured,
          inputHash: expectedHash,
          model: execution.model,
          fallback: "rule_summary",
          fallbackSummary: buildRuleFallbackSummary(input)
        });
      }
      return failure("AI要約サービスが処理に失敗しました", errors, "error", {
        structured,
        inputHash: expectedHash,
        model: execution.model
      });
    }
    if (raw.status !== "validated" || raw.ok !== true || !structured) {
      return failure("AI要約サービスの応答形式が不正です", ["schema_invalid"], "error", { inputHash: expectedHash, model: execution.model });
    }

    const localValidation = validateAiStructuredSummary(structured, input);
    const metadataErrors: string[] = [];
    if (raw.inputHash !== expectedHash) metadataErrors.push("input_hash_mismatch");
    if (raw.model !== execution.model) metadataErrors.push("model_mismatch");
    const errors = [...localValidation.errors, ...metadataErrors];
    if (errors.length) {
      return failure("AI要約をクライアント検証で採用できませんでした", errors, "fallback", {
        structured,
        inputHash: expectedHash,
        model: execution.model,
        fallback: "rule_summary",
        fallbackSummary: buildRuleFallbackSummary(input)
      });
    }

    return {
      ok: true,
      status: "validated",
      summary: buildDisplaySummary(structured),
      structured,
      validation: { valid: true, errors: [] },
      inputHash: expectedHash,
      model: execution.model
    };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw error;
    return failure("AI要約リクエストに失敗しました", ["ai_request_failed"], "error", { inputHash: expectedHash, model: execution.model });
  }
}

/**
 * 旧text引数を維持しつつ、新しいページ・facts入力をWorkerへ渡す。
 * 外部Workerを設定している場合も、利用不能なら同一originのPages Functionへフォールバックする。
 */
export async function fetchAiSummary(
  proxyUrl: string,
  textOrInput: string | AiSummaryInput,
  ticker?: string,
  companyName?: string,
  title?: string,
  signal?: AbortSignal
): Promise<AiSummaryResult> {
  const input = parseAiSummaryInput(normalizeInput(textOrInput, ticker, companyName, title));
  if (!input) return failure("AI要約の入力が不正です", ["input_invalid"]);

  const execution = buildAiExecutionPayload(input);
  let expectedHash: string;
  try {
    expectedHash = await hashAiExecutionPayload(execution);
  } catch {
    return failure("AI要約の監査情報を生成できませんでした", ["input_hash_failed"]);
  }

  const endpoints = Array.from(new Set([
    proxyUrl ? `${proxyUrl.replace(/\/+$/, "")}/ai/summarize` : undefined,
    "/api/ai/summarize"
  ].filter((endpoint): endpoint is string => Boolean(endpoint))));
  const failures: AiUnvalidatedSummaryResult[] = [];
  for (const endpoint of endpoints) {
    if (signal?.aborted) throw new DOMException("中断されました", "AbortError");
    const result = await requestAiSummaryEndpoint(endpoint, input, execution, expectedHash, signal);
    if (result.ok) return result;
    failures.push(result);
  }

  const preferred = failures.find((result) => result.status === "fallback") ?? failures[failures.length - 1];
  if (!preferred) return failure("AI要約サービスを利用できませんでした", ["ai_request_failed"], "error", { inputHash: expectedHash, model: execution.model });
  return {
    ...preferred,
    error: Array.from(new Set(failures.map((result) => result.error))).join(" / "),
    validation: {
      valid: false,
      errors: Array.from(new Set(failures.flatMap((result) => result.validation.errors)))
    }
  };
}

/**
 * Workers AI 要約の共通ロジック（Pages Functions / 外部Worker 共用）。
 * 出力はアプリの構造化レポートパーサ（parseAiSummaryToStructured）が読める固定フォーマット。
 */

export const AI_MODEL = "@cf/meta/llama-3.1-8b-instruct";

export const AI_SYSTEM_PROMPT = `あなたは決算短信（日本企業の四半期・通期決算発表資料）を読むための補助AIです。

以下のルールを厳守してください:
- 投資助言、売買推奨、目標株価、投資判断の断定を絶対に行わない
- 将来の株価予測を行わない
- 「買い」「売り」「保有」などの投資行動を推奨しない
- 数値は「参考数値（アプリ側で計算済み）」と抽出テキストに実際に記載されたもののみ使用する。推測で数値を作らない
- 該当情報が資料から読み取れない項目は「記載なし」と書く

出力は必ず次のフォーマットに従ってください（見出し・ラベルを変えない）:

一言サマリー: （決算の要点を30字程度の1文で。例: 増収だが営業利益は横ばい、為替と買収費用が交錯。）

【決算分析レポート】

1. 企業概要と事業の核心
- 企業名: …
- 決算短信発行日: …
- クオーター: …（例: 2026年9月期 第2四半期（中間期））
- 事業内容: …（資料から読み取れる主要事業を1行で）

2. 業績ハイライト（定量的評価）
- 全体業績: 売上高・営業利益・経常利益・純利益と前年同期比
- 利益率: 営業利益率など
- 通期予想に対する進捗率: …
- 業績予想の修正有無: …
- 配当予想・株主還元: …
- 財務安全性: 自己資本比率・総資産・純資産など
- セグメント別動向: セグメントごとの売上・利益の増減
- 利益変動要因: 増益・減益の主な要因（為替、費用、一過性要因など）

3. 注意点とリスク
- 資料に記載されたリスク・特記事項を2〜3点

最後に「※この要約はAIによる自動生成です。正確性は保証されません。投資判断は必ず原文を確認のうえ、ご自身の責任で行ってください。」と付記してください。`;

export type AiSummarizeRequestBody = {
  text?: string;
  ticker?: string;
  companyName?: string;
  title?: string;
  /** アプリ側で計算済みの確定数値（進捗率・利益率など）。LLMの数値捏造防止用コンテキスト */
  metrics?: string;
};

export function buildAiUserPrompt(body: AiSummarizeRequestBody): string {
  const trimmedText = (body.text || "").slice(0, 6000);
  const metricsBlock = body.metrics
    ? `\n参考数値（アプリ側で計算済み。数値はこちらを優先して使うこと）:\n${body.metrics.slice(0, 2000)}\n`
    : "";
  return `以下は${body.companyName || "企業"}（銘柄コード: ${body.ticker || "不明"}）の決算短信「${body.title || "決算資料"}」から抽出したテキストです。システム指示のフォーマットに従って分析レポートを作成してください。
${metricsBlock}
抽出テキスト:
${trimmedText}`;
}

type AiBinding = {
  run(model: string, input: Record<string, unknown>): Promise<{ response?: string }>;
};

export async function runAiSummarize(
  ai: AiBinding,
  body: AiSummarizeRequestBody
): Promise<{ ok: true; summary: string; model: string } | { ok: false; error: string; status: number }> {
  if (!body.text || typeof body.text !== "string" || body.text.trim().length < 50) {
    return { ok: false, error: "text_too_short", status: 400 };
  }
  try {
    const result = await ai.run(AI_MODEL, {
      messages: [
        { role: "system", content: AI_SYSTEM_PROMPT },
        { role: "user", content: buildAiUserPrompt(body) }
      ],
      max_tokens: 1400,
      temperature: 0.2
    });
    if (!result.response) return { ok: false, error: "ai_no_response", status: 502 };
    return { ok: true, summary: result.response, model: AI_MODEL.replace("@cf/meta/", "") };
  } catch (error) {
    return { ok: false, error: `ai_error: ${error instanceof Error ? error.message : String(error)}`, status: 502 };
  }
}

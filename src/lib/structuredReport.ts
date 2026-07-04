/**
 * 「決算分析レポート」（構造化レポート）ビルダー。
 * - buildStructuredReport: ルールベース解析結果から構造化レポートを組み立てる（AI不要・常に生成可能）
 * - parseAiSummaryToStructured: Workers AI の出力（所定フォーマット）を構造化レポートにパースする
 *
 * 表示構成はスクリーンショットUI互換:
 *   一言サマリー → 1.企業概要と事業の核心 → 2.業績ハイライト（定量的評価） → 3.良い点・注意点 → …
 */
import type { AnalysisReport, StructuredReport, StructuredReportItem, StructuredReportSection } from "./types";
import { formatDateTime } from "./utils";

function quarterLabelFromTitle(title?: string): string | undefined {
  if (!title) return undefined;
  const period = title.match(/(20\d{2}年[0-9０-９]{1,2}月期)/u)?.[1];
  const quarter = title.match(/第([0-9０-９一二三四１-４])四半期/u)?.[1];
  if (period && quarter) {
    const isInterim = /[2２二]/.test(quarter);
    return `${period} 第${quarter}四半期${isInterim ? "（中間期）" : ""}`;
  }
  if (period) return `${period}（通期）`;
  return undefined;
}

function metricsSentence(rows: AnalysisReport["freeAiDigest"]["keyMetrics"], suffix: string): string | undefined {
  if (!rows.length) return undefined;
  const parts = rows.map((row) => `${row.label}は${row.value}（${suffix}${row.growth ?? "—"}）`);
  return `${parts.join("、")}。`;
}

/** ルールベースの構造化レポート。数値はすべてアプリ側計算・抽出値のみを使用する。 */
export function buildStructuredReport(report: Omit<AnalysisReport, "structuredReport">): StructuredReport {
  const dig = report.freeAiDigest;
  const sections: StructuredReportSection[] = [];

  // 1. 企業概要
  const overview: StructuredReportItem[] = [];
  if (report.companyName) overview.push({ label: "企業名", text: report.companyName });
  if (report.ticker) overview.push({ label: "銘柄コード", text: report.ticker });
  if (report.sourceDisclosure?.disclosedAt) {
    overview.push({ label: "決算短信発行日", text: formatDateTime(report.sourceDisclosure.disclosedAt).split(" ")[0] });
  }
  const quarter = quarterLabelFromTitle(report.sourceDisclosure?.title);
  if (quarter) overview.push({ label: "クオーター", text: quarter });
  if (report.sourceDisclosure?.title) overview.push({ label: "資料", text: report.sourceDisclosure.title });
  if (overview.length) sections.push({ heading: "1. 企業概要と事業の核心", items: overview });

  // 2. 業績ハイライト（定量的評価）
  const highlight: StructuredReportItem[] = [];
  const overall = metricsSentence(dig.keyMetrics, "前年同期比");
  if (overall) highlight.push({ label: "全体業績", text: overall });
  if (dig.marginLine) highlight.push({ label: "利益率", text: `${dig.marginLine}。` });
  if (dig.progressLines?.length) highlight.push({ label: "通期予想に対する進捗率", text: `${dig.progressLines.join("、")}。` });
  const forecast = metricsSentence(dig.forecastMetrics, "前期比");
  if (forecast) highlight.push({ label: "通期予想", text: forecast });
  highlight.push({ label: "業績予想の修正有無", text: dig.forecastRevisionLine ? `${dig.forecastRevisionLine}。` : "記載を自動判定できませんでした。原文で確認してください。" });
  if (dig.dividendLine) highlight.push({ label: "配当予想・株主還元", text: `${dig.dividendLine}。` });
  if (dig.equityLine) highlight.push({ label: "財務安全性", text: `${dig.equityLine}（当期時点）。` });
  if (highlight.length) sections.push({ heading: "2. 業績ハイライト（定量的評価）", items: highlight });

  // 3. 良い点・注意点
  const points: StructuredReportItem[] = [];
  for (const good of dig.goodPoints.slice(0, 4)) points.push({ label: "良い点", text: good });
  for (const concern of dig.concernPoints.slice(0, 4)) points.push({ label: "注意点", text: concern });
  if (points.length) sections.push({ heading: "3. 良い点と注意点", items: points });

  // 4. その他の検出項目
  const others: StructuredReportItem[] = dig.topicSummaries.slice(0, 5).map((topic) => ({
    label: topic.category,
    text: `${topic.summary}${topic.pages.length ? `（${topic.pages.slice(0, 3).join("・")}P）` : ""}`
  }));
  if (others.length) sections.push({ heading: "4. その他の記載", items: others });

  return {
    oneLine: report.oneLineSummary,
    sections,
    generatedBy: "rule",
    methodLabel: "標準ルール分析"
  };
}

/**
 * Workers AI の出力を構造化レポートにパースする。
 * 期待フォーマット:
 *   一言サマリー: …
 *   1. 企業概要と事業の核心
 *   - 企業名: …
 *   2. 業績ハイライト（定量的評価）
 *   - 全体業績: …
 * パースできない場合は undefined（呼び出し側でルール版にフォールバック）。
 */
export function parseAiSummaryToStructured(aiText: string, methodLabel: string): StructuredReport | undefined {
  const lines = aiText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (!lines.length) return undefined;

  let oneLine = "";
  const sections: StructuredReportSection[] = [];
  let current: StructuredReportSection | undefined;

  for (const rawLine of lines) {
    const line = rawLine.replace(/\*\*/g, "");
    const oneLineMatch = line.match(/^(?:[-・*]\s*)?一言サマリー[:：]\s*(.+)$/u);
    if (oneLineMatch) {
      oneLine = oneLineMatch[1].trim();
      continue;
    }
    if (/^【決算分析レポート】$/u.test(line)) continue;

    const headingMatch = line.match(/^(?:#+\s*)?([0-9０-９]+)[\.．、]\s*(.+)$/u);
    if (headingMatch && headingMatch[2].length <= 30 && !/[:：]/.test(headingMatch[2])) {
      current = { heading: `${headingMatch[1]}. ${headingMatch[2].trim()}`, items: [] };
      sections.push(current);
      continue;
    }

    const itemMatch = line.match(/^[-・*●]\s*(.+)$/u);
    const body = itemMatch ? itemMatch[1] : line;
    if (!current) {
      current = { heading: "分析", items: [] };
      sections.push(current);
    }
    const labelMatch = body.match(/^([^:：]{1,16})[:：]\s*(.+)$/u);
    if (labelMatch) {
      current.items.push({ label: labelMatch[1].trim(), text: labelMatch[2].trim() });
    } else if (itemMatch || body.length > 5) {
      current.items.push({ label: "", text: body });
    }
  }

  const totalItems = sections.reduce((sum, section) => sum + section.items.length, 0);
  if (!oneLine && totalItems < 3) return undefined;

  return {
    oneLine: oneLine || "",
    sections: sections.filter((section) => section.items.length > 0),
    generatedBy: "ai",
    methodLabel
  };
}

/**
 * AI要約に渡す「参考数値」コンテキストを組み立てる。
 * アプリ側で計算・抽出済みの確定値のみを渡し、LLMの数値捏造を防ぐ。
 */
export function buildMetricsContext(report: Omit<AnalysisReport, "structuredReport">): string {
  const dig = report.freeAiDigest;
  const lines: string[] = [];
  for (const row of dig.keyMetrics) lines.push(`実績 ${row.label}: ${row.value}（前年同期比${row.growth ?? "不明"}）`);
  for (const row of dig.forecastMetrics) lines.push(`通期予想 ${row.label}: ${row.value}（前期比${row.growth ?? "不明"}）`);
  if (dig.marginLine) lines.push(dig.marginLine);
  for (const line of dig.progressLines ?? []) lines.push(`通期予想に対する${line}`);
  if (dig.forecastRevisionLine) lines.push(dig.forecastRevisionLine);
  if (dig.dividendLine) lines.push(dig.dividendLine);
  if (dig.equityLine) lines.push(dig.equityLine);
  return lines.join("\n");
}

/** 構造化レポートをプレーンテキスト（コピー用）に変換 */
export function structuredReportToText(structured: StructuredReport): string {
  const lines: string[] = [];
  if (structured.oneLine) lines.push(`一言サマリー: ${structured.oneLine}`, "");
  lines.push("【決算分析レポート】", "");
  for (const section of structured.sections) {
    lines.push(section.heading);
    for (const item of section.items) {
      lines.push(item.label ? `- ${item.label}: ${item.text}` : `- ${item.text}`);
    }
    lines.push("");
  }
  return lines.join("\n").trim();
}

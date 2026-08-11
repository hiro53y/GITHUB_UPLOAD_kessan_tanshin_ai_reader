import * as pdfjsLib from "pdfjs-dist";
import workerSrc from "pdfjs-dist/build/pdf.worker.mjs?url";
import type { PdfExtractItem, PdfExtractLine, PdfExtractQuality, PdfExtractResult } from "./types";
import { fetchArrayBufferWithFallback } from "./utils";

// Viteではworker URLをassetとして解決する。Node/Vitestでは `/node_modules/` または
// 祖先node_modulesを指す `/@fs/C:/...` が返るため、実在するfile URLへ補正する。
export function resolvePdfWorkerSrc(value: string, nodeEnvironment = typeof window === "undefined"): string {
  if (!nodeEnvironment) return value;
  if (value.startsWith("/@fs/")) {
    return new URL(`file:///${value.slice("/@fs/".length).replace(/^\/+/, "")}`).toString();
  }
  if (value.startsWith("/node_modules/")) {
    return new URL(`.${value}`, new URL("../../", import.meta.url)).toString();
  }
  if (/^[A-Za-z]:[\\/]/.test(value)) {
    return new URL(`file:///${value.replace(/\\/g, "/")}`).toString();
  }
  return value;
}

pdfjsLib.GlobalWorkerOptions.workerSrc = resolvePdfWorkerSrc(workerSrc);

async function toArrayBuffer(input: File | ArrayBuffer | string, signal?: AbortSignal): Promise<ArrayBuffer> {
  if (typeof input === "string") return fetchArrayBufferWithFallback(input, signal);
  if (input instanceof File) return input.arrayBuffer();
  return input;
}

export async function extractPdfText(input: File | ArrayBuffer | string, signal?: AbortSignal): Promise<PdfExtractResult> {
  const buffer = await toArrayBuffer(input, signal);
  if (signal?.aborted) throw new DOMException("中断されました", "AbortError");
  const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(buffer) });
  const pdf = await loadingTask.promise;
  const pages: PdfExtractResult["pages"] = [];
  const warnings: string[] = [];

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    if (signal?.aborted) throw new DOMException("中断されました", "AbortError");
    try {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      const items = content.items.flatMap((item): PdfExtractItem[] => {
        if (!("str" in item) || !item.str.trim() || !("transform" in item)) return [];
        const transform = item.transform as number[];
        return [{ text: item.str, x: transform[4] ?? 0, y: transform[5] ?? 0, width: item.width, height: Math.abs(transform[3] ?? 0) }];
      });
      const lines = reconstructPdfLines(items);
      const text = lines.map((line) => line.text).join(" ").replace(/\s+/g, " ").trim();
      const quality = assessPdfPage(lines, text);
      pages.push({ pageNumber, text, lines, quality });
      if (text.length < 30) warnings.push(`${pageNumber}ページの抽出文字数が少ないため、画像PDFまたは表中心の可能性があります。`);
    } catch (error) {
      warnings.push(`${pageNumber}ページのテキスト抽出に失敗しました: ${error instanceof Error ? error.message : String(error)}`);
      pages.push({ pageNumber, text: "" });
    }
  }

  const rawText = pages.map((page) => `--- ${page.pageNumber}ページ ---\n${page.text}`).join("\n\n");
  if (rawText.replace(/\s/g, "").length < 500) {
    warnings.push("抽出できた文字数が少なすぎます。画像PDFの可能性があります。原文を必ず確認してください。");
  }
  // 「PDFの表は…」の一般注意は冗長なため、低品質抽出（短い・抽出失敗ページが多い）時のみ表示
  const failedPageCount = pages.filter((p) => p.text.length < 30).length;
  if (failedPageCount >= Math.max(2, Math.floor(pages.length * 0.3))) {
    warnings.push(`抽出が不十分なページが ${failedPageCount} ページあります。数値は原文で必ず確認してください。`);
  }

  const quality = assessPdfExtractQuality(pages);
  if (!quality.safeForAutomaticFacts) {
    warnings.push("表構造または抽出品質が曖昧です。主要数値を自動確定せず、原文の表を確認してください。");
  }

  return {
    pages,
    totalPages: pdf.numPages,
    rawText,
    warnings,
    quality
  };
}

/** PDF.js の文字片を上から下、左から右へ復元する。PDFの内部順序には依存しない。 */
export function reconstructPdfLines(items: PdfExtractItem[]): PdfExtractLine[] {
  const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x);
  const lines: PdfExtractItem[][] = [];
  for (const item of sorted) {
    const tolerance = Math.max(2.5, (item.height || 0) * 0.45);
    const line = lines.find((candidate) => Math.abs(candidate[0].y - item.y) <= tolerance);
    if (line) line.push(item);
    else lines.push([item]);
  }
  return lines.map((line) => {
    const ordered = line.sort((a, b) => a.x - b.x);
    const cells: string[] = [];
    let cell = "";
    let previous: PdfExtractItem | undefined;
    for (const item of ordered) {
      const gap = previous ? item.x - (previous.x + (previous.width || 0)) : 0;
      if (previous && gap > Math.max(14, (previous.height || 0) * 1.5)) {
        if (cell) cells.push(cell.trim());
        cell = item.text;
      } else {
        // 日本語PDFでは1文字ずつ別itemになることがある。近接glyphへ無条件に
        // 空白を挿入すると「売 上 高」となり、主要表ヘッダを検出できない。
        const height = Math.max(previous?.height || 0, item.height || 0);
        const wordGap = previous && gap > Math.max(1.5, height * 0.2);
        cell += `${cell && wordGap ? " " : ""}${item.text}`;
      }
      previous = item;
    }
    if (cell) cells.push(cell.trim());
    return { y: ordered[0].y, text: cells.join(" "), items: ordered, cells };
  });
}

export function assessPdfPage(lines: PdfExtractLine[], text: string) {
  const flags: Array<"empty" | "short_text" | "table_ambiguous" | "table_header_missing"> = [];
  if (!text) flags.push("empty");
  else if (text.length < 30) flags.push("short_text");
  const tableLines = lines.filter((line) => line.cells.length >= 2);
  const tableLike = tableLines.length >= 2;
  const financialHeader = lines.some((line) => {
    const labels = ["売上高", "売上収益", "営業収益", "営業利益", "経常利益", "当期純利益", "四半期純利益"];
    return labels.filter((label) => line.text.includes(label)).length >= 2;
  });
  const financialDataRow = lines.some((line) =>
    /(?:20\d{2}年[^\s]*期|通期)/.test(line.text)
    && (line.text.match(/[△▲-]?\d[\d,]*(?:\.\d+)?/g)?.length ?? 0) >= 4
  );
  const financialTableCandidate = financialHeader && financialDataRow;
  if (tableLike) {
    const widths = tableLines.map((line) => line.cells.length);
    const aligned = widths.filter((width) => width === widths[0]).length / widths.length;
    const hasHeader = tableLines.some((line) => /売上|営業|経常|利益|年度|実績|予想|前年|当期/.test(line.text));
    // 結合セルを含む短信ヘッダは列数が揺れる。主要ヘッダと期間付きデータ行を
    // 同じページで復元できた場合は、その揺れだけで曖昧とは判定しない。
    if (aligned < 0.7 && !financialTableCandidate) flags.push("table_ambiguous");
    if (!hasHeader) flags.push("table_header_missing");
  }
  const score = Math.max(0, 100 - (flags.includes("empty") ? 70 : 0) - (flags.includes("short_text") ? 30 : 0) - (flags.includes("table_ambiguous") ? 30 : 0) - (flags.includes("table_header_missing") ? 10 : 0));
  return { score, flags, tableLike, financialTableCandidate, lineCount: lines.length };
}

export function assessPdfExtractQuality(pages: PdfExtractResult["pages"]): PdfExtractQuality {
  const emptyPageRate = pages.length ? pages.filter((page) => !page.text.trim() || page.text.length < 30).length / pages.length : 1;
  const ambiguousTablePages = pages.filter((page) => page.quality?.flags.includes("table_ambiguous")).map((page) => page.pageNumber);
  const flags: PdfExtractQuality["flags"] = [];
  if (emptyPageRate >= 0.3) flags.push("empty_page_rate_high");
  if (ambiguousTablePages.length) flags.push("table_ambiguous");
  if (pages.every((page) => page.text.length < 500)) flags.push("text_sparse");
  const average = pages.length ? pages.reduce((sum, page) => sum + (page.quality?.score ?? 0), 0) / pages.length : 0;
  const score = Math.round(Math.max(0, average - emptyPageRate * 25));
  const hasVerifiedFinancialTable = pages.some((page) => page.quality?.financialTableCandidate && !page.quality.flags.includes("table_ambiguous"));
  return {
    score,
    flags,
    emptyPageRate,
    ambiguousTablePages,
    safeForAutomaticFacts: score >= 70 && emptyPageRate < 0.3 && hasVerifiedFinancialTable
  };
}

import * as pdfjsLib from "pdfjs-dist";
import workerSrc from "pdfjs-dist/build/pdf.worker.mjs?url";
import type { PdfExtractResult } from "./types";
import { fetchArrayBufferWithFallback } from "./utils";

pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc;

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
      const text = content.items
        .map((item) => ("str" in item ? item.str : ""))
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
      pages.push({ pageNumber, text });
      if (text.length < 30) warnings.push(`${pageNumber}ページの抽出文字数が少ないため、画像PDFまたは表中心の可能性があります。`);
    } catch (error) {
      warnings.push(`${pageNumber}ページのテキスト抽出に失敗しました: ${error instanceof Error ? error.message : String(error)}`);
      pages.push({ pageNumber, text: "" });
    }
  }

  const rawText = pages.map((page) => `--- ${page.pageNumber}ページ ---\n${page.text}`).join("\n\n");
  if (rawText.replace(/\s/g, "").length < 500) {
    warnings.push("抽出できた文字数が少ないため、画像PDFまたは保護PDFの可能性があります。読み取れた範囲で要約します。");
  }
  // 「PDFの表は…」の一般注意は冗長なため、低品質抽出（短い・抽出失敗ページが多い）時のみ表示
  const failedPageCount = pages.filter((p) => p.text.length < 30).length;
  if (failedPageCount >= Math.max(2, Math.floor(pages.length * 0.3))) {
    warnings.push(`抽出が不十分なページが ${failedPageCount} ページあります。数値は原文で必ず確認してください。`);
  }

  return {
    pages,
    totalPages: pdf.numPages,
    rawText,
    warnings
  };
}

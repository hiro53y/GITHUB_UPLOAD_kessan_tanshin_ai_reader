import * as pdfjsLib from "pdfjs-dist";
import workerSrc from "pdfjs-dist/build/pdf.worker.mjs?url";
import type { PdfExtractResult } from "./types";
import { fetchArrayBufferWithFallback } from "./utils";

pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc;

async function toArrayBuffer(input: File | ArrayBuffer | string): Promise<ArrayBuffer> {
  if (typeof input === "string") return fetchArrayBufferWithFallback(input);
  if (input instanceof File) return input.arrayBuffer();
  return input;
}

export async function extractPdfText(input: File | ArrayBuffer | string): Promise<PdfExtractResult> {
  const buffer = await toArrayBuffer(input);
  const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(buffer) });
  const pdf = await loadingTask.promise;
  const pages: PdfExtractResult["pages"] = [];
  const warnings: string[] = [];

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
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
    warnings.push("抽出できた文字数が少なすぎます。原文PDFを必ず確認してください。");
  }
  warnings.push("PDFの表はテキスト抽出時に行・列が崩れる可能性があります。数値は必ず原文で確認してください。");

  return {
    pages,
    totalPages: pdf.numPages,
    rawText,
    warnings
  };
}

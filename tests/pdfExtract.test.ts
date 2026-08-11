import { describe, expect, it } from "vitest";
import { assessPdfExtractQuality, assessPdfPage, reconstructPdfLines, resolvePdfWorkerSrc } from "../src/lib/pdfExtract";

describe("PDF座標ベースの表復元と品質ゲート", () => {
  it("WindowsのVite /@fs/ worker URLをfile URLへ変換する", () => {
    expect(resolvePdfWorkerSrc("/@fs/C:/project/node_modules/pdfjs-dist/build/pdf.worker.mjs", true))
      .toBe("file:///C:/project/node_modules/pdfjs-dist/build/pdf.worker.mjs");
  });

  it("PDF内部順序ではなくY→Xの順で行とセルを復元する", () => {
    const lines = reconstructPdfLines([
      { text: "1,000", x: 180, y: 700, width: 30, height: 10 },
      { text: "売上高", x: 30, y: 700, width: 30, height: 10 },
      { text: "100", x: 180, y: 680, width: 20, height: 10 },
      { text: "営業利益", x: 30, y: 680, width: 40, height: 10 }
    ]);
    expect(lines.map((line) => line.cells)).toEqual([["売上高", "1,000"], ["営業利益", "100"]]);
    expect(assessPdfPage(lines, lines.map((line) => line.text).join(" ")).flags).not.toContain("table_ambiguous");
  });

  it("列数の揺れる表と空ページを自動確定不可として返す", () => {
    const ambiguous = reconstructPdfLines([
      { text: "売上高", x: 10, y: 700 }, { text: "100", x: 180, y: 700 },
      { text: "営業利益", x: 10, y: 680 }, { text: "50", x: 100, y: 680 }, { text: "注記", x: 180, y: 680 }
    ]);
    const pageQuality = assessPdfPage(ambiguous, ambiguous.map((line) => line.text).join(" "));
    const quality = assessPdfExtractQuality([{ pageNumber: 1, text: ambiguous.map((line) => line.text).join(" "), lines: ambiguous, quality: pageQuality }, { pageNumber: 2, text: "", lines: [], quality: assessPdfPage([], "") }]);
    expect(pageQuality.flags).toContain("table_ambiguous");
    expect(quality.safeForAutomaticFacts).toBe(false);
    expect(quality.flags).toContain("empty_page_rate_high");
  });
});

import type { ExtractedNumber } from "../lib/types";

export function NumberTable({ numbers }: { numbers: ExtractedNumber[] }) {
  if (!numbers.length) {
    return <p className="text-slate-600">数値候補は自動抽出されませんでした。PDFの表崩れにより数値を抽出できない場合があります。</p>;
  }

  return (
    <div className="overflow-hidden rounded-xl border border-blue-100">
      <div className="grid grid-cols-[1.2fr_1fr_72px] bg-blue-50 text-sm font-bold text-slate-800">
        <div className="border-r border-blue-100 p-3">項目</div>
        <div className="border-r border-blue-100 p-3">値</div>
        <div className="p-3">ページ</div>
      </div>
      {numbers.slice(0, 30).map((item, index) => (
        <div key={`${item.label}-${item.valueText}-${index}`} className="grid grid-cols-[1.2fr_1fr_72px] border-t border-blue-100 text-sm text-slate-800">
          <div className="min-w-0 break-words border-r border-blue-100 p-3 font-bold">{item.label}</div>
          <div className="min-w-0 break-words border-r border-blue-100 p-3">{item.valueText}</div>
          <div className="p-3 font-bold text-brand-600">{item.pageNumber}P</div>
          <div className="col-span-3 border-t border-blue-50 bg-slate-50 px-3 py-2 text-xs text-slate-500">{item.context}</div>
        </div>
      ))}
    </div>
  );
}

import { BarChart3, ClipboardCopy, ExternalLink, FileUp, Link, Search, ShieldAlert } from "lucide-react";
import { useRef, useState } from "react";
import type { HistoryItem } from "../lib/types";
import { formatDateTime } from "../lib/utils";
import { Card, OutlineButton, PrimaryButton, StatusBadge } from "../components/Card";

export function HomePage({
  latestHistory,
  onAnalyzeTicker,
  onAnalyzeFile,
  onAnalyzeUrl,
  onOpenReport,
  onOpenHistory
}: {
  latestHistory?: HistoryItem;
  onAnalyzeTicker: (ticker: string, companyName?: string) => void;
  onAnalyzeFile: (file: File, ticker?: string, companyName?: string) => void;
  onAnalyzeUrl: (url: string, ticker?: string, companyName?: string) => void;
  onOpenReport: () => void;
  onOpenHistory: () => void;
}) {
  const [ticker, setTicker] = useState("5592");
  const [companyName, setCompanyName] = useState("");
  const [pdfUrl, setPdfUrl] = useState("");
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const openYahooCodeSearch = () => {
    const query = encodeURIComponent(companyName || ticker || "");
    window.open(`https://finance.yahoo.co.jp/search/?query=${query}`, "_blank", "noopener,noreferrer");
  };

  return (
    <div className="space-y-4">
      <Card title="要約強化版 2026-05-09.5" action={<StatusBadge tone="green">更新済み</StatusBadge>}>
        <div className="space-y-2 rounded-xl border border-green-200 bg-green-50 p-3 text-sm font-bold leading-6 text-green-800">
          <p>決算診断、良い点・注意点、主要数値、Yahoo!ファイナンス銘柄検索、PDF URL proxyを強化済みです。</p>
          <p>このカードが見えていれば、新しい版が表示されています。</p>
        </div>
      </Card>

      {latestHistory ? (
        <Card
          title="最新分析サマリー"
          action={
            <button type="button" onClick={onOpenReport} className="rounded-xl border border-brand-600 px-3 py-2 text-sm font-bold text-brand-600">
              レポートを開く
            </button>
          }
        >
          <div className="rounded-xl border border-blue-100 bg-blue-50 p-3 text-lg font-bold leading-8 text-slate-950">
            一言サマリー: {latestHistory.oneLineSummary}
          </div>
          <p className="mt-3 text-sm text-slate-500">最終更新: {formatDateTime(latestHistory.analyzedAt)} / 分析方式: 標準ルール分析 + 無料AI要約</p>
        </Card>
      ) : null}

      <Card title="銘柄コードから自動取得" icon={<span className="text-lg font-bold">1</span>}>
        <div className="space-y-4">
          <label className="block">
            <span className="mb-2 block text-sm font-bold text-slate-700">銘柄コード</span>
            <input
              value={ticker}
              inputMode="numeric"
              maxLength={4}
              onChange={(event) => setTicker(event.target.value.replace(/[^\d]/g, "").slice(0, 4))}
              placeholder="例: 7203"
              className="h-13 w-full rounded-xl border border-blue-200 px-4 text-lg font-bold text-slate-950 outline-none focus:border-brand-600"
            />
          </label>
          <label className="block">
            <span className="mb-2 block text-sm font-bold text-slate-700">会社名補助入力（任意）</span>
            <input
              value={companyName}
              onChange={(event) => setCompanyName(event.target.value)}
              placeholder="例: トヨタ"
              className="h-13 w-full rounded-xl border border-blue-200 px-4 text-lg text-slate-950 outline-none focus:border-brand-600"
            />
          </label>
          <OutlineButton onClick={openYahooCodeSearch}>
            <ExternalLink className="h-5 w-5" />
            Yahoo!ファイナンスで銘柄コード検索
          </OutlineButton>
          <PrimaryButton onClick={() => onAnalyzeTicker(ticker, companyName || undefined)}>
            <Search className="h-5 w-5" />
            最新決算短信を取得して分析
          </PrimaryButton>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <OutlineButton onClick={() => fileInputRef.current?.click()}>
              <FileUp className="h-5 w-5" />
              手動PDFアップロード
            </OutlineButton>
            <OutlineButton onClick={() => pdfUrl && onAnalyzeUrl(pdfUrl, ticker || undefined, companyName || undefined)} disabled={!pdfUrl}>
              <Link className="h-5 w-5" />
              PDF URLを貼り付けて分析
            </OutlineButton>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/pdf,.pdf"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) onAnalyzeFile(file, ticker || undefined, companyName || undefined);
              event.currentTarget.value = "";
            }}
          />
          <input
            value={pdfUrl}
            onChange={(event) => setPdfUrl(event.target.value)}
            placeholder="https://www.release.tdnet.info/inbs/....pdf"
            className="h-12 w-full rounded-xl border border-blue-200 px-3 text-sm outline-none focus:border-brand-600"
          />
          <div className="grid grid-cols-5 gap-2 text-center text-xs font-bold text-emerald-800">
            {[
              ["1. LOOKUP", "開示検索"],
              ["2. SELECT", "候補選定"],
              ["3. DOWNLOAD", "PDF取得"],
              ["4. EXTRACT", "テキスト抽出"],
              ["5. ANALYZE", "無料AI要約"]
            ].map(([title, label]) => (
              <div key={title} className="rounded-xl border border-emerald-100 bg-emerald-50 px-1 py-3">
                <div className="text-[11px]">{title}</div>
                <div className="mt-2 text-slate-800">{label}</div>
              </div>
            ))}
          </div>
        </div>
      </Card>

      {latestHistory ? (
        <Card
          title="最近の取得履歴"
          action={
            <button type="button" onClick={onOpenHistory} className="rounded-xl border border-brand-600 px-3 py-2 text-sm font-bold text-brand-600">
              すべて見る
            </button>
          }
        >
          <button type="button" onClick={onOpenReport} className="flex w-full items-center gap-3 rounded-xl border border-blue-100 p-3 text-left">
            <div className="grid h-14 w-14 shrink-0 place-items-center rounded-full bg-blue-100 text-lg font-bold text-slate-950">
              {latestHistory.ticker || "PDF"}
            </div>
            <div className="min-w-0 flex-1">
              <div className="break-words text-lg font-bold text-slate-950">{latestHistory.companyName || "手動PDF資料"}</div>
              <div className="text-sm text-slate-500">取得日時: {formatDateTime(latestHistory.analyzedAt)}</div>
            </div>
            <StatusBadge tone={latestHistory.status === "success" ? "green" : "orange"}>{latestHistory.status === "success" ? "分析完了" : "注意あり"}</StatusBadge>
          </button>
        </Card>
      ) : null}

      <Card title="注意事項" icon={<ShieldAlert className="h-5 w-5" />}>
        <p className="leading-7 text-slate-700">
          本アプリは投資助言ではありません。決算短信を読むための補助ツールです。PDFから抽出できたテキストをもとに、無料AI要約と標準ルール分析で内容を整理します。
        </p>
      </Card>

      <Card>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <OutlineButton onClick={onOpenReport}>
            <BarChart3 className="h-5 w-5" />
            レポートを見る
          </OutlineButton>
          <OutlineButton onClick={() => navigator.clipboard?.writeText("決算短信AIリーダー: 標準ルール分析で決算資料を読む補助PWA")}>
            <ClipboardCopy className="h-5 w-5" />
            アプリ説明をコピー
          </OutlineButton>
        </div>
      </Card>
    </div>
  );
}

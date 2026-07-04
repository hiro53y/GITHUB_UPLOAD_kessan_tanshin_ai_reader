import { BarChart3, ClipboardCopy, FileUp, Link, Loader2, Search, ShieldAlert } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { HistoryItem, LoadingStep, LoadingStepStatus } from "../lib/types";
import { compactText, formatDateTime, isValidTicker, normalizeTicker } from "../lib/utils";
import { getLastTicker } from "../lib/storage";
import { structuredReportToText } from "../lib/structuredReport";
import {
  loadTickerMaster,
  lookupNameByCode,
  resolveTickerByName,
  searchTickerMaster,
  type TickerMasterEntry,
  type TickerSuggestion
} from "../lib/tickerMaster";
import { Card, OutlineButton, PrimaryButton, StatusBadge } from "../components/Card";

// ─── 5ステップ進捗チップ（内部9ステップを集約してライブ表示） ───
type ChipDef = { key: string; title: string; label: string; stepIds: number[] };

const CHIP_DEFS: ChipDef[] = [
  { key: "lookup", title: "LOOKUP", label: "開示検索", stepIds: [1, 2] },
  { key: "select", title: "SELECT", label: "候補選定", stepIds: [3] },
  { key: "download", title: "DOWNLOAD", label: "PDF取得", stepIds: [4] },
  { key: "extract", title: "EXTRACT", label: "テキスト抽出", stepIds: [5, 6] },
  { key: "llm", title: "LLM", label: "分析・要約", stepIds: [7, 8, 9] }
];

function aggregateStatus(steps: LoadingStep[], ids: number[]): { status: LoadingStepStatus; detail?: string } {
  const group = steps.filter((step) => ids.includes(step.id));
  if (!group.length) return { status: "waiting" };
  if (group.some((step) => step.status === "failed")) {
    return { status: "failed", detail: group.find((step) => step.status === "failed")?.detail };
  }
  if (group.some((step) => step.status === "processing")) {
    return { status: "processing", detail: group.find((step) => step.status === "processing")?.detail };
  }
  if (group.every((step) => step.status === "waiting")) return { status: "waiting" };
  if (group.every((step) => step.status === "success" || step.status === "skipped")) {
    const lastWithDetail = [...group].reverse().find((step) => step.detail);
    return { status: "success", detail: lastWithDetail?.detail };
  }
  return { status: "waiting" };
}

function StepChips({ steps }: { steps: LoadingStep[] }) {
  return (
    <div className="grid grid-cols-5 gap-2 text-center text-xs font-bold">
      {CHIP_DEFS.map((chip, index) => {
        const { status, detail } = aggregateStatus(steps, chip.stepIds);
        const style =
          status === "success"
            ? "border-emerald-100 bg-emerald-50 text-emerald-800"
            : status === "processing"
              ? "border-blue-200 bg-blue-50 text-brand-600"
              : status === "failed"
                ? "border-red-200 bg-red-50 text-red-700"
                : "border-slate-200 bg-slate-50 text-slate-500";
        return (
          <div key={chip.key} className={`rounded-xl border px-1 py-3 ${style}`}>
            <div className="flex items-center justify-center gap-1 text-[11px]">
              {status === "processing" ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
              {`${index + 1}. ${chip.title}`}
            </div>
            <div className="mt-2 text-slate-800">{chip.label}</div>
            {detail ? <div className="mt-1 truncate text-[10px] font-medium text-slate-500">{detail}</div> : null}
          </div>
        );
      })}
    </div>
  );
}

export function HomePage({
  latestHistory,
  isProcessing,
  steps,
  onAnalyzeTicker,
  onAnalyzeFile,
  onAnalyzeUrl,
  onOpenReport,
  onOpenHistory,
  onCopy
}: {
  latestHistory?: HistoryItem;
  isProcessing: boolean;
  steps: LoadingStep[];
  onAnalyzeTicker: (ticker: string, companyName?: string) => void;
  onAnalyzeFile: (file: File, ticker?: string, companyName?: string) => void;
  onAnalyzeUrl: (url: string, ticker?: string, companyName?: string) => void;
  onOpenReport: () => void;
  onOpenHistory: () => void;
  onCopy: (label: string, text: string) => void;
}) {
  const lastTicker = getLastTicker();
  const [query, setQuery] = useState(() => {
    if (!lastTicker) return "";
    return lastTicker.companyName ? `${lastTicker.ticker} ${lastTicker.companyName}` : lastTicker.ticker;
  });
  const [pendingSelection, setPendingSelection] = useState<TickerSuggestion | undefined>(
    lastTicker ? { code: lastTicker.ticker, name: lastTicker.companyName || "" } : undefined
  );
  const [masterEntries, setMasterEntries] = useState<TickerMasterEntry[]>([]);
  const [masterState, setMasterState] = useState<"loading" | "ready" | "empty">("loading");
  const [inputFocused, setInputFocused] = useState(false);
  const [inputError, setInputError] = useState("");
  const [pdfUrl, setPdfUrl] = useState("");
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const blurTimerRef = useRef<number | null>(null);

  // 銘柄マスタのロード（CDN→localStorageキャッシュ）。失敗してもコード直接入力で利用可能。
  useEffect(() => {
    let cancelled = false;
    void loadTickerMaster().then((entries) => {
      if (cancelled) return;
      setMasterEntries(entries);
      setMasterState(entries.length ? "ready" : "empty");
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    return () => {
      if (blurTimerRef.current !== null) window.clearTimeout(blurTimerRef.current);
    };
  }, []);

  const suggestions = useMemo(() => {
    if (pendingSelection) return [];
    return searchTickerMaster(masterEntries, query, 8);
  }, [masterEntries, query, pendingSelection]);

  function selectSuggestion(item: TickerSuggestion) {
    setPendingSelection(item);
    setQuery(`${item.code} ${item.name}`);
    setInputError("");
  }

  /** 入力内容を銘柄コード＋会社名に解決する */
  function resolveInput(): { ticker: string; companyName?: string } | undefined {
    if (pendingSelection?.code) {
      return { ticker: pendingSelection.code, companyName: pendingSelection.name || undefined };
    }
    const trimmed = query.trim();
    if (!trimmed) return undefined;
    // 「4958 長谷川香料」形式
    const codeWithName = trimmed.match(/^([0-9][0-9A-Za-z]{3})\s+(.+)$/u);
    if (codeWithName && isValidTicker(codeWithName[1])) {
      return { ticker: normalizeTicker(codeWithName[1]), companyName: codeWithName[2].trim() };
    }
    // コードのみ
    if (isValidTicker(trimmed)) {
      const code = normalizeTicker(trimmed);
      return { ticker: code, companyName: lookupNameByCode(masterEntries, code) };
    }
    // 会社名 → マスタで解決
    const resolved = resolveTickerByName(masterEntries, trimmed);
    if (resolved) return { ticker: resolved.code, companyName: resolved.name };
    return undefined;
  }

  function handleAnalyzeClick() {
    const resolved = resolveInput();
    if (!resolved) {
      setInputError(
        masterState === "ready"
          ? "銘柄が見つかりませんでした。4桁の銘柄コード、または正確な会社名で入力してください。"
          : "銘柄一覧を取得できていないため、会社名検索が使えません。4桁の銘柄コードで入力してください。"
      );
      return;
    }
    setInputError("");
    onAnalyzeTicker(resolved.ticker, resolved.companyName);
  }

  const resolvedForManual = resolveInput();

  // 最新分析サマリーの本文プレビュー（構造化レポート→Markdownの順で採用）
  const latestReport = latestHistory?.report;
  const latestStructured = latestReport?.structuredReport;
  const previewText = latestStructured
    ? compactText(structuredReportToText(latestStructured).replace(/^一言サマリー:.*$/m, "").trim(), 220)
    : latestHistory
      ? compactText(latestHistory.reportMarkdown.replace(/[#*|-]/g, " "), 220)
      : "";
  const methodLabel = latestStructured?.methodLabel || "標準ルール分析";

  return (
    <div className="space-y-4">
      {latestHistory ? (
        <Card
          title="最新分析サマリー"
          icon={<span className="text-[10px] font-black tracking-widest text-brand-600">LATEST</span>}
          action={
            <button type="button" onClick={onOpenReport} className="rounded-xl bg-brand-600 px-3 py-2 text-sm font-bold text-white">
              レポートを開く
            </button>
          }
        >
          <p className="mb-2 text-xs text-slate-500">
            最終更新: {formatDateTime(latestHistory.analyzedAt)} / 使用分析: {methodLabel}
          </p>
          <div className="rounded-xl border border-blue-100 bg-blue-50 p-3 text-base font-bold leading-7 text-slate-950">
            一言サマリー: {latestHistory.oneLineSummary}
          </div>
          {previewText ? (
            <button type="button" onClick={onOpenReport} className="mt-3 block w-full text-left text-sm leading-6 text-slate-600">
              {previewText}
            </button>
          ) : null}
        </Card>
      ) : null}

      <Card title="銘柄コードから自動取得" icon={<span className="text-lg font-bold">1</span>}>
        <div className="space-y-4">
          <label className="block">
            <span className="mb-2 block text-sm font-bold text-slate-700">銘柄コード / 会社名</span>
            <div className="relative">
              <input
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setPendingSelection(undefined);
                  setInputError("");
                }}
                onFocus={() => setInputFocused(true)}
                onBlur={() => {
                  // 候補タップを拾えるよう少し遅らせて閉じる
                  blurTimerRef.current = window.setTimeout(() => setInputFocused(false), 200);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !isProcessing) handleAnalyzeClick();
                }}
                placeholder="例: 7203 または トヨタ自動車"
                className="h-13 w-full rounded-xl border border-blue-200 px-4 text-lg font-bold text-slate-950 outline-none focus:border-brand-600"
              />
              {inputFocused && suggestions.length > 0 ? (
                <div className="absolute inset-x-0 top-full z-30 mt-1 overflow-hidden rounded-xl border border-blue-200 bg-white shadow-lg">
                  {suggestions.map((item) => (
                    <button
                      key={item.code}
                      type="button"
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => selectSuggestion(item)}
                      className="block w-full border-b border-blue-50 px-4 py-3 text-left last:border-b-0 active:bg-blue-50"
                    >
                      <span className="font-bold text-slate-950">
                        {item.code} {item.name}
                      </span>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
            {masterState === "loading" ? (
              <span className="mt-1 block text-xs text-slate-400">銘柄一覧を読み込み中…（コード直接入力はすぐ使えます）</span>
            ) : masterState === "empty" ? (
              <span className="mt-1 block text-xs text-orange-600">銘柄一覧を取得できませんでした。4桁コードで入力してください。</span>
            ) : null}
            {inputError ? <span className="mt-1 block text-sm font-bold text-red-600">{inputError}</span> : null}
          </label>

          <PrimaryButton onClick={handleAnalyzeClick} disabled={isProcessing || !query.trim()}>
            <Search className="h-5 w-5" />
            {isProcessing ? "処理中…" : "最新決算短信を取得して分析"}
          </PrimaryButton>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <OutlineButton onClick={() => fileInputRef.current?.click()} disabled={isProcessing}>
              <FileUp className="h-5 w-5" />
              手動PDFアップロード
            </OutlineButton>
            <OutlineButton
              onClick={() => pdfUrl.trim() && onAnalyzeUrl(pdfUrl.trim(), resolvedForManual?.ticker, resolvedForManual?.companyName)}
              disabled={!pdfUrl.trim() || isProcessing}
            >
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
              if (file) onAnalyzeFile(file, resolvedForManual?.ticker, resolvedForManual?.companyName);
              event.currentTarget.value = "";
            }}
          />
          <input
            value={pdfUrl}
            onChange={(event) => setPdfUrl(event.target.value)}
            placeholder="https://www.release.tdnet.info/inbs/....pdf"
            className="h-12 w-full rounded-xl border border-blue-200 px-3 text-sm outline-none focus:border-brand-600"
          />

          <StepChips steps={steps} />
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
            <StatusBadge tone={latestHistory.status === "success" ? "green" : "orange"}>{latestHistory.status === "success" ? "分析完了" : "要確認"}</StatusBadge>
          </button>
        </Card>
      ) : null}

      <Card title="注意事項" icon={<ShieldAlert className="h-5 w-5" />}>
        <p className="leading-7 text-slate-700">
          本アプリは投資助言ではありません。決算短信を読むための補助ツールです。抽出・分析結果には誤りが含まれる可能性があります。最終確認は必ずTDnet、企業IR、決算短信原文で行ってください。
        </p>
      </Card>

      <Card>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <OutlineButton onClick={onOpenReport}>
            <BarChart3 className="h-5 w-5" />
            レポートを見る
          </OutlineButton>
          <OutlineButton onClick={() => onCopy("アプリ説明", "決算短信AIリーダー: 標準ルール分析で決算資料を読む補助PWA")}>
            <ClipboardCopy className="h-5 w-5" />
            アプリ説明をコピー
          </OutlineButton>
        </div>
      </Card>
    </div>
  );
}

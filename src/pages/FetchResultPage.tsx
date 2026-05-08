import { AlertTriangle, ExternalLink, FileUp, Info, Link, RotateCcw } from "lucide-react";
import { useRef, useState } from "react";
import { DisclosureCandidateList } from "../components/DisclosureCandidateList";
import { Card, OutlineButton, PrimaryButton, StatusBadge } from "../components/Card";
import { LoadingSteps } from "../components/LoadingSteps";
import type { DisclosureFetchResult, DisclosureItem, LoadingStep } from "../lib/types";
import { formatDateTime } from "../lib/utils";

export function FetchResultPage({
  fetchResult,
  selectedDisclosure,
  steps,
  logs,
  isProcessing,
  onSelectDisclosure,
  onAnalyzeDisclosure,
  onRetry,
  onAnalyzeFile,
  onAnalyzeUrl
}: {
  fetchResult?: DisclosureFetchResult;
  selectedDisclosure?: DisclosureItem;
  steps: LoadingStep[];
  logs: string[];
  isProcessing: boolean;
  onSelectDisclosure: (item: DisclosureItem) => void;
  onAnalyzeDisclosure: (item: DisclosureItem) => void;
  onRetry: () => void;
  onAnalyzeFile: (file: File) => void;
  onAnalyzeUrl: (url: string) => void;
}) {
  const [url, setUrl] = useState("");
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const success = fetchResult?.status === "success";
  const failed = fetchResult && fetchResult.status !== "success";

  return (
    <div className="space-y-4">
      {isProcessing ? <LoadingSteps steps={steps} logs={logs} /> : null}

      {success && selectedDisclosure ? (
        <>
          <Card
            title="最新取得結果"
            action={<StatusBadge tone="green">取得成功</StatusBadge>}
          >
            <p className="text-lg font-bold leading-8 text-slate-950">最新の決算関連資料が自動的に選定されました。</p>
            <p className="mt-2 text-sm text-slate-500">取得日時: {formatDateTime(fetchResult.searchedAt)} / 分析方式: 標準ルール分析</p>
          </Card>

          <Card title="選定された資料" action={<StatusBadge tone="blue">スコア {selectedDisclosure.score}</StatusBadge>}>
            <dl className="overflow-hidden rounded-xl border border-blue-100 text-base">
              {[
                ["会社名", selectedDisclosure.companyName || fetchResult.companyName || "不明"],
                ["銘柄コード", fetchResult.ticker],
                ["開示日時", formatDateTime(selectedDisclosure.disclosedAt)],
                ["資料タイトル", selectedDisclosure.title],
                ["資料種別", selectedDisclosure.documentType],
                ["取得元", "TDnet公開閲覧"]
              ].map(([label, value]) => (
                <div key={label} className="grid grid-cols-[112px_1fr] border-b border-blue-100 last:border-b-0">
                  <dt className="bg-slate-50 p-3 font-bold text-slate-600">{label}</dt>
                  <dd className="min-w-0 break-words p-3 font-bold text-slate-950">{value}</dd>
                </div>
              ))}
            </dl>
            <div className="mt-4 rounded-xl border border-blue-200 bg-blue-50 p-3">
              <div className="mb-1 flex items-center gap-2 font-bold text-slate-950">
                <Info className="h-5 w-5 text-brand-600" />
                なぜこの資料が選ばれたか
              </div>
              <p className="leading-7 text-slate-700">{fetchResult.userMessage}</p>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-600">
                {selectedDisclosure.scoreReasons.slice(0, 5).map((reason) => (
                  <li key={reason}>{reason}</li>
                ))}
              </ul>
            </div>
            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
              {selectedDisclosure.pdfUrl ? (
                <PrimaryButton onClick={() => window.open(selectedDisclosure.pdfUrl, "_blank", "noopener,noreferrer")}>
                  <ExternalLink className="h-5 w-5" />
                  PDFを開く
                </PrimaryButton>
              ) : null}
              <OutlineButton onClick={() => onAnalyzeDisclosure(selectedDisclosure)}>この資料で再分析</OutlineButton>
            </div>
          </Card>

          <DisclosureCandidateList
            candidates={fetchResult.candidates}
            selectedId={selectedDisclosure.id}
            onSelect={onSelectDisclosure}
            onAnalyze={onAnalyzeDisclosure}
          />
        </>
      ) : null}

      {failed ? (
        <>
          <Card>
            <div className="flex gap-3">
              <div className="grid h-16 w-16 shrink-0 place-items-center rounded-full bg-orange-50 text-orange-600">
                <AlertTriangle className="h-9 w-9" />
              </div>
              <div className="min-w-0">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <h2 className="text-xl font-bold text-orange-700">自動取得を完了できませんでした</h2>
                  <StatusBadge tone="orange">要対応</StatusBadge>
                </div>
                <p className="leading-7 text-slate-700">{fetchResult.userMessage}</p>
                {fetchResult.errorMessage ? <p className="mt-2 break-words text-xs text-slate-500">詳細: {fetchResult.errorMessage}</p> : null}
              </div>
            </div>
          </Card>

          <LoadingSteps steps={steps} logs={logs} />

          <Card title="次の操作">
            <div className="space-y-3">
              <PrimaryButton onClick={() => fileInputRef.current?.click()}>
                <FileUp className="h-5 w-5" />
                手動PDFをアップロード
              </PrimaryButton>
              <input
                ref={fileInputRef}
                type="file"
                accept="application/pdf,.pdf"
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) onAnalyzeFile(file);
                  event.currentTarget.value = "";
                }}
              />
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_auto]">
                <input
                  value={url}
                  onChange={(event) => setUrl(event.target.value)}
                  placeholder="PDF URLを貼り付け"
                  className="h-12 rounded-xl border border-blue-200 px-3 outline-none focus:border-brand-600"
                />
                <OutlineButton onClick={() => url && onAnalyzeUrl(url)} disabled={!url}>
                  <Link className="h-5 w-5" />
                  分析
                </OutlineButton>
              </div>
              <OutlineButton onClick={onRetry}>
                <RotateCcw className="h-5 w-5" />
                再取得
              </OutlineButton>
              <div className="rounded-xl border border-blue-200 bg-blue-50 p-3">
                <h3 className="mb-2 font-bold text-slate-950">よくある原因</h3>
                <ul className="list-disc space-y-1 pl-5 text-sm leading-6 text-slate-700">
                  <li>PDF配信先が一時的に応答していない</li>
                  <li>公開ページ構造が変わり自動取得に失敗した</li>
                  <li>CORS制限によりブラウザから直接取得できない</li>
                  <li>TDnet公開閲覧の掲載期間外だった</li>
                </ul>
              </div>
            </div>
          </Card>
        </>
      ) : null}

      {!fetchResult && !isProcessing ? (
        <Card title="取得結果">
          <p className="text-slate-600">まだ取得処理は実行されていません。ホーム画面から銘柄コードを入力してください。</p>
        </Card>
      ) : null}
    </div>
  );
}

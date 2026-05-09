import { AlertCircle, ArrowLeft, BarChart3, CheckCircle2, ClipboardCopy, ExternalLink, FileText, Grid2X2, ListChecks } from "lucide-react";
import { NumberTable } from "../components/NumberTable";
import { ReportSection } from "../components/ReportSection";
import { WarningCard } from "../components/WarningCard";
import { Card, OutlineButton, PrimaryButton, StatusBadge } from "../components/Card";
import type { AnalysisReport, DisclosureFetchResult } from "../lib/types";
import { buildMarkdownReport } from "../lib/promptBuilder";
import { formatDateTime } from "../lib/utils";

function topicStatus(topic: AnalysisReport["topics"][number]) {
  if (!topic.detected) return <StatusBadge tone="gray">未検出</StatusBadge>;
  if (topic.category === "リスク・注記") return <StatusBadge tone="orange">要確認</StatusBadge>;
  return <StatusBadge tone="green">検出</StatusBadge>;
}

export function ReportPage({
  report,
  fetchResult,
  pdfWarnings,
  detail,
  onDetailChange,
  onCopy,
  onBackToFetch
}: {
  report?: AnalysisReport;
  fetchResult?: DisclosureFetchResult;
  pdfWarnings: string[];
  detail: boolean;
  onDetailChange: (detail: boolean) => void;
  onCopy: (label: string, text: string) => void;
  onBackToFetch: () => void;
}) {
  if (!report) {
    return (
      <Card title="レポート">
        <p className="text-slate-600">まだ分析レポートはありません。ホーム画面から取得または手動PDF分析を実行してください。</p>
      </Card>
    );
  }

  const markdown = buildMarkdownReport(report);
  const detectedTopics = report.topics.filter((topic) => topic.detected);

  if (detail) {
    return (
      <div className="space-y-4">
        <button type="button" onClick={() => onDetailChange(false)} className="flex items-center gap-2 text-lg font-bold text-brand-600">
          <ArrowLeft className="h-6 w-6" />
          概要へ戻る
        </button>

        <ReportSection title="注意ポイント">
          <div className="space-y-3">
            {report.warnings.length ? (
              report.warnings.map((warning) => <WarningCard key={warning.label} warning={warning} />)
            ) : (
              <div className="rounded-xl border border-green-100 bg-green-50 p-4 font-bold text-green-700">強い注意語句は自動検出されませんでした。</div>
            )}
          </div>
        </ReportSection>

        <ReportSection title="抽出数値一覧">
          <NumberTable numbers={report.extractedNumbers} />
        </ReportSection>

        <ReportSection title="原文確認ページ">
          <div className="overflow-hidden rounded-xl border border-blue-100">
            {report.sourceCheckpoints.map((checkpoint) => (
              <div key={`${checkpoint.pageNumber}-${checkpoint.reason}`} className="grid grid-cols-[78px_1fr] border-b border-blue-100 last:border-b-0">
                <div className="bg-blue-50 p-3 font-bold text-brand-600">{checkpoint.pageNumber}ページ</div>
                <div className="min-w-0 p-3">
                  <div className="font-bold text-slate-950">{checkpoint.reason}</div>
                  <div className="mt-1 break-words text-sm text-slate-600">{checkpoint.excerpt}</div>
                </div>
              </div>
            ))}
          </div>
        </ReportSection>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <OutlineButton onClick={() => onCopy("Markdownレポート", markdown)}>
            <ClipboardCopy className="h-5 w-5" />
            Markdownをコピー
          </OutlineButton>
          <OutlineButton onClick={() => onCopy("原文確認リスト", report.sourceCheckpoints.map((item) => `${item.pageNumber}ページ: ${item.reason}`).join("\n"))}>
            <FileText className="h-5 w-5" />
            原文リストをコピー
          </OutlineButton>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* 決算サマリー */}
      <Card title="決算サマリー">
        <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 text-base font-bold leading-7 text-slate-950">{report.oneLineSummary}</div>
        <div className="mt-3 flex flex-wrap gap-2">
          <StatusBadge tone={report.overallTone === "caution" || report.overallTone === "mixed" ? "orange" : "green"}>
            {report.overallTone === "positive"
              ? "好材料語句あり"
              : report.overallTone === "caution"
                ? "注意語句あり"
                : report.overallTone === "mixed"
                  ? "強弱混在"
                  : report.overallTone === "neutral"
                    ? "中立"
                    : "判定不明"}
          </StatusBadge>
          <StatusBadge tone="blue">信頼度: {report.confidence === "high" ? "高" : report.confidence === "medium" ? "中" : "低"}</StatusBadge>
          <StatusBadge tone="orange">原文確認推奨</StatusBadge>
        </div>
      </Card>

      {/* 無料AI診断カード */}
      <Card title="無料AI診断・要点" action={<StatusBadge tone="blue">API不要</StatusBadge>}>
        <div className="space-y-4">
          {/* 判定バッジ + 方式 */}
          <div className="flex flex-wrap items-center gap-2">
            <span className={`inline-flex items-center rounded-full px-3 py-1 text-sm font-bold ${
              report.freeAiDigest.verdict === "good" ? "bg-green-100 text-green-700" :
              report.freeAiDigest.verdict === "weak" ? "bg-red-100 text-red-700" :
              report.freeAiDigest.verdict === "mixed" ? "bg-orange-100 text-orange-700" :
              "bg-slate-100 text-slate-600"
            }`}>
              {report.freeAiDigest.verdictLabel}
            </span>
            <span className="text-xs text-slate-400">{report.freeAiDigest.method}</span>
          </div>

          {/* 主要数値（パース成功時のみ） */}
          {report.freeAiDigest.keyFigures.length > 0 && (
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <div className="mb-2 text-xs font-bold text-slate-500">主要数値</div>
              <ul className="space-y-1">
                {report.freeAiDigest.keyFigures.slice(0, 6).map((fig) => (
                  <li key={fig} className="text-sm font-bold text-slate-800">{fig}</li>
                ))}
              </ul>
            </div>
          )}

          {/* 良い点 / 注意点 */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="rounded-xl border border-green-100 bg-green-50 p-3">
              <div className="mb-2 flex items-center gap-1 text-sm font-bold text-green-700">
                <CheckCircle2 className="h-4 w-4" />
                良い点
              </div>
              <ul className="space-y-1">
                {report.freeAiDigest.goodPoints.map((pt) => (
                  <li key={pt} className="text-sm leading-5 text-slate-700">・{pt}</li>
                ))}
              </ul>
            </div>
            <div className="rounded-xl border border-orange-100 bg-orange-50 p-3">
              <div className="mb-2 flex items-center gap-1 text-sm font-bold text-orange-700">
                <AlertCircle className="h-4 w-4" />
                注意点
              </div>
              <ul className="space-y-1">
                {report.freeAiDigest.concernPoints.map((pt) => (
                  <li key={pt} className="text-sm leading-5 text-slate-700">・{pt}</li>
                ))}
              </ul>
            </div>
          </div>

          {/* トピック別サマリー */}
          {report.freeAiDigest.topicSummaries.length > 0 && (
            <div className="overflow-hidden rounded-xl border border-blue-100">
              {report.freeAiDigest.topicSummaries.map((ts) => (
                <div key={ts.category} className="grid grid-cols-[88px_1fr] border-b border-blue-100 last:border-b-0">
                  <div className="flex items-center bg-blue-50 p-2 text-xs font-bold text-brand-600">{ts.category}</div>
                  <div className="p-2">
                    <p className="text-sm leading-5 text-slate-700">{ts.summary}</p>
                    {ts.pages.length > 0 && <p className="mt-1 text-xs text-brand-500">{ts.pages.join("・")}ページ</p>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </Card>

      {/* Cloudflare Workers AI 要約（設定済みの場合のみ） */}
      {report.aiSummary ? (
        <Card title="AI要約">
          <div className="rounded-xl border border-purple-200 bg-gradient-to-br from-purple-50 to-indigo-50 p-4">
            <div className="mb-3 flex items-center gap-2">
              <div className="grid h-8 w-8 place-items-center rounded-lg bg-purple-100 text-purple-600">
                <BarChart3 className="h-5 w-5" />
              </div>
              <span className="text-sm font-bold text-purple-700">Cloudflare Workers AI</span>
            </div>
            <div className="whitespace-pre-wrap text-sm leading-7 text-slate-800">{report.aiSummary}</div>
          </div>
          <div className="mt-3">
            <OutlineButton onClick={() => onCopy("AI要約", report.aiSummary || "")}>
              <ClipboardCopy className="h-5 w-5" />
              AI要約をコピー
            </OutlineButton>
          </div>
        </Card>
      ) : null}

      {/* 最新資料情報 */}
      <Card title="最新資料カード">
        <div className="space-y-3 text-slate-700">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-xl font-bold text-slate-950">{report.companyName || fetchResult?.companyName || "手動PDF資料"}</div>
              <div className="text-sm">銘柄コード: {report.ticker || fetchResult?.ticker || "未指定"}</div>
            </div>
            <StatusBadge tone="green">分析完了</StatusBadge>
          </div>
          <div className="rounded-xl bg-slate-50 p-3 text-sm leading-6">
            <div>開示日時: {formatDateTime(report.sourceDisclosure?.disclosedAt)}</div>
            <div className="break-words">資料タイトル: {report.sourceDisclosure?.title || "手動PDF資料"}</div>
            <div>取得元: {report.sourceDisclosure?.sourceUrl ? "TDnet公開閲覧 / 手動URL" : "手動PDF"}</div>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {report.sourceDisclosure?.pdfUrl ? (
              <OutlineButton onClick={() => window.open(report.sourceDisclosure?.pdfUrl, "_blank", "noopener,noreferrer")}>
                <ExternalLink className="h-5 w-5" />
                PDFを開く
              </OutlineButton>
            ) : null}
            <OutlineButton onClick={onBackToFetch}>取得結果へ</OutlineButton>
            <OutlineButton onClick={() => onDetailChange(true)}>詳細を見る</OutlineButton>
          </div>
        </div>
      </Card>

      {/* トピックカード一覧 */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {report.topics.map((topic) => (
          <div key={topic.category} className="rounded-[16px] border border-blue-100 bg-white p-4 shadow-soft">
            <div className="mb-3 flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-blue-50 text-brand-600">
                  {topic.category === "売上" || topic.category === "利益" ? <BarChart3 className="h-7 w-7" /> : <Grid2X2 className="h-7 w-7" />}
                </div>
                <h3 className="text-lg font-bold text-slate-950">{topic.category}</h3>
              </div>
              {topicStatus(topic)}
            </div>
            <p className="text-sm leading-6 text-slate-700">{topic.comment}</p>
            {topic.pages.length ? <p className="mt-2 text-sm font-bold text-brand-600">{topic.pages.join("・")}ページ</p> : null}
            {topic.keywords.length ? <p className="mt-1 text-xs text-slate-500">語句: {topic.keywords.join("・")}</p> : null}
          </div>
        ))}
      </div>

      {/* PDF抽出警告 */}
      {pdfWarnings.length ? (
        <Card title="PDF抽出時の警告">
          <ul className="list-disc space-y-2 pl-5 text-sm leading-6 text-slate-700">
            {pdfWarnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </Card>
      ) : null}

      {/* 原文確認ポイント（上位5件） */}
      <ReportSection title="原文確認ポイント" action={<ListChecks className="h-5 w-5 text-brand-600" />}>
        <div className="overflow-hidden rounded-xl border border-blue-100">
          {report.sourceCheckpoints.slice(0, 5).map((checkpoint) => (
            <div key={`${checkpoint.pageNumber}-${checkpoint.reason}`} className="grid grid-cols-[76px_1fr] border-b border-blue-100 last:border-b-0">
              <div className="bg-blue-50 p-3 font-bold text-brand-600">{checkpoint.pageNumber}P</div>
              <div className="p-3 font-bold text-slate-900">{checkpoint.reason}</div>
            </div>
          ))}
        </div>
      </ReportSection>

      {/* アクションボタン */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <PrimaryButton onClick={() => onDetailChange(true)}>詳細を見る</PrimaryButton>
        <OutlineButton onClick={() => onCopy("AI用プロンプト", report.aiPrompt)}>
          <ClipboardCopy className="h-5 w-5" />
          AI用プロンプトをコピー
        </OutlineButton>
      </div>

      {/* 免責事項 */}
      <Card>
        <p className="text-sm leading-6 text-slate-600">{report.disclaimer}</p>
      </Card>
    </div>
  );
}

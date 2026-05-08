import { ArrowLeft, BarChart3, ClipboardCopy, ExternalLink, FileText, Grid2X2, ListChecks } from "lucide-react";
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
      <Card title="一言サマリー">
        <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 text-lg font-bold leading-8 text-slate-950">{report.oneLineSummary}</div>
        <div className="mt-3 flex flex-wrap gap-2">
          <StatusBadge tone={report.overallTone === "caution" ? "orange" : report.overallTone === "mixed" ? "orange" : "green"}>
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
            {topic.pages.length ? <p className="mt-2 text-sm font-bold text-brand-600">{topic.pages.join("、")}ページ</p> : null}
            {topic.keywords.length ? <p className="mt-2 text-xs text-slate-500">語句: {topic.keywords.join("、")}</p> : null}
          </div>
        ))}
      </div>

      {pdfWarnings.length ? (
        <Card title="PDF抽出時の警告">
          <ul className="list-disc space-y-2 pl-5 text-sm leading-6 text-slate-700">
            {pdfWarnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </Card>
      ) : null}

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

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <PrimaryButton onClick={() => onDetailChange(true)}>詳細を見る</PrimaryButton>
        <OutlineButton onClick={() => onCopy("AI用プロンプト", report.aiPrompt)}>
          <ClipboardCopy className="h-5 w-5" />
          AI用プロンプトをコピー
        </OutlineButton>
      </div>

      <Card>
        <p className="text-sm leading-6 text-slate-600">{report.disclaimer}</p>
      </Card>
    </div>
  );
}

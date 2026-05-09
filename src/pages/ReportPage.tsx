import { ArrowLeft, BarChart3, ClipboardCopy, ExternalLink, FileText, Grid2X2, ListChecks, Sparkles } from "lucide-react";
import { NumberTable } from "../components/NumberTable";
import { ReportSection } from "../components/ReportSection";
import { WarningCard } from "../components/WarningCard";
import { Card, OutlineButton, PrimaryButton, StatusBadge } from "../components/Card";
import type { AnalysisReport, DisclosureFetchResult } from "../lib/types";
import { buildMarkdownReport } from "../lib/promptBuilder";
import { formatDateTime } from "../lib/utils";

function topicStatus(topic: AnalysisReport["topics"][number]) {
  if (!topic.detected) return <StatusBadge tone="gray">未検出</StatusBadge>;
  if (topic.category === "リスク・注記") return <StatusBadge tone="orange">注意語句</StatusBadge>;
  return <StatusBadge tone="green">検出</StatusBadge>;
}

function verdictTone(verdict?: AnalysisReport["freeAiDigest"]["verdict"]): "green" | "blue" | "orange" | "gray" {
  if (verdict === "good") return "green";
  if (verdict === "weak" || verdict === "mixed") return "orange";
  if (verdict === "neutral") return "blue";
  return "gray";
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
  const digestBase = {
    verdict: "unknown" as const,
    verdictLabel: "業績判断は材料不足",
    headline: report.oneLineSummary,
    plainSummary: report.oneLineSummary,
    bullets: [`検出トピック: ${detectedTopics.map((topic) => topic.category).join("、") || "少なめ"}`],
    goodPoints: ["好材料として明確に分類できる語句は多くありません。"],
    concernPoints: report.warnings.length ? report.warnings.map((warning) => warning.comment) : ["強い注意語句は目立ちません。"],
    topicSummaries: detectedTopics.slice(0, 4).map((topic) => ({ category: topic.category, summary: topic.comment, pages: topic.pages })),
    keyFigures: report.extractedNumbers.slice(0, 5).map((item) => `${item.label}: ${item.valueText}（${item.pageNumber}P）`),
    method: "無料AI要約（保存済みレポート互換表示）"
  };
  const digest = {
    ...digestBase,
    ...(report.freeAiDigest || {}),
    goodPoints: report.freeAiDigest?.goodPoints?.length ? report.freeAiDigest.goodPoints : digestBase.goodPoints,
    concernPoints: report.freeAiDigest?.concernPoints?.length ? report.freeAiDigest.concernPoints : digestBase.concernPoints,
    bullets: report.freeAiDigest?.bullets?.length ? report.freeAiDigest.bullets : digestBase.bullets,
    topicSummaries: report.freeAiDigest?.topicSummaries?.length ? report.freeAiDigest.topicSummaries : digestBase.topicSummaries,
    keyFigures: report.freeAiDigest?.keyFigures?.length ? report.freeAiDigest.keyFigures : digestBase.keyFigures
  };

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

        <ReportSection title="根拠ページ・読みどころ">
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
          <OutlineButton onClick={() => onCopy("根拠ページリスト", report.sourceCheckpoints.map((item) => `${item.pageNumber}ページ: ${item.reason}`).join("\n"))}>
            <FileText className="h-5 w-5" />
            根拠リストをコピー
          </OutlineButton>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Card title="決算サマリー" action={<StatusBadge tone={verdictTone(digest.verdict)}>{digest.verdictLabel}</StatusBadge>}>
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
          <StatusBadge tone="blue">無料AI診断</StatusBadge>
        </div>
      </Card>

      <Card title="無料AI診断・要点" icon={<Sparkles className="h-5 w-5" />} action={<StatusBadge tone="blue">API不要</StatusBadge>}>
        <div className="space-y-3">
          <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 text-base font-bold leading-7 text-slate-950">
            {digest.plainSummary || digest.headline}
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="rounded-xl border border-green-100 bg-green-50 p-3">
              <div className="mb-2 font-bold text-green-800">良い点</div>
              <ul className="space-y-2 text-sm leading-6 text-green-900">
                {digest.goodPoints.map((point) => (
                  <li key={point}>{point}</li>
                ))}
              </ul>
            </div>
            <div className="rounded-xl border border-orange-100 bg-orange-50 p-3">
              <div className="mb-2 font-bold text-orange-800">注意点</div>
              <ul className="space-y-2 text-sm leading-6 text-orange-900">
                {digest.concernPoints.map((point) => (
                  <li key={point}>{point}</li>
                ))}
              </ul>
            </div>
          </div>
          <ul className="space-y-2 text-sm leading-6 text-slate-700">
            {digest.bullets.map((bullet) => (
              <li key={bullet} className="rounded-xl bg-slate-50 px-3 py-2">
                {bullet}
              </li>
            ))}
          </ul>
          {digest.keyFigures.length ? (
            <div className="rounded-xl border border-blue-100 p-3">
              <div className="mb-2 font-bold text-slate-950">主要数値候補</div>
              <div className="flex flex-wrap gap-2">
                {digest.keyFigures.slice(0, 8).map((figure) => (
                  <StatusBadge key={figure} tone="blue">{figure}</StatusBadge>
                ))}
              </div>
            </div>
          ) : null}
          <div className="space-y-2">
            {digest.topicSummaries.slice(0, 4).map((item) => (
              <div key={`${item.category}-${item.pages.join("-")}`} className="rounded-xl border border-blue-100 p-3">
                <div className="mb-1 flex items-center justify-between gap-2">
                  <span className="font-bold text-slate-950">{item.category}</span>
                  {item.pages.length ? <span className="text-sm font-bold text-brand-600">{item.pages.join("、")}P</span> : null}
                </div>
                <p className="text-sm leading-6 text-slate-700">{item.summary}</p>
              </div>
            ))}
          </div>
          <p className="text-xs font-bold text-slate-500">{digest.method}</p>
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

      <ReportSection title="根拠ページ・読みどころ" action={<ListChecks className="h-5 w-5 text-brand-600" />}>
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
        <OutlineButton onClick={() => onCopy("AI貼り付け用プロンプト", report.aiPrompt)}>
          <ClipboardCopy className="h-5 w-5" />
          AI貼り付け用プロンプトをコピー
        </OutlineButton>
      </div>

      <Card>
        <p className="text-sm leading-6 text-slate-600">{report.disclaimer}</p>
      </Card>
    </div>
  );
}

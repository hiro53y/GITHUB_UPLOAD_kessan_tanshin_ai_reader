import { AlertCircle, ArrowLeft, ArrowDown, ArrowUp, CheckCircle2, ClipboardCopy, ExternalLink, FileText, Minus } from "lucide-react";
import { NumberTable } from "../components/NumberTable";
import { ReportSection } from "../components/ReportSection";
import { WarningCard } from "../components/WarningCard";
import { Card, OutlineButton, PrimaryButton, StatusBadge } from "../components/Card";
import type { AnalysisReport, DisclosureFetchResult, KeyMetricRow } from "../lib/types";
import { buildMarkdownReport } from "../lib/promptBuilder";
import { formatDateTime } from "../lib/utils";

function verdictTone(verdict: AnalysisReport["freeAiDigest"]["verdict"]): "green" | "orange" | "red" | "gray" | "blue" {
  if (verdict === "good") return "green";
  if (verdict === "weak") return "red";
  if (verdict === "mixed") return "orange";
  if (verdict === "neutral") return "blue";
  return "gray";
}

function GrowthCell({ row }: { row: KeyMetricRow }) {
  if (!row.growth) return <span className="text-slate-400">—</span>;
  const tone = row.growthTone;
  const cls =
    tone === "up"
      ? "text-green-700"
      : tone === "down"
        ? "text-red-600"
        : "text-slate-600";
  const Icon = tone === "up" ? ArrowUp : tone === "down" ? ArrowDown : Minus;
  return (
    <span className={`inline-flex items-center gap-1 font-bold ${cls}`}>
      <Icon className="h-3.5 w-3.5" />
      {row.growth}
    </span>
  );
}

function MetricsTable({ rows, caption }: { rows: KeyMetricRow[]; caption?: string }) {
  if (!rows.length) return null;
  return (
    <div className="overflow-hidden rounded-xl border border-blue-100">
      {caption ? (
        <div className="bg-blue-50 px-3 py-2 text-xs font-bold text-brand-600">{caption}</div>
      ) : null}
      <table className="w-full text-sm">
        <tbody>
          {rows.map((row) => (
            <tr key={row.label} className="border-t border-blue-100 first:border-t-0">
              <th scope="row" className="w-[35%] bg-slate-50 px-3 py-2 text-left font-bold text-slate-800">
                {row.label}
              </th>
              <td className="px-3 py-2 text-right font-bold text-slate-900">{row.value}</td>
              <td className="w-[30%] px-3 py-2 text-right">
                <GrowthCell row={row} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
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

  const dig = report.freeAiDigest;
  const markdown = buildMarkdownReport(report);

  // 詳細ビュー（変更なし、ただし冗長表示を整理）
  if (detail) {
    return (
      <div className="space-y-4">
        <button type="button" onClick={() => onDetailChange(false)} className="flex items-center gap-2 text-lg font-bold text-brand-600">
          <ArrowLeft className="h-6 w-6" />
          要点へ戻る
        </button>

        <ReportSection title="注意ポイント（詳細）">
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

        <ReportSection title="原文確認ページ（全件）">
          <div className="overflow-hidden rounded-xl border border-blue-100">
            {report.sourceCheckpoints.map((checkpoint) => (
              <div key={`${checkpoint.pageNumber}-${checkpoint.reason}`} className="grid grid-cols-[78px_1fr] border-b border-blue-100 last:border-b-0">
                <div className="bg-blue-50 p-3 font-bold text-brand-600">{checkpoint.pageNumber}P</div>
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

  // ─── 要点ビュー（メイン）───────────────────────────
  const company = report.companyName || fetchResult?.companyName || "手動PDF資料";
  const ticker = report.ticker || fetchResult?.ticker;
  const title = report.sourceDisclosure?.title || "手動PDF資料";

  return (
    <div className="space-y-4">
      {/* ── ① ヘッダー：会社情報 + 判定バッジ ── */}
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-xs font-bold text-slate-500">{ticker ? `銘柄コード ${ticker}` : "銘柄コード 未指定"}</div>
            <div className="text-xl font-bold leading-tight text-slate-950">{company}</div>
            <div className="mt-1 break-words text-sm text-slate-600">{title}</div>
            <div className="mt-1 text-xs text-slate-500">開示: {formatDateTime(report.sourceDisclosure?.disclosedAt)}</div>
          </div>
          <div className="flex flex-col items-end gap-1">
            <StatusBadge tone={verdictTone(dig.verdict)}>{dig.verdictLabel}</StatusBadge>
            <span className="text-xs text-slate-400">信頼度 {report.confidence === "high" ? "高" : report.confidence === "medium" ? "中" : "低"}</span>
          </div>
        </div>
      </Card>

      {/* ── ② TL;DR：1〜2行で結論 ── */}
      <Card>
        <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 text-base font-bold leading-7 text-slate-950">
          {report.oneLineSummary}
        </div>
      </Card>

      {/* ── ③ 主要数値テーブル（実績 + 通期予想） ── */}
      {(dig.keyMetrics.length > 0 || dig.forecastMetrics.length > 0) && (
        <Card title="主要数値">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {dig.keyMetrics.length > 0 && <MetricsTable rows={dig.keyMetrics} caption="実績（前年同期比）" />}
            {dig.forecastMetrics.length > 0 && <MetricsTable rows={dig.forecastMetrics} caption="通期予想（前期比）" />}
          </div>
          {(dig.dividendLine || dig.forecastRevisionLine) && (
            <div className="mt-3 space-y-1 text-sm text-slate-700">
              {dig.forecastRevisionLine && <div>・{dig.forecastRevisionLine}</div>}
              {dig.dividendLine && <div>・{dig.dividendLine}</div>}
            </div>
          )}
        </Card>
      )}

      {/* ── ④ 良い点 / 注意点（2カラム・短文のみ） ── */}
      <Card title="要点">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="rounded-xl border border-green-100 bg-green-50 p-3">
            <div className="mb-2 flex items-center gap-1 text-sm font-bold text-green-700">
              <CheckCircle2 className="h-4 w-4" />
              ポジティブ
            </div>
            <ul className="space-y-1">
              {dig.goodPoints.map((pt) => (
                <li key={pt} className="text-sm leading-5 text-slate-800">・{pt}</li>
              ))}
            </ul>
          </div>
          <div className="rounded-xl border border-orange-100 bg-orange-50 p-3">
            <div className="mb-2 flex items-center gap-1 text-sm font-bold text-orange-700">
              <AlertCircle className="h-4 w-4" />
              注意点
            </div>
            <ul className="space-y-1">
              {dig.concernPoints.map((pt) => (
                <li key={pt} className="text-sm leading-5 text-slate-800">・{pt}</li>
              ))}
            </ul>
          </div>
        </div>
      </Card>

      {/* ── ⑤ その他の検出トピック（1行リスト・該当ページ） ── */}
      {dig.topicSummaries.length > 0 && (
        <Card title="その他の記載">
          <ul className="divide-y divide-blue-100 overflow-hidden rounded-xl border border-blue-100">
            {dig.topicSummaries.map((ts) => (
              <li key={ts.category} className="grid grid-cols-[100px_1fr_auto] items-center gap-2 px-3 py-2 text-sm">
                <span className="font-bold text-brand-600">{ts.category}</span>
                <span className="min-w-0 truncate text-slate-700">{ts.summary}</span>
                {ts.pages.length > 0 && <span className="text-xs font-bold text-slate-500">{ts.pages.slice(0, 3).join("・")}P</span>}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* ── ⑥ 原文確認（上位5件・ページ + 理由のみ） ── */}
      {report.sourceCheckpoints.length > 0 && (
        <Card title="原文を確認すべきページ">
          <ul className="divide-y divide-blue-100 overflow-hidden rounded-xl border border-blue-100">
            {report.sourceCheckpoints.slice(0, 5).map((cp) => (
              <li key={`${cp.pageNumber}-${cp.reason}`} className="grid grid-cols-[70px_1fr] items-center gap-2 px-3 py-2 text-sm">
                <span className="font-bold text-brand-600">{cp.pageNumber}P</span>
                <span className="font-bold text-slate-900">{cp.reason}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* ── ⑦ Cloudflare Workers AI 要約（任意） ── */}
      {report.aiSummary ? (
        <Card title="AI要約（Workers AI）">
          <div className="whitespace-pre-wrap rounded-xl border border-purple-200 bg-purple-50 p-3 text-sm leading-6 text-slate-800">{report.aiSummary}</div>
          <div className="mt-3">
            <OutlineButton onClick={() => onCopy("AI要約", report.aiSummary || "")}>
              <ClipboardCopy className="h-5 w-5" />
              AI要約をコピー
            </OutlineButton>
          </div>
        </Card>
      ) : null}

      {/* ── ⑧ PDF抽出警告（あれば） ── */}
      {pdfWarnings.length ? (
        <Card title="PDF抽出時の警告">
          <ul className="list-disc space-y-1 pl-5 text-sm leading-6 text-slate-700">
            {pdfWarnings.map((w) => <li key={w}>{w}</li>)}
          </ul>
        </Card>
      ) : null}

      {/* ── ⑨ アクション ── */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <PrimaryButton onClick={() => onDetailChange(true)}>詳細を見る</PrimaryButton>
        {report.sourceDisclosure?.pdfUrl ? (
          <OutlineButton onClick={() => window.open(report.sourceDisclosure?.pdfUrl, "_blank", "noopener,noreferrer")}>
            <ExternalLink className="h-5 w-5" />
            PDFを開く
          </OutlineButton>
        ) : (
          <OutlineButton onClick={onBackToFetch}>取得結果へ戻る</OutlineButton>
        )}
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <OutlineButton onClick={() => onCopy("Markdownレポート", markdown)}>
          <ClipboardCopy className="h-5 w-5" />
          Markdownをコピー
        </OutlineButton>
        <OutlineButton onClick={() => onCopy("AI用プロンプト", report.aiPrompt)}>
          <ClipboardCopy className="h-5 w-5" />
          AI用プロンプトをコピー
        </OutlineButton>
      </div>

      {/* ── ⑩ 免責（小さく） ── */}
      <p className="px-1 text-xs leading-5 text-slate-500">{report.disclaimer}</p>
    </div>
  );
}
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         
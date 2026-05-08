import { CheckCircle2, ExternalLink, ListChecks } from "lucide-react";
import type { DisclosureItem } from "../lib/types";
import { formatDateTime } from "../lib/utils";
import { Card, OutlineButton, PrimaryButton, StatusBadge } from "./Card";

export function DisclosureCandidateList({
  candidates,
  selectedId,
  onSelect,
  onAnalyze
}: {
  candidates: DisclosureItem[];
  selectedId?: string;
  onSelect: (item: DisclosureItem) => void;
  onAnalyze: (item: DisclosureItem) => void;
}) {
  if (!candidates.length) {
    return (
      <Card title="候補資料">
        <p className="text-slate-600">候補資料は見つかっていません。</p>
      </Card>
    );
  }

  return (
    <Card title="候補資料" icon={<ListChecks className="h-5 w-5" />}>
      <div className="space-y-3">
        {candidates.slice(0, 8).map((item, index) => {
          const selected = item.id === selectedId;
          return (
            <button
              type="button"
              key={item.id}
              onClick={() => onSelect(item)}
              className={`w-full rounded-xl border p-3 text-left transition ${
                selected ? "border-green-300 bg-green-50" : "border-blue-100 bg-white active:bg-blue-50"
              }`}
            >
              <div className="flex items-start gap-3">
                <div className={`grid h-8 w-8 shrink-0 place-items-center rounded-full text-sm font-bold ${selected ? "bg-green-600 text-white" : "bg-brand-600 text-white"}`}>
                  {selected ? <CheckCircle2 className="h-5 w-5" /> : index + 1}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    {selected ? <StatusBadge tone="green">選定済み</StatusBadge> : null}
                    <StatusBadge tone="blue">スコア {item.score}</StatusBadge>
                  </div>
                  <div className="break-words text-base font-bold text-slate-950">{item.title}</div>
                  <div className="mt-1 text-sm text-slate-500">
                    {item.companyName || "会社名不明"} / {formatDateTime(item.disclosedAt)}
                  </div>
                  <div className="mt-2 text-sm text-slate-600">{item.scoreReasons.slice(0, 2).join("、")}</div>
                </div>
              </div>
            </button>
          );
        })}
      </div>
      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {candidates.find((item) => item.id === selectedId)?.pdfUrl ? (
          <OutlineButton onClick={() => window.open(candidates.find((item) => item.id === selectedId)?.pdfUrl, "_blank", "noopener,noreferrer")}>
            <ExternalLink className="h-5 w-5" />
            PDFを開く
          </OutlineButton>
        ) : null}
        {candidates.find((item) => item.id === selectedId) ? (
          <PrimaryButton onClick={() => onAnalyze(candidates.find((item) => item.id === selectedId)!)}>
            この資料で分析
          </PrimaryButton>
        ) : null}
      </div>
    </Card>
  );
}

import { ChevronRight, Download, Trash2 } from "lucide-react";
import { Card, DangerButton, OutlineButton, StatusBadge } from "../components/Card";
import type { HistoryItem } from "../lib/types";
import { formatDateTime } from "../lib/utils";

export function HistoryPage({
  history,
  filter,
  onFilterChange,
  onOpen,
  onDelete,
  onClear
}: {
  history: HistoryItem[];
  filter: "all" | "success" | "warning";
  onFilterChange: (filter: "all" | "success" | "warning") => void;
  onOpen: (item: HistoryItem) => void;
  onDelete: (id: string) => void;
  onClear: () => void;
}) {
  const filtered = history.filter((item) => {
    if (filter === "success") return item.status === "success";
    if (filter === "warning") return item.warningCount > 0 || item.status === "failed";
    return true;
  });

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        {[
          ["all", "すべて"],
          ["success", "成功"],
          ["warning", "注意あり"]
        ].map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => onFilterChange(key as "all" | "success" | "warning")}
            className={`h-12 rounded-xl border text-base font-bold ${
              filter === key ? "border-brand-600 bg-brand-600 text-white" : "border-brand-600 bg-white text-brand-600"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <Card title="保存済みレポート">
        <div className="space-y-1">
          {filtered.length ? (
            filtered.map((item) => (
              <div key={item.id} className="flex items-center gap-3 border-b border-blue-50 py-3 last:border-b-0">
                <button type="button" onClick={() => onOpen(item)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
                  <div className="grid h-16 w-16 shrink-0 place-items-center rounded-full bg-blue-100 text-lg font-bold text-slate-950">
                    {item.ticker || "PDF"}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="break-words text-lg font-bold text-slate-950">{item.companyName || "手動PDF資料"}</div>
                    <div className="text-sm text-slate-500">{formatDateTime(item.analyzedAt)}</div>
                    <div className="mt-1 line-clamp-2 text-sm text-slate-600">{item.oneLineSummary}</div>
                  </div>
                  <StatusBadge tone={item.warningCount > 0 ? "orange" : "green"}>{item.warningCount > 0 ? "注意あり" : "分析完了"}</StatusBadge>
                  <ChevronRight className="h-6 w-6 shrink-0 text-slate-500" />
                </button>
                <button type="button" aria-label="削除" onClick={() => onDelete(item.id)} className="grid h-10 w-10 shrink-0 place-items-center rounded-xl text-red-500">
                  <Trash2 className="h-5 w-5" />
                </button>
              </div>
            ))
          ) : (
            <p className="text-slate-600">該当する履歴はありません。</p>
          )}
        </div>
      </Card>

      <Card title="履歴操作">
        <div className="space-y-3">
          <OutlineButton onClick={() => navigator.clipboard?.writeText(history.map((item) => item.reportMarkdown).join("\n\n---\n\n"))}>
            <Download className="h-5 w-5" />
            全履歴をエクスポート
          </OutlineButton>
          <DangerButton onClick={onClear}>
            <Trash2 className="h-5 w-5" />
            全履歴を削除
          </DangerButton>
        </div>
      </Card>
    </div>
  );
}

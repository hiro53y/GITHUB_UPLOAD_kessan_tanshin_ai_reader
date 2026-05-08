import { AlertTriangle, CheckCircle2 } from "lucide-react";
import type { WarningItem } from "../lib/types";
import { StatusBadge } from "./Card";

export function WarningCard({ warning }: { warning: WarningItem }) {
  const color = warning.level === "high" ? "text-red-600 bg-red-50" : warning.level === "medium" ? "text-orange-600 bg-orange-50" : "text-green-700 bg-green-50";
  return (
    <div className="rounded-xl border border-blue-100 p-3">
      <div className="flex gap-3">
        <div className={`grid h-11 w-11 shrink-0 place-items-center rounded-xl ${color}`}>
          {warning.level === "low" ? <CheckCircle2 className="h-7 w-7" /> : <AlertTriangle className="h-7 w-7" />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-base font-bold text-slate-950">{warning.label}</h3>
            <StatusBadge tone={warning.level === "high" ? "red" : warning.level === "medium" ? "orange" : "green"}>
              レベル: {warning.level === "high" ? "高" : warning.level === "medium" ? "中" : "低"}
            </StatusBadge>
          </div>
          <p className="mt-1 text-sm text-slate-600">{warning.comment}</p>
          <p className="mt-2 text-sm font-bold text-brand-600">{warning.pages.join("、") || "-"}ページ</p>
        </div>
      </div>
    </div>
  );
}

import { Check, Clock, Loader2, Minus, X } from "lucide-react";
import type { LoadingStep, LoadingStepStatus } from "../lib/types";
import { stepSummary } from "../lib/utils";
import { Card, StatusBadge } from "./Card";

function statusLabel(status: LoadingStepStatus) {
  return {
    waiting: "待機",
    processing: "処理中",
    success: "完了",
    failed: "失敗",
    skipped: "省略"
  }[status];
}

function statusIcon(status: LoadingStepStatus) {
  if (status === "success") return <Check className="h-5 w-5" />;
  if (status === "failed") return <X className="h-5 w-5" />;
  if (status === "processing") return <Loader2 className="h-5 w-5 animate-spin" />;
  if (status === "skipped") return <Minus className="h-5 w-5" />;
  return <Clock className="h-5 w-5" />;
}

function tone(status: LoadingStepStatus): "green" | "blue" | "orange" | "red" | "gray" {
  if (status === "success") return "green";
  if (status === "processing") return "blue";
  if (status === "failed") return "red";
  if (status === "skipped") return "orange";
  return "gray";
}

export function LoadingSteps({ steps, logs = [] }: { steps: LoadingStep[]; logs?: string[] }) {
  const summary = stepSummary(steps);
  const processingIndex = steps.findIndex((step) => step.status === "processing");
  const progress =
    processingIndex >= 0 ? Math.round(((processingIndex + 0.45) / steps.length) * 100) : Math.round((summary.completed / steps.length) * 100);

  return (
    <div className="space-y-4">
      <Card>
        <div className="space-y-4">
          {steps.map((step) => (
            <div key={step.id} className="grid grid-cols-[44px_1fr_auto] items-center gap-3 border-b border-blue-50 pb-3 last:border-b-0 last:pb-0">
              <div
                className={`grid h-9 w-9 place-items-center rounded-full text-sm font-bold ${
                  step.status === "success"
                    ? "bg-green-600 text-white"
                    : step.status === "failed"
                      ? "bg-red-500 text-white"
                      : step.status === "processing"
                        ? "bg-brand-600 text-white"
                        : "bg-slate-200 text-slate-500"
                }`}
              >
                {step.status === "waiting" || step.status === "skipped" ? step.id : statusIcon(step.status)}
              </div>
              <div className="min-w-0">
                <div className={`text-lg font-bold ${step.status === "processing" ? "text-brand-600" : "text-slate-800"}`}>{step.label}</div>
                {step.detail ? <div className="mt-1 text-sm text-slate-500">{step.detail}</div> : null}
                {step.status === "processing" ? (
                  <div className="mt-3 h-3 overflow-hidden rounded-full bg-blue-100">
                    <div className="h-full rounded-full bg-brand-600 transition-all" style={{ width: `${progress}%` }} />
                  </div>
                ) : null}
              </div>
              <StatusBadge tone={tone(step.status)}>{statusLabel(step.status)}</StatusBadge>
            </div>
          ))}
        </div>
      </Card>

      {logs.length ? (
        <Card title="処理ログ">
          <div className="space-y-2">
            {logs.slice(-6).map((log, index) => (
              <div key={`${log}-${index}`} className="rounded-xl bg-blue-50 px-3 py-2 text-sm font-medium text-slate-700">
                {log}
              </div>
            ))}
          </div>
        </Card>
      ) : null}
    </div>
  );
}

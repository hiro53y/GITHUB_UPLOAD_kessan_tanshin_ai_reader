import { Database, ShieldCheck, SlidersHorizontal } from "lucide-react";
import type { AppSettings } from "../lib/types";
import { Card, DangerButton, StatusBadge } from "./Card";

const lookbackOptions = [30, 60, 90, 120, 180, 365] as const;

export function SettingsPanel({
  settings,
  onChange,
  historyCount,
  storageSize,
  onClearHistory
}: {
  settings: AppSettings;
  onChange: (settings: AppSettings) => void;
  historyCount: number;
  storageSize: string;
  onClearHistory: () => void;
}) {
  return (
    <div className="space-y-4">
      <Card title="取得設定" icon={<SlidersHorizontal className="h-5 w-5" />}>
        <div className="space-y-4">
          <label className="block">
            <span className="mb-2 block font-bold text-slate-800">検索期間</span>
            <select
              value={settings.lookbackDays}
              onChange={(event) => onChange({ ...settings, lookbackDays: Number(event.target.value) as AppSettings["lookbackDays"] })}
              className="h-12 w-full rounded-xl border border-blue-200 bg-white px-3 text-base font-bold text-slate-900 outline-none focus:border-brand-600"
            >
              {lookbackOptions.map((days) => (
                <option key={days} value={days}>
                  {days}日
                </option>
              ))}
            </select>
          </label>
          <div className="flex items-center justify-between border-t border-blue-50 pt-4">
            <div>
              <div className="font-bold text-slate-800">TDnet公開ページ取得</div>
              <div className="text-sm text-slate-500">OFF時は手動PDFだけを使います</div>
            </div>
            <button
              type="button"
              onClick={() => onChange({ ...settings, tdnetEnabled: !settings.tdnetEnabled })}
              className={`relative h-9 w-16 rounded-full transition ${settings.tdnetEnabled ? "bg-brand-600" : "bg-slate-300"}`}
              aria-label="TDnet公開ページ取得"
            >
              <span className={`absolute top-1 h-7 w-7 rounded-full bg-white transition ${settings.tdnetEnabled ? "left-8" : "left-1"}`} />
            </button>
          </div>
          <label className="block border-t border-blue-50 pt-4">
            <span className="mb-2 block font-bold text-slate-800">Cloudflare Workers proxy URL</span>
            <input
              value={settings.proxyUrl}
              onChange={(event) => onChange({ ...settings, proxyUrl: event.target.value })}
              placeholder="https://your-worker.your-subdomain.workers.dev"
              className="h-12 w-full rounded-xl border border-blue-200 px-3 text-base outline-none focus:border-brand-600"
            />
          </label>
          <p className="rounded-xl bg-blue-50 p-3 text-sm leading-6 text-slate-600">
            TDnet公開閲覧は掲載期間が限られ、CORSやHTML変更で失敗する場合があります。失敗時は手動PDFアップロードまたはPDF URL貼り付けで続行できます。
          </p>
        </div>
      </Card>

      <Card title="分析設定" icon={<ShieldCheck className="h-5 w-5" />}>
        <div className="space-y-4">
          <div className="flex items-center justify-between border-b border-blue-50 pb-4">
            <span className="font-bold text-slate-800">分析方式</span>
            <StatusBadge tone="blue">標準ルール分析</StatusBadge>
          </div>
          <div className="flex items-center justify-between border-b border-blue-50 pb-4">
            <span className="font-bold text-slate-800">重要語句検出感度</span>
            <div className="grid grid-cols-3 overflow-hidden rounded-xl border border-blue-100 text-sm font-bold">
              {(["low", "standard", "high"] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => onChange({ ...settings, analysisSensitivity: value })}
                  className={`px-4 py-2 ${
                    settings.analysisSensitivity === value ? "bg-brand-600 text-white" : "bg-white text-slate-600"
                  }`}
                >
                  {value === "low" ? "低" : value === "standard" ? "標準" : "高"}
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center justify-between border-b border-blue-50 pb-4">
            <span className="font-bold text-slate-800">原文確認ポイントを表示</span>
            <button
              type="button"
              onClick={() => onChange({ ...settings, showSourceCheckpoints: !settings.showSourceCheckpoints })}
              className={`relative h-9 w-16 rounded-full transition ${settings.showSourceCheckpoints ? "bg-brand-600" : "bg-slate-300"}`}
              aria-label="原文確認ポイント"
            >
              <span className={`absolute top-1 h-7 w-7 rounded-full bg-white transition ${settings.showSourceCheckpoints ? "left-8" : "left-1"}`} />
            </button>
          </div>
          <div className="flex items-center justify-between">
            <div>
              <span className="font-bold text-slate-800">AI要約（Workers AI）</span>
              <div className="text-sm text-slate-500">Cloudflare Workers AI で要約</div>
            </div>
            <button
              type="button"
              onClick={() => onChange({ ...settings, aiSummaryEnabled: !settings.aiSummaryEnabled })}
              className={`relative h-9 w-16 rounded-full transition ${settings.aiSummaryEnabled ? "bg-brand-600" : "bg-slate-300"}`}
              aria-label="AI要約"
            >
              <span className={`absolute top-1 h-7 w-7 rounded-full bg-white transition ${settings.aiSummaryEnabled ? "left-8" : "left-1"}`} />
            </button>
          </div>
          {settings.aiSummaryEnabled && !settings.proxyUrl ? (
            <p className="rounded-xl bg-orange-50 p-3 text-sm leading-6 text-orange-700">
              AI要約を使うには、上の「Cloudflare Workers proxy URL」にWorker URLを入力してください。Workers AIバインディングを有効にしたWorkerが必要です。
            </p>
          ) : null}
          {settings.aiSummaryEnabled && settings.proxyUrl ? (
            <p className="rounded-xl bg-green-50 p-3 text-sm leading-6 text-green-700">
              AI要約が有効です。分析時にCloudflare Workers AI（@cf/meta/llama-3.1-8b-instruct）で要約を生成します。
            </p>
          ) : null}
        </div>
      </Card>

      <Card title="保存データ" icon={<Database className="h-5 w-5" />}>
        <div className="space-y-3">
          <div className="flex justify-between border-b border-blue-50 pb-3">
            <span className="font-bold text-slate-800">履歴件数</span>
            <span className="text-slate-700">{historyCount}件</span>
          </div>
          <div className="flex justify-between border-b border-blue-50 pb-3">
            <span className="font-bold text-slate-800">保存サイズ</span>
            <span className="text-slate-700">{storageSize}</span>
          </div>
          <DangerButton onClick={onClearHistory}>履歴を削除</DangerButton>
        </div>
      </Card>
    </div>
  );
}

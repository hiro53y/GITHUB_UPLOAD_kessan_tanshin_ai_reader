import { ShieldCheck } from "lucide-react";
import { SettingsPanel } from "../components/SettingsPanel";
import { Card } from "../components/Card";
import type { AppSettings } from "../lib/types";
import { APP_BUILD_TAG } from "../lib/utils";

export function SettingsPage({
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
      <SettingsPanel settings={settings} onChange={onChange} historyCount={historyCount} storageSize={storageSize} onClearHistory={onClearHistory} />
      <Card title="免責事項" icon={<ShieldCheck className="h-5 w-5" />}>
        <p className="leading-7 text-slate-700">
          本アプリは、決算資料を読むための補助ツールです。投資助言、売買推奨、将来の株価予測を行うものではありません。抽出結果や分析には誤りが含まれる可能性があります。投資判断を行う場合は、必ず公式資料、TDnet、企業IR、決算短信、有価証券報告書等の原文を確認してください。
        </p>
      </Card>
      <Card title="バージョン情報">
        <div className="space-y-2 text-slate-700">
          <div className="flex justify-between">
            <span className="font-bold">アプリ名</span>
            <span>決算短信AIリーダー</span>
          </div>
          <div className="flex justify-between">
            <span className="font-bold">build</span>
            <span>{APP_BUILD_TAG}</span>
          </div>
          <div className="flex justify-between">
            <span className="font-bold">AI要約</span>
            <span>{settings.aiSummaryEnabled ? "Workers AI（有効）" : "OFF"}</span>
          </div>
        </div>
      </Card>
    </div>
  );
}

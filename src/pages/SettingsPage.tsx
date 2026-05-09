import { ShieldCheck } from "lucide-react";
import { SettingsPanel } from "../components/SettingsPanel";
import { Card } from "../components/Card";
import type { AppSettings } from "../lib/types";

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
          本アプリは、決算資料を読むための補助ツールです。投資助言、売買推奨、将来の株価予測を行うものではありません。抽出・要約は自動処理のため誤差を含む可能性があります。
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
            <span>2026-05-09.5 要約強化版</span>
          </div>
          <div className="flex justify-between">
            <span className="font-bold">外部AI API</span>
            <span>使用しない</span>
          </div>
          <div className="flex justify-between">
            <span className="font-bold">無料AI要約</span>
            <span>端末内処理</span>
          </div>
        </div>
      </Card>
    </div>
  );
}

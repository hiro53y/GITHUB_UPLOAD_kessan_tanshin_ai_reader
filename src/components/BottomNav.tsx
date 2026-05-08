import { BarChart3, FileText, History, Home, Settings } from "lucide-react";

export type NavKey = "home" | "fetch" | "report" | "history" | "settings";

const items = [
  { key: "home", label: "ホーム", icon: Home },
  { key: "fetch", label: "取得結果", icon: FileText },
  { key: "report", label: "レポート", icon: BarChart3 },
  { key: "history", label: "履歴", icon: History },
  { key: "settings", label: "設定", icon: Settings }
] satisfies Array<{ key: NavKey; label: string; icon: typeof Home }>;

export function BottomNav({ active, onChange }: { active: NavKey; onChange: (key: NavKey) => void }) {
  return (
    <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-blue-100 bg-white/95 px-2 pb-[max(env(safe-area-inset-bottom),8px)] pt-2 backdrop-blur">
      <div className="mx-auto grid max-w-xl grid-cols-5">
        {items.map((item) => {
          const Icon = item.icon;
          const selected = active === item.key;
          return (
            <button
              key={item.key}
              type="button"
              onClick={() => onChange(item.key)}
              className={`flex min-h-14 flex-col items-center justify-center gap-1 rounded-xl text-xs font-bold transition ${
                selected ? "text-brand-600" : "text-slate-500"
              }`}
              aria-label={item.label}
            >
              <Icon className={`h-7 w-7 ${selected ? "fill-brand-600/10" : ""}`} strokeWidth={selected ? 2.6 : 2.2} />
              <span>{item.label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}

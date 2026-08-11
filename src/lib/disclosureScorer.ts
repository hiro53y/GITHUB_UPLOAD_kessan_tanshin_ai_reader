import type { DisclosureDocumentType, DisclosureItem } from "./types";
import { tdnetCodeToTicker } from "./utils";

const typeScores: Record<DisclosureDocumentType, { points: number; reason: string }> = {
  earnings_release: { points: 100, reason: "決算短信（第1優先）" },
  earnings_presentation: { points: 60, reason: "決算説明資料（第2優先）" },
  forecast_revision: { points: 20, reason: "業績予想資料" },
  dividend_revision: { points: 10, reason: "配当資料" },
  other: { points: 0, reason: "対象外資料" }
};

const negativeRules: Array<{ keyword: string; points: number; reason: string }> = [
  { keyword: "人事異動", points: -50, reason: "主対象外の「人事異動」を含む" },
  { keyword: "定款", points: -50, reason: "主対象外の「定款」を含む" },
  { keyword: "招集通知", points: -50, reason: "主対象外の「招集通知」を含む" },
  { keyword: "コーポレート・ガバナンス", points: -50, reason: "主対象外の「コーポレート・ガバナンス」を含む" },
  { keyword: "自己株式", points: -30, reason: "主対象外寄りの「自己株式」を含む" },
  { keyword: "月次", points: -20, reason: "主対象外寄りの「月次」を含む" },
  { keyword: "支配株主", points: -30, reason: "主対象外寄りの「支配株主」を含む" },
  { keyword: "大量保有", points: -30, reason: "主対象外寄りの「大量保有」を含む" },
  { keyword: "役員報酬", points: -30, reason: "主対象外寄りの「役員報酬」を含む" },
  { keyword: "譲渡制限付株式報酬", points: -30, reason: "主対象外寄りの株式報酬情報を含む" }
];

function isCorrectionTitle(title: string): boolean {
  return /訂正|差替/.test(title);
}

function isAutoSelectable(item: DisclosureItem): boolean {
  return item.documentType === "earnings_release" || item.documentType === "earnings_presentation";
}

export function classifyDocumentTitle(title: string): DisclosureDocumentType {
  if (/決算短信|四半期決算短信|通期決算短信/.test(title)) return "earnings_release";
  if (/決算説明資料|決算補足説明資料/.test(title)) return "earnings_presentation";
  if (/業績予想の修正|通期業績予想の修正|業績予想|通期業績予想/.test(title)) return "forecast_revision";
  // 配当系：単純な「配当」マッチを避けて、修正/予想/方針に関わる文書のみを分類
  if (/配当予想の修正|配当予想|期末配当|中間配当|剰余金の配当|配当方針|配当性向|株主還元/.test(title)) return "dividend_revision";
  return "other";
}

export function scoreDisclosure(
  item: DisclosureItem,
  input: { ticker: string; companyName?: string; newestDateMs?: number; oldestDateMs?: number }
): DisclosureItem {
  let score = 0;
  const reasons: string[] = [];
  const itemTicker = tdnetCodeToTicker(item.ticker);

  const documentType = classifyDocumentTitle(item.title);
  if (itemTicker && itemTicker === input.ticker) {
    score += 50;
    reasons.push("銘柄コードが一致した（+50）");
  }

  if (input.companyName && item.companyName?.includes(input.companyName)) {
    score += 20;
    reasons.push("会社名補助入力と一致した（+20）");
  }

  const typeScore = typeScores[documentType];
  score += typeScore.points;
  reasons.push(`${typeScore.reason}（+${typeScore.points}）`);

  if (isCorrectionTitle(item.title)) {
    score += 15;
    reasons.push("訂正・差替版を原本より優先（+15）");
  }

  for (const rule of negativeRules) {
    if (item.title.includes(rule.keyword)) {
      score += rule.points;
      reasons.push(`${rule.reason}（${rule.points}）`);
    }
  }

  if (item.disclosedAt && input.newestDateMs && input.oldestDateMs) {
    const dateMs = new Date(item.disclosedAt).getTime();
    const range = Math.max(input.newestDateMs - input.oldestDateMs, 1);
    const freshness = Math.max(0, Math.min(30, Math.round(((dateMs - input.oldestDateMs) / range) * 30)));
    score += freshness;
    reasons.push(`開示日が検索期間内で新しい（+${freshness}）`);
  }

  if (item.pdfUrl) {
    score += 10;
    reasons.push("PDF URLがある（+10）");
  }

  if (item.htmlUrl || item.xbrlUrl) {
    score += 10;
    reasons.push("HTMLまたはXBRLリンクがある（+10）");
  }

  return {
    ...item,
    documentType,
    score,
    scoreReasons: reasons.length ? reasons : ["スコア対象の明確な条件は限定的です"]
  };
}

export function selectBestDisclosure(candidates: DisclosureItem[], ticker?: string): DisclosureItem | undefined {
  const rank: Record<DisclosureDocumentType, number> = {
    earnings_release: 0, earnings_presentation: 1, forecast_revision: 2, dividend_revision: 3, other: 4
  };
  return candidates
    .filter((item) => !ticker || tdnetCodeToTicker(item.ticker) === ticker)
    .filter(isAutoSelectable)
    .sort((a, b) => {
      const type = rank[a.documentType] - rank[b.documentType];
      if (type) return type;
      const correction = Number(isCorrectionTitle(b.title)) - Number(isCorrectionTitle(a.title));
      if (correction) return correction;
      const date = (Date.parse(b.disclosedAt || "") || 0) - (Date.parse(a.disclosedAt || "") || 0);
      if (date) return date;
      const assets = Number(Boolean(b.pdfUrl)) + Number(Boolean(b.xbrlUrl)) - Number(Boolean(a.pdfUrl)) - Number(Boolean(a.xbrlUrl));
      if (assets) return assets;
      return a.id.localeCompare(b.id);
    })[0];
}

export function isCloseDecision(candidates: DisclosureItem[], ticker?: string): boolean {
  const selectable = candidates
    .filter((item) => !ticker || tdnetCodeToTicker(item.ticker) === ticker)
    .filter(isAutoSelectable);
  if (selectable.length < 2) return false;
  const sorted = [...selectable].sort((a, b) => b.score - a.score);
  return sorted[0].score - sorted[1].score <= 10;
}

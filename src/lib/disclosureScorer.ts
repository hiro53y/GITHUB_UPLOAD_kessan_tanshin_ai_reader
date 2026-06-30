import type { DisclosureDocumentType, DisclosureItem } from "./types";
import { tdnetCodeToTicker } from "./utils";

const positiveRules: Array<{ keyword: string; points: number; reason: string }> = [
  { keyword: "決算短信", points: 50, reason: "タイトルに「決算短信」を含む" },
  { keyword: "四半期決算短信", points: 45, reason: "タイトルに「四半期決算短信」を含む" },
  { keyword: "通期決算短信", points: 45, reason: "タイトルに「通期決算短信」を含む" },
  { keyword: "決算説明資料", points: 25, reason: "タイトルに「決算説明資料」を含む" },
  { keyword: "決算補足説明資料", points: 25, reason: "タイトルに「決算補足説明資料」を含む" },
  { keyword: "業績予想の修正", points: 20, reason: "タイトルに「業績予想の修正」を含む" },
  { keyword: "配当予想の修正", points: 15, reason: "タイトルに「配当予想の修正」を含む" }
];

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

  if (itemTicker && itemTicker === input.ticker) {
    score += 50;
    reasons.push("銘柄コードが一致した（+50）");
  }

  if (input.companyName && item.companyName?.includes(input.companyName)) {
    score += 20;
    reasons.push("会社名補助入力と一致した（+20）");
  }

  for (const rule of positiveRules) {
    if (item.title.includes(rule.keyword)) {
      score += rule.points;
      reasons.push(`${rule.reason}（+${rule.points}）`);
    }
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
    documentType: classifyDocumentTitle(item.title),
    score,
    scoreReasons: reasons.length ? reasons : ["スコア対象の明確な条件は限定的です"]
  };
}

export function selectBestDisclosure(candidates: DisclosureItem[]): DisclosureItem | undefined {
  return [...candidates].sort((a, b) => b.score - a.score)[0];
}

export function isCloseDecision(candidates: DisclosureItem[]): boolean {
  if (candidates.length < 2) return false;
  const sorted = [...candidates].sort((a, b) => b.score - a.score);
  return sorted[0].score - sorted[1].score <= 10;
}

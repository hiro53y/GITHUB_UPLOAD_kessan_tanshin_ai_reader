import { unzipSync, strFromU8 } from "fflate";
import { XMLParser } from "fast-xml-parser";
import { fetchArrayBufferWithFallback } from "./utils";

/**
 * TDnet 決算短信XBRL（zip）から業績数値を抽出する。
 *
 * ## 設計メモ
 * - TDnet短信XBRLは Summary（経営成績の数値要素のみが定義された軽量XBRL）と
 *   Attachment（財務諸表本体）に分かれる。本実装は Summary を優先（高速で必要十分）。
 * - 要素名は `tse-ed-t:NetSales` 等、日本基準と IFRS（Revenues / OperatingProfit）の両方を拾う。
 * - 文脈（contextRef）から「当期/前期/予想」を判定する。
 *   - 当期実績: contextRef に Current* + Duration、Forecast なし
 *   - 前期実績: contextRef に Prior + Duration
 *   - 通期予想: contextRef に Forecast を含む
 * - decimals 属性（-6=百万円、-3=千円、0=円）から単位を推定。
 */

export type XbrlMetricRow = {
  period: string;
  sales: string;
  salesGrowth: string;
  operatingProfit: string;
  operatingProfitGrowth: string;
  ordinaryProfit: string;
  ordinaryProfitGrowth: string;
  netProfit: string;
  netProfitGrowth: string;
};

export type XbrlForecastRow = Omit<XbrlMetricRow, "period">;

export type XbrlExtractResult = {
  ok: boolean;
  performance?: XbrlMetricRow;
  forecast?: XbrlForecastRow;
  prior?: XbrlMetricRow;
  unit: "百万円" | "千円" | "円";
  xbrlFileName?: string;
  source: "summary" | "attachment" | "mixed" | "none";
  error?: string;
};

type ContextKind = "current" | "prior" | "forecastFull" | "forecastNext" | "other";

const ELEMENT_ALIASES = {
  sales: ["NetSales", "Revenues", "OperatingRevenues", "OperatingRevenuesUS", "OperatingRevenuesIFRS"],
  operatingProfit: ["OperatingIncome", "OperatingProfit", "OperatingProfitIFRS"],
  ordinaryProfit: ["OrdinaryIncome", "OrdinaryProfit", "ProfitBeforeTaxIFRS", "ProfitBeforeTax"],
  netProfit: [
    "ProfitLoss",
    "NetIncome",
    "ProfitAttributableToOwnersOfParent",
    "NetIncomeAttributableToOwnersOfParent",
    "ProfitLossAttributableToOwnersOfParentIFRS"
  ]
} as const;

const GROWTH_RATE_ELEMENTS = {
  sales: ["ChangeInNetSales", "ChangeInRevenues", "PercentageOfChangeInNetSales", "PercentageOfChangeInRevenues"],
  operatingProfit: ["ChangeInOperatingIncome", "ChangeInOperatingProfit", "PercentageOfChangeInOperatingIncome"],
  ordinaryProfit: ["ChangeInOrdinaryIncome", "ChangeInOrdinaryProfit", "PercentageOfChangeInOrdinaryIncome"],
  netProfit: [
    "ChangeInProfitLoss",
    "ChangeInNetIncome",
    "ChangeInProfitAttributableToOwnersOfParent",
    "PercentageOfChangeInProfitLoss"
  ]
} as const;

function classifyContext(ref: string): ContextKind {
  const hasForecast = /Forecast/i.test(ref);
  const isDuration = /Duration/i.test(ref);
  if (!isDuration) return "other";
  if (hasForecast) {
    if (/Next/i.test(ref)) return "forecastNext";
    return "forecastFull";
  }
  if (/Prior/i.test(ref)) return "prior";
  if (/Current/i.test(ref)) return "current";
  return "other";
}

function localName(name: string): string {
  const colon = name.indexOf(":");
  return colon >= 0 ? name.slice(colon + 1) : name;
}

function unitFromDecimals(decimals?: string): "百万円" | "千円" | "円" | undefined {
  if (!decimals) return undefined;
  const n = Number(decimals);
  if (!Number.isFinite(n)) return undefined;
  if (n === -6) return "百万円";
  if (n === -3) return "千円";
  if (n >= 0) return "円";
  return undefined;
}

function convertToUnit(rawValue: string, fromUnit: "百万円" | "千円" | "円", toUnit: "百万円" | "千円" | "円"): string {
  const num = Number(rawValue);
  if (!Number.isFinite(num)) return rawValue;
  const fromYen = fromUnit === "百万円" ? 1_000_000 : fromUnit === "千円" ? 1_000 : 1;
  const toYen = toUnit === "百万円" ? 1_000_000 : toUnit === "千円" ? 1_000 : 1;
  const yen = num * fromYen;
  const converted = yen / toYen;
  if (Math.abs(converted) >= 1) return Math.round(converted).toString();
  return converted.toFixed(2);
}

type FactEntry = {
  element: string;
  contextRef: string;
  unitRef?: string;
  decimals?: string;
  value: string;
};

function collectFacts(xmlObj: any): FactEntry[] {
  const facts: FactEntry[] = [];
  const collectOne = (_fullKey: string, ln: string, val: any, out: FactEntry[]) => {
    if (!val || typeof val !== "object") return;
    const ctx = val["@_contextRef"];
    if (typeof ctx !== "string") return;
    const raw = val["#text"] ?? val.value ?? "";
    const valueStr = typeof raw === "string" || typeof raw === "number" ? String(raw) : "";
    if (!valueStr) return;
    out.push({
      element: ln,
      contextRef: ctx,
      unitRef: typeof val["@_unitRef"] === "string" ? val["@_unitRef"] : undefined,
      decimals: typeof val["@_decimals"] === "string" ? val["@_decimals"] : undefined,
      value: valueStr
    });
  };
  const visit = (node: any) => {
    if (node === null || node === undefined) return;
    if (typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const item of node) visit(item);
      return;
    }
    for (const [key, val] of Object.entries(node)) {
      if (key.startsWith("@_") || key === "#text") continue;
      const ln = localName(key);
      if (Array.isArray(val)) {
        for (const v of val) collectOne(key, ln, v, facts);
      } else if (val && typeof val === "object") {
        collectOne(key, ln, val, facts);
        visit(val);
      }
    }
  };
  const root = xmlObj.xbrl ?? xmlObj["xbrli:xbrl"] ?? xmlObj;
  visit(root);
  return facts;
}

function pickValue(facts: FactEntry[], elementNames: readonly string[], kind: ContextKind): FactEntry | undefined {
  for (const name of elementNames) {
    const matched = facts.find((f) => f.element === name && classifyContext(f.contextRef) === kind);
    if (matched) return matched;
  }
  return undefined;
}

function periodLabelFromContext(ref: string): string {
  const qMatch = ref.match(/Q([1-4])/);
  if (qMatch) return `第${qMatch[1]}四半期`;
  return "当期";
}

function getGrowthRate(facts: FactEntry[], kind: ContextKind, group: keyof typeof GROWTH_RATE_ELEMENTS): string {
  const entry = pickValue(facts, GROWTH_RATE_ELEMENTS[group], kind);
  if (!entry) return "0";
  return entry.value;
}

function findSummaryXbrl(entries: Record<string, Uint8Array>): { name: string; data: Uint8Array } | undefined {
  const xbrlFiles = Object.entries(entries).filter(([name]) => /\.xbrl$/i.test(name));
  if (!xbrlFiles.length) {
    const ixbrl = Object.entries(entries).find(([name]) => /Summary\/.+\.htm/i.test(name));
    return ixbrl ? { name: ixbrl[0], data: ixbrl[1] } : undefined;
  }
  const summary = xbrlFiles.find(([name]) => /Summary/i.test(name));
  const target = summary || xbrlFiles[0];
  return { name: target[0], data: target[1] };
}

function parseFacts(xmlText: string): FactEntry[] {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    textNodeName: "#text",
    parseAttributeValue: false,
    parseTagValue: false,
    trimValues: true,
    allowBooleanAttributes: true
  });
  const obj = parser.parse(xmlText);
  return collectFacts(obj);
}

/**
 * XBRL zip URL を取得し、業績/予想を抽出する。
 */
export async function extractXbrlMetrics(url: string, signal?: AbortSignal): Promise<XbrlExtractResult> {
  try {
    const buf = await fetchArrayBufferWithFallback(url, signal);
    const u8 = new Uint8Array(buf);
    const entries = unzipSync(u8, {
      filter: (file) => /\.(xbrl|xml|htm|html)$/i.test(file.name)
    });

    const target = findSummaryXbrl(entries);
    if (!target) {
      return { ok: false, unit: "百万円", source: "none", error: "XBRL ファイルが zip 内に見つかりませんでした" };
    }

    const xmlText = strFromU8(target.data);
    const facts = parseFacts(xmlText);
    if (!facts.length) {
      return { ok: false, unit: "百万円", source: "none", error: "XBRL fact が抽出できませんでした", xbrlFileName: target.name };
    }

    const decimalsCount: Record<string, number> = {};
    for (const f of facts) {
      const u = unitFromDecimals(f.decimals);
      if (u) decimalsCount[u] = (decimalsCount[u] || 0) + 1;
    }
    const detectedUnit =
      (Object.entries(decimalsCount).sort((a, b) => b[1] - a[1])[0]?.[0] as "百万円" | "千円" | "円" | undefined) || "百万円";

    const extractRow = (kind: ContextKind): XbrlMetricRow | undefined => {
      const sales = pickValue(facts, ELEMENT_ALIASES.sales, kind);
      const op = pickValue(facts, ELEMENT_ALIASES.operatingProfit, kind);
      const ord = pickValue(facts, ELEMENT_ALIASES.ordinaryProfit, kind);
      const net = pickValue(facts, ELEMENT_ALIASES.netProfit, kind);
      if (!sales && !op && !ord && !net) return undefined;
      const toDisplay = (entry?: FactEntry) =>
        entry ? convertToUnit(entry.value, unitFromDecimals(entry.decimals) || detectedUnit, detectedUnit) : "";
      return {
        period: sales ? periodLabelFromContext(sales.contextRef) : "当期",
        sales: toDisplay(sales),
        salesGrowth: getGrowthRate(facts, kind, "sales"),
        operatingProfit: toDisplay(op),
        operatingProfitGrowth: getGrowthRate(facts, kind, "operatingProfit"),
        ordinaryProfit: toDisplay(ord),
        ordinaryProfitGrowth: getGrowthRate(facts, kind, "ordinaryProfit"),
        netProfit: toDisplay(net),
        netProfitGrowth: getGrowthRate(facts, kind, "netProfit")
      };
    };

    const extractForecastRow = (): XbrlForecastRow | undefined => {
      for (const kind of ["forecastFull", "forecastNext"] as const) {
        const row = extractRow(kind);
        if (row) {
          const { period: _period, ...rest } = row;
          return rest;
        }
      }
      return undefined;
    };

    const performance = extractRow("current");
    const prior = extractRow("prior");
    const forecast = extractForecastRow();

    const ok = Boolean(performance || forecast);
    return {
      ok,
      performance,
      forecast,
      prior,
      unit: detectedUnit,
      xbrlFileName: target.name,
      source: ok ? "summary" : "none"
    };
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    return {
      ok: false,
      unit: "百万円",
      source: "none",
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

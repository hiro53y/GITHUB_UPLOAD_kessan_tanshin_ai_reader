import { unzipSync, strFromU8 } from "fflate";
import { XMLParser } from "fast-xml-parser";
import { fetchArrayBufferWithFallback } from "./utils";

export type XbrlMetricRow = {
  period: string; sales: string; salesGrowth: string; operatingProfit: string; operatingProfitGrowth: string;
  ordinaryProfit: string; ordinaryProfitGrowth: string; netProfit: string; netProfitGrowth: string;
  source?: "summary" | "attachment" | "mixed";
  context?: string; contextKind?: ContextKind; periodStart?: string; periodEnd?: string; instant?: string;
  consolidation?: "consolidated" | "non_consolidated" | "unknown";
  quality?: "high" | "medium" | "low"; uncertainty?: string[];
};
export type XbrlForecastRow = Omit<XbrlMetricRow, "period">;
export type XbrlExtractResult = {
  ok: boolean; performance?: XbrlMetricRow; forecast?: XbrlForecastRow; prior?: XbrlMetricRow;
  unit: "百万円" | "千円" | "円"; xbrlFileName?: string; source: "summary" | "attachment" | "mixed" | "none";
  contexts?: XbrlContext[]; error?: string;
};

export type ContextKind = "current" | "prior" | "forecastFull" | "forecastNext" | "other";
export type XbrlContext = {
  id: string; kind: ContextKind; startDate?: string; endDate?: string; instant?: string;
  dimensions: string[]; consolidation: "consolidated" | "non_consolidated" | "unknown";
};
type Unit = { id: string; measure?: string; displayUnit?: "百万円" | "千円" | "円" };
type FactEntry = { element: string; contextRef: string; unitRef?: string; decimals?: string; value: string };

const ELEMENT_ALIASES = {
  sales: ["NetSales", "Revenues", "OperatingRevenues", "OperatingRevenuesUS", "OperatingRevenuesIFRS"],
  operatingProfit: ["OperatingIncome", "OperatingProfit", "OperatingProfitIFRS"],
  ordinaryProfit: ["OrdinaryIncome", "OrdinaryProfit", "ProfitBeforeTaxIFRS", "ProfitBeforeTax"],
  netProfit: ["ProfitLoss", "NetIncome", "ProfitAttributableToOwnersOfParent", "NetIncomeAttributableToOwnersOfParent", "ProfitLossAttributableToOwnersOfParentIFRS"]
} as const;
const GROWTH_RATE_ELEMENTS = {
  sales: ["ChangeInNetSales", "ChangeInRevenues", "PercentageOfChangeInNetSales", "PercentageOfChangeInRevenues"],
  operatingProfit: ["ChangeInOperatingIncome", "ChangeInOperatingProfit", "PercentageOfChangeInOperatingIncome"],
  ordinaryProfit: ["ChangeInOrdinaryIncome", "ChangeInOrdinaryProfit", "PercentageOfChangeInOrdinaryIncome"],
  netProfit: ["ChangeInProfitLoss", "ChangeInNetIncome", "ChangeInProfitAttributableToOwnersOfParent", "PercentageOfChangeInProfitLoss"]
} as const;

function localName(name: string) { return name.includes(":") ? name.slice(name.indexOf(":") + 1) : name; }
function values(value: any): any[] { return Array.isArray(value) ? value : value === undefined ? [] : [value]; }
function textOf(value: any): string | undefined { const v = value?.["#text"] ?? value; return typeof v === "string" || typeof v === "number" ? String(v) : undefined; }
function contextKind(id: string): ContextKind {
  if (/Forecast/i.test(id)) return /Next/i.test(id) ? "forecastNext" : "forecastFull";
  if (/Prior/i.test(id)) return "prior";
  if (/Current/i.test(id)) return "current";
  return "other";
}
function consolidation(id: string, dimensions: string[]): XbrlContext["consolidation"] {
  // Axis名にNonConsolidatedを含むだけで連結を個別と誤認しないよう、member値を優先する。
  const members = dimensions.map((dimension) => dimension.split("=").slice(1).join("=")).join(" ");
  if (/Non.?ConsolidatedMember|Individual|Separate/i.test(members)) return "non_consolidated";
  if (/ConsolidatedMember/i.test(members)) return "consolidated";
  if (/Non.?Consolidated|Individual|Separate/i.test(id)) return "non_consolidated";
  if (/Consolidated|Consolidation/i.test(id)) return "consolidated";
  return "unknown";
}
function findByLocal(node: any, wanted: string): any[] {
  if (!node || typeof node !== "object") return [];
  if (Array.isArray(node)) return node.flatMap((v) => findByLocal(v, wanted));
  return Object.entries(node).flatMap(([key, value]) => localName(key) === wanted ? values(value) : findByLocal(value, wanted));
}
function parseContexts(root: any): XbrlContext[] {
  return findByLocal(root, "context").map((node) => {
    const period = findByLocal(node, "period")[0] ?? {};
    const dimensions = findByLocal(node, "explicitMember").map((v) => `${v?.["@_dimension"] ?? ""}=${textOf(v) ?? ""}`).filter(Boolean);
    const id = String(node?.["@_id"] ?? "");
    return { id, kind: contextKind(id), startDate: textOf(findByLocal(period, "startDate")[0]), endDate: textOf(findByLocal(period, "endDate")[0]), instant: textOf(findByLocal(period, "instant")[0]), dimensions, consolidation: consolidation(id, dimensions) };
  }).filter((c) => c.id);
}
function parseUnits(root: any): Unit[] {
  return findByLocal(root, "unit").map((node) => {
    const measure = textOf(findByLocal(node, "measure")[0]);
    const displayUnit: Unit["displayUnit"] = /JPY|iso4217:JPY/i.test(measure ?? "") ? "百万円" : undefined;
    return { id: String(node?.["@_id"] ?? ""), measure, displayUnit };
  }).filter((u) => u.id);
}
function collectFacts(root: any): FactEntry[] {
  const facts: FactEntry[] = [];
  const visit = (node: any) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) { node.forEach(visit); return; }
    for (const [key, value] of Object.entries(node)) {
      if (key.startsWith("@_") || key === "#text" || ["context", "unit", "schemaRef"].includes(localName(key))) continue;
      for (const item of values(value)) {
        if (item && typeof item === "object" && typeof item["@_contextRef"] === "string") {
          const valueText = textOf(item);
          if (valueText) facts.push({ element: localName(key), contextRef: item["@_contextRef"], unitRef: item["@_unitRef"], decimals: item["@_decimals"], value: valueText });
        }
        visit(item);
      }
    }
  };
  visit(root); return facts;
}
function parser() { return new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_", textNodeName: "#text", parseAttributeValue: false, parseTagValue: false, trimValues: true, allowBooleanAttributes: true }); }
function parseDocument(xml: string) { const obj = parser().parse(xml); const root = obj.xbrl ?? obj["xbrli:xbrl"] ?? obj; return { facts: collectFacts(root), contexts: parseContexts(root), units: parseUnits(root) }; }
function parseIxbrl(html: string): FactEntry[] {
  const facts: FactEntry[] = []; const re = /<(?:ix:)?(nonFraction|nonNumeric)\b([^>]*)>([\s\S]*?)<\/(?:ix:)?\1>/gi;
  for (const match of html.matchAll(re)) {
    const attr = (name: string) => match[2].match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']+)["']`, "i"))?.[1];
    const name = attr("name"), contextRef = attr("contextRef"); let value = match[3].replace(/<[^>]*>/g, "").replace(/,/g, "").trim();
    if (!name || !contextRef || !value) continue;
    const scale = Number(attr("scale") ?? 0); if (Number.isFinite(scale) && scale) { const n = Number(value); if (Number.isFinite(n)) value = String(n * 10 ** scale); }
    if (attr("sign") === "-") value = `-${value}`;
    facts.push({ element: localName(name), contextRef, unitRef: attr("unitRef"), decimals: attr("decimals"), value });
  } return facts;
}
function unitForFact(fact: FactEntry | undefined, units: Unit[]) { return fact?.unitRef ? units.find((unit) => unit.id === fact.unitRef) : undefined; }
function toDisplay(value: string, unit: Unit | undefined, target: XbrlExtractResult["unit"]) {
  const n = Number(value); if (!Number.isFinite(n)) return value;
  // decimals は精度属性であり換算に利用しない。通貨は unitRef/xbrli:unit がJPYと確認できた場合だけ圧縮する。
  if (unit?.displayUnit === "百万円" && target === "百万円") return String(Math.round(n / 1_000_000));
  return String(Math.round(n));
}
function factFor(facts: FactEntry[], aliases: readonly string[]) { return facts.find((fact) => aliases.includes(fact.element as never)); }
function nonConsolidationDimensions(context: XbrlContext): string[] {
  return context.dimensions.filter((dimension) => !/ConsolidatedOrNonConsolidatedAxis/i.test(dimension));
}
function rankedContexts(contexts: XbrlContext[], facts: FactEntry[], kind: ContextKind) {
  const candidates = contexts.filter((context) => context.kind === kind);
  return candidates.sort((a, b) => {
    const score = (c: XbrlContext) => Object.values(ELEMENT_ALIASES).filter((aliases) => factFor(facts.filter((fact) => fact.contextRef === c.id), aliases)).length + (c.consolidation === "consolidated" ? 0.2 : 0);
    const consolidationRank = (context: XbrlContext) => context.consolidation === "consolidated" ? 2 : context.consolidation === "non_consolidated" ? 1 : 0;
    const durationDays = (context: XbrlContext) => {
      const start = Date.parse(context.startDate || "");
      const end = Date.parse(context.endDate || "");
      return Number.isFinite(start) && Number.isFinite(end) ? Math.max(0, end - start) : 0;
    };
    const durationPreference = kind === "current" || kind === "prior" ? durationDays(b) - durationDays(a) : 0;
    // セグメント・地域等のdimension付きcontextを全社総額として採らない。
    // 連結/個別区分だけのdimensionは総額contextとして許容する。
    return nonConsolidationDimensions(a).length - nonConsolidationDimensions(b).length
      || consolidationRank(b) - consolidationRank(a)
      || durationPreference
      || score(b) - score(a)
      || b.endDate?.localeCompare(a.endDate ?? "")
      || a.id.localeCompare(b.id);
  });
}
function inferredKind(context: XbrlContext, contexts: XbrlContext[]): ContextKind {
  if (context.kind !== "other" || !context.endDate || context.instant) return context.kind;
  const durations = contexts.filter((c) => c.endDate && !c.instant).sort((a, b) => (b.endDate ?? "").localeCompare(a.endDate ?? ""));
  if (durations[0]?.id === context.id) return "current";
  if (durations[1]?.id === context.id) return "prior";
  return "other";
}
function buildRow(kind: ContextKind, contexts: XbrlContext[], facts: FactEntry[], units: Unit[], displayUnit: XbrlExtractResult["unit"], source: XbrlMetricRow["source"]): XbrlMetricRow | undefined {
  const normalized = contexts.map((c) => ({ ...c, kind: inferredKind(c, contexts) }));
  const selected = rankedContexts(normalized, facts, kind)[0]; if (!selected) return undefined;
  const inContext = facts.filter((fact) => fact.contextRef === selected.id);
  const pick = (aliases: readonly string[]) => factFor(inContext, aliases);
  const sales = pick(ELEMENT_ALIASES.sales), op = pick(ELEMENT_ALIASES.operatingProfit), ord = pick(ELEMENT_ALIASES.ordinaryProfit), net = pick(ELEMENT_ALIASES.netProfit);
  if (!sales && !op && !ord && !net) return undefined;
  const uncertainty: string[] = [];
  const monetary = [sales, op, ord, net].filter(Boolean) as FactEntry[];
  if (monetary.length < 3) uncertainty.push("同一contextで確認できる主要指標が3項目未満です");
  if (monetary.some((fact) => !unitForFact(fact, units)?.displayUnit)) uncertainty.push("unitRefがJPYとして確認できないため、値を自動換算していません");
  if (selected.consolidation === "unknown") uncertainty.push("連結・個別区分をcontextから確定できません");
  if (nonConsolidationDimensions(selected).length) uncertainty.push("セグメント等のdimensionを含むcontextのため、全社値として確定できません");
  const value = (fact?: FactEntry) => fact ? toDisplay(fact.value, unitForFact(fact, units), displayUnit) : "";
  // 成長率factが存在しないことと、0%（横ばい）は別物。欠損を0で補完しない。
  const growth = (group: keyof typeof GROWTH_RATE_ELEMENTS) => pick(GROWTH_RATE_ELEMENTS[group])?.value ?? "";
  return { period: selected.endDate ?? selected.instant ?? "当期", sales: value(sales), salesGrowth: growth("sales"), operatingProfit: value(op), operatingProfitGrowth: growth("operatingProfit"), ordinaryProfit: value(ord), ordinaryProfitGrowth: growth("ordinaryProfit"), netProfit: value(net), netProfitGrowth: growth("netProfit"), source, context: selected.id, contextKind: kind, periodStart: selected.startDate, periodEnd: selected.endDate, instant: selected.instant, consolidation: selected.consolidation, quality: uncertainty.length ? "medium" : "high", uncertainty };
}
type SourceFile = { name: string; data: Uint8Array; kind: "xbrl" | "ixbrl" };
type ParsedSourceFile = SourceFile & {
  facts: FactEntry[];
  contexts: XbrlContext[];
  units: Unit[];
  source: "summary" | "attachment";
};
type EvaluatedSourceFile = ParsedSourceFile & {
  performance?: XbrlMetricRow;
  prior?: XbrlMetricRow;
  forecast?: XbrlMetricRow;
};

function findSourceFiles(entries: Record<string, Uint8Array>): SourceFile[] {
  const candidates = Object.entries(entries).flatMap(([name, data]): SourceFile[] => {
    if (/\.xbrl$/i.test(name)) return [{ name, data, kind: "xbrl" }];
    if (/\.(?:htm|html)$/i.test(name)) return [{ name, data, kind: "ixbrl" }];
    return [];
  });
  return candidates.sort((a, b) => {
    const summary = Number(/Summary/i.test(b.name)) - Number(/Summary/i.test(a.name));
    if (summary) return summary;
    const nativeXbrl = Number(b.kind === "xbrl") - Number(a.kind === "xbrl");
    return nativeXbrl || a.name.localeCompare(b.name);
  });
}

function rowMetricCount(row: XbrlMetricRow | undefined): number {
  if (!row) return 0;
  return [row.sales, row.operatingProfit, row.ordinaryProfit, row.netProfit].filter((value) => value !== "").length;
}

function rowQualityRank(row: XbrlMetricRow | undefined): number {
  return row?.quality === "high" ? 3 : row?.quality === "medium" ? 2 : row ? 1 : 0;
}

function selectBestRow(
  files: EvaluatedSourceFile[],
  select: (file: EvaluatedSourceFile) => XbrlMetricRow | undefined
): { file: EvaluatedSourceFile; row: XbrlMetricRow } | undefined {
  return files
    .flatMap((file) => {
      const row = select(file);
      return row ? [{ file, row }] : [];
    })
    .sort((a, b) => rowQualityRank(b.row) - rowQualityRank(a.row)
      || rowMetricCount(b.row) - rowMetricCount(a.row)
      || Number(b.file.source === "summary") - Number(a.file.source === "summary")
      || a.file.name.localeCompare(b.file.name))[0];
}

export async function extractXbrlMetrics(url: string, signal?: AbortSignal): Promise<XbrlExtractResult> {
  try {
    const buffer = await fetchArrayBufferWithFallback(url, signal);
    const entries = unzipSync(new Uint8Array(buffer), { filter: (file) => /\.(xbrl|xml|htm|html)$/i.test(file.name) });
    const targets = findSourceFiles(entries);
    if (!targets.length) return { ok: false, unit: "百万円", source: "none", error: "XBRL ファイルが zip 内に見つかりませんでした" };

    const parsed: ParsedSourceFile[] = targets.flatMap((target) => {
      const text = strFromU8(target.data);
      const document = parseDocument(text);
      const facts = target.kind === "ixbrl" ? parseIxbrl(text) : document.facts;
      if (!facts.length) return [];
      return [{
        ...target,
        facts,
        contexts: document.contexts,
        units: document.units,
        source: /Summary/i.test(target.name) ? "summary" as const : "attachment" as const
      }];
    });
    if (!parsed.length) return { ok: false, unit: "百万円", source: "none", xbrlFileName: targets[0].name, error: "XBRL/iXBRL fact が抽出できませんでした" };

    // 採用候補間で単位を統一する。JPYを確認できる候補は全て百万円表示へ正規化する。
    const unit: XbrlExtractResult["unit"] = parsed.some((file) =>
      file.units.some((item) => item.displayUnit === "百万円") || file.facts.some((fact) => fact.unitRef === "JPY")
    ) ? "百万円" : "円";
    const evaluated: EvaluatedSourceFile[] = parsed.map((file) => ({
      ...file,
      performance: buildRow("current", file.contexts, file.facts, file.units, unit, file.source),
      prior: buildRow("prior", file.contexts, file.facts, file.units, unit, file.source),
      forecast: buildRow("forecastFull", file.contexts, file.facts, file.units, unit, file.source)
        ?? buildRow("forecastNext", file.contexts, file.facts, file.units, unit, file.source)
    }));

    // Summaryを無条件に固定せず、品質→主要指標の完全性→Summaryの順で選ぶ。
    // これにより不完全なSummaryしかない場合は完全なAttachmentへ安全にfallbackする。
    const selectedPerformance = selectBestRow(evaluated, (file) => file.performance);
    const selectedPrior = selectBestRow(evaluated, (file) => file.prior);
    const selectedForecast = selectBestRow(evaluated, (file) => file.forecast);
    const performance = selectedPerformance?.row;
    const prior = selectedPrior?.row;
    const forecast = selectedForecast?.row
      ? (({ period: _period, ...rest }) => rest)(selectedForecast.row)
      : undefined;
    const selected = [selectedPerformance, selectedForecast].filter(Boolean) as Array<{ file: EvaluatedSourceFile; row: XbrlMetricRow }>;
    const selectedSources = new Set(selected.map((item) => item.file.source));
    const source: XbrlExtractResult["source"] = !selected.length
      ? "none"
      : selectedSources.size > 1 ? "mixed" : selected[0].file.source;
    const selectedFiles = Array.from(new Set([selectedPerformance?.file, selectedPrior?.file, selectedForecast?.file].filter(Boolean) as EvaluatedSourceFile[]));
    const xbrlFileName = selectedFiles.map((file) => file.name).join(" + ") || parsed[0].name;
    const contexts = selectedFiles.flatMap((file) => file.contexts);
    return { ok: Boolean(performance || forecast), performance, prior, forecast, unit, xbrlFileName, source, contexts };
  } catch (error) { if (error instanceof DOMException && error.name === "AbortError") throw error; return { ok: false, unit: "百万円", source: "none", error: error instanceof Error ? error.message : String(error) }; }
}

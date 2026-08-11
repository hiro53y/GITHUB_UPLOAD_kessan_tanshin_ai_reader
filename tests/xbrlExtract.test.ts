import { describe, expect, it, vi } from "vitest";
import { zipSync, strToU8 } from "fflate";

// extractXbrlMetrics は ./utils の fetchArrayBufferWithFallback でzipを取得するため、
// その関数だけをモックして、合成したiXBRL zipを返す。
const mockFetchArrayBuffer = vi.fn();
vi.mock("../src/lib/utils", () => ({
  fetchArrayBufferWithFallback: (...args: unknown[]) => mockFetchArrayBuffer(...args)
}));

import { extractXbrlMetrics } from "../src/lib/xbrlExtract";

function buildIxbrlZip(): ArrayBuffer {
  // 実例準拠: scale="6" decimals="-6"、表示値は百万円単位。実額は 表示値 × 10^6 = 円全額。
  const ixbrl = `<!DOCTYPE html><html><body>
    <xbrli:context id="CurrentYearDuration"><xbrli:entity><xbrli:identifier scheme="test">1</xbrli:identifier></xbrli:entity><xbrli:period><xbrli:startDate>2025-04-01</xbrli:startDate><xbrli:endDate>2026-03-31</xbrli:endDate></xbrli:period></xbrli:context>
    <xbrli:context id="PriorYearDuration"><xbrli:entity><xbrli:identifier scheme="test">1</xbrli:identifier></xbrli:entity><xbrli:period><xbrli:startDate>2024-04-01</xbrli:startDate><xbrli:endDate>2025-03-31</xbrli:endDate></xbrli:period></xbrli:context>
    <xbrli:unit id="JPY"><xbrli:measure>iso4217:JPY</xbrli:measure></xbrli:unit>
    <ix:nonFraction name="tse-ed-t:NetSales" contextRef="CurrentYearDuration" unitRef="JPY" decimals="-6" scale="6">12,345</ix:nonFraction>
    <ix:nonFraction name="tse-ed-t:OperatingIncome" contextRef="CurrentYearDuration" unitRef="JPY" decimals="-6" scale="6">1,000</ix:nonFraction>
    <ix:nonFraction name="tse-ed-t:NetSales" contextRef="PriorYearDuration" unitRef="JPY" decimals="-6" scale="6">10,000</ix:nonFraction>
  </body></html>`;
  const zipped = zipSync({ "XBRLData/Summary/tse-ed-t-ixbrl.htm": strToU8(ixbrl) });
  return zipped.buffer.slice(zipped.byteOffset, zipped.byteOffset + zipped.byteLength) as ArrayBuffer;
}

describe("extractXbrlMetrics の単位換算（1,000,000倍過大バグの回帰防止）", () => {
  it("scale=6/decimals=-6 のiXBRLを百万円表示へ正しく圧縮する（円全額のまま渡さない）", async () => {
    mockFetchArrayBuffer.mockResolvedValue(buildIxbrlZip());
    const result = await extractXbrlMetrics("https://example.test/xbrl.zip");

    expect(result.ok).toBe(true);
    expect(result.unit).toBe("百万円");
    // 売上 表示値12,345（百万円） → 円全額12,345,000,000 → 百万円へ圧縮し "12345"。
    // 旧バグでは円全額をそのまま "12345000000" として返していた。
    expect(result.performance?.sales).toBe("12345");
    expect(result.performance?.operatingProfit).toBe("1000");
    expect(result.performance?.salesGrowth).toBe("");
    expect(result.prior?.sales).toBe("10000");
    expect(result.performance?.periodEnd).toBe("2026-03-31");
    expect(result.performance?.quality).toBe("medium");
    expect(result.performance?.uncertainty).toContain("連結・個別区分をcontextから確定できません");
  });
});

it("contextの連結区分・期間・unitRefを使い、個別や異通貨の候補を混在させない", async () => {
  const xbrl = `<xbrli:xbrl>
    <xbrli:context id="CurrentConsolidatedDuration"><xbrli:entity><xbrli:identifier scheme="test">1</xbrli:identifier><xbrli:segment><xbrldi:explicitMember dimension="jppfs_cor:ConsolidatedOrNonConsolidatedAxis">jppfs_cor:ConsolidatedMember</xbrldi:explicitMember></xbrli:segment></xbrli:entity><xbrli:period><xbrli:startDate>2025-04-01</xbrli:startDate><xbrli:endDate>2026-03-31</xbrli:endDate></xbrli:period></xbrli:context>
    <xbrli:context id="CurrentNonConsolidatedDuration"><xbrli:entity><xbrli:identifier scheme="test">1</xbrli:identifier></xbrli:entity><xbrli:period><xbrli:startDate>2025-04-01</xbrli:startDate><xbrli:endDate>2026-03-31</xbrli:endDate></xbrli:period></xbrli:context>
    <xbrli:context id="ForecastYearDuration"><xbrli:entity><xbrli:identifier scheme="test">1</xbrli:identifier></xbrli:entity><xbrli:period><xbrli:startDate>2026-04-01</xbrli:startDate><xbrli:endDate>2027-03-31</xbrli:endDate></xbrli:period></xbrli:context>
    <xbrli:unit id="JPY"><xbrli:measure>iso4217:JPY</xbrli:measure></xbrli:unit><xbrli:unit id="USD"><xbrli:measure>iso4217:USD</xbrli:measure></xbrli:unit>
    <t:NetSales contextRef="CurrentConsolidatedDuration" unitRef="JPY" decimals="-6">12000000000</t:NetSales><t:OperatingIncome contextRef="CurrentConsolidatedDuration" unitRef="JPY" decimals="-6">1000000000</t:OperatingIncome><t:OrdinaryIncome contextRef="CurrentConsolidatedDuration" unitRef="JPY">900000000</t:OrdinaryIncome><t:ProfitAttributableToOwnersOfParent contextRef="CurrentConsolidatedDuration" unitRef="JPY">700000000</t:ProfitAttributableToOwnersOfParent>
    <t:NetSales contextRef="CurrentNonConsolidatedDuration" unitRef="JPY">999999999999</t:NetSales><t:OperatingIncome contextRef="CurrentNonConsolidatedDuration" unitRef="JPY">8888888888</t:OperatingIncome><t:OrdinaryIncome contextRef="CurrentNonConsolidatedDuration" unitRef="JPY">7777777777</t:OrdinaryIncome><t:ProfitAttributableToOwnersOfParent contextRef="CurrentNonConsolidatedDuration" unitRef="JPY">6666666666</t:ProfitAttributableToOwnersOfParent>
    <t:NetSales contextRef="ForecastYearDuration" unitRef="JPY">13000000000</t:NetSales>
  </xbrli:xbrl>`;
  const zipped = zipSync({ "XBRLData/Summary/summary.xbrl": strToU8(xbrl) });
  mockFetchArrayBuffer.mockResolvedValue(zipped.buffer.slice(zipped.byteOffset, zipped.byteOffset + zipped.byteLength));
  const result = await extractXbrlMetrics("https://example.test/contexts.zip");
  expect(result.performance?.context).toBe("CurrentConsolidatedDuration");
  expect(result.performance?.sales).toBe("12000");
  expect(result.performance?.consolidation).toBe("consolidated");
  expect(result.forecast?.sales).toBe("13000");
  expect(result.performance?.uncertainty).toEqual([]);
  expect(result.forecast?.quality).toBe("medium");
  expect(result.forecast?.uncertainty).toContain("同一contextで確認できる主要指標が3項目未満です");
});

it("同一期末の四半期単独contextより累計YTD contextを優先する", async () => {
  const row = (context: string, sales: number) => `
    <t:NetSales contextRef="${context}" unitRef="JPY">${sales}000000</t:NetSales>
    <t:OperatingIncome contextRef="${context}" unitRef="JPY">100000000</t:OperatingIncome>
    <t:OrdinaryIncome contextRef="${context}" unitRef="JPY">90000000</t:OrdinaryIncome>
    <t:ProfitAttributableToOwnersOfParent contextRef="${context}" unitRef="JPY">70000000</t:ProfitAttributableToOwnersOfParent>`;
  const xbrl = `<xbrli:xbrl>
    <xbrli:context id="CurrentQuarterConsolidatedDuration"><xbrli:entity><xbrli:identifier scheme="test">1</xbrli:identifier></xbrli:entity><xbrli:period><xbrli:startDate>2025-10-01</xbrli:startDate><xbrli:endDate>2025-12-31</xbrli:endDate></xbrli:period></xbrli:context>
    <xbrli:context id="CurrentYTDConsolidatedDuration"><xbrli:entity><xbrli:identifier scheme="test">1</xbrli:identifier></xbrli:entity><xbrli:period><xbrli:startDate>2025-04-01</xbrli:startDate><xbrli:endDate>2025-12-31</xbrli:endDate></xbrli:period></xbrli:context>
    <xbrli:unit id="JPY"><xbrli:measure>iso4217:JPY</xbrli:measure></xbrli:unit>
    ${row("CurrentQuarterConsolidatedDuration", 100)}
    ${row("CurrentYTDConsolidatedDuration", 900)}
  </xbrli:xbrl>`;
  const zipped = zipSync({ "XBRLData/Summary/ytd.xbrl": strToU8(xbrl) });
  mockFetchArrayBuffer.mockResolvedValue(zipped.buffer.slice(zipped.byteOffset, zipped.byteOffset + zipped.byteLength));
  const result = await extractXbrlMetrics("https://example.test/ytd.zip");
  expect(result.performance?.context).toBe("CurrentYTDConsolidatedDuration");
  expect(result.performance?.sales).toBe("900");
});

it("Attachment XBRLよりSummary iXBRLを拡張子横断で優先する", async () => {
  const document = (sales: number, inline: boolean) => `<html><body>
    <xbrli:context id="CurrentConsolidatedDuration"><xbrli:entity><xbrli:identifier scheme="test">1</xbrli:identifier></xbrli:entity><xbrli:period><xbrli:startDate>2025-04-01</xbrli:startDate><xbrli:endDate>2026-03-31</xbrli:endDate></xbrli:period></xbrli:context>
    <xbrli:unit id="JPY"><xbrli:measure>iso4217:JPY</xbrli:measure></xbrli:unit>
    ${["NetSales", "OperatingIncome", "OrdinaryIncome", "ProfitAttributableToOwnersOfParent"].map((name, index) => inline
      ? `<ix:nonFraction name="t:${name}" contextRef="CurrentConsolidatedDuration" unitRef="JPY">${index ? 100000000 : sales * 1_000_000}</ix:nonFraction>`
      : `<t:${name} contextRef="CurrentConsolidatedDuration" unitRef="JPY">${index ? 100000000 : sales * 1_000_000}</t:${name}>`).join("")}
  </body></html>`;
  const zipped = zipSync({
    "XBRLData/Attachment/statement.xbrl": strToU8(document(100, false)),
    "XBRLData/Summary/summary.htm": strToU8(document(900, true))
  });
  mockFetchArrayBuffer.mockResolvedValue(zipped.buffer.slice(zipped.byteOffset, zipped.byteOffset + zipped.byteLength));
  const result = await extractXbrlMetrics("https://example.test/mixed-sources.zip");
  expect(result.xbrlFileName).toContain("Summary");
  expect(result.performance?.sales).toBe("900");
});

it("不完全なSummaryより主要4指標が揃うAttachmentを優先する", async () => {
  const context = `<xbrli:context id="CurrentConsolidatedDuration"><xbrli:entity><xbrli:identifier scheme="test">1</xbrli:identifier></xbrli:entity><xbrli:period><xbrli:startDate>2025-04-01</xbrli:startDate><xbrli:endDate>2026-03-31</xbrli:endDate></xbrli:period></xbrli:context>`;
  const unit = `<xbrli:unit id="JPY"><xbrli:measure>iso4217:JPY</xbrli:measure></xbrli:unit>`;
  const summary = `<xbrli:xbrl>${context}${unit}
    <t:NetSales contextRef="CurrentConsolidatedDuration" unitRef="JPY">900000000</t:NetSales>
    <t:OperatingIncome contextRef="CurrentConsolidatedDuration" unitRef="JPY">90000000</t:OperatingIncome>
    <t:OrdinaryIncome contextRef="CurrentConsolidatedDuration" unitRef="JPY">85000000</t:OrdinaryIncome>
  </xbrli:xbrl>`;
  const attachment = `<xbrli:xbrl>${context}${unit}
    <t:NetSales contextRef="CurrentConsolidatedDuration" unitRef="JPY">800000000</t:NetSales>
    <t:OperatingIncome contextRef="CurrentConsolidatedDuration" unitRef="JPY">80000000</t:OperatingIncome>
    <t:OrdinaryIncome contextRef="CurrentConsolidatedDuration" unitRef="JPY">70000000</t:OrdinaryIncome>
    <t:ProfitAttributableToOwnersOfParent contextRef="CurrentConsolidatedDuration" unitRef="JPY">60000000</t:ProfitAttributableToOwnersOfParent>
  </xbrli:xbrl>`;
  const zipped = zipSync({
    "XBRLData/Summary/summary.xbrl": strToU8(summary),
    "XBRLData/Attachment/statement.xbrl": strToU8(attachment)
  });
  mockFetchArrayBuffer.mockResolvedValue(zipped.buffer.slice(zipped.byteOffset, zipped.byteOffset + zipped.byteLength));

  const result = await extractXbrlMetrics("https://example.test/incomplete-summary.zip");

  expect(result.source).toBe("attachment");
  expect(result.xbrlFileName).toContain("Attachment");
  expect(result.performance?.sales).toBe("800");
  expect(result.performance?.operatingProfit).toBe("80");
  expect(result.performance?.ordinaryProfit).toBe("70");
  expect(result.performance?.netProfit).toBe("60");
  expect(result.performance?.quality).toBe("high");
});

it("全社総額contextをsegment dimension付きcontextより優先し、dimensionしかない予想には不確実性を付ける", async () => {
  const context = (id: string, start: string, end: string, segment = false) => `<xbrli:context id="${id}"><xbrli:entity><xbrli:identifier scheme="test">1</xbrli:identifier>${segment
    ? `<xbrli:segment><xbrldi:explicitMember dimension="jppfs_cor:OperatingSegmentsAxis">jppfs_cor:ConsumerMember</xbrldi:explicitMember></xbrli:segment>`
    : ""}</xbrli:entity><xbrli:period><xbrli:startDate>${start}</xbrli:startDate><xbrli:endDate>${end}</xbrli:endDate></xbrli:period></xbrli:context>`;
  const facts = (contextRef: string, sales: number) => `
    <t:NetSales contextRef="${contextRef}" unitRef="JPY">${sales * 1_000_000}</t:NetSales>
    <t:OperatingIncome contextRef="${contextRef}" unitRef="JPY">100000000</t:OperatingIncome>
    <t:OrdinaryIncome contextRef="${contextRef}" unitRef="JPY">90000000</t:OrdinaryIncome>
    <t:ProfitAttributableToOwnersOfParent contextRef="${contextRef}" unitRef="JPY">70000000</t:ProfitAttributableToOwnersOfParent>`;
  const xbrl = `<xbrli:xbrl>
    ${context("CurrentTotalConsolidatedDuration", "2025-04-01", "2026-03-31")}
    ${context("CurrentSegmentConsolidatedDuration", "2025-04-01", "2026-03-31", true)}
    ${context("ForecastYearSegmentConsolidatedDuration", "2026-04-01", "2027-03-31", true)}
    <xbrli:unit id="JPY"><xbrli:measure>iso4217:JPY</xbrli:measure></xbrli:unit>
    ${facts("CurrentTotalConsolidatedDuration", 100)}
    ${facts("CurrentSegmentConsolidatedDuration", 999)}
    ${facts("ForecastYearSegmentConsolidatedDuration", 120)}
  </xbrli:xbrl>`;
  const zipped = zipSync({ "XBRLData/Summary/dimensions.xbrl": strToU8(xbrl) });
  mockFetchArrayBuffer.mockResolvedValue(zipped.buffer.slice(zipped.byteOffset, zipped.byteOffset + zipped.byteLength));

  const result = await extractXbrlMetrics("https://example.test/dimensions.zip");

  expect(result.performance?.context).toBe("CurrentTotalConsolidatedDuration");
  expect(result.performance?.sales).toBe("100");
  expect(result.performance?.uncertainty).not.toContain("セグメント等のdimensionを含むcontextのため、全社値として確定できません");
  expect(result.forecast?.context).toBe("ForecastYearSegmentConsolidatedDuration");
  expect(result.forecast?.quality).toBe("medium");
  expect(result.forecast?.uncertainty).toContain("セグメント等のdimensionを含むcontextのため、全社値として確定できません");
});

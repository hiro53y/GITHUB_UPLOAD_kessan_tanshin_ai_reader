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
    expect(result.prior?.sales).toBe("10000");
  });
});

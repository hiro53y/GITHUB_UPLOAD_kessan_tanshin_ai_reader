import { describe, expect, it } from "vitest";
import { normalizeSearchKey, resolveTickerByName, searchTickerMaster, type TickerMasterEntry } from "../src/lib/tickerMaster";
import { isValidTicker } from "../src/lib/utils";

function entries(rows: Array<[string, string]>): TickerMasterEntry[] {
  return rows.map(([code, name]) => ({ code, name, key: normalizeSearchKey(name) }));
}

const MASTER = entries([
  ["7203", "トヨタ自動車"],
  ["4958", "長谷川香料"],
  ["4901", "富士フイルムホールディングス"],
  ["130A", "Ｖｅｒｉｔａｓ　Ｉｎ　Ｓｉｌｉｃｏ"],
  ["5401", "日本製鉄"],
  ["5411", "ＪＦＥホールディングス"]
]);

describe("normalizeSearchKey", () => {
  it("全角英数・空白を正規化する", () => {
    expect(normalizeSearchKey("Ｖｅｒｉｔａｓ　Ｉｎ　Ｓｉｌｉｃｏ")).toBe("veritasinsilico");
  });
  it("株式会社を除去する", () => {
    expect(normalizeSearchKey("株式会社日本製鉄")).toBe(normalizeSearchKey("日本製鉄"));
  });
});

describe("searchTickerMaster", () => {
  it("会社名の部分一致で検索できる", () => {
    const results = searchTickerMaster(MASTER, "長谷川");
    expect(results[0]).toEqual({ code: "4958", name: "長谷川香料" });
  });

  it("コード前方一致で検索できる", () => {
    const results = searchTickerMaster(MASTER, "54");
    expect(results.map((r) => r.code)).toContain("5401");
    expect(results.map((r) => r.code)).toContain("5411");
  });

  it("コード完全一致が先頭に来る", () => {
    const results = searchTickerMaster(MASTER, "7203");
    expect(results[0].code).toBe("7203");
  });

  it("英字入りコードも検索できる", () => {
    const results = searchTickerMaster(MASTER, "130A");
    expect(results[0].code).toBe("130A");
  });

  it("該当なしは空配列", () => {
    expect(searchTickerMaster(MASTER, "存在しない会社")).toEqual([]);
  });
});

describe("resolveTickerByName", () => {
  it("会社名からコードを解決する", () => {
    expect(resolveTickerByName(MASTER, "トヨタ自動車")).toEqual({ code: "7203", name: "トヨタ自動車" });
  });
  it("部分一致でも先頭候補を返す", () => {
    expect(resolveTickerByName(MASTER, "富士フイルム")?.code).toBe("4901");
  });
});

describe("isValidTicker", () => {
  it("英字入り4桁コードも有効と判定する", () => {
    expect(isValidTicker("130A")).toBe(true);
    expect(isValidTicker("130a")).toBe(true);
  });
});

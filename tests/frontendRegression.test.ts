import { describe, expect, it } from "vitest";
import { appReducer, createInitialAppState } from "../src/lib/appReducer";
import { defaultSettings } from "../src/lib/storage";
import { disclosureSourceLabel } from "../src/pages/FetchResultPage";

describe("frontend regression helpers", () => {
  it("取得元をTDnetへ一律表示せず、実際のsourceに合わせる", () => {
    expect(disclosureSourceLabel("tdnet-public")).toBe("TDnet公開閲覧");
    expect(disclosureSourceLabel("jpx-company-service")).toBe("JPX 東証上場会社情報");
    expect(disclosureSourceLabel("company-ir")).toBe("企業IR");
    expect(disclosureSourceLabel("manual")).toBe("手動指定");
    expect(disclosureSourceLabel()).toBe("取得元不明");
  });

  it("ログ初期化直後の追記で前回ログを復活させない", () => {
    const initial = { ...createInitialAppState(defaultSettings, [], []), logs: ["前回ログ"] };
    const cleared = appReducer(initial, { type: "SET_LOGS", payload: [] });
    const next = appReducer(cleared, { type: "PUSH_LOG", payload: "今回ログ" });
    expect(next.logs).toEqual(["今回ログ"]);
  });
});

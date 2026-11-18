import { describe, expect, it } from "vitest";
import { conjugateAdjective, conjugateVerb, conjugationRows } from "./conjugation";

describe("verbs", () => {
  it("godan endings", () => {
    const cases: [string, string, string, string][] = [
      // word, te, past, negative
      ["買う", "買って", "買った", "買わない"],
      ["待つ", "待って", "待った", "待たない"],
      ["取る", "取って", "取った", "取らない"],
      ["飲む", "飲んで", "飲んだ", "飲まない"],
      ["遊ぶ", "遊んで", "遊んだ", "遊ばない"],
      ["死ぬ", "死んで", "死んだ", "死なない"],
      ["書く", "書いて", "書いた", "書かない"],
      ["泳ぐ", "泳いで", "泳いだ", "泳がない"],
      ["話す", "話して", "話した", "話さない"],
    ];
    for (const [w, te, past, neg] of cases) {
      const f = conjugateVerb(w, "g");
      expect([f["て-form"], f.Past, f.Negative]).toEqual([te, past, neg]);
    }
  });

  it("godan full table for 待つ", () => {
    const f = conjugateVerb("待つ", "g");
    expect(f["Polite (ます)"]).toBe("待ちます");
    expect(f["Potential (can)"]).toBe("待てる");
    expect(f["Volitional (let's, casual)"]).toBe("待とう");
    expect(f["Conditional (ば)"]).toBe("待てば");
    expect(f["Conditional (たら)"]).toBe("待ったら");
    expect(f.Passive).toBe("待たれる");
    expect(f.Causative).toBe("待たせる");
    expect(f.Command).toBe("待て");
    expect(f["ちゃった (oops / done)"]).toBe("待っちゃった");
  });

  it("ちゃった becomes じゃった after で", () => {
    expect(conjugateVerb("死ぬ", "g")["ちゃった (oops / done)"]).toBe("死んじゃった");
  });

  it("行く irregular te", () => {
    const f = conjugateVerb("行く", "iku");
    expect([f["て-form"], f.Past, f["Conditional (たら)"]]).toEqual(["行って", "行った", "行ったら"]);
  });

  it("ichidan", () => {
    const f = conjugateVerb("食べる", "i");
    expect([f.Negative, f["Potential (can)"], f.Command, f["Volitional (let's, casual)"]]).toEqual([
      "食べない", "食べられる", "食べろ", "食べよう",
    ]);
  });

  it("来る in kanji and kana", () => {
    expect(conjugateVerb("来る", "k").Negative).toBe("来ない");
    const k = conjugateVerb("くる", "k");
    expect([k.Negative, k["Polite (ます)"], k.Command, k["Conditional (ば)"]]).toEqual(["こない", "きます", "こい", "くれば"]);
  });

  it("する and する-nouns", () => {
    expect(conjugateVerb("する", "su")["Potential (can)"]).toBe("できる");
    expect(conjugateVerb("配信", "s")["Polite past"]).toBe("配信しました");
  });

  it("overrides: ある negative is ない", () => {
    const rows = conjugationRows("ある", "ある", "g");
    expect(rows.find((r) => r.form === "Negative")?.word).toBe("ない");
    expect(rows.find((r) => r.form === "Potential (can)")?.word).toBe("—");
  });

  it("shows kana reading only when different", () => {
    const rows = conjugationRows("来る", "くる", "k");
    expect(rows.find((r) => r.form === "Negative")).toEqual({ form: "Negative", word: "来ない", reading: "こない" });
    expect(conjugationRows("やる", "やる", "g").every((r) => r.reading === null)).toBe(true);
  });

  it("returns empty rows for non-conjugatable input instead of throwing", () => {
    expect(conjugationRows("ABC", "ABC", "g")).toEqual([]);
    expect(conjugationRows("友達", "ともだち", "n")).toEqual([]);
  });
});

describe("adjectives", () => {
  it("regular い-adjective", () => {
    const f = conjugateAdjective("強い", "ia");
    expect([f.Negative, f.Past, f["て-form (and…)"], f["Looks like (そう)"]]).toEqual(["強くない", "強かった", "強くて", "強そう"]);
  });
  it("いい / かっこいい use よ-stem", () => {
    expect(conjugateAdjective("いい", "ia").Negative).toBe("よくない");
    expect(conjugateAdjective("いい", "ia")["Looks like (そう)"]).toBe("よさそう");
    expect(conjugateAdjective("かっこいい", "ia").Past).toBe("かっこよかった");
  });
  it("な-adjective", () => {
    const f = conjugateAdjective("暇", "na");
    expect([f.Negative, f["Before a noun"], f.Adverb]).toEqual(["暇じゃない", "暇な〜", "暇に"]);
  });
});

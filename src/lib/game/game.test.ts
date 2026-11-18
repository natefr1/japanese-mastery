import { describe, expect, it } from "vitest";
import { choose, currentNode, questResult, startQuest, submitTyped, validateQuest } from "./quests";
import { QUESTS, konbini, mikaPlans, harutoInvite } from "./questData";
import { analyze, buildKnowledge, comfort, type Token } from "../reading/coverage";
import type { CardRow } from "../learning/types";
import type { VocabItem } from "../types";

describe("authored quests", () => {
  it("are structurally valid", () => {
    for (const q of QUESTS) expect(validateQuest(q), q.id).toEqual([]);
  });

  it("konbini: random cashier questions, playable to success with natural answers", () => {
    for (const seed of [1, 2, 3, 42, 99]) {
      let s = startQuest(konbini, seed);
      let guard = 0;
      while (!s.ended && guard++ < 30) {
        const node = currentNode(konbini, s);
        if (node.choices) s = choose(konbini, s, 0, seed);
        else if (node.id === "total") s = submitTyped(konbini, s, "680", seed);
        else throw new Error(`stuck at ${node.id}`);
      }
      const r = questResult(konbini, s);
      expect(r.success).toBe(true);
      // Exactly 3 of the 4 question objectives are in play each run.
      expect(r.objectives.filter((o) => o.id.startsWith("q-")).length).toBe(3);
      expect(r.score).toBeGreaterThan(90);
    }
  });

  it("konbini: misunderstanding the questions fails the quest with feedback, grammar never touches relationships", () => {
    let s = startQuest(konbini, 7);
    s = choose(konbini, s, 0);
    while (!s.ended) {
      const node = currentNode(konbini, s);
      if (node.id === "total") s = submitTyped(konbini, s, "600");
      else if (node.typed && node.id.startsWith("q-")) s = submitTyped(konbini, s, "えっと、りんご");
      else s = choose(konbini, s, 0);
    }
    const r = questResult(konbini, s);
    expect(r.success).toBe(false);
    expect(r.feedback.length).toBeGreaterThanOrEqual(3);
    expect(r.relationship).toEqual([]);
  });

  it("typed answers accept multiple phrasings (kana, kanji, romaji)", () => {
    for (const ans of ["はい、お願いします", "おねがいします", "daijoubu desu"]) {
      let s = startQuest(konbini, 5);
      s = choose(konbini, s, 0);
      const before = s.met.length;
      s = submitTyped(konbini, s, ans);
      expect(s.met.length).toBe(before + 1);
    }
  });

  it("mika: flags change dialogue; rude answer ends in a failed (but valid) outcome", () => {
    let s = startQuest(mikaPlans, 1);
    s = choose(mikaPlans, s, 1); // Saturday busy
    s = choose(mikaPlans, s, 0); // accept
    expect(s.transcript.some((l) => l.jp.includes("日曜日の2時"))).toBe(true);
    let r = startQuest(mikaPlans, 1);
    r = choose(mikaPlans, r, 0);
    r = choose(mikaPlans, r, 2); // flat refusal
    expect(r.ended).toBe(true);
    const res = questResult(mikaPlans, r);
    expect(res.success).toBe(false);
    expect(res.relationship).toContainEqual(["mika", -1]);
  });

  it("haruto: memories and relationship accumulate from social choices", () => {
    let s = startQuest(harutoInvite, 1);
    s = choose(harutoInvite, s, 0);
    s = choose(harutoInvite, s, 1);
    s = choose(harutoInvite, s, 1);
    s = choose(harutoInvite, s, 0);
    s = choose(harutoInvite, s, 1);
    s = choose(harutoInvite, s, 0);
    const r = questResult(harutoInvite, s);
    expect(r.success).toBe(true);
    expect(r.memories.length).toBe(3);
    expect(r.relationship[0]![1]).toBeGreaterThan(5);
    expect(r.objectives.every((o) => o.met)).toBe(true);
  });
});

describe("reading coverage", () => {
  const v = (id: string, word: string, reading: string, word_type = "n"): VocabItem =>
    ({ id, word, reading, word_type, meaning: "", level: "", category: "", note: "", personal_note: "", pitch_accent: null, audio_ref: null, tags: [], examples: [], source: "seed:v1", created_at: 0, updated_at: 0, deleted_at: null, rev: 1, freq_rank: null }) as VocabItem;
  const card = (item_id: string, state: number, stability: number, introduced = true): CardRow => ({
    id: item_id + "r", item_type: "vocab", item_id, skill: "recognition", due: 0, stability, difficulty: 5, elapsed_days: 0, scheduled_days: 0,
    learning_steps: 0, reps: 1, lapses: 0, state, last_review: null, introduced_at: introduced ? 1 : null, suspended: false, rev: 1,
  });
  const vocab = [v("1", "海賊", "かいぞく"), v("2", "王", "おう"), v("3", "俺", "おれ"), v("4", "なる", "なる", "g"), v("5", "分かる", "わかる", "g")];
  const cards = [card("1", 2, 30), card("2", 1, 1), card("3", 2, 10), card("4", 0, 0, false), card("5", 2, 50)];
  const k = buildKnowledge(vocab, cards);
  const tokens: Token[] = [
    { surface: "海賊", basic: "海賊", reading: "カイゾク", pos: "名詞" },
    { surface: "王", basic: "王", reading: "オウ", pos: "名詞" },
    { surface: "に", basic: "に", pos: "助詞" },
    { surface: "俺", basic: "俺", reading: "オレ", pos: "名詞" },
    { surface: "は", basic: "は", pos: "助詞" },
    { surface: "なる", basic: "なる", reading: "ナル", pos: "動詞" },
    { surface: "！", basic: "！", pos: "記号" },
    { surface: "ルフィ", basic: "*", pos: "名詞", pos1: "固有名詞" },
    { surface: "わかっ", basic: "わかる", reading: "ワカッ", pos: "動詞" },
    { surface: "ゴムゴム", basic: "*", reading: "ゴムゴム", pos: "名詞" },
  ];
  it("classifies tokens by real card state and ignores symbols and names", () => {
    const r = analyze(tokens, k);
    expect(r.names).toBe(1);
    expect(r.grammarTokens).toBe(2);
    expect(r.counted).toBe(8);
    expect(r.known).toBe(5); // 海賊, 俺, わかる(kana match) + 2 grammar
    expect(r.learning).toBe(1); // 王
    expect(r.queued).toBe(1); // なる
    expect(r.unknown).toBe(1); // ゴムゴム
    expect(r.coverage).toBeCloseTo(5 / 8);
    expect(r.words[0]!.status).toBe("unknown");
  });
  it("can count grammar tokens as unknown-neutral", () => {
    const r = analyze(tokens, k, { grammarKnown: false });
    expect(r.grammarTokens).toBe(0);
  });
  it("comfort labels follow research thresholds", () => {
    expect(comfort(0.99).tone).toBe("ok");
    expect(comfort(0.92).tone).toBe("warn");
    expect(comfort(0.75).tone).toBe("bad");
  });
});

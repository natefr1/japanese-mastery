import { describe, expect, it } from "vitest";
import { check, clozeSentence, matchesAny, normalize, suggestRating, vocabAnswers } from "./answers";
import { formatInterval, makeScheduler, previewDue, schedule, retrievability, Rating } from "./fsrs";
import { planSession, type PlanInput } from "./planner";
import type { CardRow } from "./types";

let n = 0;
function card(p: Partial<CardRow> = {}): CardRow {
  n++;
  return {
    id: `c${n}`, item_type: "vocab", item_id: `i${n}`, skill: "recognition", due: 0, stability: 0, difficulty: 0,
    elapsed_days: 0, scheduled_days: 0, learning_steps: 0, reps: 0, lapses: 0, state: 0, last_review: null,
    introduced_at: null, suspended: false, rev: 1, ...p,
  };
}

describe("answers", () => {
  it("normalizes katakana, romaji, width and punctuation", () => {
    expect(normalize("ゲーム！")).toBe("げーむ");
    expect(normalize("taberu")).toBe("たべる");
    expect(normalize(" 食べる。")).toBe("食べる");
    expect(normalize("６８０")).toBe("680");
  });
  it("accepts kanji, kana or romaji for production", () => {
    const acc = vocabAnswers({ word: "配信", reading: "はいしん", word_type: "s" });
    expect(check("配信する", acc).correct).toBe(true);
    expect(check("haishin", acc).correct).toBe(true);
    expect(check("はいし", acc).correct).toBe(false);
    expect(check("はいしm", acc).nearMiss).toBe(true);
    expect(check("", acc).correct).toBe(false);
  });
  it("cloze blanks the word when present", () => {
    expect(clozeSentence("ボスを倒した！", "倒す")).toBeNull();
    expect(clozeSentence("ナイスショット！", "ナイス")).toBe("＿＿ショット！");
  });
  it("suggests ratings from evidence, never Easy", () => {
    expect(suggestRating(false, 1000, 8000)).toBe(1);
    expect(suggestRating(true, 30000, 8000)).toBe(2);
    expect(suggestRating(true, 3000, 8000, true)).toBe(2);
    expect(suggestRating(true, 3000, 8000)).toBe(3);
  });
  it("intent matching", () => {
    expect(matchesAny("はい、お願いします", ["お願い", "おねがい"])).toBe(true);
    expect(matchesAny("はい、おねがいします", ["お願い", "おねがい"])).toBe(true);
    expect(matchesAny("daijoubu desu", ["だいじょうぶ"])).toBe(true);
    expect(matchesAny("680円", ["=680"])).toBe(false);
    expect(matchesAny("680", ["=680"])).toBe(true);
  });
});

describe("fsrs adapter (ts-fsrs)", () => {
  const s = makeScheduler(0.9);
  const now = new Date("2026-11-18T12:00:00Z");
  it("new card graded Good enters learning and increments reps", () => {
    const c = card({ due: now.getTime() });
    const next = schedule(s, c, Rating.Good, now);
    expect(next.reps).toBe(1);
    expect(next.state).toBeGreaterThan(0);
    expect(next.due).toBeGreaterThan(now.getTime());
  });
  it("Again is sooner than Good is sooner than Easy", () => {
    const c = card({ due: now.getTime() });
    const p = previewDue(s, c, now);
    expect(p[1]).toBeLessThanOrEqual(p[3]);
    expect(p[3]).toBeLessThanOrEqual(p[4]);
  });
  it("review card: retrievability falls over time", () => {
    const c = card({ state: 2, stability: 10, difficulty: 5, reps: 3, last_review: now.getTime(), due: now.getTime() + 10 * 864e5 });
    const r1 = retrievability(s, c, new Date(now.getTime() + 864e5));
    const r2 = retrievability(s, c, new Date(now.getTime() + 20 * 864e5));
    expect(r1).toBeGreaterThan(r2);
  });
  it("formats intervals", () => {
    expect(formatInterval(5 * 60000)).toBe("5m");
    expect(formatInterval(3 * 864e5)).toBe("3d");
  });
});

describe("planner", () => {
  const base = (p: Partial<PlanInput>): PlanInput => ({
    due: [], newCandidates: [], newToday: 0, retention30d: null, retentionSamples: 0, avgMs: {}, minutes: 12,
    prefs: { newPerDay: 10, retention: 0.9, startLevel: "N4", focusCategories: [], productionBias: true, includeGrammar: true, includeKanji: true },
    info: () => ({ level: "N4" }), retrievability: () => 0.5, ...p,
  });
  const reviews = (k: number) => Array.from({ length: k }, () => card({ state: 2, introduced_at: 1, reps: 2 }));
  const fresh = (k: number, p: Partial<CardRow> = {}) => Array.from({ length: k }, () => card(p));

  it("fits the time budget", () => {
    const plan = planSession(base({ due: reviews(200), minutes: 5 }));
    expect(plan.estSeconds).toBeLessThanOrEqual(300);
    expect(plan.reviewCount).toBeGreaterThan(0);
    expect(plan.reviewCount).toBeLessThan(200);
  });
  it("stops new cards when the backlog is large", () => {
    const plan = planSession(base({ due: reviews(160), newCandidates: fresh(20), minutes: 60 }));
    expect(plan.newCount).toBe(0);
    expect(plan.notes.join(" ")).toMatch(/No new cards/);
  });
  it("limits new cards with a moderate backlog and low retention", () => {
    const plan = planSession(base({ due: reviews(70), newCandidates: fresh(20), minutes: 60, retention30d: 0.7, retentionSamples: 100 }));
    expect(plan.newCount).toBeLessThanOrEqual(1);
  });
  it("respects the daily new-card target", () => {
    const plan = planSession(base({ newCandidates: fresh(30), newToday: 8, minutes: 60 }));
    expect(plan.newCount).toBe(2);
  });
  it("reserves part of the new slots for production when biased", () => {
    const plan = planSession(base({ newCandidates: [...fresh(20), ...fresh(20, { skill: "production" })], minutes: 60 }));
    const prod = plan.queue.filter((q) => q.card.skill === "production").length;
    expect(prod).toBeGreaterThanOrEqual(4);
  });
  it("puts learning cards first and interleaves new ones", () => {
    const learning = card({ state: 1, introduced_at: 1, reps: 1 });
    const plan = planSession(base({ due: [...reviews(6), learning], newCandidates: fresh(2), minutes: 30 }));
    expect(plan.queue[0]!.card.id).toBe(learning.id);
    const newIdx = plan.queue.flatMap((q, i) => (q.isNew ? [i] : []));
    expect(newIdx.length).toBe(2);
    expect(newIdx[0]).toBeGreaterThan(0);
    expect(newIdx[1]! - newIdx[0]!).toBeGreaterThan(1);
  });
  it("only-mode restricts content type", () => {
    const plan = planSession(base({ newCandidates: [...fresh(5), ...fresh(5, { item_type: "grammar", skill: "cloze" })], minutes: 30, only: "grammar" }));
    expect(plan.queue.every((q) => q.card.item_type === "grammar")).toBe(true);
  });
});

// Deterministic session planner. Decides WHICH cards to show, never HOW they are
// scheduled (that is FSRS's job). Every throttle produces a human-readable note.
import type { CardRow, Skill, StudyPrefs } from "./types";

export const LEVEL_ORDER = ["N5", "N4", "N3", "N2", "N1"];
/** Slang and net words sit around N3 difficulty for ordering purposes. */
const levelRank = (l: string | undefined) => {
  if (!l) return 2;
  const i = LEVEL_ORDER.indexOf(l);
  return i >= 0 ? i : 2;
};

export const DEFAULT_SECONDS: Record<Skill, number> = { recognition: 8, production: 15, cloze: 15 };
export const NEW_COST_FACTOR = 2.5;
export const BACKLOG_STOP = 150;
export const BACKLOG_SLOW = 60;

export interface ItemInfo {
  level?: string;
  category?: string;
  /** Explicitly prioritised by the learner (e.g. mined from a manga page). */
  priority?: boolean;
  freqRank?: number | null;
}

export interface PlanInput {
  due: CardRow[];
  newCandidates: CardRow[];
  newToday: number;
  retention30d: number | null;
  retentionSamples: number;
  avgMs: Partial<Record<Skill, number>>;
  minutes: number;
  prefs: Pick<StudyPrefs, "newPerDay" | "retention" | "startLevel" | "focusCategories" | "productionBias" | "includeGrammar" | "includeKanji">;
  info: (c: CardRow) => ItemInfo;
  /** Probability of recall now; lower = more urgent. */
  retrievability: (c: CardRow) => number;
  /** Restrict to one content type (grammar / kanji practice). */
  only?: "vocab" | "grammar" | "kanji";
}

export interface PlannedCard {
  card: CardRow;
  isNew: boolean;
}

export interface Plan {
  queue: PlannedCard[];
  reviewCount: number;
  newCount: number;
  dueTotal: number;
  estSeconds: number;
  notes: string[];
}

export function secondsFor(c: CardRow, avgMs: PlanInput["avgMs"], isNew: boolean): number {
  const base = (avgMs[c.skill] ?? DEFAULT_SECONDS[c.skill] * 1000) / 1000;
  return Math.max(3, base) * (isNew ? NEW_COST_FACTOR : 1);
}

export function planSession(input: PlanInput): Plan {
  const notes: string[] = [];
  const budget = Math.max(60, input.minutes * 60);
  const allowed = (c: CardRow) =>
    (input.only ? c.item_type === input.only : true) &&
    (input.prefs.includeGrammar || c.item_type !== "grammar" || input.only === "grammar") &&
    (input.prefs.includeKanji || c.item_type !== "kanji" || input.only === "kanji");

  // 1) Reviews: short-term (learning/relearning) first, then lowest retrievability.
  const due = input.due.filter(allowed);
  const sortedDue = [...due].sort((a, b) => {
    const la = a.state === 1 || a.state === 3 ? 0 : 1;
    const lb = b.state === 1 || b.state === 3 ? 0 : 1;
    if (la !== lb) return la - lb;
    return input.retrievability(a) - input.retrievability(b) || a.due - b.due;
  });
  const reviews: CardRow[] = [];
  let used = 0;
  for (const c of sortedDue) {
    const s = secondsFor(c, input.avgMs, false);
    if (used + s > budget && reviews.length > 0) break;
    reviews.push(c);
    used += s;
  }
  if (reviews.length < due.length) notes.push(`${due.length - reviews.length} more reviews are due. They'll be first next session.`);

  // 2) New cards: daily target, throttled by backlog and retention, then by time.
  let allowance = Math.max(0, input.prefs.newPerDay - input.newToday);
  if (input.newToday >= input.prefs.newPerDay && input.prefs.newPerDay > 0) notes.push("You've hit today's new-card target.");
  if (due.length >= BACKLOG_STOP) {
    allowance = 0;
    notes.push(`No new cards: ${due.length} reviews are waiting. Clearing them protects what you've already learned.`);
  } else if (due.length >= BACKLOG_SLOW && allowance > 3) {
    allowance = 3;
    notes.push(`New cards limited to 3 while ${due.length} reviews are due.`);
  }
  if (input.retentionSamples >= 30 && input.retention30d != null && input.retention30d < input.prefs.retention - 0.08) {
    const before = allowance;
    allowance = Math.floor(allowance / 2);
    if (before > 0)
      notes.push(
        `Recent retention is ${Math.round(input.retention30d * 100)}% (target ${Math.round(input.prefs.retention * 100)}%), so fewer new cards today.`,
      );
  }

  const cands = input.newCandidates.filter(allowed);
  const picked = pickNew(cands, allowance, input);
  const newCards: CardRow[] = [];
  for (const c of picked) {
    const s = secondsFor(c, input.avgMs, true);
    if (used + s > budget) break;
    newCards.push(c);
    used += s;
  }
  if (newCards.length < picked.length) notes.push(`${picked.length - newCards.length} new cards didn't fit in ${input.minutes} minutes.`);

  // 3) Interleave new cards evenly among reviews, and keep two cards of the same item apart.
  const queue = interleave(
    reviews.map((card) => ({ card, isNew: false })),
    newCards.map((card) => ({ card, isNew: true })),
  );
  separateSameItem(queue);
  return { queue, reviewCount: reviews.length, newCount: newCards.length, dueTotal: due.length, estSeconds: Math.round(used), notes };
}

function pickNew(cands: CardRow[], n: number, input: PlanInput): CardRow[] {
  if (n <= 0) return [];
  const start = levelRank(input.prefs.startLevel);
  const focus = new Set(input.prefs.focusCategories);
  const score = (c: CardRow) => {
    const i = input.info(c);
    const r = levelRank(i.level);
    // Start level first, then harder levels, then easier review material.
    const levelScore = r >= start ? r - start : 10 + (start - r);
    // Core-deck words have no JLPT level: order them by frequency inside the level band.
    const freq = i.freqRank != null ? i.freqRank / 10000 : 0;
    return (i.priority ? -1000 : 0) + (focus.has(i.category ?? "") ? 0 : 100) + levelScore + freq;
  };
  const byType = (t: string, skill?: Skill) =>
    cands.filter((c) => c.item_type === t && (!skill || c.skill === skill)).sort((a, b) => score(a) - score(b));

  const production = byType("vocab", "production");
  const recognition = byType("vocab", "recognition");
  const grammar = byType("grammar");
  const kanji = byType("kanji");

  const out: CardRow[] = [];
  const take = (arr: CardRow[], k: number) => {
    while (k-- > 0 && arr.length) out.push(arr.shift()!);
  };
  if (input.only) {
    take([...production, ...recognition, ...grammar, ...kanji], n);
    return out;
  }
  // Production practice is the learner's main weakness: reserve ~40% when available.
  if (input.prefs.productionBias) take(production, Math.ceil(n * 0.4));
  take(grammar, Math.floor(n / 4));
  take(kanji, Math.floor(n / 5));
  take(recognition, n - out.length);
  take(production, n - out.length);
  take(grammar, n - out.length);
  take(kanji, n - out.length);
  return out.slice(0, n);
}

function interleave(reviews: PlannedCard[], fresh: PlannedCard[]): PlannedCard[] {
  if (!fresh.length) return reviews;
  if (!reviews.length) return fresh;
  const out: PlannedCard[] = [];
  const gap = Math.max(1, Math.floor(reviews.length / (fresh.length + 1)));
  let r = 0, f = 0;
  while (r < reviews.length || f < fresh.length) {
    for (let i = 0; i < gap && r < reviews.length; i++) out.push(reviews[r++]!);
    if (f < fresh.length) out.push(fresh[f++]!);
  }
  return out;
}

function separateSameItem(q: PlannedCard[]) {
  for (let i = 1; i < q.length; i++) {
    if (q[i]!.card.item_id === q[i - 1]!.card.item_id) {
      const j = q.findIndex((x, k) => k > i && x.card.item_id !== q[i]!.card.item_id);
      if (j > 0) [q[i], q[j]] = [q[j]!, q[i]!];
    }
  }
}

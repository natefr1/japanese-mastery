// Deterministic quest engine for authored (offline) 生活 encounters.
// Communication is the gameplay: nodes present Japanese lines; the player answers by
// choosing or typing; objectives track whether the GOAL was achieved. Language
// feedback and relationship effects are kept separate: a grammar slip never
// costs friendship, only social tone does.
import { matchesAny } from "../learning/answers";

export type Tone = "natural" | "ok" | "awkward" | "rude";

export interface Gloss {
  t: string; // surface text
  r?: string; // reading
  m: string; // meaning
}

export interface Line {
  speaker: string; // character id, "cashier", "you", or "narration"
  jp: string;
  en: string;
  gloss?: Gloss[];
  ifFlag?: string;
  unlessFlag?: string;
}

export interface Effects {
  objective?: string;
  rel?: Record<string, number>;
  memory?: { character: string; fact: string };
  flag?: string;
  /** Language note (shown as feedback, never affects relationship). */
  feedback?: string;
}

export interface Choice extends Effects {
  jp: string;
  en: string;
  tone: Tone;
  next: string; // node id, or "@continue" inside a random sequence
}

export interface TypedRule extends Effects {
  patterns: string[];
  tone: Tone;
  next: string;
}

export interface QNode {
  id: string;
  lines: Line[];
  choices?: Choice[];
  typed?: { rules: TypedRule[]; fallback: { next: string; feedback: string }; placeholder?: string };
  /** Pick `count` nodes from `pool` (seeded) and play them in order, then go to `then`. */
  random?: { pool: string[]; count: number; then: string };
  end?: { success: boolean };
}

export interface Objective {
  id: string;
  text: string;
  /** Only shown/required if the node that awards it was visited. */
  dynamicFrom?: string;
}

export interface QuestDef {
  id: string;
  title: string;
  titleJp: string;
  location: "konbini" | "phone";
  character?: string;
  summary: string;
  minLevel: number;
  start: string;
  objectives: Objective[];
  /** Success predicate over met objectives and visited nodes. */
  success: (met: Set<string>, visited: Set<string>) => boolean;
  nodes: Record<string, QNode>;
  passport: { kind: string; title: string; detail: string };
  phrases: Gloss[];
}

export interface FeedbackItem {
  kind: "language" | "social";
  said: string;
  note: string;
  tone: Tone;
}

export interface TranscriptEntry {
  speaker: string;
  jp: string;
  en: string;
  gloss?: Gloss[];
}

export interface QuestState {
  questId: string;
  nodeId: string;
  seq: string[];
  seqPos: number;
  seqThen: string | null;
  visited: string[];
  met: string[];
  flags: string[];
  rel: Record<string, number>;
  memories: { character: string; fact: string }[];
  tones: Tone[];
  feedback: FeedbackItem[];
  transcript: TranscriptEntry[];
  ended: boolean;
  endedSuccess: boolean;
  startedAt: number;
}

/** Small seeded PRNG (mulberry32) so a run is reproducible from its seed. */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function visibleLines(node: QNode, flags: string[]): Line[] {
  return node.lines.filter((l) => (!l.ifFlag || flags.includes(l.ifFlag)) && (!l.unlessFlag || !flags.includes(l.unlessFlag)));
}

function enter(q: QuestDef, s: QuestState, id: string, rand: () => number): QuestState {
  let st = { ...s };
  let nodeId = id;
  // Resolve random sequences.
  for (let guard = 0; guard < 20; guard++) {
    const node = q.nodes[nodeId];
    if (!node) throw new Error(`quest ${q.id}: missing node ${nodeId}`);
    if (!node.random) break;
    const pool = [...node.random.pool];
    const seq: string[] = [];
    while (seq.length < node.random.count && pool.length) seq.push(pool.splice(Math.floor(rand() * pool.length), 1)[0]!);
    st = { ...st, seq, seqPos: 0, seqThen: node.random.then, visited: [...st.visited, nodeId] };
    nodeId = seq[0] ?? node.random.then;
  }
  const node = q.nodes[nodeId]!;
  const lines = visibleLines(node, st.flags).map((l) => ({ speaker: l.speaker, jp: l.jp, en: l.en, gloss: l.gloss }));
  st = { ...st, nodeId, visited: [...st.visited, nodeId], transcript: [...st.transcript, ...lines] };
  if (node.end) st = { ...st, ended: true, endedSuccess: node.end.success };
  return st;
}

export function startQuest(q: QuestDef, seed: number, now = Date.now()): QuestState {
  const s: QuestState = {
    questId: q.id, nodeId: q.start, seq: [], seqPos: 0, seqThen: null, visited: [], met: [], flags: [], rel: {},
    memories: [], tones: [], feedback: [], transcript: [], ended: false, endedSuccess: false, startedAt: now,
  };
  return enter(q, s, q.start, rng(seed));
}

export function currentNode(q: QuestDef, s: QuestState): QNode {
  return q.nodes[s.nodeId]!;
}

function apply(q: QuestDef, s: QuestState, said: string, e: Effects & { tone: Tone; next: string }, seed: number): QuestState {
  let st: QuestState = {
    ...s,
    transcript: [...s.transcript, { speaker: "you", jp: said, en: "" }],
    tones: [...s.tones, e.tone],
    met: e.objective && !s.met.includes(e.objective) ? [...s.met, e.objective] : s.met,
    flags: e.flag ? [...s.flags, e.flag] : s.flags,
    memories: e.memory ? [...s.memories, e.memory] : s.memories,
    rel: { ...s.rel },
  };
  for (const [k, v] of Object.entries(e.rel ?? {})) st.rel[k] = (st.rel[k] ?? 0) + v;
  if (e.feedback) {
    st.feedback = [...st.feedback, { kind: e.tone === "rude" ? "social" : "language", said, note: e.feedback, tone: e.tone }];
  }
  let next = e.next;
  if (next === "@continue") {
    const pos = st.seqPos + 1;
    if (pos < st.seq.length) {
      st = { ...st, seqPos: pos };
      next = st.seq[pos]!;
    } else {
      next = st.seqThen ?? q.start;
      st = { ...st, seq: [], seqPos: 0, seqThen: null };
    }
  }
  return enter(q, st, next, rng(seed + st.transcript.length));
}

export function choose(q: QuestDef, s: QuestState, index: number, seed = 1): QuestState {
  const node = currentNode(q, s);
  const c = node.choices?.[index];
  if (!c || s.ended) throw new Error("invalid choice");
  return apply(q, s, c.jp, c, seed);
}

export function submitTyped(q: QuestDef, s: QuestState, text: string, seed = 1): QuestState {
  const node = currentNode(q, s);
  if (!node.typed || s.ended) throw new Error("this step has no typed answer");
  const rule = node.typed.rules.find((r) => matchesAny(text, r.patterns));
  if (rule) return apply(q, s, text, rule, seed);
  return apply(q, s, text, { tone: "ok", next: node.typed.fallback.next, feedback: node.typed.fallback.feedback }, seed);
}

export interface QuestResult {
  success: boolean;
  score: number;
  objectives: { id: string; text: string; met: boolean }[];
  feedback: FeedbackItem[];
  relationship: [string, number][];
  memories: { character: string; fact: string }[];
  transcript: TranscriptEntry[];
}

const TONE_POINTS: Record<Tone, number> = { natural: 1, ok: 0.7, awkward: 0.35, rude: 0 };

export function questResult(q: QuestDef, s: QuestState): QuestResult {
  const met = new Set(s.met);
  const visited = new Set(s.visited);
  const objectives = q.objectives
    .filter((o) => !o.dynamicFrom || visited.has(o.dynamicFrom))
    .map((o) => ({ id: o.id, text: o.text, met: met.has(o.id) }));
  const success = s.ended && s.endedSuccess && q.success(met, visited);
  const objScore = objectives.length ? objectives.filter((o) => o.met).length / objectives.length : 1;
  const toneScore = s.tones.length ? s.tones.reduce((a, t) => a + TONE_POINTS[t], 0) / s.tones.length : 1;
  return {
    success,
    score: Math.round(objScore * 70 + toneScore * 30),
    objectives,
    feedback: s.feedback,
    relationship: Object.entries(s.rel),
    memories: s.memories,
    transcript: s.transcript,
  };
}

/** Static checks for authored quests (used in tests). */
export function validateQuest(q: QuestDef): string[] {
  const errs: string[] = [];
  const ids = new Set(Object.keys(q.nodes));
  if (!ids.has(q.start)) errs.push(`start ${q.start} missing`);
  for (const n of Object.values(q.nodes)) {
    const targets = [
      ...(n.choices ?? []).map((c) => c.next),
      ...(n.typed?.rules ?? []).map((r) => r.next),
      ...(n.typed ? [n.typed.fallback.next] : []),
      ...(n.random ? [...n.random.pool, n.random.then] : []),
    ];
    for (const t of targets) if (t !== "@continue" && !ids.has(t)) errs.push(`${n.id} → unknown ${t}`);
    if (!n.end && !n.random && !n.choices?.length && !n.typed) errs.push(`${n.id} is a dead end`);
  }
  return errs;
}

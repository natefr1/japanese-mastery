// Reading coverage: what share of the words in a real text you actually know,
// judged from your own review history, not from guesses.
import type { CardRow } from "../learning/types";
import type { VocabItem } from "../types";

export interface Token {
  surface: string;
  basic: string; // dictionary form ('*' when unknown)
  reading?: string; // katakana
  pos: string; // 名詞, 動詞, 助詞, 記号...
  pos1?: string; // 固有名詞, 数...
}

export type Status = "known" | "learning" | "queued" | "unknown";

export interface Knowledge {
  status: Status;
  vocabId: string | null;
}

const toHira = (s: string) => s.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));

/** Same definition as "known" on the Study Center: Review state, stability ≥ 7 days. */
export const KNOWN_STABILITY = 7;

const rank: Record<Status, number> = { known: 3, learning: 2, queued: 1, unknown: 0 };

export function buildKnowledge(vocab: VocabItem[], cards: CardRow[]): Map<string, Knowledge> {
  const rec = new Map<string, CardRow>();
  for (const c of cards) if (c.item_type === "vocab" && c.skill === "recognition") rec.set(c.item_id, c);
  const map = new Map<string, Knowledge>();
  const put = (key: string, k: Knowledge) => {
    if (!key) return;
    const prev = map.get(key);
    if (!prev || rank[k.status] > rank[prev.status]) map.set(key, k);
  };
  for (const v of vocab) {
    const c = rec.get(v.id);
    const status: Status = !c || c.introduced_at == null ? "queued" : c.state === 2 && c.stability >= KNOWN_STABILITY ? "known" : "learning";
    const k = { status, vocabId: v.id };
    const word = v.word.replace(/^〜/, "");
    put(word, k);
    put(toHira(v.reading.replace(/^〜/, "")), k);
    if (v.word_type === "s") {
      put(word + "する", k);
    }
  }
  return map;
}

export interface CoverageWord {
  key: string;
  surface: string;
  reading: string;
  count: number;
  status: Status;
  vocabId: string | null;
}

export interface CoverageResult {
  /** Tokens counted (content words + grammar tokens), excluding symbols and names. */
  counted: number;
  known: number;
  learning: number;
  queued: number;
  unknown: number;
  grammarTokens: number;
  names: number;
  /** known / counted */
  coverage: number;
  /** (known + learning) / counted */
  coverageWithLearning: number;
  words: CoverageWord[];
}

const SKIP_POS = new Set(["記号", "BOS", "EOS"]);
const GRAMMAR_POS = new Set(["助詞", "助動詞"]);

export function analyze(tokens: Token[], knowledge: Map<string, Knowledge>, opts: { grammarKnown: boolean } = { grammarKnown: true }): CoverageResult {
  const words = new Map<string, CoverageWord>();
  let known = 0, learning = 0, queued = 0, unknown = 0, grammar = 0, names = 0;
  for (const t of tokens) {
    if (SKIP_POS.has(t.pos) || !t.surface.trim() || /^[\s\p{P}\p{S}ー〜…]+$/u.test(t.surface)) continue;
    if (t.pos1 === "固有名詞") {
      names++;
      continue;
    }
    if (t.pos1 === "数" || /^[0-9０-９]+$/.test(t.surface)) continue;
    // Particles, auxiliaries and dependent nouns (の, こと as grammar) count as grammar.
    if ((GRAMMAR_POS.has(t.pos) || t.pos1 === "非自立") && opts.grammarKnown) {
      grammar++;
      known++;
      continue;
    }
    const basic = t.basic && t.basic !== "*" ? t.basic : t.surface;
    const reading = toHira(t.reading ?? "");
    const k = knowledge.get(basic) ?? knowledge.get(t.surface) ?? knowledge.get(toHira(basic)) ?? (reading ? knowledge.get(reading) : undefined);
    const status: Status = k?.status ?? "unknown";
    if (status === "known") known++;
    else if (status === "learning") learning++;
    else if (status === "queued") queued++;
    else unknown++;
    const w = words.get(basic);
    if (w) w.count++;
    else words.set(basic, { key: basic, surface: t.surface, reading, count: 1, status, vocabId: k?.vocabId ?? null });
  }
  const counted = known + learning + queued + unknown;
  return {
    counted, known, learning, queued, unknown, grammarTokens: grammar, names,
    coverage: counted ? known / counted : 0,
    coverageWithLearning: counted ? (known + learning) / counted : 0,
    words: [...words.values()].sort((a, b) => rank[a.status] - rank[b.status] || b.count - a.count),
  };
}

/** Rough reading-comfort label from coverage (research thresholds: 95% minimal, 98% comfortable). */
export function comfort(coverage: number): { label: string; tone: "bad" | "warn" | "ok" } {
  if (coverage >= 0.98) return { label: "Comfortable reading", tone: "ok" };
  if (coverage >= 0.95) return { label: "Readable with occasional lookups", tone: "ok" };
  if (coverage >= 0.9) return { label: "Hard going: frequent lookups", tone: "warn" };
  return { label: "Too many unknown words to follow easily", tone: "bad" };
}

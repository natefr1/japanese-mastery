// Deterministic Japanese conjugation engine (ported from the original website).
// Works on any string ending in a dictionary-form kana, so the same function
// conjugates both the kanji spelling and the kana reading.
import type { WordType } from "./types";

export const VERB_FORMS = [
  "Dictionary", "Polite (ます)", "Polite negative", "Polite past", "Negative", "Past", "Past negative",
  "て-form", "てる (doing / state)", "Want to (たい)", "Potential (can)", "Volitional (let's, casual)",
  "Polite volitional (let's)", "Conditional (ば)", "Conditional (たら)", "Passive", "Causative",
  "Command", "ちゃった (oops / done)",
] as const;
export type VerbForm = (typeof VERB_FORMS)[number];

export const ADJ_FORMS = [
  "Plain", "Polite", "Negative", "Past", "Past negative", "て-form (and…)", "Adverb",
  "Conditional (if)", "Too much (すぎる)", "Looks like (そう)", "Before a noun",
] as const;
export type AdjForm = (typeof ADJ_FORMS)[number];

type Table<K extends string> = Record<K, string>;

const ROWS: Record<string, string> = {
  う: "わいえお", く: "かきけこ", ぐ: "がぎげご", す: "さしせそ", つ: "たちてと",
  ぬ: "なにねの", ぶ: "ばびべぼ", む: "まみめも", る: "らりれろ",
};
const TE: Record<string, string> = {
  う: "って", つ: "って", る: "って", む: "んで", ぶ: "んで", ぬ: "んで", く: "いて", ぐ: "いで", す: "して",
};

const NONE = "—";
// Forms that don't exist or aren't used for specific verbs.
const NO_VOLITIONAL_ETC: Partial<Table<VerbForm>> = {
  "Potential (can)": NONE, Passive: NONE, Command: NONE, "Volitional (let's, casual)": NONE,
  "Polite volitional (let's)": NONE, "Want to (たい)": NONE, Causative: NONE,
};
export const OVERRIDES: Record<string, Partial<Table<VerbForm>>> = {
  ある: { ...NO_VOLITIONAL_ETC, Negative: "ない", "Past negative": "なかった", "てる (doing / state)": NONE },
  分かる: NO_VOLITIONAL_ETC,
  わかる: NO_VOLITIONAL_ETC,
  できる: NO_VOLITIONAL_ETC,
  くれる: { ...NO_VOLITIONAL_ETC, Command: "くれ" },
  知る: { "てる (doing / state)": "知ってる (= know)" },
  しる: { "てる (doing / state)": "しってる (= know)" },
};

const chatta = (te: string) => (te.endsWith("で") ? te.slice(0, -1) + "じゃった" : te.slice(0, -1) + "ちゃった");

export function conjugateVerb(w: string, type: WordType): Table<VerbForm> {
  if (type === "s" || type === "su") {
    const b = type === "s" ? w : w.slice(0, -2);
    return {
      Dictionary: b + "する", "Polite (ます)": b + "します", "Polite negative": b + "しません",
      "Polite past": b + "しました", Negative: b + "しない", Past: b + "した", "Past negative": b + "しなかった",
      "て-form": b + "して", "てる (doing / state)": b + "してる", "Want to (たい)": b + "したい",
      "Potential (can)": b + "できる", "Volitional (let's, casual)": b + "しよう",
      "Polite volitional (let's)": b + "しましょう", "Conditional (ば)": b + "すれば",
      "Conditional (たら)": b + "したら", Passive: b + "される", Causative: b + "させる", Command: b + "しろ",
      "ちゃった (oops / done)": b + "しちゃった",
    };
  }
  if (type === "k") {
    // Works for 来る / くる and compounds like 持ってくる / やってくる.
    const kanji = w.endsWith("来る");
    const stem = w.slice(0, -2);
    const ko = stem + (kanji ? "来" : "こ"), ki = stem + (kanji ? "来" : "き"), ku = stem + (kanji ? "来" : "く");
    return {
      Dictionary: ku + "る", "Polite (ます)": ki + "ます", "Polite negative": ki + "ません",
      "Polite past": ki + "ました", Negative: ko + "ない", Past: ki + "た", "Past negative": ko + "なかった",
      "て-form": ki + "て", "てる (doing / state)": ki + "てる", "Want to (たい)": ki + "たい",
      "Potential (can)": ko + "られる", "Volitional (let's, casual)": ko + "よう",
      "Polite volitional (let's)": ki + "ましょう", "Conditional (ば)": ku + "れば",
      "Conditional (たら)": ki + "たら", Passive: ko + "られる", Causative: ko + "させる", Command: ko + "い",
      "ちゃった (oops / done)": ki + "ちゃった",
    };
  }
  if (type === "i") {
    const s = w.slice(0, -1);
    return {
      Dictionary: w, "Polite (ます)": s + "ます", "Polite negative": s + "ません", "Polite past": s + "ました",
      Negative: s + "ない", Past: s + "た", "Past negative": s + "なかった", "て-form": s + "て",
      "てる (doing / state)": s + "てる", "Want to (たい)": s + "たい", "Potential (can)": s + "られる",
      "Volitional (let's, casual)": s + "よう", "Polite volitional (let's)": s + "ましょう",
      "Conditional (ば)": s + "れば", "Conditional (たら)": s + "たら", Passive: s + "られる",
      Causative: s + "させる", Command: s + "ろ", "ちゃった (oops / done)": s + "ちゃった",
    };
  }
  if (type !== "g" && type !== "iku") throw new Error(`not a verb type: ${type}`);
  const e = w.slice(-1), s = w.slice(0, -1), r = ROWS[e];
  if (!r) throw new Error(`cannot conjugate godan verb ending in '${e}'`);
  const te = type === "iku" ? s + "って" : s + (TE[e] ?? "");
  const ta = te.slice(0, -1) + (te.endsWith("で") ? "だ" : "た");
  const [a, i, eRow, o] = [r.charAt(0), r.charAt(1), r.charAt(2), r.charAt(3)];
  return {
    Dictionary: w, "Polite (ます)": s + i + "ます", "Polite negative": s + i + "ません",
    "Polite past": s + i + "ました", Negative: s + a + "ない", Past: ta, "Past negative": s + a + "なかった",
    "て-form": te, "てる (doing / state)": te + "る", "Want to (たい)": s + i + "たい",
    "Potential (can)": s + eRow + "る", "Volitional (let's, casual)": s + o + "う",
    "Polite volitional (let's)": s + i + "ましょう", "Conditional (ば)": s + eRow + "ば",
    "Conditional (たら)": ta + "ら", Passive: s + a + "れる", Causative: s + a + "せる", Command: s + eRow,
    "ちゃった (oops / done)": chatta(te),
  };
}

export function conjugateAdjective(w: string, type: "ia" | "na"): Table<AdjForm> {
  if (type === "ia") {
    const ii = w.endsWith("いい"); // いい / かっこいい conjugate from よい
    const s = ii ? w.slice(0, -2) + "よ" : w.slice(0, -1);
    return {
      Plain: w, Polite: w + "です", Negative: s + "くない", Past: s + "かった", "Past negative": s + "くなかった",
      "て-form (and…)": s + "くて", Adverb: s + "く", "Conditional (if)": s + "ければ",
      "Too much (すぎる)": s + "すぎる", "Looks like (そう)": ii ? s + "さそう" : s + "そう",
      "Before a noun": w + "〜",
    };
  }
  return {
    Plain: w + "だ", Polite: w + "です", Negative: w + "じゃない", Past: w + "だった",
    "Past negative": w + "じゃなかった", "て-form (and…)": w + "で", Adverb: w + "に",
    "Conditional (if)": w + "なら", "Too much (すぎる)": w + "すぎる", "Looks like (そう)": w + "そう",
    "Before a noun": w + "な〜",
  };
}

export interface ConjRow {
  form: string;
  word: string;
  reading: string | null; // null when identical to `word`
}

/** Full table for an item, applying per-verb overrides. Empty for non-conjugating types. */
export function conjugationRows(word: string, reading: string, type: WordType): ConjRow[] {
  const showReading = reading !== word;
  if (type === "ia" || type === "na") {
    const a = conjugateAdjective(word, type), b = conjugateAdjective(reading, type);
    return ADJ_FORMS.map((f) => ({ form: f, word: a[f], reading: showReading && b[f] !== a[f] ? b[f] : null }));
  }
  if (!["g", "i", "iku", "s", "su", "k"].includes(type)) return [];
  let a: Table<VerbForm>, b: Table<VerbForm>;
  try {
    a = { ...conjugateVerb(word, type), ...(OVERRIDES[word] ?? OVERRIDES[reading] ?? {}) };
    b = { ...conjugateVerb(reading, type), ...(OVERRIDES[reading] ?? OVERRIDES[word] ?? {}) };
  } catch {
    return []; // user-entered word that doesn't end in a conjugatable kana
  }
  return VERB_FORMS.map((f) => ({ form: f, word: a[f], reading: showReading && b[f] !== a[f] ? b[f] : null }));
}

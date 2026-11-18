// Typed-answer checking for production and cloze exercises.
// Accepts kanji or kana, katakana or hiragana, and romaji (for people without an
// IME), ignoring punctuation and whitespace.
import { isRomaji, toHiragana } from "wanakana";

const PUNCT = /[\s　。、．，,.!！?？~〜「」『』（）()…・"'`]/g;

export function normalize(s: string): string {
  let t = s.normalize("NFKC").trim().toLowerCase().replace(PUNCT, "");
  if (t && isRomaji(t)) t = toHiragana(t);
  // Katakana → hiragana, keeping kanji and the long-vowel mark ー.
  return t.replace(/[\u30a1-\u30f6]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0x60));
}

function levenshtein(a: string, b: string): number {
  const A = [...a], B = [...b];
  const dp = Array.from({ length: A.length + 1 }, (_, i) => [i, ...Array<number>(B.length).fill(0)]);
  for (let j = 1; j <= B.length; j++) dp[0]![j] = j;
  for (let i = 1; i <= A.length; i++)
    for (let j = 1; j <= B.length; j++)
      dp[i]![j] = Math.min(dp[i - 1]![j]! + 1, dp[i]![j - 1]! + 1, dp[i - 1]![j - 1]! + (A[i - 1] === B[j - 1] ? 0 : 1));
  return dp[A.length]![B.length]!;
}

export interface CheckResult {
  correct: boolean;
  /** One character off: probably a typo, shown as a hint, still graded as incorrect. */
  nearMiss: boolean;
  expected: string[];
}

export function check(input: string, accepted: string[]): CheckResult {
  const got = normalize(input);
  const exp = [...new Set(accepted.map(normalize).filter(Boolean))];
  if (!got) return { correct: false, nearMiss: false, expected: accepted };
  if (exp.includes(got)) return { correct: true, nearMiss: false, expected: accepted };
  const nearMiss = exp.some((e) => [...e].length >= 3 && levenshtein(got, e) === 1);
  return { correct: false, nearMiss, expected: accepted };
}

/** Accepted spellings for producing a vocabulary item. */
export function vocabAnswers(v: { word: string; reading: string; word_type: string }): string[] {
  const base = [v.word, v.reading].map((s) => s.replace(/^〜/, ""));
  return v.word_type === "s" ? [...base, ...base.map((b) => b + "する")] : base;
}

/** Cloze helper: blank out the word inside an example sentence, if it appears verbatim. */
export function clozeSentence(sentence: string, word: string): string | null {
  const w = word.replace(/^〜/, "");
  if (!w || !sentence.includes(w)) return null;
  return sentence.replace(w, "＿＿");
}

/**
 * Suggested rating from objective evidence. The learner can always override.
 * Never suggests Easy: that's the learner's call.
 */
export function suggestRating(correct: boolean, responseMs: number, expectedMs: number, usedHint = false): 1 | 2 | 3 {
  if (!correct) return 1;
  if (usedHint || responseMs > expectedMs * 2.5) return 2;
  return 3;
}

/** Intent matching for typed quest replies: any pattern contained in the normalized text. */
export function matchesAny(input: string, patterns: string[]): boolean {
  const t = normalize(input);
  if (!t) return false;
  return patterns.some((p) => (p.startsWith("=") ? t === normalize(p.slice(1)) : t.includes(normalize(p))));
}

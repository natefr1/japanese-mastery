import type { WordType } from "./types";

export const CATEGORIES: Record<string, { label: string; jp: string }> = {
  game: { label: "Gaming", jp: "ゲーム" },
  stream: { label: "Creator / Streaming", jp: "配信" },
  react: { label: "Reactions & Slang", jp: "リアクション" },
  social: { label: "Friends & Social", jp: "友達" },
  uni: { label: "University", jp: "大学" },
  core: { label: "Core Verbs & Words", jp: "基本" },
  keigo: { label: "Polite / Collabs", jp: "敬語" },
  grammar: { label: "Grammar Patterns", jp: "文法" },
  manga: { label: "Manga Speech", jp: "漫画" },
  core3k: { label: "Core 3000", jp: "基礎" },
};

export const categoryLabel = (c: string) => CATEGORIES[c]?.label ?? (c || "Uncategorized");

export const LEVELS = ["N5", "N4", "N3", "N2", "N1", "Slang", "Net"] as const;

export const TYPE_LABELS: Record<WordType, string> = {
  g: "godan verb",
  i: "ichidan verb",
  iku: "godan verb (行く)",
  s: "する verb",
  su: "irregular (する)",
  k: "irregular (来る)",
  ia: "い-adjective",
  na: "な-adjective",
  n: "noun",
  x: "phrase",
  adv: "adverb / connector",
  gr: "grammar",
};

export const VERB_TYPES: WordType[] = ["g", "i", "iku", "s", "su", "k"];
export const isVerb = (t: WordType) => VERB_TYPES.includes(t);
export const isAdjective = (t: WordType) => t === "ia" || t === "na";

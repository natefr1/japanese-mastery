// Mirrors of jm-core study/game types.

export type ItemType = "vocab" | "grammar" | "kanji";
export type Skill = "recognition" | "production" | "cloze";

export interface CardRow {
  id: string;
  item_type: ItemType;
  item_id: string;
  skill: Skill;
  due: number;
  stability: number;
  difficulty: number;
  elapsed_days: number;
  scheduled_days: number;
  learning_steps: number;
  reps: number;
  lapses: number;
  state: number;
  last_review: number | null;
  introduced_at: number | null;
  suspended: boolean;
  rev: number;
}

export interface FsrsState {
  due: number;
  stability: number;
  difficulty: number;
  elapsed_days: number;
  scheduled_days: number;
  learning_steps: number;
  reps: number;
  lapses: number;
  state: number;
  last_review: number | null;
}

export interface QueueData {
  due: CardRow[];
  new_candidates: CardRow[];
  new_today: number;
  reviews_today: number;
  retention_30d: number | null;
  retention_samples: number;
  avg_ms: [string, number][];
}

export interface Grant {
  currency: "xp" | "yen";
  amount: number;
  reason: string;
}

export interface ReviewSubmit {
  card_id: string;
  expected_rev: number;
  rating: 1 | 2 | 3 | 4;
  reviewed_at: number;
  next: FsrsState;
  response_ms?: number | null;
  auto_correct?: boolean | null;
  answer?: string | null;
  session_id?: string | null;
  source: "review" | "placement";
  day: string;
}

export interface ReviewOutcome {
  card: CardRow;
  grants: Grant[];
}

export interface SessionSummary {
  cards_done: number;
  new_done: number;
  again: number;
  accuracy: number | null;
  avg_ms: number | null;
  grants: Grant[];
}

export interface SkillMastery {
  item_type: ItemType;
  skill: Skill;
  total: number;
  introduced: number;
  learning: number;
  known: number;
  mature: number;
  retention_30d: number | null;
  retention_samples: number;
}

export interface Overview {
  due_now: number;
  due_today: number;
  new_available: number;
  new_today: number;
  reviews_today: number;
  retention_30d: number | null;
  retention_samples: number;
  studied_days_last_7: boolean[];
  forecast_14: number[];
  mastery: SkillMastery[];
}

export interface StatsDetail {
  daily: { day_offset: number; reviews: number; again: number }[];
  weak: { card: CardRow; recent_again: number }[];
  avg_ms_by_skill: [string, number][];
  total_reviews: number;
}

export interface GrammarPoint {
  id: string;
  slug: string;
  level: string;
  title: string;
  meaning: string;
  formation: string;
  explanation: string;
  examples: { jp: string; en: string }[];
  cloze: { prompt: string; answers: string[]; en: string; hint?: string }[];
  mistakes: string[];
  compare: { slug: string; note: string }[];
  prereqs: string[];
  position: number;
}

export interface Kanji {
  id: string;
  character: string;
  meanings: string[];
  on: string[];
  kun: string[];
  jlpt: number | null;
  strokes: number | null;
  grade: number | null;
}

export interface PlayerState {
  xp: number;
  yen: number;
  level: number;
  level_floor: number;
  level_ceil: number;
  xp_today: number;
  review_xp_today: number;
  review_xp_cap: number;
  daily_goal_done: boolean;
}

export interface QuestProgress {
  quest_id: string;
  completions: number;
  best_score: number;
  last_completed_at: number | null;
}

export interface CharacterState {
  id: string;
  relationship: number;
  memories: { id: string; fact: string; source: string; created_at: number }[];
}

export interface PassportEntry {
  id: string;
  kind: string;
  title: string;
  detail: string;
  simulated: boolean;
  created_at: number;
}

export interface QuestReward {
  grants: Grant[];
  first_completion: boolean;
  relationship_applied: [string, number][];
  memories_added: number;
  passport_added: number;
}

export interface StudyPrefs {
  onboarded: boolean;
  level: string; // self-reported, e.g. "N4"
  startLevel: string; // where new cards start
  newPerDay: number;
  dailyGoal: number;
  sessionMinutes: number;
  retention: number;
  focusCategories: string[];
  interests: string[];
  goals: string[];
  productionBias: boolean;
  includeGrammar: boolean;
  includeKanji: boolean;
  challenge: "gentle" | "balanced" | "challenging";
  /** Include the 3,000-word core frequency deck when introducing new words. */
  useCore: boolean;
  /** Show English translations in 生活 by default (otherwise tap to reveal). */
  showEnglish: boolean;
  ttsRate: number;
}

export const DEFAULT_PREFS: StudyPrefs = {
  onboarded: false,
  level: "N4",
  startLevel: "N4",
  newPerDay: 10,
  dailyGoal: 30,
  sessionMinutes: 12,
  retention: 0.9,
  focusCategories: [],
  interests: [],
  goals: [],
  productionBias: true,
  includeGrammar: true,
  includeKanji: true,
  challenge: "balanced",
  useCore: true,
  showEnglish: false,
  ttsRate: 1,
};

// Typed wrappers over Tauri commands. All persistence goes through here.
import { invoke } from "@tauri-apps/api/core";
import type {
  AppStatus, BackupInfo, FileFormat, ImportMode, ImportReport, VerifyResult,
  VocabInput, VocabItem, VocabStats,
} from "./types";
import type {
  CardRow, CharacterState, GrammarPoint, Kanji, Overview, PassportEntry, PlayerState, QuestProgress, QuestReward,
  QueueData, ReviewOutcome, ReviewSubmit, SessionSummary, StatsDetail,
} from "./learning/types";

export interface Sample {
  id?: string | null;
  series: string;
  title: string;
  text: string;
  created_at?: number;
  updated_at?: number;
}

export interface QuestCompletion {
  quest_id: string;
  success: boolean;
  score: number;
  started_at: number;
  relationship: [string, number][];
  memories: { character: string; fact: string }[];
  passport: { kind: string; title: string; detail: string }[];
  outcome: unknown;
}

export const isTauri = (): boolean => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (!isTauri()) {
    throw new Error("Japanese Mastery must run inside the desktop app (npm run tauri dev).");
  }
  try {
    return await invoke<T>(cmd, args);
  } catch (e) {
    throw new Error(typeof e === "string" ? e : e instanceof Error ? e.message : String(e));
  }
}

export const api = {
  status: () => call<AppStatus>("app_status"),

  vocabList: () => call<VocabItem[]>("vocab_list"),
  vocabSave: (input: VocabInput) => call<VocabItem>("vocab_save", { input }),
  vocabDelete: (id: string) => call<void>("vocab_delete", { id }),
  vocabRestore: (id: string) => call<void>("vocab_restore", { id }),
  vocabStats: () => call<VocabStats>("vocab_stats"),

  settingsGet: () => call<Record<string, unknown>>("settings_get"),
  settingsSet: (key: string, value: unknown) => call<void>("settings_set", { key, value }),

  vocabExport: (path: string, format: FileFormat) => call<number>("vocab_export", { path, format }),
  vocabImport: (path: string, format: FileFormat, mode: ImportMode) =>
    call<ImportReport>("vocab_import", { path, format, mode }),

  backupCreate: (reason?: "pre-update") => call<BackupInfo>("backup_create", { reason: reason ?? null }),
  backupList: () => call<BackupInfo[]>("backup_list"),
  backupVerify: (id: string) => call<VerifyResult>("backup_verify", { id }),
  backupRestore: (id: string) => call<BackupInfo>("backup_restore", { id }),

  // Study Center
  studyQueue: (now: number, dayStart: number) => call<QueueData>("study_queue", { now, dayStart }),
  reviewSubmit: (submit: ReviewSubmit) => call<ReviewOutcome>("review_submit", { submit }),
  cardSuspend: (id: string, suspended: boolean) => call<void>("card_suspend", { id, suspended }),
  cardsOfType: (itemType: "vocab" | "grammar" | "kanji") => call<CardRow[]>("cards_of_type", { itemType }),
  sessionStart: (mode: string, minutes: number) => call<string>("session_start", { mode, minutes }),
  sessionEnd: (id: string, day: string, dayStart: number, goal: number) => call<SessionSummary>("session_end", { id, day, dayStart, goal }),
  studyOverview: (now: number, dayStart: number) => call<Overview>("study_overview", { now, dayStart }),
  studyStats: (dayStart: number) => call<StatsDetail>("study_stats", { dayStart }),
  grammarList: () => call<GrammarPoint[]>("grammar_list"),
  kanjiList: () => call<Kanji[]>("kanji_list"),

  // Reading samples
  sampleSave: (sample: Sample) => call<Sample>("sample_save", { sample }),
  sampleList: () => call<Sample[]>("sample_list"),
  sampleDelete: (id: string) => call<void>("sample_delete", { id }),

  // 生活 / progression
  playerState: (day: string) => call<PlayerState>("player_state", { day }),
  questComplete: (completion: QuestCompletion, day: string) => call<QuestReward>("quest_complete", { completion, day }),
  questProgress: () => call<QuestProgress[]>("quest_progress"),
  characters: () => call<CharacterState[]>("characters_list"),
  memoryDelete: (id: string) => call<void>("memory_delete", { id }),
  passport: () => call<PassportEntry[]>("passport_list"),
  passportAddReal: (title: string, detail: string) => call<void>("passport_add_real", { title, detail }),
};

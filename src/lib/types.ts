// Mirrors of jm-core Rust types (serde field names).

export type WordType = "g" | "i" | "iku" | "s" | "su" | "k" | "ia" | "na" | "n" | "x" | "adv" | "gr";

export interface Example {
  jp: string;
  en: string;
}

export interface VocabItem {
  id: string;
  word: string;
  reading: string;
  meaning: string;
  word_type: WordType;
  level: string;
  category: string;
  note: string;
  personal_note: string;
  pitch_accent: string | null;
  audio_ref: string | null;
  tags: string[];
  examples: Example[];
  freq_rank: number | null;
  source: string;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
  rev: number;
}

export interface VocabInput {
  id?: string | null;
  word: string;
  reading: string;
  meaning: string;
  word_type: WordType;
  level: string;
  category: string;
  note: string;
  personal_note: string;
  pitch_accent?: string | null;
  tags: string[];
  examples: Example[];
  freq_rank?: number | null;
}

export interface VocabStats {
  total: number;
  deleted: number;
  user_added: number;
  by_category: [string, number][];
  by_level: [string, number][];
}

export interface OpenReport {
  created_new: boolean;
  migrated_from: number;
  migrated_to: number;
  seeded: number;
  pre_migration_backup: string | null;
  recovered_from_backup: string | null;
  quarantined_file: string | null;
}

export interface AppStatus {
  ok: boolean;
  error: string | null;
  report: OpenReport | null;
  schema_version: number;
  device_id: string;
  data_dir: string;
  backup_dir: string;
  app_version: string;
}

export interface BackupInfo {
  id: string;
  file_name: string;
  created_at: number;
  reason: string;
  schema_version: number;
  size_bytes: number;
  sha256: string;
  vocab_count: number;
  app_version: string;
}

export interface VerifyResult {
  ok: boolean;
  checksum_ok: boolean;
  integrity_ok: boolean;
  schema_version: number;
  message: string;
}

export type ImportMode = "skip_existing" | "update_existing";
export type FileFormat = "json" | "csv";

export interface ImportReport {
  added: number;
  updated: number;
  skipped: number;
  errors: string[];
}

export interface Settings {
  theme: "dark" | "light" | "system";
  textScale: number; // percent
  motion: boolean;
  sounds: boolean;
  /** Check GitHub for a new version when the app starts (the only network call the app makes). */
  autoUpdate: boolean;
}

export const DEFAULT_SETTINGS: Settings = { theme: "dark", textScale: 100, motion: true, sounds: true, autoUpdate: true };

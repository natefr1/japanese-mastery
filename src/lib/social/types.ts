// Types mirroring jm-core's social layer (chat.rs, npc.rs, memory.rs, social.rs).

export type MsgKind = "text" | "sticker" | "plan" | "system" | "reaction";
export type ReplyState = "none" | "pending" | "done" | "failed" | "read_only";

export interface Message {
  id: string;
  conversation_id: string;
  sender_id: string; // "player" | "system" | character id
  kind: MsgKind;
  body: string;
  sticker_id: string | null;
  meta: Record<string, unknown> | null;
  status: string;
  created_at: number;
  deliver_at: number;
  read_by_npc_at: number | null;
  reply_state: ReplyState | null;
  reply_error: string | null;
  reactions: [string, string][];
}

export interface Typing { member_id: string; until: number }

export interface ConversationView {
  id: string;
  kind: "direct" | "group" | "memo";
  title: string;
  avatar: string;
  members: string[];
  pinned: boolean;
  muted: boolean;
  archived: boolean;
  last_activity_at: number;
  last_message: Message | null;
  unread: number;
  typing: Typing[];
  next_change_at: number | null;
  draft: string | null;
}

export interface NpcState {
  character_id: string;
  closeness: number;
  trust: number;
  shared_experiences: number;
  meaningful_days: number;
  last_meaningful_day: string | null;
  last_player_msg_at: number | null;
  last_npc_msg_at: number | null;
  last_initiated_at: number | null;
}

export interface NpcView {
  id: string;
  name: string;
  display: string;
  full_name: string;
  age: number;
  color: string;
  role: string;
  bio: string;
  personality: string[];
  interests: string[];
  active_hours: [number, number][];
  state: NpcState;
  score: number;
  register_stage: number;
  register_label: string;
  online_now: boolean;
  busy_now: string | null;
  relations: [string, string, string][];
}

export interface Memory {
  id: string;
  character_id: string;
  fact: string;
  kind: string;
  importance: number;
  confidence: number;
  source: string;
  source_message_id: string | null;
  verified: boolean;
  created_at: number;
  last_used_at: number | null;
}

export interface Sticker { id: string; caption: string; meaning: string; face: string; prop: string }
export interface StickerPack { id: string; name: string; price_yen: number; stickers: Sticker[] }
export interface StickerState { owned: string[]; favorites: string[]; recent: string[] }
export interface Stickers { packs: StickerPack[]; state: StickerState }

export interface Notification { id: string; conversation_id: string | null; title: string; body: string; created_at: number; seen: boolean }
export interface CallLog { id: string; character_id: string; direction: string; kind: string; status: string; duration_s: number | null; created_at: number }
export interface SearchHit { message: Message; conversation_title: string }

export interface CalendarEvent {
  id: string;
  title: string;
  starts_at: number | null;
  when_text: string;
  place: string;
  participants: string[];
  source_message_id: string | null;
  status: "planned" | "done" | "cancelled" | string;
  created_at: number;
}

export type ObsCategory = "error" | "unnatural" | "natural_casual" | "slang" | "success" | "vocab";
export interface Observation {
  id: string;
  conversation_id: string;
  message_id: string | null;
  category: ObsCategory;
  original: string;
  suggestion: string;
  note: string;
  payload: unknown;
  created_at: number;
}
export interface VocabNote { word: string; reading?: string; meaning?: string }
export interface Review { items: Observation[]; vocab: VocabNote[]; overall: string }

export type Pace = "fast" | "natural" | "realistic";
export interface SocialSettings {
  background: boolean;
  quiet_start: number;
  quiet_end: number;
  max_initiations_per_day: number;
  min_gap_minutes: number;
  daily_ai_budget: number;
  background_ai_budget: number;
  group_activity: boolean;
}
export interface PlayerInfo { name: string; status_message: string; level_note: string }
export interface SocialConfig {
  social: SocialSettings;
  pace: Pace;
  player: PlayerInfo;
  tz_offset_min: number;
  notifications: boolean;
  notification_preview: boolean;
  close_to_tray: boolean;
  paused: boolean;
}

export type ProviderKind = "none" | "anthropic" | "openai" | "gemini" | "openai_compat";
export interface ProviderConfig { kind: ProviderKind; chat_model: string; review_model: string; base_url: string }
export interface Consent { granted: boolean; at: number; provider: ProviderKind | null }
export interface Usage { requests: number; background_requests: number; input_tokens: number; output_tokens: number }
export interface AiStatus {
  config: ProviderConfig;
  has_key: boolean;
  consent: Consent;
  ready: boolean;
  problem: string | null;
  usage_today: Usage;
  daily_budget: number;
  background_budget: number;
}

export interface Outgoing { conversation_id: string; kind: "text" | "sticker"; body: string; sticker_id: string | null }

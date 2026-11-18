// Typed wrappers for the phone/social commands, plus the live "chat-changed" feed.
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useEffect, useRef } from "react";
import { isTauri } from "../api";
import type {
  AiStatus, CalendarEvent, CallLog, ConversationView, Memory, Message, NpcView, Notification, Observation,
  Outgoing, ProviderConfig, ProviderKind, Review, SearchHit, SocialConfig, Stickers,
} from "./types";

async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (!isTauri()) throw new Error("The phone needs the desktop app.");
  try {
    return await invoke<T>(cmd, args);
  } catch (e) {
    throw new Error(typeof e === "string" ? e : e instanceof Error ? e.message : String(e));
  }
}

export const social = {
  configGet: () => call<SocialConfig>("social_config_get"),
  configSet: (config: SocialConfig) => call<SocialConfig>("social_config_set", { config }),
  clock: () => call<SocialConfig>("social_clock", { tzOffsetMin: -new Date().getTimezoneOffset() }),

  npcs: () => call<NpcView[]>("npc_list"),
  memories: (character: string) => call<Memory[]>("npc_memories", { character }),
  memoryAdd: (character: string, fact: string) => call<void>("npc_memory_add", { character, fact }),
  memoryCorrect: (id: string, fact: string) => call<void>("npc_memory_correct", { id, fact }),
  memoryDelete: (id: string) => call<void>("memory_delete", { id }),
  memoryDeleteAll: (character: string) => call<number>("npc_memory_delete_all", { character }),

  chats: () => call<ConversationView[]>("chat_list"),
  chat: (id: string) => call<ConversationView>("chat_get", { id }),
  messages: (id: string, before?: number, limit?: number) => call<Message[]>("chat_messages", { id, before: before ?? null, limit: limit ?? null }),
  send: (outgoing: Outgoing) => call<Message>("chat_send", { outgoing }),
  open: (id: string | null) => call<void>("chat_open", { id }),
  markRead: (id: string) => call<void>("chat_mark_read", { id }),
  flag: (id: string, flag: "pinned" | "muted" | "archived", on: boolean) => call<void>("chat_flag", { id, flag, on }),
  draft: (id: string, body: string) => call<void>("chat_draft", { id, body }),
  react: (messageId: string, emoji: string | null) => call<void>("chat_react", { messageId, emoji }),
  retry: (id: string) => call<number>("chat_retry", { id }),
  clear: (id: string) => call<void>("chat_clear", { id }),
  search: (q: string) => call<SearchHit[]>("chat_search", { q }),

  review: (id: string) => call<Review>("chat_review", { id }),
  observations: (id: string) => call<Observation[]>("chat_observations", { id }),
  hint: (id: string) => call<string>("chat_hint", { id }),
  gloss: (word: string, sentence: string) => call<string>("chat_gloss", { word, sentence }),

  notifications: () => call<Notification[]>("notifications_list"),
  notificationsSeen: () => call<void>("notifications_seen"),
  calls: () => call<CallLog[]>("calls_list"),
  callAttempt: (character: string, kind: "voice" | "video") => call<string>("call_attempt", { character, kind }),

  stickers: () => call<Stickers>("stickers_get"),
  stickerFavorite: (id: string, fav: boolean) => call<void>("sticker_favorite", { id, fav }),
  stickerBuy: (pack: string) => call<void>("sticker_buy", { pack }),

  calendar: () => call<CalendarEvent[]>("calendar_list"),
  calendarStatus: (id: string, status: string) => call<void>("calendar_status", { id, status }),

  aiStatus: () => call<AiStatus>("ai_status"),
  aiConfigure: (config: ProviderConfig) => call<AiStatus>("ai_configure", { config }),
  aiSaveKey: (kind: ProviderKind, key: string) => call<AiStatus>("ai_save_key", { kind, key }),
  aiClearKey: (kind: ProviderKind) => call<AiStatus>("ai_clear_key", { kind }),
  aiConsent: (granted: boolean) => call<AiStatus>("ai_consent", { granted }),
  aiTest: () => call<string>("ai_test"),

  deleteData: (what: "chats" | "memories" | "observations") => call<number>("social_delete", { what }),
  autostartGet: () => call<boolean>("autostart_get"),
  autostartSet: (on: boolean) => call<boolean>("autostart_set", { on }),
};

/** Calls `fn(conversationIds)` whenever the runtime reports chat changes. */
export function useChatChanged(fn: (ids: string[]) => void) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    if (!isTauri()) return;
    let off: (() => void) | undefined;
    let dead = false;
    listen<{ conversations: string[] }>("chat-changed", (e) => ref.current(e.payload.conversations)).then((u) => {
      if (dead) u();
      else off = u;
    });
    return () => {
      dead = true;
      off?.();
    };
  }, []);
}

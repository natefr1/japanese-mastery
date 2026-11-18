// Shared phone state: characters, conversations, stickers, config and AI status,
// refreshed from the runtime's "chat-changed" events rather than polling.
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { social, useChatChanged } from "../../../lib/social/api";
import type { AiStatus, ConversationView, NpcView, SocialConfig, Sticker, Stickers } from "../../../lib/social/types";
import { worldStore, type NavAction, type PhoneScreen } from "../../../lib/game/worldNav";

interface PhoneCtx {
  npcs: NpcView[];
  npc: (id: string) => NpcView | undefined;
  chats: ConversationView[];
  stickers: Stickers | null;
  sticker: (id: string) => Sticker | undefined;
  config: SocialConfig | null;
  ai: AiStatus | null;
  error: string | null;
  refresh: () => Promise<void>;
  refreshAi: () => Promise<void>;
  setConfig: (c: SocialConfig) => Promise<void>;
  push: (s: PhoneScreen) => void;
  back: () => void;
  nav: (a: NavAction) => void;
}

const Ctx = createContext<PhoneCtx | null>(null);
export const usePhone = () => {
  const c = useContext(Ctx);
  if (!c) throw new Error("usePhone outside PhoneProvider");
  return c;
};

export function PhoneProvider({ children }: { children: ReactNode }) {
  const [npcs, setNpcs] = useState<NpcView[]>([]);
  const [chats, setChats] = useState<ConversationView[]>([]);
  const [stickers, setStickers] = useState<Stickers | null>(null);
  const [config, setConfigState] = useState<SocialConfig | null>(null);
  const [ai, setAi] = useState<AiStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [n, c, s] = await Promise.all([social.npcs(), social.chats(), social.stickers()]);
      setNpcs(n);
      setChats(c);
      setStickers(s);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  const refreshAi = useCallback(async () => {
    try {
      setAi(await social.aiStatus());
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    social.clock().then(setConfigState).catch((e: Error) => setError(e.message));
    refresh();
    refreshAi();
  }, [refresh, refreshAi]);

  // Coalesce bursts of events into one list refresh.
  const [tick, setTick] = useState(0);
  useChatChanged(() => setTick((t) => t + 1));
  useEffect(() => {
    if (!tick) return;
    const t = setTimeout(() => {
      social.chats().then(setChats).catch(() => {});
      social.npcs().then(setNpcs).catch(() => {});
    }, 120);
    return () => clearTimeout(t);
  }, [tick]);

  const value = useMemo<PhoneCtx>(() => {
    const stickerMap = new Map<string, Sticker>();
    stickers?.packs.forEach((p) => p.stickers.forEach((s) => stickerMap.set(s.id, s)));
    return {
      npcs,
      npc: (id) => npcs.find((n) => n.id === id),
      chats,
      stickers,
      sticker: (id) => stickerMap.get(id),
      config,
      ai,
      error,
      refresh,
      refreshAi,
      setConfig: async (c) => {
        setConfigState(await social.configSet(c));
      },
      push: (s) => worldStore.dispatch({ t: "phone.push", screen: s }),
      back: () => worldStore.dispatch({ t: "phone.back" }),
      nav: (a) => worldStore.dispatch(a),
    };
  }, [npcs, chats, stickers, config, ai, error, refresh, refreshAi]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

// ---------------- formatting helpers ----------------

export function timeLabel(ms: number, now = Date.now()): string {
  const d = new Date(ms);
  const n = new Date(now);
  const hm = d.toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" });
  if (d.toDateString() === n.toDateString()) return hm;
  const y = new Date(now - 86_400_000);
  if (d.toDateString() === y.toDateString()) return "昨日";
  if (now - ms < 6 * 86_400_000) return ["日", "月", "火", "水", "木", "金", "土"][d.getDay()] + "曜日";
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

export function dayLabel(ms: number): string {
  const d = new Date(ms);
  const wd = ["日", "月", "火", "水", "木", "金", "土"][d.getDay()];
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return "今日";
  if (d.toDateString() === new Date(Date.now() - 86_400_000).toDateString()) return "昨日";
  return `${d.getMonth() + 1}月${d.getDate()}日(${wd})`;
}

export function preview(c: ConversationView, npcName: (id: string) => string, stickerCaption: (id: string) => string | undefined): string {
  if (c.typing.length) return c.kind === "group" ? `${npcName(c.typing[0]!.member_id)}が入力中…` : "入力中…";
  if (c.draft) return `[下書き] ${c.draft}`;
  const m = c.last_message;
  if (!m) return "";
  const who = c.kind === "group" && m.sender_id !== "player" && m.sender_id !== "system" ? `${npcName(m.sender_id)}: ` : "";
  if (m.kind === "sticker") return `${who}スタンプ${m.sticker_id ? `「${stickerCaption(m.sticker_id) ?? ""}」` : ""}`;
  if (m.kind === "plan") return `📅 ${m.body}`;
  return who + m.body;
}

/** Esc closes the innermost open thing first (capture phase, before the phone's own Esc). */
export function useEscape(onEsc: () => void, active = true) {
  useEffect(() => {
    if (!active) return;
    const k = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.defaultPrevented) {
        e.preventDefault();
        onEsc();
      }
    };
    window.addEventListener("keydown", k, true);
    return () => window.removeEventListener("keydown", k, true);
  }, [onEsc, active]);
}

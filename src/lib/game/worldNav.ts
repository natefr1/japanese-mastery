// 生活 navigation as an explicit state machine. The world (map/exploration/quest)
// is always the base layer and stays mounted; the phone, panels and sheets are
// overlays stacked on top. Closing any overlay reveals exactly what was beneath it,
// so there is no state in which nothing is rendered (the old blank-screen bug).

export type Scene = { kind: "town" } | { kind: "quest"; questId: string };

export type PhoneScreen =
  | { s: "home" }
  | { s: "chats" }
  | { s: "calls" }
  | { s: "stickers" }
  | { s: "settings" }
  | { s: "notifications" }
  | { s: "chat"; id: string }
  | { s: "profile"; id: string }
  | { s: "review"; id: string };

export type PhoneTab = "home" | "chats" | "calls" | "stickers" | "settings";

export type Panel = "relationships" | "journal" | "calendar" | "passport" | "inventory" | "apartment" | "achievements" | "map";

export interface WorldNav {
  scene: Scene;
  phone: { open: boolean; booted: boolean; stack: PhoneScreen[] };
  panel: Panel | null;
}

export type NavAction =
  | { t: "phone.open"; screen?: PhoneScreen }
  | { t: "phone.close" }
  | { t: "phone.booted" }
  | { t: "phone.push"; screen: PhoneScreen }
  | { t: "phone.back" }
  | { t: "phone.tab"; tab: PhoneTab }
  | { t: "panel.open"; panel: Panel }
  | { t: "panel.close" }
  | { t: "quest.start"; questId: string }
  | { t: "quest.end" }
  | { t: "escape" };

export const initialNav: WorldNav = { scene: { kind: "town" }, phone: { open: false, booted: false, stack: [{ s: "chats" }] }, panel: null };

const TABS: PhoneTab[] = ["home", "chats", "calls", "stickers", "settings"];
const isTab = (x: PhoneScreen) => (TABS as string[]).includes(x.s);
const same = (a: PhoneScreen, b: PhoneScreen) => JSON.stringify(a) === JSON.stringify(b);

export function navReducer(st: WorldNav, a: NavAction): WorldNav {
  switch (a.t) {
    case "phone.open": {
      // Reopening restores the stack where you left it; a target screen is pushed on top.
      let stack = st.phone.stack.length ? st.phone.stack : [{ s: "chats" } as PhoneScreen];
      if (a.screen && !same(stack[stack.length - 1]!, a.screen)) {
        stack = isTab(a.screen) ? [a.screen] : [...stack.filter((x) => isTab(x)).slice(-1), a.screen];
      }
      return { ...st, panel: null, phone: { ...st.phone, open: true, stack } };
    }
    case "phone.close":
      return { ...st, phone: { ...st.phone, open: false } };
    case "phone.booted":
      return { ...st, phone: { ...st.phone, booted: true } };
    case "phone.push": {
      const top = st.phone.stack[st.phone.stack.length - 1];
      if (top && same(top, a.screen)) return st;
      return { ...st, phone: { ...st.phone, stack: [...st.phone.stack, a.screen].slice(-12) } };
    }
    case "phone.back": {
      if (st.phone.stack.length <= 1) return { ...st, phone: { ...st.phone, open: false } };
      return { ...st, phone: { ...st.phone, stack: st.phone.stack.slice(0, -1) } };
    }
    case "phone.tab":
      return { ...st, phone: { ...st.phone, stack: [{ s: a.tab } as PhoneScreen] } };
    case "panel.open":
      return { ...st, panel: a.panel, phone: { ...st.phone, open: false } };
    case "panel.close":
      return { ...st, panel: null };
    case "quest.start":
      return { ...st, scene: { kind: "quest", questId: a.questId }, panel: null, phone: { ...st.phone, open: false } };
    case "quest.end":
      return { ...st, scene: { kind: "town" } };
    case "escape":
      // Topmost layer first: phone screen → phone → panel. Scenes are never closed by Esc.
      if (st.phone.open) return navReducer(st, { t: "phone.back" });
      if (st.panel) return { ...st, panel: null };
      return st;
  }
}

export const phoneTop = (st: WorldNav): PhoneScreen => st.phone.stack[st.phone.stack.length - 1] ?? { s: "chats" };

/** Something is always on screen: the scene is never empty. */
export function visibleLayers(st: WorldNav): string[] {
  const l = [st.scene.kind === "quest" ? `quest:${st.scene.questId}` : "town"];
  if (st.panel) l.push(`panel:${st.panel}`);
  if (st.phone.open) l.push(`phone:${phoneTop(st).s}`);
  return l;
}

// A tiny store so the state survives page switches (the sidebar remounts pages).
type Listener = () => void;
let current: WorldNav = load();
const listeners = new Set<Listener>();

function load(): WorldNav {
  try {
    const raw = sessionStorage.getItem("jm.worldNav");
    if (raw) {
      const v = JSON.parse(raw) as WorldNav;
      if (v && v.scene && v.phone && Array.isArray(v.phone.stack)) return { ...v, phone: { ...v.phone, open: false } };
    }
  } catch {
    /* storage unavailable */
  }
  return initialNav;
}

export const worldStore = {
  get: () => current,
  dispatch(a: NavAction) {
    const next = navReducer(current, a);
    if (next === current) return;
    current = next;
    try {
      sessionStorage.setItem("jm.worldNav", JSON.stringify(current));
    } catch {
      /* ignore */
    }
    listeners.forEach((l) => l());
  },
  subscribe(l: Listener) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
  reset() {
    current = initialNav;
    listeners.forEach((l) => l());
  },
};

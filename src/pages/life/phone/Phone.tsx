// The in-world phone running ハナシ (hanashi), an original messaging app.
// Rendered as an overlay above the world; the world stays mounted underneath.
import { useEffect, useState, useSyncExternalStore } from "react";
import { phoneTop, worldStore, type PhoneScreen, type PhoneTab } from "../../../lib/game/worldNav";
import { ErrorBoundary } from "../../../components/ErrorBoundary";
import { HanashiMark } from "./art";
import { PhoneProvider, usePhone } from "./ctx";
import { CallsScreen, ChatsScreen, HomeScreen, NotificationsScreen, StickerShop } from "./Lists";
import { Conversation } from "./Conversation";
import { ProfileScreen } from "./Profile";
import { ReviewScreen } from "./Review";
import { PhoneSettings } from "./PhoneSettings";
import "./phone.css";

export function useWorldNav() {
  return useSyncExternalStore(worldStore.subscribe, worldStore.get, worldStore.get);
}

const TABS: { tab: PhoneTab; label: string; icon: string }[] = [
  { tab: "home", label: "ホーム", icon: "M4 11l8-7 8 7v8a1 1 0 0 1-1 1h-4v-6H9v6H5a1 1 0 0 1-1-1z" },
  { tab: "chats", label: "トーク", icon: "M4 6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H9l-4 3v-3a2 2 0 0 1-1-2z" },
  { tab: "calls", label: "通話", icon: "M6 3h3l2 5-2.5 1.5a11 11 0 0 0 6 6L16 13l5 2v3a2 2 0 0 1-2 2A16 16 0 0 1 4 5a2 2 0 0 1 2-2z" },
  { tab: "stickers", label: "スタンプ", icon: "M12 3a9 9 0 1 0 9 9h-5a4 4 0 0 1-4-4zM15 3.5V8a1 1 0 0 0 1 1h4.5" },
  { tab: "settings", label: "設定", icon: "M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zm8 3l2-1-1-3-2 .2-1.3-1.3.2-2-3-1-1 2h-1.8l-1-2-3 1 .2 2L6 7.2 4 7 3 10l2 1v1.8l-2 1 1 3 2-.2 1.3 1.3-.2 2 3 1 1-2h1.8l1 2 3-1-.2-2 1.3-1.3 2 .2 1-3-2-1z" },
];

export default function Phone() {
  const nav = useWorldNav();
  if (!nav.phone.open) return null;
  return (
    <div className="phone-overlay" onMouseDown={(e) => e.target === e.currentTarget && worldStore.dispatch({ t: "phone.close" })}>
      <div className="phone-device" role="dialog" aria-modal="true" aria-label="Phone">
        <div className="phone-notch" />
        <StatusBar />
        <ErrorBoundary label="phone" onReset={() => worldStore.dispatch({ t: "phone.tab", tab: "chats" })}>
          <PhoneProvider>
            {nav.phone.booted ? <PhoneBody /> : <Splash />}
          </PhoneProvider>
        </ErrorBoundary>
        <button className="phone-home-bar" aria-label="Close phone" title="Close phone (Esc)" onClick={() => worldStore.dispatch({ t: "phone.close" })} />
      </div>
    </div>
  );
}

function StatusBar() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 15_000);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="phone-status">
      <span>{now.toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" })}</span>
      <span className="phone-status-icons" aria-hidden="true">
        <svg width="16" height="11" viewBox="0 0 16 11"><path d="M1 10h2V7H1zm4 0h2V5H5zm4 0h2V3H9zm4 0h2V1h-2z" fill="currentColor" /></svg>
        <svg width="22" height="11" viewBox="0 0 22 11"><rect x=".5" y=".5" width="19" height="10" rx="2.5" fill="none" stroke="currentColor" /><rect x="2" y="2" width="14" height="7" rx="1.5" fill="currentColor" /><rect x="20.5" y="3.5" width="1.5" height="4" rx=".7" fill="currentColor" /></svg>
      </span>
    </div>
  );
}

function Splash() {
  useEffect(() => {
    const t = setTimeout(() => worldStore.dispatch({ t: "phone.booted" }), 1100);
    return () => clearTimeout(t);
  }, []);
  return (
    <div className="splash" onClick={() => worldStore.dispatch({ t: "phone.booted" })}>
      <div className="splash-mark"><HanashiMark size={88} /></div>
      <div className="splash-name">ハナシ</div>
      <div className="splash-sub">hanashi</div>
    </div>
  );
}

function PhoneBody() {
  const nav = useWorldNav();
  const top = phoneTop(nav);
  const depth = nav.phone.stack.length;
  const { chats } = usePhone();
  const unread = chats.filter((c) => !c.muted && !c.archived).reduce((a, c) => a + c.unread, 0);
  const isTab = TABS.some((t) => t.tab === top.s);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Menus, pickers and sheets inside the phone handle Esc first (capture phase).
      if (e.key !== "Escape" || e.defaultPrevented) return;
      e.preventDefault();
      worldStore.dispatch({ t: "escape" });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="phone-screen">
      <div className="phone-view" key={`${depth}:${JSON.stringify(top)}`} data-dir={isTab ? "fade" : "push"}>
        <Screen s={top} />
      </div>
      {isTab && (
        <nav className="tabbar" aria-label="Phone tabs">
          {TABS.map((t) => (
            <button key={t.tab} className={`tab${top.s === t.tab ? " on" : ""}`} onClick={() => worldStore.dispatch({ t: "phone.tab", tab: t.tab })} aria-current={top.s === t.tab ? "page" : undefined}>
              <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true"><path d={t.icon} fill={top.s === t.tab ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" /></svg>
              <span>{t.label}</span>
              {t.tab === "chats" && unread > 0 && <span className="tab-badge">{unread > 99 ? "99+" : unread}</span>}
            </button>
          ))}
        </nav>
      )}
    </div>
  );
}

function Screen({ s }: { s: PhoneScreen }) {
  switch (s.s) {
    case "home": return <HomeScreen />;
    case "chats": return <ChatsScreen />;
    case "calls": return <CallsScreen />;
    case "stickers": return <StickerShop />;
    case "settings": return <PhoneSettings />;
    case "notifications": return <NotificationsScreen />;
    case "chat": return <Conversation id={s.id} />;
    case "profile": return <ProfileScreen id={s.id} />;
    case "review": return <ReviewScreen id={s.id} />;
  }
}

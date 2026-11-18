// 生活: the life-sim. The world (walkable neighbourhood or a quest scene) is the
// base layer and always stays mounted; menus and the phone are overlays on top,
// driven by the worldNav state machine. Closing an overlay always reveals the world.
import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../../lib/api";
import { localDay } from "../../lib/day";
import { QUESTS, questById } from "../../lib/game/questData";
import { worldStore, type Panel } from "../../lib/game/worldNav";
import type { PassportEntry, PlayerState, QuestProgress } from "../../lib/learning/types";
import { useNav } from "../../lib/nav";
import { social, useChatChanged } from "../../lib/social/api";
import type { CalendarEvent, ConversationView, NpcView, Stickers } from "../../lib/social/types";
import { fmtDate, Modal, useToast } from "../../components/ui";
import { ErrorBoundary } from "../../components/ErrorBoundary";
import Explore, { type Door } from "./Explore";
import QuestPlayer from "./QuestPlayer";
import Phone, { useWorldNav } from "./phone/Phone";
import { NpcAvatar, StickerArt } from "./phone/art";
import { bondLabel, REGISTER_EN, REGISTER_JA } from "./phone/Profile";

const MENU: { panel: Panel | "phone"; label: string; jp: string; key?: string }[] = [
  { panel: "map", label: "Map", jp: "地図", key: "M" },
  { panel: "phone", label: "Phone", jp: "スマホ", key: "P" },
  { panel: "relationships", label: "Friends", jp: "友だち", key: "F" },
  { panel: "journal", label: "Journal", jp: "日誌", key: "J" },
  { panel: "calendar", label: "Calendar", jp: "予定", key: "C" },
  { panel: "inventory", label: "Inventory", jp: "持ち物", key: "I" },
  { panel: "apartment", label: "Apartment", jp: "部屋" },
  { panel: "achievements", label: "Achievements", jp: "実績" },
  { panel: "passport", label: "Passport", jp: "パスポート" },
];

export default function Seikatsu() {
  const { route, go } = useNav();
  const { toast } = useToast();
  const nav = useWorldNav();
  const [player, setPlayer] = useState<PlayerState | null>(null);
  const [progress, setProgress] = useState<QuestProgress[]>([]);
  const [passport, setPassport] = useState<PassportEntry[]>([]);
  const [chats, setChats] = useState<ConversationView[]>([]);
  const [addReal, setAddReal] = useState(false);

  const load = useCallback(() =>
    Promise.all([api.playerState(localDay()), api.questProgress(), api.passport()])
      .then(([p, q, pp]) => { setPlayer(p); setProgress(q); setPassport(pp); })
      .catch((e: Error) => toast(e.message, { kind: "error" })), [toast]);
  const loadChats = useCallback(() => social.chats().then(setChats).catch(() => {}), []);
  useEffect(() => { load(); loadChats(); }, [load, loadChats, nav.scene.kind]);
  useChatChanged(() => loadChats());

  // Deep links from elsewhere in the app (e.g. Home → "play this quest") become world actions.
  useEffect(() => {
    if (route.sub === "quest" && route.questId && questById(route.questId)) {
      worldStore.dispatch({ t: "quest.start", questId: route.questId });
      go({ page: "life" });
    }
  }, [route.sub, route.questId, go]);

  // World hotkeys (ignored while typing or while the phone is open; the phone handles its own keys).
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
      if ((e.target as HTMLElement)?.closest?.("input, textarea, select, [contenteditable]")) return;
      if (document.querySelector(".modal-backdrop")) return;
      const st = worldStore.get();
      if (e.key === "Escape" && !st.phone.open && st.panel) {
        e.preventDefault();
        worldStore.dispatch({ t: "panel.close" });
        return;
      }
      if (st.phone.open || st.scene.kind === "quest") return;
      const item = MENU.find((m) => m.key && m.key.toLowerCase() === e.key.toLowerCase());
      if (!item) return;
      e.preventDefault();
      if (item.panel === "phone") worldStore.dispatch({ t: "phone.open" });
      else worldStore.dispatch(st.panel === item.panel ? { t: "panel.close" } : { t: "panel.open", panel: item.panel });
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, []);

  const play = (id: string) => worldStore.dispatch({ t: "quest.start", questId: id });
  const prog = (id: string) => progress.find((p) => p.quest_id === id);
  const unread = chats.filter((c) => !c.muted && !c.archived).reduce((a, c) => a + c.unread, 0);
  const levelPct = player ? ((player.xp - player.level_floor) / Math.max(1, player.level_ceil - player.level_floor)) * 100 : 0;
  const playing = nav.scene.kind === "quest" ? questById(nav.scene.questId) : undefined;

  const onDoor = useCallback((d: Door) => {
    if (d.id === "konbini") worldStore.dispatch({ t: "quest.start", questId: "konbini-first-purchase" });
    else if (d.id === "apartment") worldStore.dispatch({ t: "panel.open", panel: "apartment" });
  }, []);

  return (
    <div className="page life">
      <div className="page-head">
        <div>
          <h1 className="page-title">生活<span className="jp-sub">Seikatsu · everyday life</span></h1>
          <p className="page-desc">Walk around, go into places, and text your friends — in your own Japanese.</p>
        </div>
        {player && (
          <div className="hud">
            <div className="hud-level">Lv {player.level}</div>
            <div className="hud-xp">
              <div className="bar-track"><div className="bar-fill" style={{ width: `${levelPct}%` }} /></div>
              <span className="faint">{player.xp - player.level_floor}/{player.level_ceil - player.level_floor} XP · today +{player.xp_today}</span>
            </div>
            <div className="hud-yen">¥{player.yen.toLocaleString()}</div>
          </div>
        )}
      </div>

      <nav className="world-menu" aria-label="生活 menu">
        {MENU.map((m) => {
          const on = m.panel === "phone" ? nav.phone.open : nav.panel === m.panel;
          return (
            <button key={m.panel} className={`wm-btn${on ? " on" : ""}`} title={m.key ? `${m.label} (${m.key})` : m.label}
              onClick={() => m.panel === "phone" ? worldStore.dispatch(on ? { t: "phone.close" } : { t: "phone.open" }) : worldStore.dispatch(on ? { t: "panel.close" } : { t: "panel.open", panel: m.panel })}>
              <span lang="ja">{m.jp}</span><small>{m.label}</small>
              {m.panel === "phone" && unread > 0 && <span className="wm-badge">{unread > 99 ? "99+" : unread}</span>}
            </button>
          );
        })}
      </nav>

      <div className="world-stage">
        <ErrorBoundary label="the world" onReset={() => worldStore.dispatch({ t: "quest.end" })}>
          {playing ? (
            <QuestPlayer key={playing.id} quest={playing} onExit={() => { worldStore.dispatch({ t: "quest.end" }); load(); }} />
          ) : (
            <Explore onEnter={onDoor} paused={nav.phone.open || !!nav.panel || addReal} />
          )}
        </ErrorBoundary>

        {nav.panel && (
          <aside className="world-panel" role="dialog" aria-label={MENU.find((m) => m.panel === nav.panel)?.label}>
            <header>
              <b lang="ja">{MENU.find((m) => m.panel === nav.panel)?.jp}</b>
              <span className="faint">{MENU.find((m) => m.panel === nav.panel)?.label}</span>
              <span className="spacer" />
              <button className="icon-btn" onClick={() => worldStore.dispatch({ t: "panel.close" })} aria-label="Close (Esc)">×</button>
            </header>
            <div className="world-panel-body">
              <ErrorBoundary label={nav.panel} compact>
                <PanelBody panel={nav.panel} progress={progress} passport={passport} player={player} play={play} prog={prog} onAddReal={() => setAddReal(true)} />
              </ErrorBoundary>
            </div>
          </aside>
        )}
      </div>

      <Phone />
      {addReal && <AddReal onClose={() => setAddReal(false)} onSaved={() => { setAddReal(false); load(); }} />}
    </div>
  );
}

function PanelBody({ panel, progress, passport, player, play, prog, onAddReal }: {
  panel: Panel; progress: QuestProgress[]; passport: PassportEntry[]; player: PlayerState | null;
  play: (id: string) => void; prog: (id: string) => QuestProgress | undefined; onAddReal: () => void;
}) {
  switch (panel) {
    case "map": return <MapPanel play={play} konbiniDone={(prog("konbini-first-purchase")?.completions ?? 0) > 0} />;
    case "relationships": return <Relationships />;
    case "journal": return <Journal play={play} prog={prog} />;
    case "calendar": return <CalendarPanel />;
    case "inventory": return <Inventory player={player} />;
    case "apartment": return <Apartment />;
    case "achievements": return <Achievements progress={progress} passport={passport} player={player} />;
    case "passport": return <PassportPanel passport={passport} onAddReal={onAddReal} />;
  }
}

function MapPanel({ play, konbiniDone }: { play: (id: string) => void; konbiniDone: boolean }) {
  return (
    <div className="stack" style={{ gap: 8 }}>
      <WorldMap onHome={() => worldStore.dispatch({ t: "panel.open", panel: "apartment" })} onKonbini={() => play("konbini-first-purchase")} konbiniDone={konbiniDone} unread={0} />
      <p className="faint" style={{ fontSize: 12, margin: 0 }}>Overview of the neighbourhood. Dimmed places open in later updates. Walk there on the street, or click to go straight in.</p>
    </div>
  );
}

function Relationships() {
  const [npcs, setNpcs] = useState<NpcView[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { social.npcs().then(setNpcs).catch((e: Error) => setErr(e.message)); }, []);
  if (err) return <p className="faint">{err}</p>;
  return (
    <div className="stack" style={{ gap: 10 }}>
      <p className="faint" style={{ fontSize: 12.5, margin: 0 }}>Each friendship has its own history: how close you are, how much they trust you, what you've done together. They talk more casually as it grows.</p>
      {npcs?.map((n) => {
        const b = bondLabel(n.score);
        return (
          <div key={n.id} className="rel-card">
            <NpcAvatar id={n.id} color={n.color} size={46} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div><b lang="ja">{n.display}</b> <span className="faint">{n.role}</span></div>
              <div style={{ fontSize: 13 }}><b lang="ja">{b.ja}</b> <span className="faint">· {b.en}</span></div>
              <div className="faint" style={{ fontSize: 12 }}>Talks to you: <span lang="ja">{REGISTER_JA[n.register_stage]}</span> ({REGISTER_EN[n.register_stage]}) · {n.state.shared_experiences} shared moments · {n.state.meaningful_days} days talking</div>
            </div>
            <div className="stack" style={{ gap: 4 }}>
              <button className="btn small primary" onClick={() => worldStore.dispatch({ t: "phone.open", screen: { s: "chat", id: `dm-${n.id}` } })}>Message</button>
              <button className="btn small ghost" onClick={() => worldStore.dispatch({ t: "phone.open", screen: { s: "profile", id: n.id } })}>Profile</button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Journal({ play, prog }: { play: (id: string) => void; prog: (id: string) => QuestProgress | undefined }) {
  const [plans, setPlans] = useState<CalendarEvent[]>([]);
  useEffect(() => { social.calendar().then(setPlans).catch(() => {}); }, []);
  const open = plans.filter((p) => p.status === "planned");
  return (
    <div className="stack" style={{ gap: 14 }}>
      <section>
        <h4 className="panel-h">Scenes</h4>
        <div className="stack" style={{ gap: 10 }}>
          {QUESTS.map((q) => {
            const p = prog(q.id);
            return (
              <div key={q.id} className="quest-row">
                <div>
                  <b lang="ja">{q.titleJp}</b> <span className="faint">{q.title}</span>
                  <div className="faint" style={{ fontSize: 12.5 }}>{q.summary}</div>
                  {p && <div className="faint" style={{ fontSize: 12 }}>✓ completed {p.completions}× · best {p.best_score}</div>}
                </div>
                <button className="btn small primary" onClick={() => play(q.id)}>{p ? "Replay" : "Play"}</button>
              </div>
            );
          })}
        </div>
      </section>
      <section>
        <h4 className="panel-h">Open plans with friends</h4>
        {open.length === 0 ? <p className="faint" style={{ fontSize: 12.5 }}>None yet. Plans you make in chats (「土曜カフェ行こう」) show up here.</p> :
          open.map((e) => <div key={e.id} className="plan-row"><b>{e.title}</b><span className="faint">{[e.when_text, e.place].filter(Boolean).join(" · ")}</span></div>)}
      </section>
    </div>
  );
}

function CalendarPanel() {
  const [ev, setEv] = useState<CalendarEvent[] | null>(null);
  const load = () => social.calendar().then(setEv).catch(() => setEv([]));
  useEffect(() => { load(); }, []);
  const label: Record<string, string> = { planned: "予定", done: "済み", cancelled: "キャンセル" };
  return (
    <div className="stack" style={{ gap: 8 }}>
      <p className="faint" style={{ fontSize: 12.5, margin: 0 }}>Plans come from your conversations. Friends may follow up on them.</p>
      {ev?.length === 0 && <p className="faint">Nothing planned.</p>}
      {ev?.map((e) => (
        <div key={e.id} className={`plan-row${e.status !== "planned" ? " past" : ""}`}>
          <div className="row" style={{ flexWrap: "nowrap" }}>
            <b style={{ flex: 1 }}>{e.title}</b>
            <span className="tag">{label[e.status] ?? e.status}</span>
          </div>
          <span className="faint">{[e.when_text, e.place].filter(Boolean).join(" · ")}</span>
          <div className="row" style={{ gap: 6 }}>
            {e.participants.map((p) => <NpcAvatar key={p} id={p} size={22} />)}
            <span className="spacer" />
            {e.status === "planned" && <>
              <button className="btn small" onClick={() => social.calendarStatus(e.id, "done").then(load)}>Done</button>
              <button className="btn small ghost" onClick={() => social.calendarStatus(e.id, "cancelled").then(load)}>Cancel</button>
            </>}
          </div>
        </div>
      ))}
    </div>
  );
}

function Inventory({ player }: { player: PlayerState | null }) {
  const [st, setSt] = useState<Stickers | null>(null);
  useEffect(() => { social.stickers().then(setSt).catch(() => {}); }, []);
  const owned = st?.packs.filter((p) => st.state.owned.includes(p.id)) ?? [];
  return (
    <div className="stack" style={{ gap: 12 }}>
      <div className="inv-money"><span className="faint">Wallet</span><b>¥{player?.yen.toLocaleString() ?? "…"}</b></div>
      <section>
        <h4 className="panel-h">Sticker packs</h4>
        <div className="row" style={{ gap: 10 }}>
          {owned.map((p) => <div key={p.id} className="inv-item"><StickerArt {...p.stickers[0]!} size={56} /><span>{p.name}</span></div>)}
        </div>
        <button className="btn small" style={{ marginTop: 8 }} onClick={() => worldStore.dispatch({ t: "phone.open", screen: { s: "stickers" } })}>Sticker shop</button>
      </section>
      <p className="faint" style={{ fontSize: 12.5 }}>Items you buy in shops arrive with the shopping-street update. Nothing here is a placeholder pretending to work.</p>
    </div>
  );
}

function Apartment() {
  return (
    <div className="stack" style={{ gap: 10 }}>
      <div className="apt-art" aria-hidden="true">
        <svg viewBox="0 0 320 150" width="100%"><rect width="320" height="150" rx="12" fill="#efe6d6" /><rect y="104" width="320" height="46" fill="#c9a77c" /><rect x="22" y="22" width="80" height="58" rx="4" fill="#9fd3f0" stroke="#fff" strokeWidth="5" /><rect x="190" y="64" width="110" height="46" rx="8" fill="#6c5ce7" /><rect x="196" y="56" width="40" height="16" rx="6" fill="#fff" /><rect x="128" y="76" width="44" height="32" rx="4" fill="#8a6a48" /><circle cx="150" cy="70" r="8" fill="#ffd166" /></svg>
      </div>
      <p style={{ margin: 0 }}>Your room. Nice place to check your phone.</p>
      <button className="btn primary" onClick={() => worldStore.dispatch({ t: "phone.open" })}>Check phone</button>
      <p className="faint" style={{ fontSize: 12.5 }}>Decorating and inviting friends over come in a later update.</p>
    </div>
  );
}

function Achievements({ progress, passport, player }: { progress: QuestProgress[]; passport: PassportEntry[]; player: PlayerState | null }) {
  const [npcs, setNpcs] = useState<NpcView[]>([]);
  useEffect(() => { social.npcs().then(setNpcs).catch(() => {}); }, []);
  const list = useMemo(() => {
    const talked = npcs.filter((n) => n.state.last_player_msg_at).length;
    const casual = npcs.filter((n) => n.register_stage >= 2 && n.register_stage > 0).length;
    const close = npcs.filter((n) => n.score >= 50).length;
    return [
      { t: "First scene", d: "Finish any 生活 scene", ok: progress.some((p) => p.completions > 0) },
      { t: "Said hi", d: "Message a friend", ok: talked >= 1 },
      { t: "Social butterfly", d: "Talk with all 8 friends", ok: talked >= 8, p: `${talked}/8` },
      { t: "タメ口", d: "A friend who started polite now talks casually to you", ok: npcs.some((n) => n.register_stage >= 2 && ["ren", "aoi", "yui"].includes(n.id)) },
      { t: "仲良し", d: "Become close friends with someone", ok: close >= 1 },
      { t: "Real world", d: "Add a real-life passport stamp", ok: passport.some((p) => !p.simulated) },
      { t: "Level 5", d: "Reach level 5", ok: (player?.level ?? 0) >= 5 },
    ].map((a) => ({ ...a, casual }));
  }, [npcs, progress, passport, player]);
  return (
    <div className="stack" style={{ gap: 8 }}>
      <p className="faint" style={{ fontSize: 12.5, margin: 0 }}>Computed from what you've actually done.</p>
      {list.map((a) => (
        <div key={a.t} className={`ach${a.ok ? " ok" : ""}`}>
          <span className="ach-ico">{a.ok ? "★" : "☆"}</span>
          <div style={{ flex: 1 }}><b>{a.t}</b><div className="faint" style={{ fontSize: 12 }}>{a.d}</div></div>
          {"p" in a && a.p && !a.ok && <span className="faint">{a.p}</span>}
        </div>
      ))}
    </div>
  );
}

function PassportPanel({ passport, onAddReal }: { passport: PassportEntry[]; onAddReal: () => void }) {
  return (
    <div className="stack" style={{ gap: 8 }}>
      <p className="faint" style={{ fontSize: 12.5, margin: 0 }}>Real communication milestones. In-app scenes are marked <b>simulated</b>. Real-life ones are self-reported. Neither is a JLPT result.</p>
      {passport.length === 0 && <p className="faint">No stamps yet. Finish a scene, or add something you did in real life.</p>}
      {passport.map((p) => (
        <div key={p.id} className={`stamp${p.simulated ? "" : " real"}`}>
          <b>{p.title}</b>
          <span className="faint" style={{ fontSize: 12 }}>{p.simulated ? "simulated" : "real world (self-reported)"} · {fmtDate(p.created_at)}</span>
          {p.detail && <span className="faint" style={{ fontSize: 12.5 }}>{p.detail}</span>}
        </div>
      ))}
      <button className="btn small" onClick={onAddReal}>+ Add a real-world achievement</button>
    </div>
  );
}

function AddReal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [title, setTitle] = useState("");
  const [detail, setDetail] = useState("");
  const { toast } = useToast();
  return (
    <Modal narrow title="Real-world achievement" onClose={onClose} footer={
      <>
        <button className="btn ghost" onClick={onClose}>Cancel</button>
        <button className="btn primary" disabled={!title.trim()} onClick={() => api.passportAddReal(title, detail).then(onSaved).catch((e: Error) => toast(e.message, { kind: "error" }))}>Add stamp</button>
      </>
    }>
      <label className="field"><span>What did you do?</span><input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ordered ramen in Japanese / Played an hour in a Japanese voice chat" /></label>
      <label className="field"><span>Notes (optional)</span><textarea className="textarea" value={detail} onChange={(e) => setDetail(e.target.value)} /></label>
    </Modal>
  );
}

function WorldMap({ onHome, onKonbini, konbiniDone, unread }: { onHome: () => void; onKonbini: () => void; konbiniDone: boolean; unread: number }) {
  const place = (x: number, y: number, w: number, h: number, color: string, label: string, jp: string, onClick?: () => void, extra?: React.ReactNode) => (
    <g className={`place${onClick ? " open" : " locked"}`} transform={`translate(${x} ${y})`} onClick={onClick} role={onClick ? "button" : undefined} tabIndex={onClick ? 0 : -1}
       onKeyDown={(e) => onClick && (e.key === "Enter" || e.key === " ") && onClick()}>
      <title>{onClick ? label : `${label}: opens in a future update`}</title>
      <rect className="shadow" x="6" y="8" width={w} height={h} rx="10" />
      <rect className="body" width={w} height={h} rx="10" fill={color} />
      <rect className="roof" width={w} height="16" rx="8" />
      {[0, 1, 2].map((i) => <rect key={i} x={14 + i * ((w - 28) / 3)} y={h / 2 - 6} width={(w - 28) / 3 - 8} height="18" rx="3" className="win" />)}
      <text x={w / 2} y={h + 26} textAnchor="middle" className="place-jp">{jp}</text>
      <text x={w / 2} y={h + 42} textAnchor="middle" className="place-en">{label}</text>
      {extra}
    </g>
  );
  return (
    <svg className="world" viewBox="0 0 760 460" role="img" aria-label="Neighbourhood map">
      <rect width="760" height="460" className="ground" />
      <path d="M0 250 H760" className="road" />
      <path d="M380 0 V460" className="road" />
      <path d="M0 250 H760 M380 0 V460" className="road-line" />
      <circle cx="640" cy="390" r="46" className="park" />
      <circle cx="610" cy="370" r="14" className="tree" /><circle cx="668" cy="402" r="18" className="tree" /><circle cx="640" cy="352" r="10" className="tree" />
      {place(80, 70, 170, 110, "#6c5ce7", "My apartment", "アパート", onHome,
        unread > 0 ? <g transform="translate(150 -12)"><circle r="16" className="ping" /><text y="5" textAnchor="middle" className="ping-text">{unread}</text></g> : null)}
      {place(470, 70, 180, 110, "#2d6a4f", "Konbini", "コンビニ", onKonbini,
        konbiniDone ? <text x="170" y="10" className="done-mark">✓</text> : null)}
      {place(60, 300, 150, 90, "#b5838d", "Café", "カフェ")}
      {place(240, 300, 110, 90, "#457b9d", "Station", "駅")}
      {place(420, 300, 140, 90, "#e76f51", "Shopping street", "商店街")}
      {place(300, 70, 60, 110, "#8d99ae", "Haruto's place", "ハルトの家")}
    </svg>
  );
}

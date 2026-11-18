// 生活: the life-sim hub. A small neighbourhood map, your phone, friends and passport.
import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import { localDay } from "../../lib/day";
import { CHARACTERS, characterById } from "../../lib/game/characters";
import { QUESTS, questById } from "../../lib/game/questData";
import type { CharacterState, PassportEntry, PlayerState, QuestProgress } from "../../lib/learning/types";
import { useNav } from "../../lib/nav";
import { fmtDate, Modal, useToast } from "../../components/ui";
import { Avatar } from "./Avatar";
import QuestPlayer from "./QuestPlayer";

type Tab = "quests" | "friends" | "passport";

export default function Seikatsu() {
  const { route, go } = useNav();
  const { toast } = useToast();
  const [player, setPlayer] = useState<PlayerState | null>(null);
  const [progress, setProgress] = useState<QuestProgress[]>([]);
  const [chars, setChars] = useState<CharacterState[]>([]);
  const [passport, setPassport] = useState<PassportEntry[]>([]);
  const [tab, setTab] = useState<Tab>("quests");
  const [phone, setPhone] = useState(false);
  const [addReal, setAddReal] = useState(false);

  const load = () =>
    Promise.all([api.playerState(localDay()), api.questProgress(), api.characters(), api.passport()])
      .then(([p, q, c, pp]) => { setPlayer(p); setProgress(q); setChars(c); setPassport(pp); })
      .catch((e: Error) => toast(e.message, { kind: "error" }));
  useEffect(() => { load(); }, [route.questId]); // eslint-disable-line react-hooks/exhaustive-deps

  const playing = route.sub === "quest" && route.questId ? questById(route.questId) : undefined;
  if (playing) return <QuestPlayer quest={playing} onExit={() => go({ page: "life" })} />;

  const play = (id: string) => go({ page: "life", sub: "quest", questId: id });
  const prog = (id: string) => progress.find((p) => p.quest_id === id);
  const levelPct = player ? ((player.xp - player.level_floor) / Math.max(1, player.level_ceil - player.level_floor)) * 100 : 0;

  return (
    <div className="page life">
      <div className="page-head">
        <div>
          <h1 className="page-title">生活<span className="jp-sub">Seikatsu · everyday life</span></h1>
          <p className="page-desc">Use your Japanese in real situations. Scenes are authored and work offline. AI conversations come in Milestone 5.</p>
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

      <div className="life-grid">
        <section className="map-panel">
          <WorldMap
            onHome={() => setPhone(true)}
            onKonbini={() => play("konbini-first-purchase")}
            konbiniDone={(prog("konbini-first-purchase")?.completions ?? 0) > 0}
            unread={QUESTS.filter((q) => q.location === "phone" && !prog(q.id)).length}
          />
          <p className="faint" style={{ fontSize: 12, margin: "8px 4px 0" }}>Click your apartment to check your phone, or the konbini to go shopping. Dimmed places open in later updates.</p>
        </section>

        <aside className="panel side-tabs">
          <div className="row" style={{ marginBottom: 10 }}>
            {(["quests", "friends", "passport"] as Tab[]).map((t) => (
              <button key={t} className={`chip${tab === t ? " on" : ""}`} onClick={() => setTab(t)}>
                {{ quests: "Quests", friends: "Friends", passport: "Passport" }[t]}
              </button>
            ))}
          </div>

          {tab === "quests" && (
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
          )}

          {tab === "friends" && (
            <div className="stack" style={{ gap: 12 }}>
              {CHARACTERS.map((c) => {
                const st = chars.find((x) => x.id === c.id);
                return (
                  <div key={c.id} className={`friend${c.unlocked ? "" : " locked"}`}>
                    <div className="row" style={{ flexWrap: "nowrap" }}>
                      <Avatar id={c.id} size={40} />
                      <div style={{ flex: 1 }}>
                        <b lang="ja">{c.nameJp}</b> <span className="faint">{c.name}</span>
                        <div className="bar-track" title="Friendship"><div className="bar-fill" style={{ width: `${st?.relationship ?? 0}%`, background: c.color }} /></div>
                      </div>
                    </div>
                    <div className="faint" style={{ fontSize: 12.5, margin: "6px 0" }}>{c.bio}</div>
                    {c.unlocked && <div className="faint" style={{ fontSize: 12 }}>Speaks: {c.style}</div>}
                    {st && st.memories.length > 0 && (
                      <div className="memories">
                        <div className="faint" style={{ fontSize: 11.5, textTransform: "uppercase", letterSpacing: ".06em" }}>Remembers about you</div>
                        {st.memories.map((m) => (
                          <div key={m.id} className="memory">
                            <span>{m.fact}</span>
                            <button className="icon-btn" title="Forget this" onClick={() => api.memoryDelete(m.id).then(load)}>×</button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {tab === "passport" && (
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
              <button className="btn small" onClick={() => setAddReal(true)}>+ Add a real-world achievement</button>
            </div>
          )}
        </aside>
      </div>

      {phone && <PhoneHome onClose={() => setPhone(false)} onOpen={(id) => { setPhone(false); play(id); }} progress={progress} />}
      {addReal && <AddReal onClose={() => setAddReal(false)} onSaved={() => { setAddReal(false); load(); }} />}
    </div>
  );
}

function PhoneHome({ onClose, onOpen, progress }: { onClose: () => void; onOpen: (questId: string) => void; progress: QuestProgress[] }) {
  const threads = QUESTS.filter((q) => q.location === "phone");
  return (
    <Modal narrow title="📱 メッセ" onClose={onClose}>
      <div className="stack" style={{ gap: 6 }}>
        {threads.map((q) => {
          const c = characterById(q.character!)!;
          const first = q.nodes[q.start]!.lines[0]!;
          const unread = !progress.find((p) => p.quest_id === q.id);
          return (
            <button key={q.id} className="thread" onClick={() => onOpen(q.id)}>
              <Avatar id={c.id} size={40} />
              <div style={{ flex: 1, textAlign: "left" }}>
                <b lang="ja">{c.nameJp}</b>
                <div className="faint" lang="ja" style={{ fontSize: 13 }}>{first.jp}</div>
              </div>
              {unread && <span className="badge">1</span>}
            </button>
          );
        })}
        <div className="thread locked"><Avatar id="ren" size={40} /><div style={{ flex: 1 }}><b lang="ja">レン</b><div className="faint" style={{ fontSize: 13 }}>Joins in a later chapter</div></div></div>
      </div>
    </Modal>
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

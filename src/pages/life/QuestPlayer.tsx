// Plays an authored 生活 quest in two skins: a visual-novel scene (konbini) or a
// LINE-style phone chat. Communication is the gameplay; feedback comes at the end.
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../lib/api";
import { useAppData } from "../../lib/appData";
import { localDay } from "../../lib/day";
import { characterById } from "../../lib/game/characters";
import { choose, currentNode, questResult, startQuest, submitTyped, type Gloss, type QuestDef, type QuestState, type TranscriptEntry } from "../../lib/game/quests";
import type { QuestReward } from "../../lib/learning/types";
import { speak } from "../../lib/speech";
import { Icon, useToast } from "../../components/ui";
import { Avatar } from "./Avatar";

export default function QuestPlayer({ quest, onExit }: { quest: QuestDef; onExit: () => void }) {
  const { prefs } = useAppData();
  const [seed] = useState(() => Math.floor(Math.random() * 1e9));
  const [s, setS] = useState<QuestState>(() => startQuest(quest, seed));
  const [typing, setTyping] = useState(prefs.challenge === "challenging");
  const [text, setText] = useState("");
  const [showEn, setShowEn] = useState(prefs.showEnglish);
  const [finished, setFinished] = useState<{ reward: QuestReward | null; error?: string } | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const node = currentNode(quest, s);
  const isPhone = quest.location === "phone";
  const canType = !!node.typed && !s.ended;

  useEffect(() => bottom.current?.scrollIntoView({ behavior: "smooth" }), [s.transcript.length]);

  const finish = async () => {
    const r = questResult(quest, s);
    try {
      const reward = await api.questComplete(
        {
          quest_id: quest.id,
          success: r.success,
          score: r.score,
          started_at: s.startedAt,
          relationship: r.relationship,
          memories: r.memories,
          passport: r.success ? [quest.passport] : [],
          outcome: { objectives: r.objectives, feedback: r.feedback, seed },
        },
        localDay(),
      );
      setFinished({ reward });
    } catch (e) {
      setFinished({ reward: null, error: (e as Error).message });
    }
  };

  const restart = () => {
    setS(startQuest(quest, Math.floor(Math.random() * 1e9)));
    setFinished(null);
    setText("");
  };

  if (finished) return <QuestResults quest={quest} state={s} reward={finished.reward} error={finished.error} onReplay={restart} onExit={onExit} />;

  return (
    <div className={isPhone ? "phone-wrap" : "scene-wrap"}>
      <div className={isPhone ? "phone" : "scene"}>
        <div className={isPhone ? "phone-head" : "scene-head"}>
          <button className="icon-btn" onClick={onExit} aria-label="Leave"><Icon name="x" size={16} /></button>
          {isPhone && quest.character && <Avatar id={quest.character} size={30} />}
          <div>
            <b lang="ja">{isPhone ? characterById(quest.character!)?.nameJp : quest.titleJp}</b>
            <div className="faint" style={{ fontSize: 11.5 }}>{quest.title}</div>
          </div>
          <span className="spacer" />
          <label className="toggle" title="Show English under every line"><input type="checkbox" checked={showEn} onChange={(e) => setShowEn(e.target.checked)} /> EN</label>
        </div>

        {!isPhone && <KonbiniBackdrop />}

        <div className={isPhone ? "chat" : "dialogue"}>
          {s.transcript.map((l, i) => <LineView key={i} l={l} phone={isPhone} showEn={showEn} rate={prefs.ttsRate} />)}
          <div ref={bottom} />
        </div>

        <div className={isPhone ? "phone-input" : "scene-input"}>
          {s.ended ? (
            <button className="btn primary" style={{ width: "100%" }} onClick={finish}>See how it went</button>
          ) : typing && canType ? (
            <form
              className="row"
              style={{ flexWrap: "nowrap" }}
              onSubmit={(e) => {
                e.preventDefault();
                if (!text.trim()) return;
                setS(submitTyped(quest, s, text, seed));
                setText("");
              }}
            >
              <input className="input" lang="ja" autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder={node.typed?.placeholder ? `例：${node.typed.placeholder}` : "日本語で…"} />
              <button className="btn primary" type="submit">送信</button>
            </form>
          ) : (
            <div className="choices">
              {node.choices?.map((c, i) => (
                <button key={i} className="choice" onClick={() => setS(choose(quest, s, i, seed))}>
                  <span lang="ja">{c.jp}</span>
                  {(showEn || prefs.challenge === "gentle") && <small>{c.en}</small>}
                </button>
              ))}
            </div>
          )}
          {!s.ended && canType && (
            <button className="btn small ghost" onClick={() => setTyping((t) => !t)}>
              {typing ? "Show choices instead" : "⌨ Type my own reply (IME or romaji)"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function LineView({ l, phone, showEn, rate }: { l: TranscriptEntry; phone: boolean; showEn: boolean; rate: number }) {
  const [open, setOpen] = useState(false);
  const mine = l.speaker === "you";
  const narr = l.speaker === "narration";
  if (narr) return <div className="narration" lang="ja">{l.jp}{(showEn || open) && l.en && <div className="en">{l.en}</div>}</div>;
  return (
    <div className={`line ${mine ? "mine" : "theirs"}`}>
      {!mine && <Avatar id={l.speaker} size={phone ? 30 : 40} />}
      <div className="bubble-wrap">
        <button className="bubble" onClick={() => setOpen((o) => !o)} lang="ja" title="Tap for translation and word meanings">
          {l.jp}
        </button>
        {!mine && (showEn || open) && l.en && <div className="en">{l.en}</div>}
        {!mine && open && <GlossList gloss={l.gloss} jp={l.jp} rate={rate} />}
      </div>
    </div>
  );
}

function GlossList({ gloss, jp, rate }: { gloss?: Gloss[]; jp: string; rate: number }) {
  const { vocab, reloadVocab } = useAppData();
  const { toast } = useToast();
  const have = useMemo(() => new Set((vocab ?? []).flatMap((v) => [v.word, v.reading])), [vocab]);
  const save = async (g: Gloss) => {
    try {
      await api.vocabSave({
        word: g.t, reading: g.r ?? g.t, meaning: g.m, word_type: "x", level: "", category: "social", note: "Saved from 生活",
        personal_note: "", tags: ["生活"], examples: [{ jp, en: "" }],
      });
      await reloadVocab();
      toast(`Saved 「${g.t}」 to your Study Center.`);
    } catch (e) {
      toast((e as Error).message, { kind: "error" });
    }
  };
  return (
    <div className="gloss">
      <button className="btn small ghost" onClick={() => speak(jp, rate)}>🔊 Listen</button>
      {gloss?.map((g) => (
        <div key={g.t} className="gloss-row">
          <span lang="ja"><b>{g.t}</b>{g.r && g.r !== g.t ? <span className="faint"> {g.r}</span> : null}</span>
          <span className="faint">{g.m}</span>
          {have.has(g.t) ? <span className="tag user">in deck</span> : <button className="btn small" onClick={() => save(g)}>+ Study</button>}
        </div>
      ))}
    </div>
  );
}

function KonbiniBackdrop() {
  return (
    <svg className="backdrop" viewBox="0 0 800 220" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <defs>
        <linearGradient id="kb" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="#f6f2e7" />
          <stop offset="1" stopColor="#e3ddcc" />
        </linearGradient>
      </defs>
      <rect width="800" height="220" fill="url(#kb)" />
      <rect y="0" width="800" height="26" fill="#2d6a4f" />
      <rect y="26" width="800" height="8" fill="#f4a261" />
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <g key={i} transform={`translate(${30 + i * 120} 55)`}>
          <rect width="100" height="95" rx="4" fill="#fff" stroke="#cfc6b0" />
          {[0, 1, 2].map((r) => <rect key={r} x="6" y={10 + r * 28} width="88" height="4" fill="#cfc6b0" />)}
          {[0, 1, 2, 3, 4].map((k) => <rect key={k} x={8 + k * 17} y={18} width="12" height="16" rx="2" fill={["#e76f51", "#2a9d8f", "#e9c46a", "#264653", "#f4a261"][(k + i) % 5]} />)}
          {[0, 1, 2, 3].map((k) => <rect key={k} x={10 + k * 21} y={48} width="16" height="12" rx="2" fill={["#90be6d", "#f94144", "#577590", "#f9c74f"][(k + i) % 4]} />)}
        </g>
      ))}
      <rect y="168" width="800" height="52" fill="#b08968" />
      <rect x="520" y="140" width="220" height="40" rx="6" fill="#ddd" stroke="#999" />
      <rect x="560" y="120" width="60" height="26" rx="3" fill="#264653" />
      <text x="590" y="138" fill="#9ef01a" fontSize="12" textAnchor="middle" fontFamily="monospace">¥680</text>
    </svg>
  );
}

function QuestResults({ quest, state, reward, error, onReplay, onExit }: { quest: QuestDef; state: QuestState; reward: QuestReward | null; error?: string; onReplay: () => void; onExit: () => void }) {
  const r = questResult(quest, state);
  const xp = reward?.grants.filter((g) => g.currency === "xp").reduce((a, g) => a + g.amount, 0) ?? 0;
  const yen = reward?.grants.filter((g) => g.currency === "yen").reduce((a, g) => a + g.amount, 0) ?? 0;
  const { vocab, reloadVocab } = useAppData();
  const { toast } = useToast();
  const have = new Set((vocab ?? []).flatMap((v) => [v.word, v.reading]));
  return (
    <div className="page">
      <div className="focus-card stack" style={{ maxWidth: 820, margin: "0 auto" }}>
        <div className="eyebrow">{quest.titleJp} · {quest.title}</div>
        <h2 style={{ margin: 0, fontSize: 28 }}>{r.success ? "クエスト達成！ Quest complete" : "Not quite. Try again?"}</h2>
        {error && <div className="notice bad">{error}</div>}
        <div className="summary-grid">
          <div><div className="v">{r.score}</div><div className="k">score</div></div>
          <div><div className="v">+{xp}</div><div className="k">XP</div></div>
          <div><div className="v">¥{yen}</div><div className="k">currency</div></div>
          <div><div className="v">{r.objectives.filter((o) => o.met).length}/{r.objectives.length}</div><div className="k">objectives</div></div>
        </div>
        {reward && !reward.first_completion && r.success && <p className="faint" style={{ margin: 0 }}>Replays give a small amount of XP once a day and no currency, so there's nothing to farm. Replay to practise, not for points.</p>}
        <div className="grid-2" style={{ alignItems: "start" }}>
          <div>
            <h3>Objectives</h3>
            {r.objectives.map((o) => <div key={o.id} className={`objective ${o.met ? "met" : ""}`}>{o.met ? "✓" : "○"} {o.text}</div>)}
            {reward && reward.relationship_applied.length > 0 && (
              <>
                <h3>Friendship</h3>
                {reward.relationship_applied.map(([c, d]) => <div key={c}>{characterById(c)?.nameJp} {d >= 0 ? `+${d}` : d} ♥</div>)}
                <p className="faint" style={{ fontSize: 12 }}>Only social choices affect friendship. Grammar mistakes never do.</p>
              </>
            )}
            {reward && reward.memories_added > 0 && <p className="faint">{reward.memories_added} new thing(s) remembered. You can view or delete memories on the friends tab.</p>}
            {reward && reward.passport_added > 0 && <div className="notice ok">🛂 Language Passport stamp: {quest.passport.title}</div>}
          </div>
          <div>
            <h3>Language feedback</h3>
            {r.feedback.length === 0 && <p className="faint">No notes. Everything you said was natural.</p>}
            {r.feedback.map((f, i) => (
              <div key={i} className={`feedback ${f.kind}`}>
                <div lang="ja"><b>「{f.said}」</b> <span className={`pill tone-${f.tone}`}>{f.tone}</span></div>
                <div className="muted">{f.note}</div>
              </div>
            ))}
          </div>
        </div>
        <h3 style={{ marginBottom: 0 }}>Key phrases</h3>
        <div className="kanji-words">
          {quest.phrases.map((p) => (
            <span key={p.t} lang="ja">
              <b>{p.t}</b> <span className="faint">{p.r && p.r !== p.t ? p.r : ""} · {p.m}</span>{" "}
              {have.has(p.t) ? (
                <span className="tag user">in deck</span>
              ) : (
                <button className="btn small" onClick={async () => {
                  await api.vocabSave({ word: p.t, reading: p.r ?? p.t, meaning: p.m, word_type: "x", level: "", category: "social", note: `From 生活: ${quest.title}`, personal_note: "", tags: ["生活"], examples: [] });
                  await reloadVocab();
                  toast(`Saved 「${p.t}」.`);
                }}>+ Study</button>
              )}
            </span>
          ))}
        </div>
        <div className="row">
          <button className="btn primary" onClick={onReplay}>Replay (new variation)</button>
          <button className="btn" onClick={onExit}>Back to the map</button>
        </div>
      </div>
    </div>
  );
}

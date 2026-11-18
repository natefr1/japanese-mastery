import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import { useAppData } from "../../lib/appData";
import { dayStart, localDay } from "../../lib/day";
import type { Overview, PlayerState, SkillMastery } from "../../lib/learning/types";
import { useNav } from "../../lib/nav";
import { pickActivity } from "../../lib/bored";
import { voicesReady } from "../../lib/speech";
import Onboarding from "./Onboarding";

const SKILL_LABEL: Record<string, string> = {
  "vocab:recognition": "Vocabulary: recognise",
  "vocab:production": "Vocabulary: produce",
  "grammar:cloze": "Grammar",
  "kanji:recognition": "Kanji",
};

function Mastery({ m }: { m: SkillMastery }) {
  const pct = (n: number) => (m.total ? (n / m.total) * 100 : 0);
  return (
    <div className="mastery-row">
      <div className="mastery-label">
        <b>{SKILL_LABEL[`${m.item_type}:${m.skill}`]}</b>
        <span className="faint">
          {m.known} known · {m.introduced} started / {m.total}
          {m.retention_samples >= 10 && m.retention_30d != null ? ` · ${Math.round(m.retention_30d * 100)}% retention` : ""}
        </span>
      </div>
      <div className="stack-bar" title={`${m.mature} mature (≥21d), ${m.known - m.mature} known (≥7d), ${m.introduced - m.known} learning`}>
        <div className="seg mature" style={{ width: `${pct(m.mature)}%` }} />
        <div className="seg known" style={{ width: `${pct(m.known - m.mature)}%` }} />
        <div className="seg learning" style={{ width: `${pct(Math.max(0, m.introduced - m.known))}%` }} />
      </div>
    </div>
  );
}

export default function StudyCenter() {
  const { go } = useNav();
  const { prefs } = useAppData();
  const [ov, setOv] = useState<Overview | null>(null);
  const [player, setPlayer] = useState<PlayerState | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [hasVoice, setHasVoice] = useState(false);
  const [custom, setCustom] = useState(prefs.sessionMinutes);
  const [onboarding, setOnboarding] = useState(false);

  useEffect(() => {
    Promise.all([api.studyOverview(Date.now(), dayStart()), api.playerState(localDay())])
      .then(([o, p]) => {
        setOv(o);
        setPlayer(p);
      })
      .catch((e: Error) => setErr(e.message));
    voicesReady().then((v) => setHasVoice(v.length > 0));
  }, []);

  useEffect(() => {
    if (!prefs.onboarded) setOnboarding(true);
  }, [prefs.onboarded]);

  const start = (mode: "quick" | "standard" | "deep" | "custom", minutes: number) => go({ page: "study", sub: "session", launch: { mode, minutes } });
  const bored = () =>
    go(pickActivity({ dueNow: ov?.due_now ?? 0, hasVoice, questsAvailable: ["konbini-first-purchase", "haruto-gaming-invite", "mika-weekend-plans"] }).route);
  const goalPct = player ? Math.min(100, ((ov?.reviews_today ?? 0) / prefs.dailyGoal) * 100) : 0;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="page-title">Study Center<span className="jp-sub">学習センター</span></h1>
          <p className="page-desc">Scheduled by FSRS. Recognising a word and producing it are tracked separately.</p>
        </div>
        <div className="row">
          <button className="btn" onClick={bored} title="Instantly pick a different kind of activity">🎲 I'm bored</button>
          <button className="btn ghost" onClick={() => setOnboarding(true)}>Preferences</button>
        </div>
      </div>
      {err && <div className="notice bad">{err}</div>}

      <div className="stack">
        <section className="hero-panel">
          <div className="hero-main">
            <div className="hero-num">{ov?.due_now ?? "–"}</div>
            <div>
              <b>reviews due now</b>
              <div className="faint">{ov ? `${ov.due_today} due today · ${ov.new_today}/${prefs.newPerDay} new words started today` : ""}</div>
            </div>
          </div>
          <div className="session-buttons">
            <button className="btn primary big" onClick={() => start("quick", 5)}>5 min<small>quick</small></button>
            <button className="btn primary big" onClick={() => start("standard", 12)}>12 min<small>standard</small></button>
            <button className="btn primary big" onClick={() => start("deep", 25)}>25 min<small>deep</small></button>
            <div className="custom-session">
              <input className="input" type="number" min={1} max={120} value={custom} onChange={(e) => setCustom(Math.max(1, Math.min(120, Number(e.target.value) || 1)))} />
              <button className="btn" onClick={() => start("custom", custom)}>Custom</button>
            </div>
          </div>
          <div className="goal">
            <div className="row" style={{ justifyContent: "space-between" }}>
              <span className="faint">Today's goal: {ov?.reviews_today ?? 0}/{prefs.dailyGoal} answers</span>
              <span className="faint">
                Studied {ov?.studied_days_last_7.filter(Boolean).length ?? 0} of the last 7 days
                <span className="week-dots">{ov?.studied_days_last_7.map((d, i) => <i key={i} className={d ? "on" : ""} />)}</span>
              </span>
            </div>
            <div className="bar-track"><div className="bar-fill" style={{ width: `${goalPct}%` }} /></div>
          </div>
        </section>

        <div className="tiles">
          <button className="tile" onClick={() => go({ page: "study", sub: "reader" })}>
            <span className="tile-jp">読む</span><b>Manga reader check</b><span className="faint">Paste a page, see what % you know</span>
          </button>
          <button className="tile" onClick={() => go({ page: "study", sub: "grammar" })}>
            <span className="tile-jp">文法</span><b>Grammar path</b><span className="faint">{ov?.mastery.find((m) => m.item_type === "grammar")?.introduced ?? 0} points started</span>
          </button>
          <button className="tile" onClick={() => go({ page: "study", sub: "kanji" })}>
            <span className="tile-jp">漢字</span><b>Kanji</b><span className="faint">{ov?.mastery.find((m) => m.item_type === "kanji")?.total ?? "–"} kanji, linked to your words</span>
          </button>
          <button className="tile" onClick={() => go({ page: "study", sub: "listening" })}>
            <span className="tile-jp">聞く</span><b>Listening & shadowing</b><span className="faint">{hasVoice ? "Japanese voice ready" : "Needs a Japanese Windows voice"}</span>
          </button>
          <button className="tile" onClick={() => go({ page: "study", sub: "stats" })}>
            <span className="tile-jp">記録</span><b>Stats & weak spots</b><span className="faint">Retention, forecast, trouble words</span>
          </button>
        </div>

        <div className="grid-2" style={{ alignItems: "start" }}>
          <section className="panel">
            <h2>Language mastery</h2>
            <p className="faint" style={{ marginTop: -6, fontSize: 12.5 }}>Based only on your review evidence. Known = stable ≥7 days, mature ≥21 days. XP can't buy this.</p>
            <div className="stack" style={{ gap: 12 }}>{ov?.mastery.map((m) => <Mastery key={m.item_type + m.skill} m={m} />)}</div>
          </section>
          <section className="panel">
            <h2>Next 14 days</h2>
            <div className="forecast">
              {ov?.forecast_14.map((n, i) => {
                const max = Math.max(1, ...ov.forecast_14);
                return (
                  <div key={i} className="fc-col" title={`${n} due`}>
                    <div className="fc-bar" style={{ height: `${(n / max) * 100}%` }} />
                    <span>{i === 0 ? "今日" : i}</span>
                  </div>
                );
              })}
            </div>
            <p className="faint" style={{ fontSize: 12.5, marginBottom: 0 }}>
              Missed a few days? Nothing resets. Due cards wait for you, and new cards slow down automatically until the backlog is under control.
            </p>
          </section>
        </div>
      </div>

      {onboarding && <Onboarding onClose={() => setOnboarding(false)} />}
    </div>
  );
}

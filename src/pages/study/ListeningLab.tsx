import { useEffect, useMemo, useState } from "react";
import { api } from "../../lib/api";
import { useAppData } from "../../lib/appData";
import { useNav } from "../../lib/nav";
import { speak, stopSpeaking, voicesReady } from "../../lib/speech";

interface Item {
  jp: string;
  en: string;
  word: string;
}

export default function ListeningLab() {
  const { vocab, prefs, setPrefs } = useAppData();
  const { go } = useNav();
  const [voices, setVoices] = useState<SpeechSynthesisVoice[] | null>(null);
  const [studied, setStudied] = useState<Set<string> | null>(null);
  const [i, setI] = useState(0);
  const [showJp, setShowJp] = useState(false);
  const [showEn, setShowEn] = useState(false);
  const [shadow, setShadow] = useState(false);
  const [yourTurn, setYourTurn] = useState(false);
  const [tally, setTally] = useState({ got: 0, missed: 0 });
  const rate = prefs.ttsRate;

  useEffect(() => {
    voicesReady().then(setVoices);
    api.cardsOfType("vocab").then((cs) => setStudied(new Set(cs.filter((c) => c.introduced_at != null).map((c) => c.item_id))));
    return () => stopSpeaking();
  }, []);

  // Sentences from words you've started first, so listening reinforces your reviews.
  const items: Item[] = useMemo(() => {
    if (!vocab || !studied) return [];
    const pick = (onlyStudied: boolean) =>
      vocab.filter((v) => (onlyStudied ? studied.has(v.id) : true)).flatMap((v) => v.examples.map((e) => ({ jp: e.jp, en: e.en, word: v.word })));
    const base = pick(true);
    const pool = base.length >= 10 ? base : pick(false);
    return pool.map((x, k) => ({ x, r: Math.sin(k * 9301 + pool.length) })).sort((a, b) => a.r - b.r).map((y) => y.x).slice(0, 200);
  }, [vocab, studied]);

  const cur = items[i];
  const play = async () => {
    if (!cur) return;
    setYourTurn(false);
    const t0 = performance.now();
    await speak(cur.jp, rate);
    if (shadow) {
      setYourTurn(true);
      const dur = performance.now() - t0;
      setTimeout(() => setYourTurn(false), Math.max(1500, dur * 1.3));
    }
  };
  const next = (got: boolean) => {
    setTally((t) => (got ? { ...t, got: t.got + 1 } : { ...t, missed: t.missed + 1 }));
    setShowJp(false);
    setShowEn(false);
    setYourTurn(false);
    setI((x) => (x + 1) % Math.max(1, items.length));
  };

  if (voices && voices.length === 0) {
    return (
      <div className="page">
        <h1 className="page-title">Listening & shadowing<span className="jp-sub">聞く</span></h1>
        <div className="panel stack" style={{ maxWidth: 680 }}>
          <b>No Japanese voice is installed on this PC.</b>
          <p className="muted" style={{ margin: 0 }}>
            Windows includes free Japanese voices. Open <b>Settings → Time &amp; language → Speech → Add voices</b>, add <b>Japanese</b>, then restart the app.
            Everything works offline once it's installed.
          </p>
          <button className="btn" onClick={() => go({ page: "study" })}>Back</button>
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="page-title">Listening & shadowing<span className="jp-sub">聞く</span></h1>
          <p className="page-desc">Hear a sentence, try to understand it before reading it, then repeat it out loud. Uses the Windows Japanese voice. Your pronunciation isn't scored.</p>
        </div>
        <button className="btn ghost" onClick={() => go({ page: "study" })}>← Study Center</button>
      </div>
      {cur ? (
        <div className="focus-card stack" style={{ maxWidth: 760, margin: "0 auto" }}>
          <div className="row" style={{ justifyContent: "space-between" }}>
            <span className="faint">Sentence {i + 1} of {items.length} · understood {tally.got}, missed {tally.missed}</span>
            <label className="toggle"><input type="checkbox" checked={shadow} onChange={(e) => setShadow(e.target.checked)} /> Shadowing pause</label>
          </div>
          <div className="row" style={{ justifyContent: "center", gap: 12 }}>
            <button className="btn primary big" onClick={play}>▶ Play</button>
            <label className="field" style={{ width: 220 }}>
              <span>Speed {rate.toFixed(2)}×</span>
              <input type="range" min={0.6} max={1.3} step={0.05} value={rate} onChange={(e) => setPrefs({ ttsRate: Number(e.target.value) })} />
            </label>
          </div>
          {yourTurn && <div className="your-turn">🎙️ Your turn: repeat it out loud</div>}
          <button className="reveal-line" onClick={() => setShowJp((v) => !v)} lang="ja">{showJp ? cur.jp : "Tap to show the Japanese"}</button>
          <button className="reveal-line en" onClick={() => setShowEn((v) => !v)}>{showEn ? cur.en : "Tap to show the translation"}</button>
          <div className="row" style={{ justifyContent: "center" }}>
            <button className="btn" onClick={() => next(false)}>Didn't catch it</button>
            <button className="btn primary" onClick={() => next(true)}>Understood it</button>
          </div>
          <p className="faint" style={{ fontSize: 12, margin: 0, textAlign: "center" }}>This tally is for you only. It doesn't change your review schedule.</p>
        </div>
      ) : (
        <div className="faint">Loading sentences…</div>
      )}
    </div>
  );
}

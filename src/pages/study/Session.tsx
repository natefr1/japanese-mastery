// Focused review session: FSRS-scheduled cards, typed production, clear stopping point.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../lib/api";
import { useAppData } from "../../lib/appData";
import { dayStart, localDay } from "../../lib/day";
import { check, clozeSentence, suggestRating, vocabAnswers } from "../../lib/learning/answers";
import { formatInterval, makeScheduler, previewDue, retrievability, schedule } from "../../lib/learning/fsrs";
import { planSession, type Plan, type PlannedCard } from "../../lib/learning/planner";
import type { CardRow, Grant, SessionSummary, Skill } from "../../lib/learning/types";
import { useNav, type SessionLaunch } from "../../lib/nav";
import { speak } from "../../lib/speech";
import { headword } from "../../components/VocabCard";
import { Icon, useToast } from "../../components/ui";
import { pickActivity } from "../../lib/bored";

type Phase = "loading" | "front" | "back" | "summary" | "empty" | "error";
type Rating = 1 | 2 | 3 | 4;

const LABELS: Record<Rating, string> = { 1: "Again", 2: "Hard", 3: "Good", 4: "Easy" };

export default function Session({ launch, onExit }: { launch: SessionLaunch; onExit: () => void }) {
  const { vocabById, grammarById, kanjiById, prefs, vocab, kanji, grammar } = useAppData();
  const { go } = useNav();
  const { toast } = useToast();
  const scheduler = useMemo(() => makeScheduler(prefs.retention), [prefs.retention]);

  const [phase, setPhase] = useState<Phase>("loading");
  const [plan, setPlan] = useState<Plan | null>(null);
  const [queue, setQueue] = useState<PlannedCard[]>([]);
  const [idx, setIdx] = useState(0);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [typed, setTyped] = useState("");
  const [checked, setChecked] = useState<{ correct: boolean; nearMiss: boolean } | null>(null);
  const [usedHint, setUsedHint] = useState(false);
  const [busy, setBusy] = useState(false);
  const [grants, setGrants] = useState<Grant[]>([]);
  const [summary, setSummary] = useState<SessionSummary | null>(null);
  const [done, setDone] = useState(0);
  const [avgMs, setAvgMs] = useState<Partial<Record<Skill, number>>>({});
  const shownAt = useRef(Date.now());
  const answerMs = useRef(0);
  const startedAt = useRef(Date.now());
  const inputRef = useRef<HTMLInputElement>(null);
  const source = launch.mode === "placement" ? "placement" : "review";

  const ready = vocab && grammar && kanji;

  // ---------- plan ----------
  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    (async () => {
      try {
        const now = Date.now();
        const q = await api.studyQueue(now, dayStart());
        const avg = Object.fromEntries(q.avg_ms) as Partial<Record<Skill, number>>;
        setAvgMs(avg);
        let p: Plan;
        if (launch.cardIds) {
          const all = [...q.due, ...q.new_candidates];
          const byId = new Map(all.map((c) => [c.id, c]));
          const fixed = launch.cardIds.map((id) => byId.get(id)).filter((c): c is CardRow => !!c);
          p = { queue: fixed.map((card) => ({ card, isNew: card.introduced_at == null })), reviewCount: fixed.length, newCount: 0, dueTotal: q.due.length, estSeconds: 0, notes: [] };
        } else {
          const usable = (c: CardRow) => {
            if (c.item_type !== "vocab") return true;
            const v = vocabById.get(c.item_id);
            return !!v && (prefs.useCore || v.category !== "core3k");
          };
          p = planSession({
            due: q.due,
            newCandidates: q.new_candidates.filter(usable),
            newToday: q.new_today,
            retention30d: q.retention_30d,
            retentionSamples: q.retention_samples,
            avgMs: avg,
            minutes: launch.minutes,
            prefs,
            only: launch.only,
            retrievability: (c) => retrievability(scheduler, c, new Date(now)),
            info: (c) => {
              if (c.item_type === "vocab") {
                const v = vocabById.get(c.item_id);
                return { level: v?.level, category: v?.category, priority: v?.tags.includes("mined"), freqRank: v?.freq_rank };
              }
              if (c.item_type === "grammar") return { level: grammarById.get(c.item_id)?.level, category: "grammar" };
              const k = kanjiById.get(c.item_id);
              return { level: k?.jlpt ? `N${k.jlpt}` : undefined, category: "kanji" };
            },
          });
        }
        if (cancelled) return;
        setPlan(p);
        setQueue(p.queue);
        if (!p.queue.length) {
          setPhase("empty");
          return;
        }
        const id = await api.sessionStart(launch.mode, launch.minutes);
        if (cancelled) return;
        setSessionId(id);
        startedAt.current = Date.now();
        shownAt.current = Date.now();
        setPhase("front");
      } catch (e) {
        setError((e as Error).message);
        setPhase("error");
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  const current = queue[idx]?.card;
  const isTyped = current ? current.skill === "production" || current.skill === "cloze" : false;

  useEffect(() => {
    if (phase === "front" && isTyped) setTimeout(() => inputRef.current?.focus(), 30);
  }, [phase, idx, isTyped]);

  const expectedMs = current ? avgMs[current.skill] ?? (current.skill === "recognition" ? 8000 : 15000) : 10000;

  // ---------- content for the current card ----------
  const content = useMemo(() => (current ? describe(current) : null), [current]); // eslint-disable-line react-hooks/exhaustive-deps
  function describe(c: CardRow) {
    if (c.item_type === "vocab") {
      const v = vocabById.get(c.item_id);
      if (!v) return null;
      const ex = v.examples[0];
      const cloze = ex ? clozeSentence(ex.jp, v.word) : null;
      return { kind: "vocab" as const, v, ex, cloze, answers: vocabAnswers(v) };
    }
    if (c.item_type === "grammar") {
      const g = grammarById.get(c.item_id);
      if (!g || !g.cloze.length) return null;
      const cz = g.cloze[c.reps % g.cloze.length]!;
      return { kind: "grammar" as const, g, cz, answers: cz.answers };
    }
    const k = kanjiById.get(c.item_id);
    if (!k) return null;
    const words = (vocab ?? []).filter((v) => v.word.includes(k.character)).slice(0, 6);
    return { kind: "kanji" as const, k, words };
  }

  // ---------- actions ----------
  const reveal = useCallback(() => {
    if (phase !== "front") return;
    answerMs.current = Date.now() - shownAt.current;
    if (isTyped && content && "answers" in content) {
      const r = check(typed, (content as { answers?: string[] }).answers ?? []);
      setChecked({ correct: r.correct, nearMiss: r.nearMiss });
    }
    setPhase("back");
  }, [phase, isTyped, content, typed]);

  const finish = useCallback(async () => {
    setPhase("summary");
    if (!sessionId) return;
    try {
      const s = await api.sessionEnd(sessionId, localDay(), dayStart(), prefs.dailyGoal);
      setSummary(s);
      setGrants((g) => [...g, ...s.grants]);
    } catch (e) {
      toast((e as Error).message, { kind: "error" });
    }
  }, [sessionId, prefs.dailyGoal, toast]);

  const rate = useCallback(
    async (rating: Rating) => {
      if (phase !== "back" || !current || busy) return;
      setBusy(true);
      const now = new Date();
      try {
        const next = schedule(scheduler, current, rating, now);
        const out = await api.reviewSubmit({
          card_id: current.id,
          expected_rev: current.rev,
          rating,
          reviewed_at: now.getTime(),
          next,
          response_ms: answerMs.current,
          auto_correct: checked ? checked.correct : null,
          answer: isTyped ? typed : null,
          session_id: sessionId,
          source,
          day: localDay(now),
        });
        setGrants((g) => [...g, ...out.grants]);
        setDone((d) => d + 1);
        // Short-term (learning) cards come back later in this session.
        const comesBack = (out.card.state === 1 || out.card.state === 3) && out.card.due <= Date.now() + 10 * 60_000 && source === "review";
        const nextQueue = comesBack ? [...queue, { card: out.card, isNew: false }] : queue;
        if (comesBack) setQueue(nextQueue);
        const overTime = Date.now() - startedAt.current > launch.minutes * 60_000;
        setTyped("");
        setChecked(null);
        setUsedHint(false);
        if (idx + 1 >= nextQueue.length || (overTime && !launch.cardIds)) {
          await finish();
        } else {
          setIdx(idx + 1);
          shownAt.current = Date.now();
          setPhase("front");
        }
      } catch (e) {
        toast((e as Error).message, { kind: "error" });
      } finally {
        setBusy(false);
      }
    },
    [phase, current, busy, scheduler, checked, isTyped, typed, sessionId, source, queue, idx, launch, finish, toast],
  );

  // keyboard
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const inInput = (e.target as HTMLElement).tagName === "INPUT";
      if (e.key === "Escape") {
        e.preventDefault();
        if (phase === "front" || phase === "back") finish();
        else onExit();
        return;
      }
      if (phase === "front" && (e.key === "Enter" || (e.key === " " && !inInput))) {
        e.preventDefault();
        reveal();
      } else if (phase === "back" && !inInput && ["1", "2", "3", "4"].includes(e.key)) {
        e.preventDefault();
        rate(Number(e.key) as Rating);
      } else if (phase === "back" && e.key === "Enter") {
        e.preventDefault();
        rate(suggested ?? 3);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const suggested: Rating | null =
    phase === "back" && current ? (isTyped && checked ? suggestRating(checked.correct, answerMs.current, expectedMs, usedHint) : null) : null;
  const previews = useMemo(() => (current && phase === "back" ? previewDue(scheduler, current, new Date()) : null), [current, phase, scheduler]);

  // ---------- render ----------
  const xp = grants.filter((g) => g.currency === "xp").reduce((a, g) => a + g.amount, 0);
  const yen = grants.filter((g) => g.currency === "yen").reduce((a, g) => a + g.amount, 0);
  const elapsed = Math.floor((Date.now() - startedAt.current) / 1000);

  if (phase === "loading") return <div className="focus-shell"><div className="faint">Planning your session…</div></div>;
  if (phase === "error")
    return (
      <div className="focus-shell">
        <div className="notice bad">{error}</div>
        <button className="btn" onClick={onExit}>Back</button>
      </div>
    );
  if (phase === "empty")
    return (
      <div className="focus-shell">
        <div className="focus-card stack" style={{ textAlign: "center" }}>
          <div style={{ fontSize: 48 }}>🌸</div>
          <h2 style={{ margin: 0 }}>Nothing due right now</h2>
          <p className="muted">{plan?.notes.join(" ") || "You're all caught up. That's a real stopping point."}</p>
          <div className="row" style={{ justifyContent: "center" }}>
            <button className="btn primary" onClick={() => go(pickActivity({ dueNow: 0, hasVoice: true, questsAvailable: [], current: launch.mode }).route)}>Try something else</button>
            <button className="btn" onClick={onExit}>Back</button>
          </div>
        </div>
      </div>
    );

  if (phase === "summary") {
    return (
      <div className="focus-shell">
        <div className="focus-card stack">
          <div className="eyebrow">{source === "placement" ? "Quick check complete" : "Session complete"} · お疲れ様！</div>
          <div className="summary-grid">
            <div><div className="v">{summary?.cards_done ?? done}</div><div className="k">cards</div></div>
            <div><div className="v">{summary?.accuracy != null ? `${Math.round(summary.accuracy * 100)}%` : "–"}</div><div className="k">not Again</div></div>
            <div><div className="v">{summary?.avg_ms != null ? `${(summary.avg_ms / 1000).toFixed(1)}s` : "–"}</div><div className="k">avg answer</div></div>
            <div><div className="v">+{xp}</div><div className="k">XP{yen ? ` · +¥${yen}` : ""}</div></div>
          </div>
          {summary?.grants.some((g) => g.reason === "daily_goal") && <div className="notice ok">Daily goal reached! +¥{summary.grants.filter((g) => g.currency === "yen").reduce((a, g) => a + g.amount, 0)}</div>}
          {source === "placement" && <p className="muted">These answers were saved as real first reviews, so nothing you just did is wasted.</p>}
          <p className="muted" style={{ margin: 0 }}>This is a good place to stop. If you want to keep going, pick one:</p>
          <div className="row">
            {source !== "placement" && (
              <button className="btn primary" onClick={() => go({ page: "study", sub: "session", launch: { mode: "quick", minutes: 5 } })}>
                Momentum: 5 more minutes
              </button>
            )}
            <button className="btn" onClick={() => go(pickActivity({ dueNow: 1, hasVoice: true, questsAvailable: ["konbini-first-purchase", "haruto-gaming-invite", "mika-weekend-plans"], current: launch.mode }).route)}>
              I'm bored: something different
            </button>
            <button className="btn ghost" onClick={onExit}>Done for now</button>
          </div>
        </div>
      </div>
    );
  }

  if (!current || !content) {
    // Item disappeared (e.g. deleted mid-session): skip it.
    return (
      <div className="focus-shell">
        <button className="btn" onClick={() => (idx + 1 < queue.length ? setIdx(idx + 1) : finish())}>Skip missing card</button>
      </div>
    );
  }

  const progress = Math.min(1, (idx + (phase === "back" ? 0.5 : 0)) / Math.max(1, queue.length));
  const say = (t: string) => speak(t, prefs.ttsRate);

  return (
    <div className="focus-shell">
      <div className="focus-top">
        <button className="btn ghost small" onClick={finish} title="End session (Esc)"><Icon name="x" size={14} /> End</button>
        <div className="focus-progress"><div style={{ width: `${progress * 100}%` }} /></div>
        <span className="faint mono">{idx + 1}/{queue.length} · {Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, "0")} / {launch.minutes}:00</span>
        <span className="xp-chip">+{xp} XP</span>
      </div>

      <div className="focus-card">
        <div className="card-kind">
          {queue[idx]?.isNew && <span className="tag user">new</span>}
          <span className="tag type">{content.kind === "vocab" ? (current.skill === "production" ? "Produce it" : "Recognise it") : content.kind === "grammar" ? "Grammar" : "Kanji"}</span>
          {content.kind === "vocab" && content.v.category === "core3k" && <span className="tag">core #{content.v.freq_rank}</span>}
          {content.kind === "vocab" && content.v.category === "manga" && <span className="tag">manga</span>}
        </div>

        {/* ---------- FRONT ---------- */}
        {content.kind === "vocab" && current.skill === "recognition" && (
          <div className="front">
            <div className="big-word" lang="ja">{headword(content.v).word}</div>
            {content.ex && <div className="context" lang="ja">{content.ex.jp}</div>}
            <button className="icon-btn" title="Listen" onClick={() => say(headword(content.v).reading || content.v.word)}>🔊</button>
          </div>
        )}
        {content.kind === "vocab" && current.skill === "production" && (
          <div className="front">
            <div className="prompt-en">{content.v.meaning}</div>
            {content.cloze ? (
              <>
                <div className="context" lang="ja">{content.cloze}</div>
                <div className="faint">{content.ex?.en}</div>
              </>
            ) : (
              <div className="faint">Type the Japanese word (kanji, kana or romaji).</div>
            )}
          </div>
        )}
        {content.kind === "grammar" && (
          <div className="front">
            <div className="context big" lang="ja">{content.cz.prompt}</div>
            <div className="faint">{content.cz.en}</div>
            {usedHint && content.cz.hint && <div className="note">{content.cz.hint}</div>}
          </div>
        )}
        {content.kind === "kanji" && (
          <div className="front">
            <div className="big-kanji" lang="ja">{content.k.character}</div>
            <div className="faint">What does it mean? How is it read?</div>
          </div>
        )}

        {isTyped && (
          <div className="answer-row">
            <input
              ref={inputRef}
              className={`input answer${checked ? (checked.correct ? " right" : " wrong") : ""}`}
              lang="ja"
              value={typed}
              disabled={phase === "back"}
              onChange={(e) => setTyped(e.target.value)}
              placeholder="答えを入力… (IME or romaji)"
              autoComplete="off"
              spellCheck={false}
            />
            {phase === "front" && (
              <button className="btn ghost small" onClick={() => setUsedHint(true)} disabled={usedHint} title="Hint (caps the suggested rating at Hard)">Hint</button>
            )}
          </div>
        )}
        {phase === "front" && usedHint && content.kind === "vocab" && current.skill === "production" && (
          <div className="faint">Starts with 「{content.v.reading.slice(0, 1)}」 · {[...content.v.reading].length} kana</div>
        )}

        {phase === "front" && (
          <button className="btn primary reveal" onClick={reveal}>
            {isTyped ? "Check" : "Show answer"} <kbd>{isTyped ? "Enter" : "Space"}</kbd>
          </button>
        )}

        {/* ---------- BACK ---------- */}
        {phase === "back" && (
          <div className="back">
            {checked && (
              <div className={`verdict ${checked.correct ? "ok" : "bad"}`}>
                {checked.correct ? "正解！ Correct" : checked.nearMiss ? "Almost: one character off" : "Not quite"}
              </div>
            )}
            {content.kind === "vocab" && (
              <>
                <div className="answer-head" lang="ja">
                  <span className="word">{headword(content.v).word}</span>
                  {headword(content.v).reading && <span className="kana">{headword(content.v).reading}</span>}
                  <button className="icon-btn" onClick={() => say(headword(content.v).reading || content.v.word)}>🔊</button>
                </div>
                <div className="meaning">{content.v.meaning}</div>
                {content.v.note && <div className="note">{content.v.note}</div>}
                {content.v.examples.slice(0, 2).map((e, i) => (
                  <div key={i} className="ex-line">
                    <div className="ex-jp" lang="ja">{e.jp} <button className="icon-btn" onClick={() => say(e.jp)}>🔊</button></div>
                    <div className="ex-en">{e.en}</div>
                  </div>
                ))}
              </>
            )}
            {content.kind === "grammar" && (
              <>
                <div className="context" lang="ja">{content.cz.prompt.replace("＿＿", `【${content.cz.answers[0]}】`)}</div>
                <div className="answer-head"><span className="word" style={{ fontSize: 22 }}>{content.g.title}</span><span className="tag level">{content.g.level}</span></div>
                <div className="meaning">{content.g.meaning}</div>
                <div className="note">{content.g.formation}</div>
                {content.cz.answers.length > 1 && <div className="faint">Also accepted: {content.cz.answers.slice(1).join("、")}</div>}
              </>
            )}
            {content.kind === "kanji" && (
              <>
                <div className="meaning">{content.k.meanings.join(", ")}</div>
                <div className="row">
                  {content.k.on.length > 0 && <span className="tag">音 {content.k.on.join("・")}</span>}
                  {content.k.kun.length > 0 && <span className="tag">訓 {content.k.kun.join("・")}</span>}
                  {content.k.jlpt && <span className="tag level">N{content.k.jlpt}</span>}
                </div>
                {content.words.length > 0 && (
                  <div className="kanji-words">
                    {content.words.map((w) => (
                      <span key={w.id} lang="ja"><b>{w.word}</b> <span className="faint">{w.reading !== w.word ? w.reading : ""} · {w.meaning.split(";")[0]}</span></span>
                    ))}
                  </div>
                )}
              </>
            )}

            <div className="ratings">
              {([1, 2, 3, 4] as Rating[]).map((r) => (
                <button key={r} className={`rate r${r}${suggested === r ? " suggested" : ""}`} disabled={busy} onClick={() => rate(r)}>
                  <b>{LABELS[r]}</b>
                  <small>{previews ? formatInterval(previews[r] - Date.now()) : ""}</small>
                  <kbd>{r}</kbd>
                </button>
              ))}
            </div>
            {suggested && <div className="faint" style={{ textAlign: "center", fontSize: 12 }}>Suggested from your answer: <b>{LABELS[suggested]}</b> (Enter). You can override it.</div>}
          </div>
        )}
      </div>
      {plan && plan.notes.length > 0 && idx === 0 && phase === "front" && <div className="faint focus-notes">{plan.notes.join(" ")}</div>}
    </div>
  );
}

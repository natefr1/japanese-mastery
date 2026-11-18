import { useEffect, useMemo, useState } from "react";
import { api } from "../../lib/api";
import { useAppData } from "../../lib/appData";
import type { CardRow } from "../../lib/learning/types";
import { useNav } from "../../lib/nav";
import { speak } from "../../lib/speech";

const STATE = ["Not started", "Learning", "Review", "Relearning"];

export default function GrammarPage() {
  const { grammar, prefs } = useAppData();
  const { go, route } = useNav();
  const [cards, setCards] = useState<Map<string, CardRow>>(new Map());
  const [sel, setSel] = useState<string | null>(route.focusId ?? null);
  const [q, setQ] = useState("");

  useEffect(() => {
    api.cardsOfType("grammar").then((cs) => setCards(new Map(cs.map((c) => [c.item_id, c]))));
  }, []);

  const list = useMemo(
    () => (grammar ?? []).filter((g) => !q || (g.title + g.meaning + g.slug + g.explanation).toLowerCase().includes(q.toLowerCase())),
    [grammar, q],
  );
  const g = (grammar ?? []).find((x) => x.id === sel) ?? list[0];
  const bySlug = new Map((grammar ?? []).map((x) => [x.slug, x]));
  const levels = ["N5", "N4", "N3", "N2"];

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="page-title">Grammar path<span className="jp-sub">文法</span></h1>
          <p className="page-desc">Original explanations, ordered by level with prerequisites. Practise with cloze sentences, scheduled by FSRS.</p>
        </div>
        <div className="row">
          <button className="btn ghost" onClick={() => go({ page: "study" })}>← Study Center</button>
          <button className="btn primary" onClick={() => go({ page: "study", sub: "session", launch: { mode: "grammar", minutes: 8, only: "grammar" } })}>Practise grammar (8 min)</button>
        </div>
      </div>
      <div className="split">
        <aside className="split-list">
          <input className="input" placeholder="Search grammar… (e.g. のに, maybe)" value={q} onChange={(e) => setQ(e.target.value)} lang="ja" />
          {levels.map((l) => {
            const items = list.filter((x) => x.level === l);
            if (!items.length) return null;
            return (
              <div key={l}>
                <div className="nav-section" style={{ paddingLeft: 4 }}>{l}</div>
                {items.map((x) => {
                  const c = cards.get(x.id);
                  return (
                    <button key={x.id} className={`list-item${g?.id === x.id ? " active" : ""}`} onClick={() => setSel(x.id)}>
                      <span lang="ja">{x.title}</span>
                      <span className={`state-dot s${c?.introduced_at ? c.state : "n"}`} title={c?.introduced_at ? STATE[c.state] : "Not started"} />
                    </button>
                  );
                })}
              </div>
            );
          })}
        </aside>
        {g && (
          <article className="panel grammar-detail">
            <div className="row">
              <h2 style={{ margin: 0, fontSize: 26 }} lang="ja">{g.title}</h2>
              <span className="tag level">{g.level}</span>
              {cards.get(g.id)?.introduced_at && <span className="tag">{STATE[cards.get(g.id)!.state]} · stability {cards.get(g.id)!.stability.toFixed(1)}d</span>}
            </div>
            <div className="meaning" style={{ fontSize: 18 }}>{g.meaning}</div>
            <div className="formation"><b>Formation</b><div lang="ja">{g.formation}</div></div>
            <p>{g.explanation}</p>
            <h3>Examples</h3>
            {g.examples.map((e, i) => (
              <div key={i} className="ex-line">
                <div className="ex-jp" lang="ja">{e.jp} <button className="icon-btn" onClick={() => speak(e.jp, prefs.ttsRate)}>🔊</button></div>
                <div className="ex-en">{e.en}</div>
              </div>
            ))}
            {g.mistakes.length > 0 && (
              <>
                <h3>Common mistakes</h3>
                {g.mistakes.map((m, i) => <div key={i} className="note" lang="ja">{m}</div>)}
              </>
            )}
            {g.compare.length > 0 && (
              <>
                <h3>Compare</h3>
                {g.compare.map((c) => {
                  const o = bySlug.get(c.slug);
                  return o ? (
                    <div key={c.slug} className="compare">
                      <button className="btn small" onClick={() => setSel(o.id)} lang="ja">{o.title}</button> <span className="muted">{c.note}</span>
                    </div>
                  ) : null;
                })}
              </>
            )}
            {g.prereqs.length > 0 && (
              <p className="faint">
                Builds on:{" "}
                {g.prereqs.map((s) => bySlug.get(s)).filter(Boolean).map((o) => (
                  <button key={o!.id} className="btn small ghost" onClick={() => setSel(o!.id)} lang="ja">{o!.title}</button>
                ))}
              </p>
            )}
          </article>
        )}
      </div>
    </div>
  );
}

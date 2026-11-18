// Manga reading coverage: paste text from a page you own, see how much you really know.
import { useEffect, useMemo, useState } from "react";
import { api, type Sample } from "../../lib/api";
import { useAppData } from "../../lib/appData";
import type { CardRow } from "../../lib/learning/types";
import { useNav } from "../../lib/nav";
import { analyze, buildKnowledge, comfort, type CoverageResult, type CoverageWord } from "../../lib/reading/coverage";
import { tokenize } from "../../lib/reading/tokenizer";
import type { VocabInput } from "../../lib/types";
import { VocabEditor } from "../../components/VocabEditor";
import { Confirm, useToast } from "../../components/ui";

export const MY_MANGA = [
  "NARUTO", "僕のヒーローアカデミア", "ブラッククローバー", "とらドラ！", "ワンパンマン", "鬼滅の刃", "君に届け", "はじめの一歩",
  "ダンダダン", "怪獣8号", "ヴィンランド・サガ", "斉木楠雄のΨ難", "スキップとローファー", "ホリミヤ", "ブルーロック",
  "夫婦以上、恋人未満。", "その着せ替え人形は恋をする", "ONE PIECE", "ルックバック", "HUNTER×HUNTER", "呪術廻戦",
  "葬送のフリーレン", "薫る花は凛と咲く",
];

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

export default function ReaderPage() {
  const { vocab, reloadVocab } = useAppData();
  const { go } = useNav();
  const { toast } = useToast();
  const [cards, setCards] = useState<CardRow[] | null>(null);
  const [samples, setSamples] = useState<Sample[]>([]);
  const [draft, setDraft] = useState<Sample>({ series: "", title: "", text: "" });
  const [result, setResult] = useState<CoverageResult | null>(null);
  const [seriesResult, setSeriesResult] = useState<{ series: string; r: CoverageResult; n: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState<VocabInput | null>(null);
  const [del, setDel] = useState<Sample | null>(null);
  const [filter, setFilter] = useState<"todo" | "all">("todo");

  const loadSamples = () => api.sampleList().then(setSamples);
  useEffect(() => {
    api.cardsOfType("vocab").then(setCards);
    loadSamples();
  }, []);

  const knowledge = useMemo(() => (vocab && cards ? buildKnowledge(vocab, cards) : null), [vocab, cards]);
  const series = useMemo(() => [...new Set(samples.map((s) => s.series))], [samples]);

  const run = async (text: string) => {
    if (!knowledge) return null;
    return analyze(await tokenize(text), knowledge);
  };

  const check = async () => {
    setBusy(true);
    try {
      setResult(await run(draft.text));
    } catch (e) {
      toast((e as Error).message, { kind: "error" });
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    try {
      const s = await api.sampleSave(draft);
      setDraft(s);
      await loadSamples();
      toast("Sample saved.");
    } catch (e) {
      toast((e as Error).message, { kind: "error" });
    }
  };

  const checkSeries = async (name: string) => {
    setBusy(true);
    try {
      const text = samples.filter((s) => s.series === name).map((s) => s.text).join("\n");
      const r = await run(text);
      if (r) setSeriesResult({ series: name, r, n: samples.filter((s) => s.series === name).length });
    } finally {
      setBusy(false);
    }
  };

  const prioritize = async (w: CoverageWord) => {
    const v = vocab?.find((x) => x.id === w.vocabId);
    if (!v) return;
    await api.vocabSave({ ...v, tags: [...new Set([...v.tags, "mined"])] });
    await reloadVocab();
    toast(`「${v.word}」 will be introduced first in your next session.`);
  };

  const shown = result?.words.filter((w) => (filter === "todo" ? w.status === "unknown" || w.status === "queued" : true)) ?? [];

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="page-title">Manga reader check<span className="jp-sub">読む</span></h1>
          <p className="page-desc">
            Type or paste the text from a page you're reading. The app splits it into words offline and checks each one against your real review history.
          </p>
        </div>
        <button className="btn ghost" onClick={() => go({ page: "study" })}>← Study Center</button>
      </div>

      <div className="notice" style={{ marginBottom: 14, fontSize: 13.5 }}>
        <b>What the number means:</b> the share of words on the page you know (stable for at least 7 days in reviews). Research on reading puts adequate comprehension at about <b>95%</b> and comfortable reading at <b>98%</b>.
        At 75%, one word in four is unknown. Names don't count; particles count as known.
        Most of your shōnen series print furigana, so unknown <i>words</i>, not kanji readings, are what slow you down.
      </div>

      <div className="grid-2" style={{ alignItems: "start" }}>
        <section className="panel stack">
          <div className="grid-2">
            <label className="field">
              <span>Series</span>
              <input className="input" list="my-manga" value={draft.series} onChange={(e) => setDraft({ ...draft, series: e.target.value })} placeholder="ONE PIECE" lang="ja" />
              <datalist id="my-manga">{MY_MANGA.map((m) => <option key={m} value={m} />)}</datalist>
            </label>
            <label className="field">
              <span>Page / note</span>
              <input className="input" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} placeholder="Vol. 1, p. 12" />
            </label>
          </div>
          <label className="field">
            <span>Text from the page</span>
            <textarea className="textarea" lang="ja" style={{ minHeight: 180 }} value={draft.text} onChange={(e) => setDraft({ ...draft, text: e.target.value })} placeholder="海賊王に俺はなる！" />
          </label>
          <div className="row">
            <button className="btn primary" disabled={!draft.text.trim() || busy || !knowledge} onClick={check}>{busy ? "Analysing…" : "Check coverage"}</button>
            <button className="btn" disabled={!draft.text.trim() || !draft.series.trim()} onClick={save}>{draft.id ? "Update sample" : "Save to library"}</button>
            {draft.id && <button className="btn ghost" onClick={() => { setDraft({ series: draft.series, title: "", text: "" }); setResult(null); }}>New page</button>}
          </div>
          <p className="faint" style={{ fontSize: 12, margin: 0 }}>The first check loads the dictionary, which takes a couple of seconds. Text stays on this PC.</p>
        </section>

        <section className="panel">
          {result ? (
            <CoverageView r={result} />
          ) : (
            <p className="faint">Results appear here.</p>
          )}
        </section>
      </div>

      {result && (
        <section className="panel" style={{ marginTop: 14 }}>
          <div className="row" style={{ marginBottom: 8 }}>
            <h2 style={{ margin: 0 }}>Words on this page</h2>
            <span className="spacer" />
            <button className={`chip${filter === "todo" ? " on" : ""}`} onClick={() => setFilter("todo")}>Not known yet</button>
            <button className={`chip${filter === "all" ? " on" : ""}`} onClick={() => setFilter("all")}>All</button>
          </div>
          <table className="table">
            <thead><tr><th>Word</th><th>Count</th><th>Status</th><th /></tr></thead>
            <tbody>
              {shown.map((w) => (
                <tr key={w.key}>
                  <td lang="ja"><b>{w.key}</b> <span className="faint">{w.reading}</span></td>
                  <td>{w.count}</td>
                  <td><span className={`pill st-${w.status}`}>{{ known: "known", learning: "learning", queued: "in deck, not started", unknown: "not in deck" }[w.status]}</span></td>
                  <td style={{ textAlign: "right" }}>
                    {w.status === "queued" && <button className="btn small" onClick={() => prioritize(w)}>Learn next</button>}
                    {w.status === "unknown" && (
                      <button className="btn small" onClick={() => setAdding({ word: w.key, reading: w.reading || w.key, meaning: "", word_type: "n", level: "", category: "manga", note: "", personal_note: draft.series ? `From ${draft.series}${draft.title ? `, ${draft.title}` : ""}` : "", tags: ["mined"], examples: [] })}>
                        Add to deck
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <section className="panel" style={{ marginTop: 14 }}>
        <h2>Library</h2>
        {series.length === 0 && <p className="faint">Save pages to track each series' coverage over time.</p>}
        {series.map((name) => (
          <div key={name} className="library-series">
            <div className="row">
              <b lang="ja">{name}</b>
              <span className="faint">{samples.filter((s) => s.series === name).length} pages</span>
              <span className="spacer" />
              <button className="btn small" disabled={busy || !knowledge} onClick={() => checkSeries(name)}>Series coverage</button>
            </div>
            {seriesResult?.series === name && (
              <div className="faint" style={{ margin: "6px 0" }}>
                Across {seriesResult.n} pages: <b>{pct(seriesResult.r.coverage)}</b> known · {pct(seriesResult.r.coverageWithLearning)} including words you're learning · {comfort(seriesResult.r.coverage).label}
              </div>
            )}
            <div className="row" style={{ gap: 6 }}>
              {samples.filter((s) => s.series === name).map((s) => (
                <span key={s.id} className="sample-chip">
                  <button className="btn small ghost" onClick={() => { setDraft(s); setResult(null); }}>{s.title || "untitled"}</button>
                  <button className="icon-btn" aria-label="Delete sample" onClick={() => setDel(s)}>×</button>
                </span>
              ))}
            </div>
          </div>
        ))}
      </section>

      {adding && (
        <VocabEditor
          item={null}
          initial={adding}
          onClose={() => setAdding(null)}
          onSave={async (inp) => {
            await api.vocabSave(inp);
            await reloadVocab();
            setAdding(null);
            toast(`Added 「${inp.word}」. It's tagged “mined”, so it's introduced first.`);
            if (draft.text) check();
          }}
        />
      )}
      {del && (
        <Confirm title="Delete this sample?" body={`${del.series} · ${del.title || "untitled"}`} confirmLabel="Delete" danger onCancel={() => setDel(null)}
          onConfirm={async () => { await api.sampleDelete(del.id!); setDel(null); loadSamples(); }} />
      )}
    </div>
  );
}

function CoverageView({ r }: { r: CoverageResult }) {
  const c = comfort(r.coverage);
  const seg = (n: number) => `${r.counted ? (n / r.counted) * 100 : 0}%`;
  return (
    <div className="stack">
      <div className="row" style={{ alignItems: "baseline" }}>
        <div className="hero-num">{pct(r.coverage)}</div>
        <div><b>known</b><div className="faint">{pct(r.coverageWithLearning)} counting words you're still learning</div></div>
      </div>
      <div className={`notice ${c.tone}`}>{c.label}</div>
      <div className="stack-bar tall">
        <div className="seg mature" style={{ width: seg(r.known) }} />
        <div className="seg learning" style={{ width: seg(r.learning) }} />
        <div className="seg queued" style={{ width: seg(r.queued) }} />
      </div>
      <div className="faint" style={{ fontSize: 13 }}>
        {r.counted} words counted · {r.known} known ({r.grammarTokens} particles/auxiliaries) · {r.learning} learning · {r.queued} in your deck but not started · {r.unknown} not in your deck · {r.names} names skipped
      </div>
      {r.coverage < 0.95 && r.counted > 0 && (
        <div className="faint" style={{ fontSize: 13 }}>
          To reach 95% here you'd need about {Math.max(0, Math.ceil(0.95 * r.counted - r.known))} more known word occurrences. Start with the most frequent unknown words below.
        </div>
      )}
    </div>
  );
}

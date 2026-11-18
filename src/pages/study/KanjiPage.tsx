import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../lib/api";
import { useAppData } from "../../lib/appData";
import type { CardRow, Kanji } from "../../lib/learning/types";
import { useNav } from "../../lib/nav";
import { Modal } from "../../components/ui";

export default function KanjiPage() {
  const { kanji, vocab } = useAppData();
  const { go } = useNav();
  const [cards, setCards] = useState<Map<string, CardRow>>(new Map());
  const [lvl, setLvl] = useState<number | "all" | "deck">("deck");
  const [q, setQ] = useState("");
  const [sel, setSel] = useState<Kanji | null>(null);

  useEffect(() => {
    api.cardsOfType("kanji").then((cs) => setCards(new Map(cs.map((c) => [c.item_id, c]))));
  }, []);

  const inDeck = useMemo(() => {
    const s = new Set<string>();
    for (const v of vocab ?? []) for (const ch of v.word) s.add(ch);
    return s;
  }, [vocab]);

  const list = useMemo(
    () =>
      (kanji ?? []).filter(
        (k) =>
          (lvl === "all" || (lvl === "deck" ? inDeck.has(k.character) : k.jlpt === lvl)) &&
          (!q || k.character === q || k.meanings.join(" ").toLowerCase().includes(q.toLowerCase()) || [...k.on, ...k.kun].some((r) => r.includes(q))),
      ),
    [kanji, lvl, q, inDeck],
  );

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="page-title">Kanji<span className="jp-sub">漢字</span></h1>
          <p className="page-desc">{kanji?.length ?? "–"} kanji (JLPT N5–N2 plus every kanji in your decks), each linked to the words that use it.</p>
        </div>
        <div className="row">
          <button className="btn ghost" onClick={() => go({ page: "study" })}>← Study Center</button>
          <button className="btn primary" onClick={() => go({ page: "study", sub: "session", launch: { mode: "kanji", minutes: 8, only: "kanji" } })}>Practise kanji (8 min)</button>
        </div>
      </div>
      <div className="row" style={{ marginBottom: 14 }}>
        <input className="input" style={{ maxWidth: 280 }} placeholder="Search kanji, meaning, reading…" value={q} onChange={(e) => setQ(e.target.value)} lang="ja" />
        <button className={`chip${lvl === "deck" ? " on" : ""}`} onClick={() => setLvl("deck")}>In my words</button>
        {[5, 4, 3, 2, 1].map((l) => <button key={l} className={`chip gold${lvl === l ? " on" : ""}`} onClick={() => setLvl(l)}>N{l}</button>)}
        <button className={`chip${lvl === "all" ? " on" : ""}`} onClick={() => setLvl("all")}>All</button>
        <span className="count">{list.length}</span>
      </div>
      <div className="kanji-grid">
        {list.map((k) => {
          const c = cards.get(k.id);
          return (
            <button key={k.id} className={`kanji-cell s${c?.introduced_at ? c.state : "n"}`} onClick={() => setSel(k)} title={k.meanings.join(", ")} lang="ja">
              {k.character}
            </button>
          );
        })}
      </div>
      <p className="faint" style={{ fontSize: 12 }}>Kanji data: KANJIDIC2 © EDRDG, used under CC BY-SA 4.0.</p>
      {sel && <KanjiDetail k={sel} card={cards.get(sel.id)} onClose={() => setSel(null)} />}
    </div>
  );
}

function KanjiDetail({ k, card, onClose }: { k: Kanji; card?: CardRow; onClose: () => void }) {
  const { vocab } = useAppData();
  const words = (vocab ?? []).filter((v) => v.word.includes(k.character)).sort((a, b) => (a.freq_rank ?? 99999) - (b.freq_rank ?? 99999)).slice(0, 10);
  return (
    <Modal title={`${k.character}: ${k.meanings[0] ?? ""}`} onClose={onClose}>
      <div className="kanji-detail">
        <div className="big-kanji" lang="ja">{k.character}</div>
        <div className="stack" style={{ gap: 8 }}>
          <div className="meaning">{k.meanings.join(", ")}</div>
          <div className="row">
            {k.on.length > 0 && <span className="tag">音読み {k.on.join("・")}</span>}
            {k.kun.length > 0 && <span className="tag">訓読み {k.kun.join("・")}</span>}
          </div>
          <div className="faint">{k.strokes} strokes{k.jlpt ? ` · JLPT N${k.jlpt}` : ""}{k.grade ? ` · grade ${k.grade}` : ""}</div>
          <div className="faint">{card?.introduced_at ? `Studying: stability ${card.stability.toFixed(1)} days, ${card.lapses} lapses` : "Not started yet"}</div>
        </div>
      </div>
      {words.length > 0 && (
        <>
          <h3 style={{ margin: "6px 0 0" }}>Words you have with {k.character}</h3>
          <div className="kanji-words">
            {words.map((w) => <span key={w.id} lang="ja"><b>{w.word}</b> <span className="faint">{w.reading !== w.word ? w.reading : ""} · {w.meaning.split(/[;/]/)[0]}</span></span>)}
          </div>
        </>
      )}
      <h3 style={{ margin: "6px 0 0" }}>Writing practice</h3>
      <TracePad ch={k.character} />
      <p className="faint" style={{ fontSize: 12, margin: 0 }}>Trace over the guide with your mouse or pen. It isn't graded, and stroke order isn't checked.</p>
    </Modal>
  );
}

function TracePad({ ch }: { ch: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const [guide, setGuide] = useState(true);
  const pos = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * 300, ((e.clientY - r.top) / r.height) * 300] as const;
  };
  const clear = () => ref.current?.getContext("2d")?.clearRect(0, 0, 300, 300);
  return (
    <div className="trace">
      <div className="trace-box">
        {guide && <span className="trace-guide" lang="ja">{ch}</span>}
        <canvas
          ref={ref}
          width={300}
          height={300}
          onPointerDown={(e) => {
            drawing.current = true;
            const ctx = ref.current!.getContext("2d")!;
            const [x, y] = pos(e);
            ctx.lineWidth = 9;
            ctx.lineCap = "round";
            ctx.lineJoin = "round";
            ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue("--text");
            ctx.beginPath();
            ctx.moveTo(x, y);
            (e.target as HTMLCanvasElement).setPointerCapture(e.pointerId);
          }}
          onPointerMove={(e) => {
            if (!drawing.current) return;
            const ctx = ref.current!.getContext("2d")!;
            const [x, y] = pos(e);
            ctx.lineTo(x, y);
            ctx.stroke();
          }}
          onPointerUp={() => (drawing.current = false)}
        />
      </div>
      <div className="stack" style={{ gap: 6 }}>
        <button className="btn small" onClick={clear}>Clear</button>
        <label className="toggle"><input type="checkbox" checked={guide} onChange={(e) => setGuide(e.target.checked)} /> Guide</label>
      </div>
    </div>
  );
}

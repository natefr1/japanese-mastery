// Post-chat review: only on request. Separates real errors from unnatural phrasing,
// natural casual speech, slang and things you did well. Nothing is said in-chat.
import { useEffect, useState } from "react";
import { social } from "../../../lib/social/api";
import type { ObsCategory, Observation, Review } from "../../../lib/social/types";
import { usePhone } from "./ctx";

const CAT: Record<ObsCategory, { ja: string; en: string; cls: string }> = {
  error: { ja: "まちがい", en: "Error — may be misunderstood", cls: "c-error" },
  unnatural: { ja: "不自然", en: "Understandable, but unnatural", cls: "c-unnatural" },
  natural_casual: { ja: "自然なくだけた表現", en: "Natural casual speech — not a mistake", cls: "c-casual" },
  slang: { ja: "スラング", en: "Slang / internet speak", cls: "c-slang" },
  success: { ja: "よくできた", en: "Communicated well", cls: "c-success" },
  vocab: { ja: "単語", en: "Words to learn", cls: "c-vocab" },
};
const ORDER: ObsCategory[] = ["error", "unnatural", "natural_casual", "slang", "success"];

export function ReviewScreen({ id }: { id: string }) {
  const { back, ai, push } = usePhone();
  const [review, setReview] = useState<Review | null>(null);
  const [past, setPast] = useState<Observation[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { social.observations(id).then(setPast).catch(() => {}); }, [id, review]);

  const run = () => {
    setBusy(true);
    setErr(null);
    social.review(id).then(setReview).catch((e: Error) => setErr(e.message)).finally(() => setBusy(false));
  };

  const items = review?.items ?? [];
  return (
    <div className="ph-page">
      <header className="ph-head"><button className="ph-back" onClick={back} aria-label="Back">‹</button><h2>ふりかえり</h2></header>
      <div className="ph-scroll">
        {!review && (
          <section className="card-sec">
            <p>Review the messages you wrote in this chat since your last review. Your friends never see this.</p>
            <p className="ph-hint">Sends this chat's recent messages to your AI provider once. {ai && !ai.ready && "AI isn't set up yet."}</p>
            {ai && !ai.ready ? <button className="pill-btn" onClick={() => push({ s: "settings" })}>Set up AI</button> : <button className="pill-btn big" disabled={busy} onClick={run}>{busy ? "Reviewing…" : "Review my Japanese"}</button>}
            {err && <div className="inline-note bad">{err}</div>}
          </section>
        )}
        {review && (
          <>
            {review.overall && <section className="card-sec overall"><b>Overall</b><p>{review.overall}</p></section>}
            {ORDER.map((c) => {
              const list = items.filter((i) => i.category === c && (i.original || i.note));
              if (!list.length) return null;
              return (
                <section key={c} className={`card-sec obs ${CAT[c].cls}`}>
                  <h3><span lang="ja">{CAT[c].ja}</span><small>{CAT[c].en}</small></h3>
                  {list.map((o, i) => (
                    <div key={i} className="obs-item">
                      {o.original && <p className="obs-orig" lang="ja">{o.original}</p>}
                      {o.suggestion && <p className="obs-sugg" lang="ja">→ {o.suggestion}</p>}
                      {o.note && <p className="obs-note">{o.note}</p>}
                    </div>
                  ))}
                </section>
              );
            })}
            {review.vocab.length > 0 && (
              <section className="card-sec obs c-vocab">
                <h3><span lang="ja">単語</span><small>Words from this chat</small></h3>
                {review.vocab.map((v) => <div key={v.word} className="vocab-line"><b lang="ja">{v.word}</b>{v.reading && <span lang="ja">{v.reading}</span>}<span>{v.meaning}</span></div>)}
                <p className="ph-hint">Add the ones you want to keep in Vocabulary.</p>
              </section>
            )}
            <button className="ph-link center" onClick={() => setReview(null)}>Done</button>
          </>
        )}
        {!review && past.filter((p) => p.category !== "vocab").length > 0 && (
          <section className="card-sec">
            <h3>以前のふりかえり</h3>
            {past.filter((p) => p.category !== "vocab" && (p.original || p.note)).slice(0, 30).map((o) => (
              <div key={o.id} className={`obs-item mini ${CAT[o.category]?.cls ?? ""}`}>
                <span className="obs-tag">{CAT[o.category]?.ja ?? o.category}</span>
                {o.original && <span lang="ja">{o.original}</span>}
                {o.suggestion && <span lang="ja"> → {o.suggestion}</span>}
              </div>
            ))}
          </section>
        )}
      </div>
    </div>
  );
}

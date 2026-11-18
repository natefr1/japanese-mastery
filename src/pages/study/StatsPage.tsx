import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import { useAppData } from "../../lib/appData";
import { dayStart } from "../../lib/day";
import type { CardRow, Overview, StatsDetail } from "../../lib/learning/types";
import { useNav } from "../../lib/nav";
import { useToast } from "../../components/ui";

export default function StatsPage() {
  const { go } = useNav();
  const { toast } = useToast();
  const { vocabById, grammarById, kanjiById } = useAppData();
  const [s, setS] = useState<StatsDetail | null>(null);
  const [ov, setOv] = useState<Overview | null>(null);

  const load = () => Promise.all([api.studyStats(dayStart()), api.studyOverview(Date.now(), dayStart())]).then(([a, b]) => { setS(a); setOv(b); });
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const label = (c: CardRow) => {
    if (c.item_type === "vocab") { const v = vocabById.get(c.item_id); return v ? `${v.word}  ${v.reading !== v.word ? v.reading : ""}` : "?"; }
    if (c.item_type === "grammar") return grammarById.get(c.item_id)?.title ?? "?";
    return kanjiById.get(c.item_id)?.character ?? "?";
  };
  const max = Math.max(1, ...(s?.daily.map((d) => d.reviews) ?? [1]));

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="page-title">Stats & weak spots<span className="jp-sub">記録</span></h1>
          <p className="page-desc">All numbers come from your own review log. Nothing here is estimated or made up.</p>
        </div>
        <div className="row">
          <button className="btn ghost" onClick={() => go({ page: "study" })}>← Study Center</button>
          {s && s.weak.length > 0 && (
            <button className="btn primary" onClick={() => go({ page: "study", sub: "session", launch: { mode: "weak", minutes: 10, cardIds: s.weak.filter((w) => w.card.due <= Date.now() + 864e5).map((w) => w.card.id) } })}>
              Drill weak items that are due
            </button>
          )}
        </div>
      </div>
      <div className="stack">
        <section className="panel">
          <h2>Answers per day (last 30 days) · {s?.total_reviews ?? 0} total</h2>
          <div className="daily">
            {s?.daily.map((d) => (
              <div key={d.day_offset} className="fc-col" title={`${d.reviews} answers, ${d.again} Again`}>
                <div className="fc-bar" style={{ height: `${(d.reviews / max) * 100}%` }}>
                  <div className="fc-again" style={{ height: d.reviews ? `${(d.again / d.reviews) * 100}%` : 0 }} />
                </div>
                <span>{d.day_offset === 0 ? "今" : ""}</span>
              </div>
            ))}
          </div>
        </section>
        <div className="grid-2" style={{ alignItems: "start" }}>
          <section className="panel">
            <h2>By skill</h2>
            <table className="table">
              <thead><tr><th>Skill</th><th>Retention (30d)</th><th>Avg answer</th><th>Known</th></tr></thead>
              <tbody>
                {ov?.mastery.map((m) => {
                  const ms = s?.avg_ms_by_skill.find(([k]) => k === m.skill)?.[1];
                  return (
                    <tr key={m.item_type + m.skill}>
                      <td>{m.item_type} · {m.skill}</td>
                      <td>{m.retention_samples >= 10 && m.retention_30d != null ? `${Math.round(m.retention_30d * 100)}% (${m.retention_samples})` : <span className="faint">not enough data</span>}</td>
                      <td>{ms ? `${(ms / 1000).toFixed(1)}s` : "–"}</td>
                      <td>{m.known}/{m.total}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="faint" style={{ fontSize: 12 }}>Retention = share of answers on mature (Review-state) cards that weren't “Again”. Response time is shown because fast recall is the goal, not just correct recall.</p>
          </section>
          <section className="panel">
            <h2>Weak items</h2>
            {s && s.weak.length === 0 && <p className="faint">No repeated misses yet.</p>}
            <table className="table">
              <tbody>
                {s?.weak.map((w) => (
                  <tr key={w.card.id}>
                    <td lang="ja"><b>{label(w.card)}</b> <span className="faint">{w.card.skill}</span></td>
                    <td className="faint">{w.card.lapses} lapses · {w.recent_again} recent Again</td>
                    <td style={{ textAlign: "right" }}>
                      <button className="btn small ghost" onClick={() => api.cardSuspend(w.card.id, true).then(() => { toast("Suspended. It won't come up until you unsuspend it."); load(); })}>Suspend</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </div>
      </div>
    </div>
  );
}

import { memo } from "react";
import { conjugationRows } from "../lib/conjugation";
import { categoryLabel, TYPE_LABELS } from "../lib/labels";
import type { VocabItem } from "../lib/types";
import { Icon } from "./ui";

/** Headword as shown to the learner: する-nouns display with する. */
export function headword(v: VocabItem): { word: string; reading: string } {
  if (v.word_type === "s") return { word: v.word + "する", reading: v.reading !== v.word ? v.reading + "する" : "" };
  return { word: v.word, reading: v.reading !== v.word ? v.reading : "" };
}

function Reveal({ className, children }: { className: string; children: React.ReactNode }) {
  return (
    <div className={className} onClick={(e) => e.currentTarget.classList.toggle("revealed")}>
      {children}
    </div>
  );
}

export const VocabCard = memo(function VocabCard(props: {
  item: VocabItem;
  onEdit: (v: VocabItem) => void;
  onDelete: (v: VocabItem) => void;
}) {
  const v = props.item;
  const h = headword(v);
  const rows = conjugationRows(v.word, v.reading, v.word_type);
  return (
    <article className="card">
      <div className="card-top">
        <div>
          <div className="kana">{h.reading}</div>
          <div className="word" lang="ja">{h.word}</div>
        </div>
        <div className="tags">
          {v.level && <span className="tag level">{v.level}</span>}
          <span className="tag type">{TYPE_LABELS[v.word_type]}</span>
          <span className="tag">{categoryLabel(v.category)}</span>
          {!v.source.startsWith("seed:") && <span className="tag user">yours</span>}
          {v.tags.map((t) => <span key={t} className="tag">#{t}</span>)}
        </div>
      </div>
      <Reveal className="meaning">{v.meaning}</Reveal>
      {v.note && <div className="note">{v.note}</div>}
      {v.personal_note && <div className="note personal">{v.personal_note}</div>}
      {v.examples.length > 0 && (
        <div className="examples">
          {v.examples.map((ex, i) => (
            <div key={i}>
              <div className="ex-jp" lang="ja">{ex.jp}</div>
              {ex.en && <Reveal className="ex-en">{ex.en}</Reveal>}
            </div>
          ))}
        </div>
      )}
      {rows.length > 0 && (
        <details className="conj">
          <summary>Conjugations ({rows.length})</summary>
          <table className="conj-table">
            <tbody>
              {rows.map((r) => (
                <tr key={r.form}>
                  <td>{r.form}</td>
                  <td lang="ja">
                    <b>{r.word}</b>
                    {r.reading && <small>{r.reading}</small>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
      <div className="card-actions">
        <button className="icon-btn" title="Edit" aria-label={`Edit ${v.word}`} onClick={() => props.onEdit(v)}>
          <Icon name="edit" size={16} />
        </button>
        <button className="icon-btn" title="Delete" aria-label={`Delete ${v.word}`} onClick={() => props.onDelete(v)}>
          <Icon name="trash" size={16} />
        </button>
      </div>
    </article>
  );
});

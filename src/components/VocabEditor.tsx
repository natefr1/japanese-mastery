import { useState } from "react";
import { CATEGORIES, LEVELS, TYPE_LABELS } from "../lib/labels";
import type { Example, VocabInput, VocabItem, WordType } from "../lib/types";
import { Icon, Modal } from "./ui";

const empty = (): VocabInput => ({
  id: null, word: "", reading: "", meaning: "", word_type: "n", level: "", category: "",
  note: "", personal_note: "", tags: [], examples: [{ jp: "", en: "" }],
});

export function VocabEditor(props: {
  item: VocabItem | null; // null = new
  /** Prefill for a new item (e.g. a word mined from a manga page). */
  initial?: VocabInput;
  onSave: (input: VocabInput) => Promise<void>;
  onClose: () => void;
}) {
  const [v, setV] = useState<VocabInput>(() =>
    props.item
      ? { ...props.item, examples: props.item.examples.length ? props.item.examples : [{ jp: "", en: "" }] }
      : props.initial
        ? { ...empty(), ...props.initial, examples: props.initial.examples.length ? props.initial.examples : [{ jp: "", en: "" }] }
        : empty(),
  );
  const [tagText, setTagText] = useState((props.item?.tags ?? props.initial?.tags ?? []).join(", "));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = <K extends keyof VocabInput>(k: K, val: VocabInput[K]) => setV((s) => ({ ...s, [k]: val }));
  const setEx = (i: number, patch: Partial<Example>) =>
    setV((s) => ({ ...s, examples: s.examples.map((e, j) => (j === i ? { ...e, ...patch } : e)) }));

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await props.onSave({ ...v, tags: tagText.split(/[,、;]/).map((t) => t.trim()).filter(Boolean) });
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <Modal
      title={props.item ? `Edit 「${props.item.word}」` : "Add a word"}
      onClose={props.onClose}
      footer={
        <>
          {error && <span className="faint" style={{ color: "var(--bad)", marginRight: "auto" }}>{error}</span>}
          <button className="btn ghost" onClick={props.onClose}>Cancel</button>
          <button className="btn primary" disabled={busy} onClick={save}>{busy ? "Saving…" : "Save"}</button>
        </>
      }
    >
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <div className="grid-2">
          <label className="field">
            <span>Word (kanji or kana)</span>
            <input className="input" lang="ja" value={v.word} onChange={(e) => set("word", e.target.value)} placeholder="配信" />
          </label>
          <label className="field">
            <span>Reading (kana)</span>
            <input className="input" lang="ja" value={v.reading} onChange={(e) => set("reading", e.target.value)} placeholder="はいしん" />
          </label>
        </div>
        <label className="field">
          <span>Meaning</span>
          <input className="input" value={v.meaning} onChange={(e) => set("meaning", e.target.value)} placeholder="stream; broadcast" />
        </label>
        <div className="grid-3">
          <label className="field">
            <span>Type</span>
            <select className="select" value={v.word_type} onChange={(e) => set("word_type", e.target.value as WordType)}>
              {(Object.keys(TYPE_LABELS) as WordType[]).map((t) => <option key={t} value={t}>{TYPE_LABELS[t]}</option>)}
            </select>
          </label>
          <label className="field">
            <span>Level</span>
            <select className="select" value={v.level} onChange={(e) => set("level", e.target.value)}>
              <option value="">—</option>
              {LEVELS.map((l) => <option key={l}>{l}</option>)}
            </select>
          </label>
          <label className="field">
            <span>Category</span>
            <select className="select" value={v.category} onChange={(e) => set("category", e.target.value)}>
              <option value="">—</option>
              {Object.entries(CATEGORIES).map(([k, c]) => <option key={k} value={k}>{c.label}</option>)}
            </select>
          </label>
        </div>
        {v.word_type === "s" && <p className="faint" style={{ margin: 0, fontSize: 12.5 }}>For する verbs, enter just the noun part (配信, not 配信する).</p>}
        <label className="field">
          <span>Usage note</span>
          <textarea className="textarea" value={v.note} onChange={(e) => set("note", e.target.value)} />
        </label>
        <label className="field">
          <span>Personal note</span>
          <textarea className="textarea" value={v.personal_note} onChange={(e) => set("personal_note", e.target.value)} placeholder="Mnemonics, where you heard it…" />
        </label>
        <label className="field">
          <span>Tags (comma-separated)</span>
          <input className="input" value={tagText} onChange={(e) => setTagText(e.target.value)} placeholder="kiyo, horror" />
        </label>
        <div className="field">
          <span>Example sentences</span>
          {v.examples.map((ex, i) => (
            <div key={i} className="row" style={{ alignItems: "flex-start", flexWrap: "nowrap" }}>
              <div className="stack" style={{ gap: 6, flex: 1 }}>
                <input className="input" lang="ja" value={ex.jp} onChange={(e) => setEx(i, { jp: e.target.value })} placeholder="日本語の例文" />
                <input className="input" value={ex.en} onChange={(e) => setEx(i, { en: e.target.value })} placeholder="English translation" />
              </div>
              <button type="button" className="icon-btn" aria-label="Remove example" onClick={() => set("examples", v.examples.filter((_, j) => j !== i))}>
                <Icon name="x" />
              </button>
            </div>
          ))}
          <div>
            <button type="button" className="btn small" onClick={() => set("examples", [...v.examples, { jp: "", en: "" }])}>
              <Icon name="plus" size={14} /> Add example
            </button>
          </div>
        </div>
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}

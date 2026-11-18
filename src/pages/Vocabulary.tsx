import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../lib/api";
import { CATEGORIES, LEVELS, isVerb } from "../lib/labels";
import type { VocabInput, VocabItem } from "../lib/types";
import { VocabCard } from "../components/VocabCard";
import { VocabEditor } from "../components/VocabEditor";
import { Icon, useToast } from "../components/ui";

export default function Vocabulary() {
  const { toast } = useToast();
  const [items, setItems] = useState<VocabItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const q = useDeferredValue(query.trim().toLowerCase());
  const [cat, setCat] = useState("all");
  const [lvl, setLvl] = useState("all");
  const [verbsOnly, setVerbsOnly] = useState(false);
  const [hideEn, setHideEn] = useState(false);
  const [editing, setEditing] = useState<VocabItem | null | "new">(null);
  const [limit, setLimit] = useState(120);
  const searchRef = useRef<HTMLInputElement>(null);

  const load = useCallback(() => api.vocabList().then(setItems).catch((e: Error) => setError(e.message)), []);
  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement).closest("input, textarea, select");
      if (e.key === "/" && !typing) {
        e.preventDefault();
        searchRef.current?.focus();
      }
      if (e.key.toLowerCase() === "n" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        setEditing("new");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const shown = useMemo(() => {
    if (!items) return [];
    return items.filter((v) => {
      if (cat !== "all" && v.category !== cat) return false;
      if (lvl !== "all" && v.level !== lvl) return false;
      if (verbsOnly && !isVerb(v.word_type)) return false;
      if (!q) return true;
      const hay = [v.word, v.reading, v.meaning, v.note, v.personal_note, ...v.tags, ...v.examples.flatMap((e) => [e.jp, e.en])]
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [items, q, cat, lvl, verbsOnly]);
  useEffect(() => setLimit(120), [q, cat, lvl, verbsOnly]);

  const save = async (input: VocabInput) => {
    const saved = await api.vocabSave(input);
    setItems((xs) => {
      if (!xs) return xs;
      const i = xs.findIndex((x) => x.id === saved.id);
      return i >= 0 ? xs.map((x) => (x.id === saved.id ? saved : x)) : [...xs, saved];
    });
    setEditing(null);
    toast(input.id ? `Saved 「${saved.word}」` : `Added 「${saved.word}」`);
  };

  const remove = useCallback(
    async (v: VocabItem) => {
      try {
        await api.vocabDelete(v.id);
        setItems((xs) => xs?.filter((x) => x.id !== v.id) ?? xs);
        toast(`Deleted 「${v.word}」`, {
          ms: 8000,
          action: {
            label: "Undo",
            run: () => api.vocabRestore(v.id).then(load).catch((e: Error) => toast(e.message, { kind: "error" })),
          },
        });
      } catch (e) {
        toast((e as Error).message, { kind: "error" });
      }
    },
    [load, toast],
  );
  const edit = useCallback((v: VocabItem) => setEditing(v), []);

  return (
    <div className={`page${hideEn ? " hide-en" : ""}`}>
      <div className="page-head">
        <div>
          <h1 className="page-title">Vocabulary<span className="jp-sub">単語帳</span></h1>
          <p className="page-desc">Search, edit and add words. Press <kbd>/</kbd> to search, <kbd>Ctrl</kbd>+<kbd>N</kbd> to add.</p>
        </div>
        <button className="btn primary" onClick={() => setEditing("new")}>
          <Icon name="plus" size={16} /> Add word
        </button>
      </div>

      <div className="toolbar">
        <div className="row">
          <input
            ref={searchRef}
            className="input search"
            type="search"
            placeholder="Search kanji, kana, English, notes… (e.g. 倒す, にげる, revive)"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            lang="ja"
          />
          <label className="toggle"><input type="checkbox" checked={hideEn} onChange={(e) => setHideEn(e.target.checked)} /> Hide English</label>
          <label className="toggle"><input type="checkbox" checked={verbsOnly} onChange={(e) => setVerbsOnly(e.target.checked)} /> Verbs only</label>
        </div>
        <div className="row">
          <button className={`chip${cat === "all" ? " on" : ""}`} onClick={() => setCat("all")}>All</button>
          {Object.entries(CATEGORIES).map(([k, c]) => (
            <button key={k} className={`chip${cat === k ? " on" : ""}`} onClick={() => setCat(k)}>{c.label}</button>
          ))}
        </div>
        <div className="row">
          <button className={`chip gold${lvl === "all" ? " on" : ""}`} onClick={() => setLvl("all")}>All levels</button>
          {LEVELS.map((l) => (
            <button key={l} className={`chip gold${lvl === l ? " on" : ""}`} onClick={() => setLvl(l)}>{l}</button>
          ))}
          <span className="count">{items ? `${shown.length} of ${items.length}` : ""}</span>
        </div>
      </div>

      {error && <div className="notice bad">{error}</div>}
      <div className="cards">
        {items === null && !error && <div className="empty">読み込み中…</div>}
        {items && shown.length === 0 && <div className="empty">No matches. Try another search or filter.</div>}
        {shown.slice(0, limit).map((v) => <VocabCard key={v.id} item={v} onEdit={edit} onDelete={remove} />)}
      </div>
      {shown.length > limit && (
        <div style={{ textAlign: "center", marginTop: 16 }}>
          <button className="btn" onClick={() => setLimit((l) => l + 240)}>Show more ({shown.length - limit} left)</button>
        </div>
      )}

      {editing && (
        <VocabEditor item={editing === "new" ? null : editing} onSave={save} onClose={() => setEditing(null)} />
      )}
    </div>
  );
}

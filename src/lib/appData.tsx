// Shared, cached app data (word lists, grammar, kanji, study prefs).
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api } from "./api";
import type { VocabItem } from "./types";
import { DEFAULT_PREFS, type GrammarPoint, type Kanji, type StudyPrefs } from "./learning/types";

interface Ctx {
  vocab: VocabItem[] | null;
  grammar: GrammarPoint[] | null;
  kanji: Kanji[] | null;
  prefs: StudyPrefs;
  setPrefs: (p: Partial<StudyPrefs>) => Promise<void>;
  reloadVocab: () => Promise<void>;
  vocabById: Map<string, VocabItem>;
  grammarById: Map<string, GrammarPoint>;
  kanjiById: Map<string, Kanji>;
  error: string | null;
}

const C = createContext<Ctx | null>(null);

export function AppDataProvider({ children }: { children: ReactNode }) {
  const [vocab, setVocab] = useState<VocabItem[] | null>(null);
  const [grammar, setGrammar] = useState<GrammarPoint[] | null>(null);
  const [kanji, setKanji] = useState<Kanji[] | null>(null);
  const [prefs, setPrefsState] = useState<StudyPrefs>(DEFAULT_PREFS);
  const prefsRef = useRef<StudyPrefs>(DEFAULT_PREFS);
  const [error, setError] = useState<string | null>(null);

  const reloadVocab = useCallback(async () => {
    setVocab(await api.vocabList());
  }, []);

  useEffect(() => {
    Promise.all([api.vocabList(), api.grammarList(), api.kanjiList(), api.settingsGet()])
      .then(([v, g, k, s]) => {
        setVocab(v);
        setGrammar(g);
        setKanji(k);
        const stored = s["study"];
        if (stored && typeof stored === "object") {
          prefsRef.current = { ...DEFAULT_PREFS, ...(stored as Partial<StudyPrefs>) };
          setPrefsState(prefsRef.current);
        }
      })
      .catch((e: Error) => setError(e.message));
  }, []);

  const setPrefs = useCallback(async (p: Partial<StudyPrefs>) => {
    const next = { ...prefsRef.current, ...p };
    prefsRef.current = next;
    setPrefsState(next);
    await api.settingsSet("study", next);
  }, []);

  const value = useMemo<Ctx>(
    () => ({
      vocab, grammar, kanji, prefs, setPrefs, reloadVocab, error,
      vocabById: new Map((vocab ?? []).map((v) => [v.id, v])),
      grammarById: new Map((grammar ?? []).map((g) => [g.id, g])),
      kanjiById: new Map((kanji ?? []).map((k) => [k.id, k])),
    }),
    [vocab, grammar, kanji, prefs, setPrefs, reloadVocab, error],
  );
  return <C.Provider value={value}>{children}</C.Provider>;
}

export function useAppData(): Ctx {
  const c = useContext(C);
  if (!c) throw new Error("useAppData outside provider");
  return c;
}

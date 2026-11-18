import { useState } from "react";
import { api } from "../../lib/api";
import { useAppData } from "../../lib/appData";
import { dayStart } from "../../lib/day";
import { useNav } from "../../lib/nav";
import type { StudyPrefs } from "../../lib/learning/types";
import { Modal, useToast } from "../../components/ui";

const GOALS = [
  ["manga", "Read my manga"],
  ["gaming", "Game & voice chat with Japanese friends"],
  ["friends", "Make friends / text naturally"],
  ["uni", "Study at a Japanese university"],
  ["creator", "Become a Japanese YouTuber / streamer"],
] as const;
const INTERESTS = ["games", "anime", "manga", "technology", "animation", "music", "travel", "everyday conversation"];
const FOCUS: Record<string, string[]> = { manga: ["manga"], gaming: ["game", "react"], friends: ["social"], uni: ["uni"], creator: ["stream", "react"] };

export default function Onboarding({ onClose }: { onClose: () => void }) {
  const { prefs, setPrefs, vocab } = useAppData();
  const { go } = useNav();
  const { toast } = useToast();
  const [step, setStep] = useState(0);
  const [p, setP] = useState<StudyPrefs>(prefs);
  const set = <K extends keyof StudyPrefs>(k: K, v: StudyPrefs[K]) => setP((s) => ({ ...s, [k]: v }));
  const toggle = (k: "goals" | "interests", v: string) => set(k, p[k].includes(v) ? p[k].filter((x) => x !== v) : [...p[k], v]);

  const save = async (extra: Partial<StudyPrefs> = {}) => {
    const focusCategories = [...new Set(p.goals.flatMap((g) => FOCUS[g] ?? []))];
    await setPrefs({ ...p, ...extra, focusCategories, onboarded: true });
  };

  const placement = async () => {
    // A real mini-review: 5 words each from N5, N4 and N3 that you haven't studied yet.
    const q = await api.studyQueue(Date.now(), dayStart());
    const rec = q.new_candidates.filter((c) => c.item_type === "vocab" && c.skill === "recognition");
    const byLevel = (lvl: string) =>
      rec.filter((c) => {
        const v = vocab?.find((x) => x.id === c.item_id);
        return v && v.level === lvl && v.source === "seed:v1";
      }).slice(0, 5);
    const ids = [...byLevel("N5"), ...byLevel("N4"), ...byLevel("N3")].map((c) => c.id);
    if (!ids.length) {
      toast("Not enough unstudied words for a quick check.");
      return;
    }
    await save();
    onClose();
    go({ page: "study", sub: "session", launch: { mode: "placement", minutes: 5, cardIds: ids } });
  };

  const steps = [
    <div className="stack" key="0">
      <p className="muted" style={{ margin: 0 }}>A few questions so the app doesn't drill you on things you already know. You can change all of this later.</p>
      <div className="field">
        <span>Where are you overall?</span>
        <div className="row">{["N5", "N4", "N3", "N2", "N1"].map((l) => <button key={l} className={`chip${p.level === l ? " on" : ""}`} onClick={() => { set("level", l); set("startLevel", l === "N5" ? "N5" : l); }}>{l}</button>)}</div>
      </div>
      <div className="field">
        <span>Start new words at</span>
        <div className="row">{["N5", "N4", "N3", "N2"].map((l) => <button key={l} className={`chip gold${p.startLevel === l ? " on" : ""}`} onClick={() => set("startLevel", l)}>{l}</button>)}</div>
        <span className="faint" style={{ fontWeight: 400 }}>Easier words still show up, just later. Nothing is skipped forever.</span>
      </div>
      <label className="toggle"><input type="checkbox" checked={p.productionBias} onChange={(e) => set("productionBias", e.target.checked)} /> My weak spot is producing Japanese, so prioritise typing and production</label>
    </div>,
    <div className="stack" key="1">
      <div className="field">
        <span>Goals</span>
        <div className="row">{GOALS.map(([k, l]) => <button key={k} className={`chip${p.goals.includes(k) ? " on" : ""}`} onClick={() => toggle("goals", k)}>{l}</button>)}</div>
      </div>
      <div className="field">
        <span>Interests</span>
        <div className="row">{INTERESTS.map((i) => <button key={i} className={`chip${p.interests.includes(i) ? " on" : ""}`} onClick={() => toggle("interests", i)}>{i}</button>)}</div>
      </div>
      <label className="toggle"><input type="checkbox" checked={p.useCore} onChange={(e) => set("useCore", e.target.checked)} /> Include the 3,000-word core frequency deck (recommended for reading manga)</label>
    </div>,
    <div className="stack" key="2">
      <div className="grid-3">
        <label className="field"><span>Default session (min)</span><input className="input" type="number" min={3} max={60} value={p.sessionMinutes} onChange={(e) => set("sessionMinutes", Number(e.target.value) || 12)} /></label>
        <label className="field"><span>New words / day</span><input className="input" type="number" min={0} max={50} value={p.newPerDay} onChange={(e) => set("newPerDay", Math.max(0, Number(e.target.value) || 0))} /></label>
        <label className="field"><span>Daily goal (answers)</span><input className="input" type="number" min={5} max={300} value={p.dailyGoal} onChange={(e) => set("dailyGoal", Number(e.target.value) || 30)} /></label>
      </div>
      <label className="field">
        <span>Target retention: {Math.round(p.retention * 100)}%</span>
        <input type="range" min={0.8} max={0.95} step={0.01} value={p.retention} onChange={(e) => set("retention", Number(e.target.value))} />
        <span className="faint" style={{ fontWeight: 400 }}>Higher means more reviews. 90% is the usual sweet spot.</span>
      </label>
      <div className="field">
        <span>Conversation challenge in 生活</span>
        <div className="row">{(["gentle", "balanced", "challenging"] as const).map((c) => <button key={c} className={`chip${p.challenge === c ? " on" : ""}`} onClick={() => set("challenge", c)}>{c}</button>)}</div>
      </div>
      <label className="toggle"><input type="checkbox" checked={p.showEnglish} onChange={(e) => set("showEnglish", e.target.checked)} /> Show English in 生活 conversations by default</label>
      <p className="faint" style={{ margin: 0, fontSize: 12.5 }}>If your review backlog grows, the app adds fewer new words automatically, whatever the number above.</p>
    </div>,
    <div className="stack" key="3">
      <p className="muted" style={{ margin: 0 }}>
        <b>Optional quick check:</b> 15 words (5 each from N5, N4 and N3). Grade yourself honestly. The answers count as real first reviews, and the results tell you where to start new words.
      </p>
      <p className="faint" style={{ margin: 0, fontSize: 12.5 }}>This measures recognition only. It isn't a JLPT score and it doesn't measure speaking ability.</p>
    </div>,
  ];

  return (
    <Modal
      title={["Your level", "What you want Japanese for", "Pace", "Quick check"][step]!}
      onClose={async () => {
        if (!prefs.onboarded) await save();
        onClose();
      }}
      footer={
        <>
          {step > 0 && <button className="btn ghost" onClick={() => setStep(step - 1)}>Back</button>}
          <span className="spacer" />
          {step < steps.length - 1 && <button className="btn primary" onClick={() => setStep(step + 1)}>Next</button>}
          {step === steps.length - 1 && (
            <>
              <button className="btn" onClick={async () => { await save(); onClose(); }}>Skip check, start studying</button>
              <button className="btn primary" onClick={() => placement().catch((e: Error) => toast(e.message, { kind: "error" }))}>Take the 2-minute check</button>
            </>
          )}
        </>
      }
    >
      <div className="steps">{[0, 1, 2, 3].map((i) => <i key={i} className={i <= step ? "on" : ""} />)}</div>
      {steps[step]}
    </Modal>
  );
}

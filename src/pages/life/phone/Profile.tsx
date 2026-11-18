// Friend profile: who they are, how your relationship has grown, how they talk to
// you now, and the memories they keep about you (editable and deletable).
import { useEffect, useState } from "react";
import { social } from "../../../lib/social/api";
import type { Memory } from "../../../lib/social/types";
import { NpcAvatar } from "./art";
import { usePhone } from "./ctx";

export const REGISTER_JA = ["丁寧語（です・ます）", "丁寧だけど親しげ", "タメ口", "くだけたタメ口"];
export const REGISTER_EN = ["Polite です/ます", "Polite but warm", "Casual (タメ口)", "Close, very casual"];

export function bondLabel(score: number): { ja: string; en: string } {
  if (score < 12) return { ja: "知り合ったばかり", en: "Just met" };
  if (score < 30) return { ja: "顔見知り", en: "Getting to know each other" };
  if (score < 50) return { ja: "友だち", en: "Friends" };
  if (score < 72) return { ja: "仲良し", en: "Close friends" };
  return { ja: "親友", en: "Best friends" };
}

export function ProfileScreen({ id }: { id: string }) {
  const { npc, back, push, npcs } = usePhone();
  const n = npc(id);
  const [mem, setMem] = useState<Memory[] | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [adding, setAdding] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const load = () => social.memories(id).then(setMem).catch((e: Error) => setErr(e.message));
  useEffect(() => { load(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!n) return <div className="ph-page"><header className="ph-head"><button className="ph-back" onClick={back}>‹</button></header></div>;
  const bond = bondLabel(n.score);
  const save = () => {
    const f = draft.trim();
    if (!f) return;
    const op = editing && editing !== "new" ? social.memoryCorrect(editing, f) : social.memoryAdd(id, f);
    op.then(() => { setEditing(null); setAdding(false); setDraft(""); load(); }).catch((e: Error) => setErr(e.message));
  };
  const hours = n.active_hours.map(([a, b]) => `${a % 24}時–${b % 24}時`).join("、");

  return (
    <div className="ph-page profile">
      <div className="profile-hero" style={{ "--c": n.color } as React.CSSProperties}>
        <button className="ph-back on-hero" onClick={back} aria-label="Back">‹</button>
        <NpcAvatar id={n.id} color={n.color} size={92} ring />
        <h2 lang="ja">{n.display}</h2>
        <span className="hero-sub">{n.full_name} · {n.age}</span>
        <span className="hero-role">{n.role}</span>
        <div className="hero-actions">
          <button onClick={() => push({ s: "chat", id: `dm-${n.id}` })}><span>💬</span>トーク</button>
          <button onClick={() => social.callAttempt(n.id, "voice").then(setNotice)}><span>📞</span>音声通話</button>
        </div>
      </div>
      <div className="ph-scroll">
        {notice && <div className="inline-note" role="status">{notice}</div>}
        <section className="card-sec">
          <p className="bio">{n.bio}</p>
          <div className="ph-tags">{n.interests.map((i) => <span key={i} className="ph-tag">{i}</span>)}</div>
          <p className="ph-hint">Usually around: {hours}{n.busy_now ? ` · now: ${n.busy_now}` : ""}</p>
        </section>

        <section className="card-sec">
          <h3>あなたとの関係</h3>
          <div className="bond"><b lang="ja">{bond.ja}</b><span>{bond.en}</span></div>
          <dl className="facets">
            <div><dt>話し方</dt><dd>{REGISTER_JA[n.register_stage]}<small>{REGISTER_EN[n.register_stage]}</small></dd></div>
            <div><dt>一緒にしたこと</dt><dd>{n.state.shared_experiences}<small>shared experiences</small></dd></div>
            <div><dt>話した日</dt><dd>{n.state.meaningful_days}<small>days with real conversation</small></dd></div>
          </dl>
          <p className="ph-hint">They loosen up as you actually spend time together — not by message count. Mistakes in your Japanese never hurt the relationship.</p>
        </section>

        {n.relations.length > 0 && (
          <section className="card-sec">
            <h3>友だち関係</h3>
            {n.relations.map(([other, kind, note]) => (
              <div key={other} className="rel-line"><NpcAvatar id={other} color={npcs.find((x) => x.id === other)?.color} size={26} /><b>{npcs.find((x) => x.id === other)?.display ?? other}</b><span>{kind} — {note}</span></div>
            ))}
          </section>
        )}

        <section className="card-sec">
          <div className="sec-row"><h3>覚えていること</h3><span className="spacer" />
            <button className="ph-link" onClick={() => { setAdding(true); setEditing("new"); setDraft(""); }}>＋追加</button>
          </div>
          <p className="ph-hint">What {n.display} remembers about you. Fix anything wrong, or delete it — they'll stop bringing it up.</p>
          {err && <div className="inline-note bad">{err}</div>}
          {adding && editing === "new" && <MemEdit value={draft} onChange={setDraft} onSave={save} onCancel={() => { setAdding(false); setEditing(null); }} />}
          {mem?.length === 0 && !adding && <p className="ph-empty">Nothing yet.</p>}
          {mem?.map((m) => editing === m.id ? (
            <MemEdit key={m.id} value={draft} onChange={setDraft} onSave={save} onCancel={() => setEditing(null)} />
          ) : (
            <div key={m.id} className="mem">
              <span className="mem-fact">{m.fact}{m.verified && <em title="Confirmed by you"> ✓</em>}</span>
              <button className="ph-link" onClick={() => { setEditing(m.id); setDraft(m.fact); }}>修正</button>
              <button className="ph-link danger" onClick={() => social.memoryDelete(m.id).then(load)}>削除</button>
            </div>
          ))}
          {mem && mem.length > 0 && (
            <button className="ph-link danger center" onClick={() => window.confirm(`Delete everything ${n.display} remembers about you?`) && social.memoryDeleteAll(id).then(load)}>すべて削除</button>
          )}
        </section>
      </div>
    </div>
  );
}

function MemEdit({ value, onChange, onSave, onCancel }: { value: string; onChange: (v: string) => void; onSave: () => void; onCancel: () => void }) {
  return (
    <div className="mem-edit">
      <textarea value={value} onChange={(e) => onChange(e.target.value)} maxLength={300} rows={2} autoFocus placeholder="e.g. I'm allergic to cats / I moved to Osaka" />
      <div className="row-gap"><button className="pill-btn" onClick={onSave} disabled={!value.trim()}>保存</button><button className="ph-link" onClick={onCancel}>キャンセル</button></div>
    </div>
  );
}

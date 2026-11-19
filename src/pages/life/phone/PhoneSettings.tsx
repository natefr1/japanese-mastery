// Phone settings: your profile, messaging behaviour, notifications, background
// activity, the AI connection (key → Windows Credential Manager, explicit consent),
// and privacy controls.
import { useEffect, useState } from "react";
import { social } from "../../../lib/social/api";
import type { Pace, ProviderConfig, ProviderKind, SocialConfig } from "../../../lib/social/types";
import { usePhone } from "./ctx";

function Toggle({ on, onChange, label, sub }: { on: boolean; onChange: (v: boolean) => void; label: string; sub?: string }) {
  return (
    <label className="set-row">
      <span className="set-text"><b>{label}</b>{sub && <small>{sub}</small>}</span>
      <input type="checkbox" className="switch" checked={on} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}

export function PhoneSettings() {
  const { config, setConfig, ai, refreshAi } = usePhone();
  const [err, setErr] = useState<string | null>(null);
  const [autostart, setAutostart] = useState<boolean | null>(null);
  useEffect(() => { social.autostartGet().then(setAutostart).catch(() => setAutostart(null)); }, []);
  if (!config) return <div className="ph-page"><header className="ph-head"><h2>設定</h2></header></div>;

  const upd = (f: (c: SocialConfig) => SocialConfig) => setConfig(f(structuredClone(config))).catch((e: Error) => setErr(e.message));

  return (
    <div className="ph-page">
      <header className="ph-head"><h2>設定</h2></header>
      <div className="ph-scroll settings">
        {err && <div className="inline-note bad">{err}</div>}

        <section className="set-sec">
          <h3>プロフィール</h3>
          <TextRow label="名前" value={config.player.name} max={24} onSave={(v) => upd((c) => ({ ...c, player: { ...c.player, name: v } }))} />
          <TextRow label="ステータスメッセージ" value={config.player.status_message} max={60} onSave={(v) => upd((c) => ({ ...c, player: { ...c.player, status_message: v } }))} />
          <TextRow label="Your level (shared with the AI)" value={config.player.level_note} max={120} onSave={(v) => upd((c) => ({ ...c, player: { ...c.player, level_note: v } }))}
            hint="Helps friends pitch their Japanese. Don't put private details here." />
        </section>

        <AiSection />

        <section className="set-sec">
          <h3>トーク</h3>
          <label className="set-row">
            <span className="set-text"><b>Reply pace</b><small>How quickly friends read and reply</small></span>
            <select value={config.pace} onChange={(e) => upd((c) => ({ ...c, pace: e.target.value as Pace }))}>
              <option value="fast">Fast (practice)</option>
              <option value="natural">Natural</option>
              <option value="realistic">Realistic (can be slow)</option>
            </select>
          </label>
          <Toggle on={config.social.background} onChange={(v) => upd((c) => ({ ...c, social: { ...c.social, background: v } }))} label="Friends can message first" sub="Unprompted messages while the app is open or in the tray" />
          <Toggle on={config.social.group_activity} onChange={(v) => upd((c) => ({ ...c, social: { ...c.social, group_activity: v } }))} label="Group chat activity" sub="Friends occasionally start topics in groups" />
          <Toggle on={config.paused} onChange={(v) => upd((c) => ({ ...c, paused: v }))} label="Pause friends" sub="Same as the tray's pause. Replies to your messages still arrive." />
          <NumRow label="Max unprompted messages / day" value={config.social.max_initiations_per_day} min={0} max={12} onChange={(v) => upd((c) => ({ ...c, social: { ...c.social, max_initiations_per_day: v } }))} />
          <div className="set-row">
            <span className="set-text"><b>Quiet hours</b><small>No unprompted messages or Windows notifications</small></span>
            <span className="row-gap">
              <HourSelect value={config.social.quiet_start} onChange={(v) => upd((c) => ({ ...c, social: { ...c.social, quiet_start: v } }))} />
              <span>–</span>
              <HourSelect value={config.social.quiet_end} onChange={(v) => upd((c) => ({ ...c, social: { ...c.social, quiet_end: v } }))} />
            </span>
          </div>
        </section>

        <section className="set-sec">
          <h3>通知</h3>
          <Toggle on={config.notifications} onChange={(v) => upd((c) => ({ ...c, notifications: v }))} label="Windows notifications" sub="When the app isn't focused" />
          <Toggle on={config.notification_preview} onChange={(v) => upd((c) => ({ ...c, notification_preview: v }))} label="Show message text" sub="Off shows 「新しいメッセージ」 instead" />
        </section>

        <section className="set-sec">
          <h3>アプリ</h3>
          <Toggle on={config.close_to_tray} onChange={(v) => upd((c) => ({ ...c, close_to_tray: v }))} label="Keep running in the tray when closed" sub="Needed for messages while the window is closed. Quit from the tray icon." />
          {autostart !== null && <Toggle on={autostart} onChange={(v) => social.autostartSet(v).then(setAutostart).catch((e: Error) => setErr(e.message))} label="Start with Windows" sub="Opens minimized to the tray. Off by default." />}
          <p className="ph-hint">When the app is fully quit, nothing runs and nothing is invented for that time.</p>
        </section>

        <PrivacySection onError={setErr} />
        <p className="ph-hint center">ハナシ — part of Japanese Mastery. Characters are fictional. {ai ? "" : ""}</p>
        <button className="ph-link center" onClick={refreshAi}>Refresh status</button>
      </div>
    </div>
  );
}

function TextRow({ label, value, max, onSave, hint }: { label: string; value: string; max: number; onSave: (v: string) => void; hint?: string }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  return (
    <label className="set-row col">
      <span className="set-text"><b>{label}</b>{hint && <small>{hint}</small>}</span>
      <input className="set-input" value={v} maxLength={max} onChange={(e) => setV(e.target.value)} onBlur={() => v !== value && onSave(v)} onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()} />
    </label>
  );
}

function NumRow({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (v: number) => void }) {
  return (
    <label className="set-row">
      <span className="set-text"><b>{label}</b></span>
      <input type="number" className="set-num" min={min} max={max} value={value} onChange={(e) => onChange(Math.max(min, Math.min(max, Number(e.target.value) || 0)))} />
    </label>
  );
}

function HourSelect({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return <select value={value} onChange={(e) => onChange(Number(e.target.value))}>{Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{h}:00</option>)}</select>;
}

// ---------------- AI ----------------

function AiSection() {
  const { ai, refreshAi, config, setConfig } = usePhone();
  const [cfg, setCfg] = useState<ProviderConfig | null>(null);
  const [key, setKey] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (ai && !cfg) setCfg(ai.config); }, [ai, cfg]);
  if (!ai || !cfg || !config) return null;

  const wrap = (p: Promise<unknown>, ok?: string) => {
    setBusy(true);
    setMsg(null);
    p.then(() => { if (ok) setMsg({ ok: true, text: ok }); }).catch((e: Error) => setMsg({ ok: false, text: e.message })).finally(() => { setBusy(false); refreshAi(); });
  };
  const saveCfg = (c: ProviderConfig) => { setCfg(c); wrap(social.aiConfigure(c)); };
  const kind = cfg.kind;
  const consentOk = ai.consent.granted && ai.consent.provider === kind;
  const defaults: Record<ProviderKind, Partial<ProviderConfig>> = {
    none: {},
    anthropic: { chat_model: "claude-haiku-5-5", review_model: "claude-sonnet-5-5" },
    openai: { chat_model: "gpt-5-mini", review_model: "gpt-5-mini" },
    gemini: { chat_model: "gemini-flash-latest", review_model: "gemini-flash-latest" },
    openai_compat: { chat_model: "qwen2.5:7b", review_model: "qwen2.5:7b", base_url: "http://localhost:11434/v1" },
  };

  return (
    <section className="set-sec ai-sec">
      <h3>AI <span className={`status-dot${ai.ready ? " ok" : ""}`} />{ai.ready ? <small>connected</small> : <small>not ready</small>}</h3>
      <p className="ph-hint">Your friends' replies, hints, word explanations and reviews are written by an AI model you connect. Without one, you can still write messages, but nobody answers.</p>
      <label className="set-row">
        <span className="set-text"><b>Provider</b></span>
        <select value={kind} disabled={busy} onChange={(e) => { const k = e.target.value as ProviderKind; saveCfg({ ...cfg, kind: k, ...defaults[k] }); }}>
          <option value="none">None</option>
          <option value="anthropic">Anthropic (Claude) — needs an API key</option>
          <option value="openai">OpenAI (GPT / Codex account) — needs an API key</option>
          <option value="gemini">Google Gemini (Flash, free tier) — needs an API key</option>
          <option value="openai_compat">Local / OpenAI-compatible (Ollama, LM Studio)</option>
        </select>
      </label>
      {kind !== "none" && (
        <>
          {kind === "openai_compat" && <TextRow label="Server address" value={cfg.base_url} max={200} onSave={(v) => saveCfg({ ...cfg, base_url: v })} hint="e.g. http://localhost:11434/v1 — a local server keeps everything on this PC." />}
          <TextRow label="Chat model" value={cfg.chat_model} max={100} onSave={(v) => saveCfg({ ...cfg, chat_model: v })} />
          <TextRow label="Review model" value={cfg.review_model} max={100} onSave={(v) => saveCfg({ ...cfg, review_model: v })} />
          <div className="set-row col">
            <span className="set-text"><b>API key {kind === "openai_compat" && "(optional)"}</b><small>{ai.has_key ? "A key is saved in Windows Credential Manager." : "Stored in Windows Credential Manager — never in settings, backups or logs."}</small></span>
            <span className="row-gap">
              <input className="set-input" type="password" autoComplete="off" spellCheck={false} value={key} placeholder={ai.has_key ? "••••••••  (saved)" : kind === "anthropic" ? "sk-ant-…" : kind === "openai" ? "sk-…" : kind === "gemini" ? "Gemini API key from AI Studio" : "optional"} onChange={(e) => setKey(e.target.value)} />
              <button className="pill-btn" disabled={!key.trim() || busy} onClick={() => { wrap(social.aiSaveKey(kind, key), "Key saved."); setKey(""); }}>Save</button>
              {ai.has_key && <button className="ph-link danger" onClick={() => wrap(social.aiClearKey(kind), "Key removed.")}>Remove</button>}
            </span>
          </div>

          <div className={`consent${consentOk ? " given" : ""}`}>
            <b>What gets sent to {({ anthropic: "Anthropic", openai: "OpenAI", gemini: "Google", openai_compat: "this server", none: "" } as Record<ProviderKind, string>)[kind]}</b>
            <ul>
              <li>The recent messages of the one chat being answered (about the last 16), plus a short summary of older ones.</li>
              <li>A few memories that character keeps about you, your display name, status message and the level note above.</li>
              <li>The fictional character's profile and the local time of day.</li>
            </ul>
            <b>Never sent</b>
            <ul>
              <li>Your vocabulary, review history, backups, other chats, or anything else in your learning database.</li>
              <li>Your API key goes only to the provider, in the request header.</li>
            </ul>
            {kind === "gemini" && <p className="ph-hint warn">Gemini's <b>free tier</b>: Google may use what you send to improve its products, and people may review it. Don't share anything private in these chats, or use a paid key / local model if that matters to you.</p>}
            {kind === "openai" && <p className="ph-hint">Needs an API key from platform.openai.com (billed separately). A ChatGPT / Codex subscription login doesn't work here. "Codex" models are tuned for coding, so the default is gpt-5-mini.</p>}
            <p className="ph-hint">Requests happen only when a friend replies or messages first, or when you ask for a hint, explanation or review. Conversation text isn't written to logs.</p>
            {consentOk ? (
              <div className="row-gap"><span className="ok-text">✓ You agreed{ai.consent.at ? ` on ${new Date(ai.consent.at).toLocaleDateString()}` : ""}.</span><button className="ph-link danger" onClick={() => wrap(social.aiConsent(false))}>Withdraw</button></div>
            ) : (
              <button className="pill-btn big" disabled={busy} onClick={() => wrap(social.aiConsent(true), "Thanks — friends can reply now.")}>I agree — allow sending chat messages</button>
            )}
          </div>
          <div className="row-gap">
            <button className="pill-btn" disabled={!ai.ready || busy} onClick={() => wrap(social.aiTest().then((t) => setMsg({ ok: true, text: `Connection OK (${t})` })))}>Test connection</button>
          </div>
          {ai.problem && !msg && <div className="inline-note">{ai.problem}</div>}
          {msg && <div className={`inline-note${msg.ok ? " good" : " bad"}`}>{msg.text}</div>}

          <div className="usage">
            <b>Today</b>
            <span>{ai.usage_today.requests} / {ai.daily_budget} requests · {ai.usage_today.background_requests} / {ai.background_budget} unprompted · {(ai.usage_today.input_tokens + ai.usage_today.output_tokens).toLocaleString()} tokens</span>
          </div>
          <NumRow label="Daily request budget" value={config.social.daily_ai_budget} min={0} max={2000} onChange={(v) => setConfig({ ...config, social: { ...config.social, daily_ai_budget: v } }).then(refreshAi)} />
          <NumRow label="…of which unprompted" value={config.social.background_ai_budget} min={0} max={config.social.daily_ai_budget} onChange={(v) => setConfig({ ...config, social: { ...config.social, background_ai_budget: v } }).then(refreshAi)} />
        </>
      )}
    </section>
  );
}

function PrivacySection({ onError }: { onError: (e: string) => void }) {
  const { refresh } = usePhone();
  const [done, setDone] = useState<string | null>(null);
  const del = (what: "chats" | "memories" | "observations", label: string) => {
    if (!window.confirm(`Delete ${label}? This can't be undone (your automatic backups still contain older copies).`)) return;
    social.deleteData(what).then((n) => { setDone(`Deleted ${label} (${n}).`); refresh(); }).catch((e: Error) => onError(e.message));
  };
  return (
    <section className="set-sec">
      <h3>プライバシー</h3>
      <button className="set-row danger-row" onClick={() => del("chats", "all chat history")}>Delete all chat history</button>
      <button className="set-row danger-row" onClick={() => del("memories", "all character memories")}>Delete everything characters remember</button>
      <button className="set-row danger-row" onClick={() => del("observations", "all review notes")}>Delete review notes</button>
      {done && <div className="inline-note good">{done}</div>}
    </section>
  );
}

import { useState } from "react";
import { useSettings } from "../lib/settings";
import { checkForUpdate, installUpdate, type UpdateCheck } from "../lib/updates";
import type { AppStatus, Settings } from "../lib/types";
import { useToast } from "../components/ui";

export default function SettingsPage({ status }: { status: AppStatus }) {
  const { settings, update } = useSettings();
  const { toast } = useToast();
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) =>
    update(k, v).catch((e: Error) => toast(e.message, { kind: "error" }));

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="page-title">Settings<span className="jp-sub">設定</span></h1>
          <p className="page-desc">Saved locally and applied immediately.</p>
        </div>
      </div>
      <div className="stack" style={{ maxWidth: 720 }}>
        <section className="panel stack">
          <h2 style={{ margin: 0 }}>Appearance</h2>
          <div className="field">
            <span>Theme</span>
            <div className="row">
              {(["dark", "light", "system"] as const).map((t) => (
                <button key={t} className={`chip${settings.theme === t ? " on" : ""}`} onClick={() => set("theme", t)}>
                  {t === "dark" ? "Dark" : t === "light" ? "Light" : "Match Windows"}
                </button>
              ))}
            </div>
          </div>
          <label className="field">
            <span>Text size: {settings.textScale}%</span>
            <input type="range" min={85} max={140} step={5} value={settings.textScale} onChange={(e) => set("textScale", Number(e.target.value))} />
          </label>
          <p lang="ja" style={{ margin: 0 }}>例文：今日は新しいゲームをやっていきたいと思います！</p>
        </section>
        <section className="panel stack">
          <h2 style={{ margin: 0 }}>Motion</h2>
          <label className="toggle">
            <input type="checkbox" checked={settings.motion} onChange={(e) => set("motion", e.target.checked)} /> Animations
          </label>
        </section>
        <UpdatesPanel version={status.app_version} />
        <section className="panel">
          <h2>About</h2>
          <div className="muted" style={{ fontSize: 13.5 }}>
            Japanese Mastery v{status.app_version} · database schema v{status.schema_version}
            <br />
            Works fully offline. AI features (later milestones) will be optional and always ask before sending anything.
            <br /><br />
            <b>Data &amp; licences:</b> Core 3000 deck from JMdict and kanji data from KANJIDIC2, © Electronic Dictionary Research and Development Group, used under CC BY-SA 4.0.
            Scheduling by ts-fsrs (MIT). Tokenizer: kuromoji.js with IPADIC (Apache-2.0). Romaji input via WanaKana (MIT).
            The grammar path, manga speech pack, website vocabulary and 生活 scenes are original content.
          </div>
        </section>
      </div>
    </div>
  );
}

function UpdatesPanel({ version }: { version: string }) {
  const { settings, update } = useSettings();
  const [state, setState] = useState<UpdateCheck | null>(null);
  const [checking, setChecking] = useState(false);
  const [progress, setProgress] = useState<number | null | undefined>(undefined);
  const [err, setErr] = useState<string | null>(null);

  const run = async () => {
    setChecking(true);
    setErr(null);
    setState(await checkForUpdate());
    setChecking(false);
  };
  const install = async () => {
    if (state?.kind !== "available") return;
    setErr(null);
    setProgress(null);
    try {
      await installUpdate(state.update, setProgress);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setProgress(undefined);
    }
  };

  return (
    <section className="panel stack">
      <h2 style={{ margin: 0 }}>Updates</h2>
      <div className="row">
        <span>Installed version: <b>v{version}</b></span>
        <span className="spacer" />
        <button className="btn" disabled={checking || progress !== undefined} onClick={run}>{checking ? "Checking…" : "Check for updates"}</button>
      </div>
      <label className="toggle">
        <input type="checkbox" checked={settings.autoUpdate} onChange={(e) => update("autoUpdate", e.target.checked)} /> Check automatically when the app starts
      </label>
      {state?.kind === "none" && <div className="notice ok">You're on the latest version.</div>}
      {state?.kind === "error" && <div className="notice warn">{state.message}</div>}
      {state?.kind === "available" && (
        <div className="notice ok stack" style={{ gap: 8 }}>
          <b>Version {state.version} is available.</b>
          {state.notes && <div className="muted" style={{ whiteSpace: "pre-wrap", fontSize: 13.5 }}>{state.notes}</div>}
          {progress === undefined ? (
            <div><button className="btn primary" onClick={install}>Back up, update &amp; restart</button></div>
          ) : (
            <div className="stack" style={{ gap: 4 }}>
              <div className="bar-track"><div className="bar-fill" style={{ width: `${(progress ?? 0.05) * 100}%` }} /></div>
              <span className="faint">{progress === 1 ? "Installing… the app will restart." : "Downloading and verifying…"}</span>
            </div>
          )}
        </div>
      )}
      {err && <div className="notice bad">{err}</div>}
      <p className="faint" style={{ margin: 0, fontSize: 12.5 }}>
        Updates come from the project's GitHub Releases and are verified with a signature before installing. Your data is backed up first,
        and the new version upgrades the database automatically. Checking for updates is the only time the app goes online.
      </p>
    </section>
  );
}

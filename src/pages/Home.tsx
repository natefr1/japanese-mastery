import { useEffect, useState } from "react";
import type { Page } from "../lib/nav";
import { api } from "../lib/api";
import { categoryLabel } from "../lib/labels";
import type { AppStatus, BackupInfo, VocabStats } from "../lib/types";
import { fmtDate } from "../components/ui";

const ROADMAP: { title: string; detail: string; state: "done" | "now" | "next" }[] = [
  { title: "M1 · Desktop foundation", detail: "Tauri app, SQLite, migrations, backups, import/export, your vocabulary", state: "done" },
  { title: "M2 · Study Center + 生活 start", detail: "FSRS reviews, grammar, kanji, manga reader check, listening; first 生活 scenes, XP, ¥, passport", state: "done" },
  { title: "M3 · Progression", detail: "Achievements, cosmetics shop, Memory Detective, weekly goals, more quests", state: "now" },
  { title: "M4 · 生活 world", detail: "More locations and chapters, Ren, daily events, apartment decoration", state: "next" },
  { title: "M5 · AI conversations", detail: "Provider setup, real messaging, memories, voice architecture", state: "next" },
  { title: "M6 · Polish & release", detail: "Accessibility, performance, installer", state: "next" },
];

function greeting() {
  const h = new Date().getHours();
  if (h < 5) return "こんばんは";
  if (h < 11) return "おはよう";
  if (h < 18) return "こんにちは";
  return "こんばんは";
}

export default function Home({ status, go }: { status: AppStatus; go: (r: Page) => void }) {
  const [stats, setStats] = useState<VocabStats | null>(null);
  const [backups, setBackups] = useState<BackupInfo[]>([]);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([api.vocabStats(), api.backupList()])
      .then(([s, b]) => {
        setStats(s);
        setBackups(b);
      })
      .catch((e: Error) => setErr(e.message));
  }, []);

  const rep = status.report;
  const max = Math.max(1, ...(stats?.by_category.map((c) => c[1]) ?? [1]));

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="page-title">{greeting()}、Nathan</h1>
          <p className="page-desc">Everything here is stored on this PC. No account, no cloud.</p>
        </div>
        <div className="row">
          <button className="btn" onClick={() => go("life")}>生活</button>
          <button className="btn primary" onClick={() => go("study")}>Study now</button>
        </div>
      </div>

      <div className="stack">
        {rep?.recovered_from_backup && (
          <div className="notice warn">
            The database was damaged, so it was restored automatically from backup <b>{rep.recovered_from_backup}</b>.
            The damaged file was kept at <span className="mono">{rep.quarantined_file}</span>.
          </div>
        )}
        {rep?.pre_migration_backup && (
          <div className="notice ok">
            Updated the database from schema v{rep.migrated_from} to v{rep.migrated_to}. A backup was taken first
            ({rep.pre_migration_backup}).
          </div>
        )}
        {rep?.created_new && rep.seeded > 0 && (
          <div className="notice ok">Welcome! Your {rep.seeded} words from the website were imported into the app.</div>
        )}
        {err && <div className="notice bad">{err}</div>}

        <div className="stats">
          <div className="stat"><div className="v">{stats?.total ?? "–"}</div><div className="k">words & phrases</div></div>
          <div className="stat"><div className="v">{stats?.user_added ?? "–"}</div><div className="k">added or imported by you</div></div>
          <div className="stat"><div className="v">{stats?.by_category.length ?? "–"}</div><div className="k">categories</div></div>
          <div className="stat">
            <div className="v" style={{ fontSize: 18, paddingTop: 8 }}>{backups[0] ? fmtDate(backups[0].created_at) : "None yet"}</div>
            <div className="k">latest backup</div>
          </div>
        </div>

        <div className="grid-2" style={{ alignItems: "start" }}>
          <section className="panel">
            <h2>Your vocabulary by category</h2>
            <div className="bars">
              {stats?.by_category.map(([c, n]) => (
                <div className="bar-row" key={c}>
                  <span>{categoryLabel(c)}</span>
                  <div className="bar-track"><div className="bar-fill" style={{ width: `${(n / max) * 100}%` }} /></div>
                  <span className="faint">{n}</span>
                </div>
              ))}
            </div>
            <p className="faint" style={{ fontSize: 12.5, marginBottom: 0 }}>
              These are counts of words you have, not words you know. Review and mastery tracking start in Milestone 2.
            </p>
          </section>
          <section className="panel">
            <h2>Build roadmap</h2>
            <ul className="roadmap">
              {ROADMAP.map((r) => (
                <li key={r.title}>
                  <span className={`dot ${r.state}`} />
                  <div>
                    <b>{r.title}</b>
                    <div className="faint" style={{ fontSize: 12.5 }}>{r.detail}</div>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}

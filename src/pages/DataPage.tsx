import { useCallback, useEffect, useState } from "react";
import { open, save } from "@tauri-apps/plugin-dialog";
import { api } from "../lib/api";
import type { AppStatus, BackupInfo, FileFormat, ImportMode, ImportReport, VerifyResult } from "../lib/types";
import { Confirm, fmtBytes, fmtDate, Icon, Modal, useToast } from "../components/ui";

const REASONS: Record<string, string> = {
  manual: "Manual",
  "auto-daily": "Daily (automatic)",
  "pre-restore": "Before a restore",
  "pre-import": "Before an import",
  "pre-update": "Before an app update",
};
const reasonLabel = (r: string) => REASONS[r] ?? (r.startsWith("pre-migration") ? "Before an update" : r);

export default function DataPage({ status, onRestored }: { status: AppStatus; onRestored: () => void }) {
  const { toast } = useToast();
  const [backups, setBackups] = useState<BackupInfo[] | null>(null);
  const [verified, setVerified] = useState<Record<string, VerifyResult>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [restoreTarget, setRestoreTarget] = useState<BackupInfo | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [report, setReport] = useState<ImportReport | null>(null);

  const load = useCallback(() => api.backupList().then(setBackups).catch((e: Error) => toast(e.message, { kind: "error" })), [toast]);
  useEffect(() => {
    load();
  }, [load]);

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    try {
      await fn();
    } catch (e) {
      toast((e as Error).message, { kind: "error" });
    } finally {
      setBusy(null);
    }
  };

  const createBackup = () =>
    run("create", async () => {
      const b = await api.backupCreate();
      toast(`Backup created (${b.vocab_count} words, verified).`);
      await load();
    });

  const verify = (b: BackupInfo) =>
    run(`verify-${b.id}`, async () => {
      const v = await api.backupVerify(b.id);
      setVerified((m) => ({ ...m, [b.id]: v }));
      toast(v.message, { kind: v.ok ? "info" : "error" });
    });

  const restore = (b: BackupInfo) =>
    run(`restore-${b.id}`, async () => {
      setRestoreTarget(null);
      await api.backupRestore(b.id);
      toast(`Restored backup from ${fmtDate(b.created_at)}. Your previous state was saved as a backup first.`);
      await load();
      onRestored();
    });

  const exportAs = (format: FileFormat) =>
    run(`export-${format}`, async () => {
      const stamp = new Date().toISOString().slice(0, 10);
      const path = await save({
        defaultPath: `japanese-mastery-vocab-${stamp}.${format}`,
        filters: [{ name: format.toUpperCase(), extensions: [format] }],
      });
      if (!path) return;
      const n = await api.vocabExport(path, format);
      toast(`Exported ${n} words to ${format.toUpperCase()}.`);
    });

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="page-title">Data & Backups<span className="jp-sub">データ</span></h1>
          <p className="page-desc">Your data lives only on this PC. Backups are verified with a checksum and an SQLite integrity check.</p>
        </div>
      </div>

      <div className="stack">
        <section className="panel">
          <div className="row" style={{ marginBottom: 12 }}>
            <h2 style={{ margin: 0 }}>Backups</h2>
            <span className="spacer" />
            <button className="btn primary" disabled={busy !== null} onClick={createBackup}>
              <Icon name="shield" size={16} /> {busy === "create" ? "Backing up…" : "Back up now"}
            </button>
          </div>
          <p className="muted" style={{ marginTop: 0, fontSize: 13.5 }}>
            A backup is made automatically once a day, before every import, before every restore, and before any database update.
            The newest 10 automatic backups are kept. Manual backups are never deleted automatically.
          </p>
          {backups && backups.length === 0 && <p className="faint">No backups yet.</p>}
          {backups && backups.length > 0 && (
            <table className="table">
              <thead>
                <tr><th>Created</th><th>Type</th><th>Words</th><th>Size</th><th>Status</th><th /></tr>
              </thead>
              <tbody>
                {backups.map((b) => {
                  const v = verified[b.id];
                  return (
                    <tr key={b.id}>
                      <td>{fmtDate(b.created_at)}</td>
                      <td>{reasonLabel(b.reason)}</td>
                      <td>{b.vocab_count}</td>
                      <td className="faint">{fmtBytes(b.size_bytes)}</td>
                      <td>
                        {v ? <span className={`pill ${v.ok ? "ok" : "bad"}`}>{v.ok ? "Intact" : "Damaged"}</span> : <span className="faint">—</span>}
                      </td>
                      <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                        <button className="btn small ghost" disabled={busy !== null} onClick={() => verify(b)}>Verify</button>
                        <button className="btn small" disabled={busy !== null} onClick={() => setRestoreTarget(b)}>Restore</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </section>

        <section className="panel">
          <h2>Export & import vocabulary</h2>
          <p className="muted" style={{ marginTop: 0, fontSize: 13.5 }}>
            JSON keeps everything (including ids) and is the format for moving data between installs. CSV opens in Excel or Google Sheets.
            Imports are all-or-nothing: if anything goes wrong, nothing changes.
          </p>
          <div className="row">
            <button className="btn" disabled={busy !== null} onClick={() => exportAs("json")}><Icon name="download" size={16} /> Export JSON</button>
            <button className="btn" disabled={busy !== null} onClick={() => exportAs("csv")}><Icon name="download" size={16} /> Export CSV</button>
            <span className="spacer" />
            <button className="btn" disabled={busy !== null} onClick={() => setImportOpen(true)}><Icon name="upload" size={16} /> Import…</button>
          </div>
        </section>

        <section className="panel">
          <h2>Where your data is stored</h2>
          <div className="stack" style={{ gap: 6, fontSize: 13.5 }}>
            <div>Database folder: <span className="mono">{status.data_dir}</span></div>
            <div>Backups: <span className="mono">{status.backup_dir}</span></div>
            <div className="faint">Device id: <span className="mono">{status.device_id}</span> · schema v{status.schema_version}</div>
          </div>
        </section>
      </div>

      {restoreTarget && (
        <Confirm
          title="Restore this backup?"
          confirmLabel="Restore"
          danger
          onCancel={() => setRestoreTarget(null)}
          onConfirm={() => restore(restoreTarget)}
          body={
            <>
              Your data will be replaced with the backup from <b>{fmtDate(restoreTarget.created_at)}</b> ({restoreTarget.vocab_count} words).
              <br /><br />
              Your current data will be backed up first, so you can undo this by restoring that backup.
            </>
          }
        />
      )}

      {importOpen && (
        <ImportDialog
          onClose={() => setImportOpen(false)}
          onDone={(r) => {
            setImportOpen(false);
            setReport(r);
            load();
          }}
        />
      )}

      {report && (
        <Modal narrow title="Import finished" onClose={() => setReport(null)} footer={<button className="btn primary" onClick={() => setReport(null)}>Done</button>}>
          <div>Added <b>{report.added}</b> · Updated <b>{report.updated}</b> · Skipped <b>{report.skipped}</b></div>
          {report.errors.length > 0 && (
            <div className="notice warn">
              <b>{report.errors.length} row(s) could not be imported:</b>
              <ul style={{ margin: "6px 0 0", paddingLeft: 18, maxHeight: 180, overflowY: "auto", fontSize: 13 }}>
                {report.errors.map((e, i) => <li key={i}>{e}</li>)}
              </ul>
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}

function ImportDialog({ onClose, onDone }: { onClose: () => void; onDone: (r: ImportReport) => void }) {
  const { toast } = useToast();
  const [path, setPath] = useState<string | null>(null);
  const [mode, setMode] = useState<ImportMode>("skip_existing");
  const [busy, setBusy] = useState(false);
  const format: FileFormat | null = path ? (path.toLowerCase().endsWith(".csv") ? "csv" : "json") : null;

  const pick = async () => {
    const p = await open({ multiple: false, directory: false, filters: [{ name: "Vocabulary", extensions: ["json", "csv"] }] });
    if (typeof p === "string") setPath(p);
  };

  const go = async () => {
    if (!path || !format) return;
    setBusy(true);
    try {
      onDone(await api.vocabImport(path, format, mode));
    } catch (e) {
      toast((e as Error).message, { kind: "error" });
      setBusy(false);
    }
  };

  return (
    <Modal
      narrow
      title="Import vocabulary"
      onClose={onClose}
      footer={
        <>
          <button className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={!path || busy} onClick={go}>{busy ? "Importing…" : "Import"}</button>
        </>
      }
    >
      <div className="row">
        <button className="btn" onClick={pick}>Choose file…</button>
        <span className="mono faint" style={{ overflow: "hidden", textOverflow: "ellipsis", maxWidth: 260 }}>{path ?? "No file chosen"}</span>
      </div>
      <p className="faint" style={{ margin: 0, fontSize: 12.5 }}>
        CSV needs a <span className="mono">meaning</span> column plus <span className="mono">word</span> and/or <span className="mono">reading</span>.
        Optional: type, level, category, note, personal_note, tags, example1_jp, example1_en, …
      </p>
      <div className="field">
        <span>When a word already exists</span>
        <label className="toggle"><input type="radio" checked={mode === "skip_existing"} onChange={() => setMode("skip_existing")} /> Keep mine, skip the imported one</label>
        <label className="toggle"><input type="radio" checked={mode === "update_existing"} onChange={() => setMode("update_existing")} /> Replace mine with the imported one</label>
      </div>
      <p className="faint" style={{ margin: 0, fontSize: 12.5 }}>A backup is taken automatically before importing.</p>
    </Modal>
  );
}

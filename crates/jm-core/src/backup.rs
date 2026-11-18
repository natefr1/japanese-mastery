//! Backups: consistent online snapshots via SQLite's backup API, each with a
//! JSON manifest (SHA-256, schema version, counts). Verification checks the
//! checksum AND runs `PRAGMA integrity_check` on the copy.
//!
//! Files: `<dir>/<id>.sqlite` + `<dir>/<id>.json`. Both are written to a temp
//! name and renamed, so a crash never leaves a half-written backup that looks valid.

use crate::{migrations, now_ms, CoreError, Result};
use rusqlite::{Connection, DatabaseName, OpenFlags};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};

pub const APP_VERSION: &str = env!("CARGO_PKG_VERSION");
/// Automatic backups kept (manual backups are never pruned automatically).
pub const KEEP_AUTO: usize = 10;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct BackupInfo {
    pub id: String,
    pub file_name: String,
    pub created_at: i64,
    /// manual | auto-daily | pre-migration-vN | pre-restore | pre-import
    pub reason: String,
    pub schema_version: i64,
    pub size_bytes: u64,
    pub sha256: String,
    pub vocab_count: i64,
    pub app_version: String,
}

impl BackupInfo {
    pub fn is_automatic(&self) -> bool {
        self.reason != "manual"
    }
}

#[derive(Debug, Serialize)]
pub struct VerifyResult {
    pub ok: bool,
    pub checksum_ok: bool,
    pub integrity_ok: bool,
    pub schema_version: i64,
    pub message: String,
}

fn sanitize(reason: &str) -> String {
    let s: String = reason
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '-' { c.to_ascii_lowercase() } else { '-' })
        .collect();
    if s.is_empty() { "manual".into() } else { s }
}

pub fn sha256_file(path: &Path) -> Result<String> {
    let mut f = fs::File::open(path)?;
    let mut h = Sha256::new();
    let mut buf = vec![0u8; 64 * 1024];
    loop {
        let n = f.read(&mut buf)?;
        if n == 0 {
            break;
        }
        h.update(&buf[..n]);
    }
    Ok(hex::encode(h.finalize()))
}

fn write_atomic(path: &Path, bytes: &[u8]) -> Result<()> {
    let tmp = path.with_extension("tmp-write");
    fs::write(&tmp, bytes)?;
    fs::rename(&tmp, path)?;
    Ok(())
}

/// Runs integrity_check on a database file and reads its schema version and vocab count.
fn inspect(path: &Path) -> Result<(bool, i64, i64)> {
    let c = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX)?;
    let res: String = c.query_row("PRAGMA integrity_check", [], |r| r.get(0))?;
    let ver: i64 = c.pragma_query_value(None, "user_version", |r| r.get(0))?;
    let count: i64 = c
        .query_row("SELECT COUNT(*) FROM vocab_items WHERE deleted_at IS NULL", [], |r| r.get(0))
        .unwrap_or(0);
    Ok((res == "ok", ver, count))
}

/// Creates a verified backup of the live database.
pub fn create(conn: &Connection, dir: &Path, reason: &str) -> Result<BackupInfo> {
    fs::create_dir_all(dir)?;
    let reason = sanitize(reason);
    let ts = now_ms();
    let mut id = format!("jm-{ts}-{reason}");
    let mut n = 1;
    while dir.join(format!("{id}.sqlite")).exists() {
        n += 1;
        id = format!("jm-{ts}-{reason}-{n}");
    }
    let final_path = dir.join(format!("{id}.sqlite"));
    let tmp = dir.join(format!("{id}.sqlite.partial"));
    let _ = fs::remove_file(&tmp);
    conn.backup(DatabaseName::Main, &tmp, None)?;
    {
        // Make the copy a self-contained single file (no WAL sidecars).
        let c = Connection::open(&tmp)?;
        let _: String = c.query_row("PRAGMA journal_mode=DELETE", [], |r| r.get(0))?;
    }
    let (ok, schema_version, vocab_count) = inspect(&tmp)?;
    if !ok {
        let _ = fs::remove_file(&tmp);
        return Err(CoreError::Corrupt("backup copy failed its integrity check".into()));
    }
    let sha256 = sha256_file(&tmp)?;
    let size_bytes = fs::metadata(&tmp)?.len();
    fs::rename(&tmp, &final_path)?;
    let info = BackupInfo {
        id: id.clone(),
        file_name: format!("{id}.sqlite"),
        created_at: ts,
        reason,
        schema_version,
        size_bytes,
        sha256,
        vocab_count,
        app_version: APP_VERSION.into(),
    };
    write_atomic(&dir.join(format!("{id}.json")), &serde_json::to_vec_pretty(&info)?)?;
    Ok(info)
}

/// All backups with a readable manifest, newest first.
pub fn list(dir: &Path) -> Result<Vec<BackupInfo>> {
    let mut out = vec![];
    if !dir.exists() {
        return Ok(out);
    }
    for e in fs::read_dir(dir)? {
        let p = e?.path();
        if p.extension().and_then(|x| x.to_str()) != Some("json") {
            continue;
        }
        if let Ok(bytes) = fs::read(&p) {
            if let Ok(info) = serde_json::from_slice::<BackupInfo>(&bytes) {
                if dir.join(&info.file_name).exists() {
                    out.push(info);
                }
            }
        }
    }
    out.sort_by(|a, b| b.created_at.cmp(&a.created_at).then(b.id.cmp(&a.id)));
    Ok(out)
}

fn find(dir: &Path, id: &str) -> Result<BackupInfo> {
    list(dir)?
        .into_iter()
        .find(|b| b.id == id)
        .ok_or_else(|| CoreError::NotFound(format!("backup {id}")))
}

pub fn backup_path(dir: &Path, info: &BackupInfo) -> PathBuf {
    dir.join(&info.file_name)
}

pub fn verify(dir: &Path, id: &str) -> Result<VerifyResult> {
    let info = find(dir, id)?;
    let path = backup_path(dir, &info);
    let checksum_ok = sha256_file(&path)? == info.sha256;
    let (integrity_ok, schema_version) = match inspect(&path) {
        Ok((ok, v, _)) => (ok, v),
        Err(_) => (false, info.schema_version),
    };
    let ok = checksum_ok && integrity_ok && schema_version <= migrations::latest_version();
    let message = if ok {
        "Backup is intact.".into()
    } else if !checksum_ok {
        "Checksum mismatch: the backup file was modified or damaged.".into()
    } else if !integrity_ok {
        "SQLite integrity check failed.".into()
    } else {
        format!("Backup uses schema v{schema_version}, newer than this app supports.")
    };
    Ok(VerifyResult { ok, checksum_ok, integrity_ok, schema_version, message })
}

/// Newest backup that passes verification.
pub fn latest_verified(dir: &Path) -> Result<Option<BackupInfo>> {
    for b in list(dir)? {
        if verify(dir, &b.id).map(|v| v.ok).unwrap_or(false) {
            return Ok(Some(b));
        }
    }
    Ok(None)
}

/// Restores a verified backup into the live connection, after taking a safety
/// backup of the current state. Caller must re-run migrations afterwards.
pub fn restore_into(conn: &mut Connection, dir: &Path, id: &str) -> Result<BackupInfo> {
    let v = verify(dir, id)?;
    if !v.ok {
        return Err(CoreError::Invalid(format!("refusing to restore: {}", v.message)));
    }
    let info = find(dir, id)?;
    create(conn, dir, "pre-restore")?;
    conn.restore(DatabaseName::Main, backup_path(dir, &info), None::<fn(rusqlite::backup::Progress)>)?;
    Ok(info)
}

/// Deletes the oldest automatic backups beyond `keep`. Manual backups are kept.
pub fn prune_automatic(dir: &Path, keep: usize) -> Result<usize> {
    let autos: Vec<_> = list(dir)?.into_iter().filter(|b| b.is_automatic()).collect();
    let mut removed = 0;
    for b in autos.into_iter().skip(keep) {
        let _ = fs::remove_file(backup_path(dir, &b));
        let _ = fs::remove_file(dir.join(format!("{}.json", b.id)));
        removed += 1;
    }
    Ok(removed)
}

/// True if no daily automatic backup exists within `interval_ms`.
pub fn auto_due(dir: &Path, interval_ms: i64) -> Result<bool> {
    let now = now_ms();
    Ok(!list(dir)?
        .iter()
        .any(|b| b.reason == "auto-daily" && now - b.created_at < interval_ms))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{seed, vocab};

    fn live(dir: &Path) -> Connection {
        let mut c = Connection::open(dir.join("live.sqlite")).unwrap();
        migrations::migrate(&mut c).unwrap();
        seed::apply(&c, "dev").unwrap();
        c
    }

    #[test]
    fn backup_restore_roundtrip() {
        let t = tempfile::tempdir().unwrap();
        let bdir = t.path().join("backups");
        let mut c = live(t.path());
        let b = create(&c, &bdir, "manual").unwrap();
        assert_eq!(b.vocab_count, 385);
        assert!(verify(&bdir, &b.id).unwrap().ok);

        // Damage live data, then restore.
        c.execute("UPDATE vocab_items SET deleted_at = 1", []).unwrap();
        assert_eq!(vocab::list(&c).unwrap().len(), 0);
        restore_into(&mut c, &bdir, &b.id).unwrap();
        assert_eq!(vocab::list(&c).unwrap().len(), 385);
        // A pre-restore safety backup was taken.
        assert!(list(&bdir).unwrap().iter().any(|x| x.reason == "pre-restore" && x.vocab_count == 0));
    }

    #[test]
    fn tampered_backup_fails_verification_and_is_not_restored() {
        let t = tempfile::tempdir().unwrap();
        let bdir = t.path().join("backups");
        let mut c = live(t.path());
        let b = create(&c, &bdir, "manual").unwrap();
        let p = backup_path(&bdir, &b);
        let mut bytes = fs::read(&p).unwrap();
        let last = bytes.len() - 10;
        bytes[last] ^= 0xFF;
        fs::write(&p, bytes).unwrap();
        let v = verify(&bdir, &b.id).unwrap();
        assert!(!v.ok && !v.checksum_ok);
        assert!(restore_into(&mut c, &bdir, &b.id).is_err());
    }

    #[test]
    fn pruning_keeps_manual_backups() {
        let t = tempfile::tempdir().unwrap();
        let bdir = t.path().join("backups");
        let c = live(t.path());
        create(&c, &bdir, "manual").unwrap();
        for _ in 0..4 {
            create(&c, &bdir, "auto-daily").unwrap();
        }
        assert_eq!(prune_automatic(&bdir, 2).unwrap(), 2);
        let all = list(&bdir).unwrap();
        assert_eq!(all.len(), 3);
        assert!(all.iter().any(|b| b.reason == "manual"));
        assert!(!auto_due(&bdir, 60_000).unwrap());
    }
}

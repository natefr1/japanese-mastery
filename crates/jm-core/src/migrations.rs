//! Versioned, transactional schema migrations tracked with `PRAGMA user_version`
//! plus a `schema_migrations` audit table (with SQL checksums).
//!
//! Rules: never edit a shipped migration; add a new one. Each migration runs in
//! its own transaction, so an interruption leaves the DB at the previous version.

use crate::{now_ms, CoreError, Result};
use rusqlite::{params, Connection};
use sha2::{Digest, Sha256};

pub struct Migration {
    pub version: i64,
    pub name: &'static str,
    pub sql: &'static str,
}

pub const MIGRATIONS: &[Migration] = &[
    Migration { version: 1, name: "init", sql: include_str!("../migrations/0001_init.sql") },
    Migration { version: 2, name: "study_and_game", sql: include_str!("../migrations/0002_study_and_game.sql") },
];

pub fn latest_version() -> i64 {
    MIGRATIONS.last().map(|m| m.version).unwrap_or(0)
}

pub fn current_version(conn: &Connection) -> Result<i64> {
    Ok(conn.pragma_query_value(None, "user_version", |r| r.get(0))?)
}

pub fn pending(conn: &Connection) -> Result<Vec<&'static Migration>> {
    let cur = current_version(conn)?;
    Ok(MIGRATIONS.iter().filter(|m| m.version > cur).collect())
}

fn checksum(sql: &str) -> String {
    hex::encode(Sha256::digest(sql.as_bytes()))
}

/// Applies all pending migrations. Returns (from_version, to_version).
pub fn migrate(conn: &mut Connection) -> Result<(i64, i64)> {
    let from = current_version(conn)?;
    if from > latest_version() {
        return Err(CoreError::Invalid(format!(
            "this database uses schema v{from}, but this app only understands up to v{}. Update the app instead of downgrading.",
            latest_version()
        )));
    }
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS schema_migrations (
            version INTEGER PRIMARY KEY,
            name TEXT NOT NULL,
            checksum TEXT NOT NULL,
            applied_at INTEGER NOT NULL
        );",
    )?;
    for m in MIGRATIONS.iter().filter(|m| m.version > from) {
        let tx = conn.transaction()?;
        tx.execute_batch(m.sql)?;
        tx.execute(
            "INSERT INTO schema_migrations(version, name, checksum, applied_at) VALUES (?1, ?2, ?3, ?4)",
            params![m.version, m.name, checksum(m.sql), now_ms()],
        )?;
        tx.pragma_update(None, "user_version", m.version)?;
        tx.commit()?;
    }
    Ok((from, current_version(conn)?))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fresh_db_migrates_to_latest_and_is_idempotent() {
        let mut c = Connection::open_in_memory().unwrap();
        let (from, to) = migrate(&mut c).unwrap();
        assert_eq!(from, 0);
        assert_eq!(to, latest_version());
        assert!(pending(&c).unwrap().is_empty());
        let (from2, to2) = migrate(&mut c).unwrap();
        assert_eq!((from2, to2), (latest_version(), latest_version()));
        let n: i64 = c.query_row("SELECT COUNT(*) FROM schema_migrations", [], |r| r.get(0)).unwrap();
        assert_eq!(n, MIGRATIONS.len() as i64);
    }

    #[test]
    fn refuses_newer_schema() {
        let mut c = Connection::open_in_memory().unwrap();
        c.pragma_update(None, "user_version", latest_version() + 1).unwrap();
        assert!(migrate(&mut c).is_err());
    }

    #[test]
    fn migration_versions_are_strictly_increasing() {
        for w in MIGRATIONS.windows(2) {
            assert!(w[1].version > w[0].version);
        }
    }
}

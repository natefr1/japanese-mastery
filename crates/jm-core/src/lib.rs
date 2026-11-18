//! Japanese Mastery core library.
//!
//! Owns everything about durable local data: the SQLite schema and migrations,
//! the built-in vocabulary seed, vocabulary CRUD, settings, the append-only
//! event log, backups/restore/recovery, and JSON/CSV import/export.
//!
//! It has no UI or Tauri dependency so it can be tested on any machine and
//! reused by a future mobile companion or sync service.

pub mod backup;
pub mod content;
pub mod db;
pub mod error;
pub mod events;
pub mod game;
pub mod io;
pub mod migrations;
pub mod reading;
pub mod seed;
pub mod settings;
pub mod study;
pub mod vocab;

pub use db::{Db, DbPaths, OpenReport};
pub use error::{CoreError, Result};

/// Current unix time in milliseconds.
pub fn now_ms() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

pub fn new_id() -> String {
    uuid::Uuid::new_v4().to_string()
}

//! Built-in vocabulary from the original website (385 entries).
//!
//! Seeding runs once per database and is recorded in `meta`, so words the user
//! deletes are never re-added. Seed rows get deterministic UUIDv5 ids, so the
//! same word has the same id on every device (important for future sync).

use crate::vocab::{self, Example, VocabInput};
use crate::Result;
use rusqlite::{params, Connection, OptionalExtension};
use serde::Deserialize;
use uuid::Uuid;

pub const SEED_KEY: &str = "seed.vocab_v1";
pub const SEED_SOURCE: &str = "seed:v1";
const SEED_JSON: &str = include_str!("../seed/vocab_v1.json");
const NAMESPACE: Uuid = Uuid::from_u128(0x6a4f_2c1e_9b7d_4e3a_8f21_5c0d_9e8b_7a61);

#[derive(Deserialize)]
struct SeedFile {
    items: Vec<SeedItem>,
}

#[derive(Deserialize)]
struct SeedItem {
    word: String,
    reading: String,
    meaning: String,
    word_type: String,
    level: String,
    category: String,
    note: String,
    examples: Vec<Example>,
}

const MANGA_JSON: &str = include_str!("../seed/manga_v1.json");
const CORE_JSON: &str = include_str!("../seed/core_v1.json");

#[derive(Deserialize)]
struct PackFile {
    items: Vec<PackItem>,
}

#[derive(Deserialize)]
struct PackItem {
    word: String,
    reading: String,
    meaning: String,
    word_type: String,
    #[serde(default)]
    level: String,
    #[serde(default)]
    category: String,
    #[serde(default)]
    note: String,
    #[serde(default)]
    examples: Vec<Example>,
    #[serde(default)]
    freq_rank: Option<i64>,
}

/// Applies an additional word pack once. Words already in the deck (same spelling
/// and reading) are skipped, so packs never create duplicates.
fn apply_pack(conn: &Connection, device_id: &str, key: &str, json: &str, source: &str, default_category: &str) -> Result<usize> {
    let done: Option<String> = conn.query_row("SELECT value FROM meta WHERE key = ?1", [key], |r| r.get(0)).optional()?;
    if done.is_some() {
        return Ok(0);
    }
    let file: PackFile = serde_json::from_str(json)?;
    let mut added = 0;
    for s in file.items {
        let id = Uuid::new_v5(&NAMESPACE, format!("{source}:{}|{}|{}", s.word, s.reading, s.word_type).as_bytes()).to_string();
        if vocab::exists(conn, &id)? || vocab::find_duplicate(conn, &s.word, &s.reading)?.is_some() {
            continue;
        }
        vocab::upsert(
            conn,
            device_id,
            VocabInput {
                id: Some(id),
                word: s.word,
                reading: s.reading,
                meaning: s.meaning,
                word_type: s.word_type,
                level: s.level,
                category: if s.category.is_empty() { default_category.into() } else { s.category },
                note: s.note,
                examples: s.examples,
                freq_rank: s.freq_rank,
                ..Default::default()
            },
            source,
        )?;
        added += 1;
    }
    conn.execute("INSERT INTO meta(key, value) VALUES (?1, ?2)", params![key, crate::now_ms().to_string()])?;
    Ok(added)
}

/// Manga register pack (original content).
pub fn apply_manga(conn: &Connection, device_id: &str) -> Result<usize> {
    apply_pack(conn, device_id, "seed.manga_v1", MANGA_JSON, "seed:manga-v1", "manga")
}

/// Core frequency deck (JMdict, CC BY-SA 4.0).
pub fn apply_core(conn: &Connection, device_id: &str) -> Result<usize> {
    apply_pack(conn, device_id, "seed.core_v1", CORE_JSON, "seed:core-v1", "core3k")
}

pub fn seed_id(word: &str, reading: &str, word_type: &str) -> String {
    Uuid::new_v5(&NAMESPACE, format!("jm-seed-v1:{word}|{reading}|{word_type}").as_bytes()).to_string()
}

pub fn seed_count() -> usize {
    serde_json::from_str::<SeedFile>(SEED_JSON).map(|f| f.items.len()).unwrap_or(0)
}

/// Inserts the seed if it has never been applied. Returns how many rows were added.
/// Call inside a transaction.
pub fn apply(conn: &Connection, device_id: &str) -> Result<usize> {
    let done: Option<String> = conn
        .query_row("SELECT value FROM meta WHERE key = ?1", [SEED_KEY], |r| r.get(0))
        .optional()?;
    if done.is_some() {
        return Ok(0);
    }
    let file: SeedFile = serde_json::from_str(SEED_JSON)?;
    let mut added = 0;
    for s in file.items {
        let id = seed_id(&s.word, &s.reading, &s.word_type);
        if vocab::exists(conn, &id)? {
            continue;
        }
        vocab::upsert(
            conn,
            device_id,
            VocabInput {
                id: Some(id),
                word: s.word,
                reading: s.reading,
                meaning: s.meaning,
                word_type: s.word_type,
                level: s.level,
                category: s.category,
                note: s.note,
                examples: s.examples,
                ..Default::default()
            },
            SEED_SOURCE,
        )?;
        added += 1;
    }
    conn.execute(
        "INSERT INTO meta(key, value) VALUES (?1, ?2)",
        params![SEED_KEY, crate::now_ms().to_string()],
    )?;
    Ok(added)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::migrations;

    #[test]
    fn seed_ids_are_unique() {
        let file: SeedFile = serde_json::from_str(SEED_JSON).unwrap();
        let mut ids: Vec<_> = file.items.iter().map(|s| seed_id(&s.word, &s.reading, &s.word_type)).collect();
        let n = ids.len();
        ids.sort();
        ids.dedup();
        assert_eq!(ids.len(), n, "duplicate seed entries");
        assert_eq!(n, 385);
    }

    #[test]
    fn packs_apply_once_without_duplicates() {
        let mut c = Connection::open_in_memory().unwrap();
        migrations::migrate(&mut c).unwrap();
        apply(&c, "dev").unwrap();
        let manga = apply_manga(&c, "dev").unwrap();
        let core = apply_core(&c, "dev").unwrap();
        assert!(manga > 80 && core > 2500, "manga {manga} core {core}");
        assert_eq!(apply_manga(&c, "dev").unwrap() + apply_core(&c, "dev").unwrap(), 0);
        let dups: i64 = c.query_row(
            "SELECT COUNT(*) FROM (SELECT word, reading FROM vocab_items GROUP BY word, reading HAVING COUNT(*) > 1)", [], |r| r.get(0)).unwrap();
        assert_eq!(dups, 0);
        let ranked: i64 = c.query_row("SELECT COUNT(*) FROM vocab_items WHERE freq_rank IS NOT NULL", [], |r| r.get(0)).unwrap();
        assert_eq!(ranked as usize, core);
    }

    #[test]
    fn seed_applies_once_and_respects_deletions() {
        let mut c = Connection::open_in_memory().unwrap();
        migrations::migrate(&mut c).unwrap();
        assert_eq!(apply(&c, "dev").unwrap(), 385);
        let first = vocab::list(&c).unwrap()[0].id.clone();
        vocab::soft_delete(&c, "dev", &first).unwrap();
        assert_eq!(apply(&c, "dev").unwrap(), 0);
        assert_eq!(vocab::list(&c).unwrap().len(), 384);
    }
}

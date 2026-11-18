//! Vocabulary items, examples and tags.
//!
//! Functions taking `&Connection` never open their own transaction, so they can
//! be composed inside a caller's transaction (imports, seeding). `Db` methods in
//! db.rs wrap them in a transaction for single operations.

use crate::{events, new_id, now_ms, CoreError, Result};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

pub const WORD_TYPES: &[&str] = &["g", "i", "iku", "s", "su", "k", "ia", "na", "n", "x", "adv", "gr"];

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Example {
    pub jp: String,
    #[serde(default)]
    pub en: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VocabItem {
    pub id: String,
    pub word: String,
    pub reading: String,
    pub meaning: String,
    pub word_type: String,
    pub level: String,
    pub category: String,
    pub note: String,
    pub personal_note: String,
    pub pitch_accent: Option<String>,
    pub audio_ref: Option<String>,
    pub tags: Vec<String>,
    pub examples: Vec<Example>,
    pub freq_rank: Option<i64>,
    pub source: String,
    pub created_at: i64,
    pub updated_at: i64,
    pub deleted_at: Option<i64>,
    pub rev: i64,
}

/// What the UI / importers send to create or update an item.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct VocabInput {
    #[serde(default)]
    pub id: Option<String>,
    #[serde(default)]
    pub word: String,
    #[serde(default)]
    pub reading: String,
    #[serde(default)]
    pub meaning: String,
    #[serde(default)]
    pub word_type: String,
    #[serde(default)]
    pub level: String,
    #[serde(default)]
    pub category: String,
    #[serde(default)]
    pub note: String,
    #[serde(default)]
    pub personal_note: String,
    #[serde(default)]
    pub pitch_accent: Option<String>,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub examples: Vec<Example>,
    #[serde(default)]
    pub freq_rank: Option<i64>,
}

impl VocabInput {
    /// Trims fields and checks they are usable. Fills `word` from `reading` (or the reverse).
    pub fn normalize(mut self) -> Result<Self> {
        for f in [&mut self.word, &mut self.reading, &mut self.meaning, &mut self.word_type, &mut self.level, &mut self.category] {
            *f = f.trim().to_string();
        }
        if self.word.is_empty() {
            self.word = self.reading.clone();
        }
        if self.reading.is_empty() {
            self.reading = self.word.clone();
        }
        if self.word.is_empty() {
            return Err(CoreError::Invalid("a word or reading is required".into()));
        }
        if self.meaning.is_empty() {
            return Err(CoreError::Invalid(format!("「{}」 needs a meaning", self.word)));
        }
        if self.word_type.is_empty() {
            self.word_type = "n".into();
        }
        if !WORD_TYPES.contains(&self.word_type.as_str()) {
            return Err(CoreError::Invalid(format!("unknown word type '{}'", self.word_type)));
        }
        self.tags = self.tags.iter().map(|t| t.trim().to_string()).filter(|t| !t.is_empty()).collect();
        self.tags.sort();
        self.tags.dedup();
        self.examples.retain(|e| !e.jp.trim().is_empty());
        for e in &mut self.examples {
            e.jp = e.jp.trim().into();
            e.en = e.en.trim().into();
        }
        Ok(self)
    }
}

const ITEM_COLS: &str = "id, word, reading, meaning, word_type, level, category, note, personal_note,
    pitch_accent, audio_ref, source, created_at, updated_at, deleted_at, rev, freq_rank";

fn row_to_item(r: &rusqlite::Row) -> rusqlite::Result<VocabItem> {
    Ok(VocabItem {
        id: r.get(0)?,
        word: r.get(1)?,
        reading: r.get(2)?,
        meaning: r.get(3)?,
        word_type: r.get(4)?,
        level: r.get(5)?,
        category: r.get(6)?,
        note: r.get(7)?,
        personal_note: r.get(8)?,
        pitch_accent: r.get(9)?,
        audio_ref: r.get(10)?,
        source: r.get(11)?,
        created_at: r.get(12)?,
        updated_at: r.get(13)?,
        deleted_at: r.get(14)?,
        rev: r.get(15)?,
        freq_rank: r.get(16)?,
        tags: vec![],
        examples: vec![],
    })
}

fn attach_children(conn: &Connection, items: &mut [VocabItem]) -> Result<()> {
    let mut ex: HashMap<String, Vec<Example>> = HashMap::new();
    let mut st = conn.prepare(
        "SELECT vocab_id, jp, en FROM vocab_examples WHERE deleted_at IS NULL ORDER BY vocab_id, position",
    )?;
    for row in st.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?)))? {
        let (vid, jp, en) = row?;
        ex.entry(vid).or_default().push(Example { jp, en });
    }
    let mut tags: HashMap<String, Vec<String>> = HashMap::new();
    let mut st = conn.prepare(
        "SELECT vt.vocab_id, t.name FROM vocab_tags vt JOIN tags t ON t.id = vt.tag_id
         WHERE vt.deleted_at IS NULL AND t.deleted_at IS NULL ORDER BY t.name",
    )?;
    for row in st.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))? {
        let (vid, name) = row?;
        tags.entry(vid).or_default().push(name);
    }
    for it in items.iter_mut() {
        it.examples = ex.remove(&it.id).unwrap_or_default();
        it.tags = tags.remove(&it.id).unwrap_or_default();
    }
    Ok(())
}

/// All live (not deleted) items, in insertion order.
pub fn list(conn: &Connection) -> Result<Vec<VocabItem>> {
    let mut st = conn.prepare(&format!(
        "SELECT {ITEM_COLS} FROM vocab_items WHERE deleted_at IS NULL ORDER BY created_at, rowid"
    ))?;
    let mut items = st.query_map([], row_to_item)?.collect::<std::result::Result<Vec<_>, _>>()?;
    attach_children(conn, &mut items)?;
    Ok(items)
}

/// One item by id, including deleted ones.
pub fn get(conn: &Connection, id: &str) -> Result<VocabItem> {
    let item = conn
        .query_row(&format!("SELECT {ITEM_COLS} FROM vocab_items WHERE id = ?1"), [id], row_to_item)
        .optional()?
        .ok_or_else(|| CoreError::NotFound(format!("vocab {id}")))?;
    let mut v = vec![item];
    attach_children(conn, &mut v)?;
    Ok(v.pop().unwrap())
}

pub fn exists(conn: &Connection, id: &str) -> Result<bool> {
    Ok(conn
        .query_row("SELECT 1 FROM vocab_items WHERE id = ?1", [id], |_| Ok(()))
        .optional()?
        .is_some())
}

/// Live item with the same spelling and reading, if any.
pub fn find_duplicate(conn: &Connection, word: &str, reading: &str) -> Result<Option<String>> {
    Ok(conn
        .query_row(
            "SELECT id FROM vocab_items WHERE word = ?1 AND reading = ?2 AND deleted_at IS NULL ORDER BY created_at LIMIT 1",
            params![word, reading],
            |r| r.get(0),
        )
        .optional()?)
}

/// Creates (id None or unknown) or updates (id exists) an item. No transaction of its own.
pub fn upsert(conn: &Connection, device_id: &str, input: VocabInput, source: &str) -> Result<String> {
    let v = input.normalize()?;
    let now = now_ms();
    let existing = match &v.id {
        Some(id) => exists(conn, id)?,
        None => false,
    };
    let id = v.id.clone().unwrap_or_else(new_id);
    if existing {
        conn.execute(
            "UPDATE vocab_items SET word=?2, reading=?3, meaning=?4, word_type=?5, level=?6, category=?7,
                note=?8, personal_note=?9, pitch_accent=?10, updated_at=?11, deleted_at=NULL,
                rev=rev+1, device_id=?12, freq_rank=?13
             WHERE id=?1",
            params![id, v.word, v.reading, v.meaning, v.word_type, v.level, v.category, v.note,
                    v.personal_note, v.pitch_accent, now, device_id, v.freq_rank],
        )?;
    } else {
        conn.execute(
            "INSERT INTO vocab_items (id, word, reading, meaning, word_type, level, category, note,
                personal_note, pitch_accent, audio_ref, source, created_at, updated_at, deleted_at, rev, device_id, freq_rank)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, NULL, ?11, ?12, ?12, NULL, 1, ?13, ?14)",
            params![id, v.word, v.reading, v.meaning, v.word_type, v.level, v.category, v.note,
                    v.personal_note, v.pitch_accent, source, now, device_id, v.freq_rank],
        )?;
    }
    set_examples(conn, device_id, &id, &v.examples, now)?;
    set_tags(conn, device_id, &id, &v.tags, now)?;
    events::append(
        conn,
        device_id,
        if existing { "vocab.updated" } else { "vocab.created" },
        "vocab",
        &id,
        &serde_json::json!({ "word": v.word, "reading": v.reading, "source": source }),
    )?;
    Ok(id)
}

fn set_examples(conn: &Connection, device_id: &str, vocab_id: &str, exs: &[Example], now: i64) -> Result<()> {
    // Positions are the stable identity of an example within its item.
    let mut current: HashMap<i64, (String, String, String, bool)> = HashMap::new();
    {
        let mut st = conn.prepare(
            "SELECT position, id, jp, en, deleted_at IS NOT NULL FROM vocab_examples WHERE vocab_id = ?1",
        )?;
        for row in st.query_map([vocab_id], |r| {
            Ok((r.get::<_, i64>(0)?, (r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)))
        })? {
            let (p, v) = row?;
            current.insert(p, v);
        }
    }
    for (i, e) in exs.iter().enumerate() {
        let pos = i as i64;
        match current.remove(&pos) {
            Some((id, jp, en, deleted)) => {
                if jp != e.jp || en != e.en || deleted {
                    conn.execute(
                        "UPDATE vocab_examples SET jp=?2, en=?3, updated_at=?4, deleted_at=NULL, rev=rev+1, device_id=?5 WHERE id=?1",
                        params![id, e.jp, e.en, now, device_id],
                    )?;
                }
            }
            None => {
                conn.execute(
                    "INSERT INTO vocab_examples (id, vocab_id, position, jp, en, created_at, updated_at, rev, device_id)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6, 1, ?7)",
                    params![new_id(), vocab_id, pos, e.jp, e.en, now, device_id],
                )?;
            }
        }
    }
    for (_, (id, _, _, deleted)) in current {
        if !deleted {
            conn.execute(
                "UPDATE vocab_examples SET deleted_at=?2, updated_at=?2, rev=rev+1, device_id=?3 WHERE id=?1",
                params![id, now, device_id],
            )?;
        }
    }
    Ok(())
}

fn tag_id(conn: &Connection, device_id: &str, name: &str, now: i64) -> Result<String> {
    if let Some((id, deleted)) = conn
        .query_row("SELECT id, deleted_at IS NOT NULL FROM tags WHERE name = ?1", [name], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, bool>(1)?))
        })
        .optional()?
    {
        if deleted {
            conn.execute(
                "UPDATE tags SET deleted_at=NULL, updated_at=?2, rev=rev+1, device_id=?3 WHERE id=?1",
                params![id, now, device_id],
            )?;
        }
        return Ok(id);
    }
    let id = new_id();
    conn.execute(
        "INSERT INTO tags (id, name, created_at, updated_at, rev, device_id) VALUES (?1, ?2, ?3, ?3, 1, ?4)",
        params![id, name, now, device_id],
    )?;
    Ok(id)
}

fn set_tags(conn: &Connection, device_id: &str, vocab_id: &str, names: &[String], now: i64) -> Result<()> {
    let wanted: Vec<String> = names
        .iter()
        .map(|n| tag_id(conn, device_id, n, now))
        .collect::<Result<_>>()?;
    let mut current: HashMap<String, bool> = HashMap::new();
    {
        let mut st = conn.prepare("SELECT tag_id, deleted_at IS NOT NULL FROM vocab_tags WHERE vocab_id = ?1")?;
        for row in st.query_map([vocab_id], |r| Ok((r.get::<_, String>(0)?, r.get::<_, bool>(1)?)))? {
            let (t, d) = row?;
            current.insert(t, d);
        }
    }
    for t in &wanted {
        match current.remove(t) {
            Some(false) => {}
            Some(true) => {
                conn.execute(
                    "UPDATE vocab_tags SET deleted_at=NULL, updated_at=?3, device_id=?4 WHERE vocab_id=?1 AND tag_id=?2",
                    params![vocab_id, t, now, device_id],
                )?;
            }
            None => {
                conn.execute(
                    "INSERT INTO vocab_tags (vocab_id, tag_id, created_at, updated_at, device_id) VALUES (?1, ?2, ?3, ?3, ?4)",
                    params![vocab_id, t, now, device_id],
                )?;
            }
        }
    }
    for (t, deleted) in current {
        if !deleted {
            conn.execute(
                "UPDATE vocab_tags SET deleted_at=?3, updated_at=?3, device_id=?4 WHERE vocab_id=?1 AND tag_id=?2",
                params![vocab_id, t, now, device_id],
            )?;
        }
    }
    Ok(())
}

/// Logical delete (tombstone). Data stays recoverable and syncable.
pub fn soft_delete(conn: &Connection, device_id: &str, id: &str) -> Result<()> {
    let now = now_ms();
    let n = conn.execute(
        "UPDATE vocab_items SET deleted_at=?2, updated_at=?2, rev=rev+1, device_id=?3 WHERE id=?1 AND deleted_at IS NULL",
        params![id, now, device_id],
    )?;
    if n == 0 {
        return Err(CoreError::NotFound(format!("vocab {id}")));
    }
    events::append(conn, device_id, "vocab.deleted", "vocab", id, &serde_json::json!({}))
}

pub fn restore(conn: &Connection, device_id: &str, id: &str) -> Result<()> {
    let now = now_ms();
    let n = conn.execute(
        "UPDATE vocab_items SET deleted_at=NULL, updated_at=?2, rev=rev+1, device_id=?3 WHERE id=?1 AND deleted_at IS NOT NULL",
        params![id, now, device_id],
    )?;
    if n == 0 {
        return Err(CoreError::NotFound(format!("deleted vocab {id}")));
    }
    events::append(conn, device_id, "vocab.restored", "vocab", id, &serde_json::json!({}))
}

#[derive(Debug, Serialize, Default)]
pub struct VocabStats {
    pub total: i64,
    pub deleted: i64,
    pub user_added: i64,
    pub by_category: Vec<(String, i64)>,
    pub by_level: Vec<(String, i64)>,
}

pub fn stats(conn: &Connection) -> Result<VocabStats> {
    let one = |sql: &str| -> Result<i64> { Ok(conn.query_row(sql, [], |r| r.get(0))?) };
    let group = |col: &str| -> Result<Vec<(String, i64)>> {
        let mut st = conn.prepare(&format!(
            "SELECT {col}, COUNT(*) FROM vocab_items WHERE deleted_at IS NULL GROUP BY {col} ORDER BY COUNT(*) DESC"
        ))?;
        let v = st.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?.collect::<std::result::Result<Vec<_>, _>>()?;
        Ok(v)
    };
    Ok(VocabStats {
        total: one("SELECT COUNT(*) FROM vocab_items WHERE deleted_at IS NULL")?,
        deleted: one("SELECT COUNT(*) FROM vocab_items WHERE deleted_at IS NOT NULL")?,
        user_added: one("SELECT COUNT(*) FROM vocab_items WHERE deleted_at IS NULL AND source NOT LIKE 'seed:%'")?,
        by_category: group("category")?,
        by_level: group("level")?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::migrations;

    fn db() -> Connection {
        let mut c = Connection::open_in_memory().unwrap();
        migrations::migrate(&mut c).unwrap();
        c
    }

    fn input(word: &str) -> VocabInput {
        VocabInput {
            word: word.into(),
            reading: "よみ".into(),
            meaning: "meaning".into(),
            word_type: "g".into(),
            tags: vec!["b".into(), "a".into(), "a".into()],
            examples: vec![Example { jp: "例1".into(), en: "ex1".into() }, Example { jp: "例2".into(), en: "ex2".into() }],
            ..Default::default()
        }
    }

    #[test]
    fn create_update_roundtrip_bumps_rev_and_logs_events() {
        let c = db();
        let id = upsert(&c, "dev", input("読む"), "user").unwrap();
        let it = get(&c, &id).unwrap();
        assert_eq!(it.rev, 1);
        assert_eq!(it.tags, vec!["a", "b"]);
        assert_eq!(it.examples.len(), 2);

        let mut upd = input("読む");
        upd.id = Some(id.clone());
        upd.meaning = "to read".into();
        upd.examples.truncate(1);
        upd.tags = vec!["c".into()];
        upsert(&c, "dev", upd, "user").unwrap();
        let it = get(&c, &id).unwrap();
        assert_eq!(it.rev, 2);
        assert_eq!(it.meaning, "to read");
        assert_eq!(it.examples.len(), 1);
        assert_eq!(it.tags, vec!["c"]);
        assert_eq!(events::for_entity(&c, "vocab", &id).unwrap().len(), 2);
    }

    #[test]
    fn soft_delete_hides_and_restore_returns() {
        let c = db();
        let id = upsert(&c, "dev", input("読む"), "user").unwrap();
        soft_delete(&c, "dev", &id).unwrap();
        assert!(list(&c).unwrap().is_empty());
        assert!(get(&c, &id).unwrap().deleted_at.is_some());
        assert!(soft_delete(&c, "dev", &id).is_err());
        restore(&c, "dev", &id).unwrap();
        assert_eq!(list(&c).unwrap().len(), 1);
    }

    #[test]
    fn validation_rejects_bad_input() {
        let c = db();
        let mut bad = input("x");
        bad.meaning = "  ".into();
        assert!(upsert(&c, "dev", bad, "user").is_err());
        let mut bad = input("x");
        bad.word_type = "verb?".into();
        assert!(upsert(&c, "dev", bad, "user").is_err());
        let ok = VocabInput { reading: "かな".into(), meaning: "kana".into(), ..Default::default() };
        let id = upsert(&c, "dev", ok, "user").unwrap();
        let it = get(&c, &id).unwrap();
        assert_eq!(it.word, "かな");
        assert_eq!(it.word_type, "n");
    }
}

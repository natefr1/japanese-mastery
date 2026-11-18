//! Long-term character memory (structured, scored, correctable) and retrieval.
//! Raw chat history lives in `messages`; this table holds the distilled facts.

use crate::{new_id, now_ms, CoreError, Result};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Memory {
    pub id: String,
    pub character_id: String,
    pub fact: String,
    pub kind: String,
    pub importance: i64,
    pub confidence: f64,
    pub source: String,
    pub source_message_id: Option<String>,
    pub verified: bool,
    pub created_at: i64,
    pub last_used_at: Option<i64>,
}

const COLS: &str = "id, character_id, fact, kind, importance, confidence, source, source_message_id, verified, created_at, last_used_at";

fn row(r: &rusqlite::Row) -> rusqlite::Result<Memory> {
    Ok(Memory {
        id: r.get(0)?, character_id: r.get(1)?, fact: r.get(2)?, kind: r.get(3)?, importance: r.get(4)?, confidence: r.get(5)?,
        source: r.get(6)?, source_message_id: r.get(7)?, verified: r.get(8)?, created_at: r.get(9)?, last_used_at: r.get(10)?,
    })
}

pub fn list(conn: &Connection, character: &str) -> Result<Vec<Memory>> {
    let mut st = conn.prepare(&format!("SELECT {COLS} FROM character_memories WHERE character_id=?1 AND deleted_at IS NULL ORDER BY created_at"))?;
    let v = st.query_map([character], row)?.collect::<std::result::Result<Vec<_>, _>>()?;
    Ok(v)
}

fn norm(s: &str) -> String {
    s.to_lowercase().chars().filter(|c| c.is_alphanumeric()).collect()
}

/// Adds a memory unless an equivalent one exists (then bumps its importance).
pub fn add(conn: &Connection, dev: &str, character: &str, fact: &str, importance: i64, source: &str, source_message_id: Option<&str>) -> Result<Option<String>> {
    let fact = fact.trim();
    if fact.is_empty() || fact.chars().count() > 200 {
        return Ok(None);
    }
    let n = norm(fact);
    for m in list(conn, character)? {
        if norm(&m.fact) == n {
            conn.execute("UPDATE character_memories SET importance = MAX(importance, ?2), updated_at=?3 WHERE id=?1", params![m.id, importance, now_ms()])?;
            return Ok(None);
        }
    }
    let id = new_id();
    let now = now_ms();
    conn.execute(
        "INSERT INTO character_memories (id, character_id, fact, source, created_at, updated_at, rev, device_id, kind, importance, confidence, source_message_id)
         VALUES (?1, ?2, ?3, ?4, ?5, ?5, 1, ?6, 'fact', ?7, 0.8, ?8)",
        params![id, character, fact, source, now, dev, importance.clamp(1, 5), source_message_id],
    )?;
    Ok(Some(id))
}

/// Player correction: edits the fact and marks it verified (full confidence).
pub fn correct(conn: &Connection, dev: &str, id: &str, fact: &str) -> Result<()> {
    let fact = fact.trim();
    if fact.is_empty() {
        return Err(CoreError::Invalid("memory can't be empty".into()));
    }
    let n = conn.execute(
        "UPDATE character_memories SET fact=?2, verified=1, confidence=1.0, updated_at=?3, rev=rev+1, device_id=?4 WHERE id=?1 AND deleted_at IS NULL",
        params![id, fact, now_ms(), dev],
    )?;
    if n == 0 {
        return Err(CoreError::NotFound(format!("memory {id}")));
    }
    Ok(())
}

pub fn delete_all(conn: &Connection, dev: &str, character: &str) -> Result<usize> {
    let now = now_ms();
    Ok(conn.execute(
        "UPDATE character_memories SET deleted_at=?2, updated_at=?2, rev=rev+1, device_id=?3 WHERE character_id=?1 AND deleted_at IS NULL",
        params![character, now, dev],
    )?)
}

/// Keys for overlap: Latin words (3+ letters, minus filler) and CJK character bigrams.
fn keys(s: &str) -> HashSet<String> {
    const STOP: &[&str] = &["player", "the", "and", "likes", "with", "has", "was", "are", "for"];
    let lower = s.to_lowercase();
    let mut out: HashSet<String> = lower
        .split(|c: char| !c.is_ascii_alphanumeric())
        .filter(|w| w.len() >= 3 && !STOP.contains(w))
        .map(|w| w.to_string())
        .collect();
    let cjk: Vec<char> = lower.chars().filter(|c| !c.is_ascii() && c.is_alphanumeric()).collect();
    out.extend(cjk.windows(2).map(|w| w.iter().collect::<String>()));
    out
}

/// Picks the k most useful memories for the current context:
/// importance + confidence + verified + recency of use + overlap with recent text.
pub fn retrieve(conn: &Connection, character: &str, context: &str, k: usize, now: i64) -> Result<Vec<Memory>> {
    let all = list(conn, character)?;
    let ctx = keys(context);
    let mut scored: Vec<(f64, Memory)> = all
        .into_iter()
        .map(|m| {
            let overlap = keys(&m.fact).intersection(&ctx).count() as f64;
            let age_days = ((now - m.created_at).max(0) as f64) / 86_400_000.0;
            let score = m.importance as f64 * 0.35 + m.confidence + if m.verified { 0.5 } else { 0.0 } + overlap.min(3.0) * 1.5 - (age_days / 60.0).min(1.0) * 0.5;
            (score, m)
        })
        .collect();
    scored.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(std::cmp::Ordering::Equal));
    let picked: Vec<Memory> = scored.into_iter().take(k).map(|(_, m)| m).collect();
    for m in &picked {
        conn.execute("UPDATE character_memories SET last_used_at=?2 WHERE id=?1", params![m.id, now])?;
    }
    Ok(picked)
}

pub fn get(conn: &Connection, id: &str) -> Result<Memory> {
    conn.query_row(&format!("SELECT {COLS} FROM character_memories WHERE id=?1"), [id], row)
        .optional()?
        .ok_or_else(|| CoreError::NotFound(format!("memory {id}")))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::migrations;

    #[test]
    fn add_dedupes_correct_verifies_retrieve_ranks() {
        let mut c = Connection::open_in_memory().unwrap();
        migrations::migrate(&mut c).unwrap();
        let a = add(&c, "d", "mika", "Player likes horror games", 2, "chat", None).unwrap();
        assert!(a.is_some());
        assert!(add(&c, "d", "mika", "player likes horror games!", 4, "chat", None).unwrap().is_none());
        assert_eq!(list(&c, "mika").unwrap()[0].importance, 4);
        add(&c, "d", "mika", "Player works at a bakery", 2, "chat", None).unwrap();
        add(&c, "d", "mika", "Player's birthday is in May", 5, "chat", None).unwrap();
        let top = retrieve(&c, "mika", "bakery", 1, now_ms()).unwrap();
        assert!(top[0].fact.contains("bakery"), "{:?}", top);
        let id = list(&c, "mika").unwrap()[1].id.clone();
        correct(&c, "d", &id, "Player works at a café").unwrap();
        let m = get(&c, &id).unwrap();
        assert!(m.verified && m.confidence == 1.0);
        assert_eq!(delete_all(&c, "d", "mika").unwrap(), 3);
        assert!(list(&c, "mika").unwrap().is_empty());
    }
}

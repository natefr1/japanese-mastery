//! Authored learning content: the original grammar pathway and kanji metadata.
//! Seeded once per database (tracked in `meta`), with deterministic ids.

use crate::{now_ms, Result};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use uuid::Uuid;

const GRAMMAR_JSON: &str = include_str!("../seed/grammar_v1.json");
const KANJI_JSON: &str = include_str!("../seed/kanji_v1.json");
const NS: Uuid = Uuid::from_u128(0x2b8e_61f4_0c3d_4a9e_b7d2_8e41_f06a_93c5);

pub fn grammar_id(slug: &str) -> String {
    Uuid::new_v5(&NS, format!("grammar:{slug}").as_bytes()).to_string()
}
pub fn kanji_id(ch: &str) -> String {
    Uuid::new_v5(&NS, format!("kanji:{ch}").as_bytes()).to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GrammarPoint {
    #[serde(default)]
    pub id: String,
    pub slug: String,
    pub level: String,
    pub title: String,
    pub meaning: String,
    pub formation: String,
    pub explanation: String,
    pub examples: Value,
    pub cloze: Value,
    pub mistakes: Value,
    pub compare: Value,
    pub prereqs: Value,
    #[serde(default)]
    pub position: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Kanji {
    #[serde(default)]
    pub id: String,
    pub character: String,
    pub meanings: Vec<String>,
    #[serde(rename = "on")]
    pub on_readings: Vec<String>,
    #[serde(rename = "kun")]
    pub kun_readings: Vec<String>,
    pub jlpt: Option<i64>,
    pub strokes: Option<i64>,
    pub grade: Option<i64>,
}

#[derive(Deserialize)]
struct File<T> {
    source: String,
    items: Vec<T>,
}

fn seeded(conn: &Connection, key: &str) -> Result<bool> {
    Ok(conn
        .query_row("SELECT 1 FROM meta WHERE key = ?1", [key], |_| Ok(()))
        .optional()?
        .is_some())
}

fn mark(conn: &Connection, key: &str) -> Result<()> {
    conn.execute("INSERT INTO meta(key, value) VALUES (?1, ?2)", params![key, now_ms().to_string()])?;
    Ok(())
}

pub fn apply_grammar_seed(conn: &Connection, device_id: &str) -> Result<usize> {
    if seeded(conn, "seed.grammar_v1")? {
        return Ok(0);
    }
    let f: File<GrammarPoint> = serde_json::from_str(GRAMMAR_JSON)?;
    let now = now_ms();
    let mut n = 0;
    for (i, g) in f.items.iter().enumerate() {
        n += conn.execute(
            "INSERT OR IGNORE INTO grammar_points (id, slug, level, title, meaning, formation, explanation,
                examples, cloze, mistakes, compare, prereqs, position, source, created_at, updated_at, rev, device_id)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?15, 1, ?16)",
            params![
                grammar_id(&g.slug), g.slug, g.level, g.title, g.meaning, g.formation, g.explanation,
                g.examples.to_string(), g.cloze.to_string(), g.mistakes.to_string(), g.compare.to_string(),
                g.prereqs.to_string(), i as i64, f.source, now, device_id
            ],
        )?;
    }
    mark(conn, "seed.grammar_v1")?;
    Ok(n)
}

pub fn apply_kanji_seed(conn: &Connection, device_id: &str) -> Result<usize> {
    if seeded(conn, "seed.kanji_v1")? {
        return Ok(0);
    }
    let f: File<Kanji> = serde_json::from_str(KANJI_JSON)?;
    let now = now_ms();
    let mut n = 0;
    for k in &f.items {
        n += conn.execute(
            "INSERT OR IGNORE INTO kanji (id, character, meanings, on_readings, kun_readings, jlpt, strokes, grade,
                source, created_at, updated_at, rev, device_id)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?10, 1, ?11)",
            params![
                kanji_id(&k.character), k.character, serde_json::to_string(&k.meanings)?,
                serde_json::to_string(&k.on_readings)?, serde_json::to_string(&k.kun_readings)?,
                k.jlpt, k.strokes, k.grade, f.source, now, device_id
            ],
        )?;
    }
    mark(conn, "seed.kanji_v1")?;
    Ok(n)
}

fn json(s: String) -> Value {
    serde_json::from_str(&s).unwrap_or(Value::Array(vec![]))
}

pub fn list_grammar(conn: &Connection) -> Result<Vec<GrammarPoint>> {
    let mut st = conn.prepare(
        "SELECT id, slug, level, title, meaning, formation, explanation, examples, cloze, mistakes, compare, prereqs, position
         FROM grammar_points WHERE deleted_at IS NULL ORDER BY position",
    )?;
    let rows = st
        .query_map([], |r| {
            Ok(GrammarPoint {
                id: r.get(0)?,
                slug: r.get(1)?,
                level: r.get(2)?,
                title: r.get(3)?,
                meaning: r.get(4)?,
                formation: r.get(5)?,
                explanation: r.get(6)?,
                examples: json(r.get(7)?),
                cloze: json(r.get(8)?),
                mistakes: json(r.get(9)?),
                compare: json(r.get(10)?),
                prereqs: json(r.get(11)?),
                position: r.get(12)?,
            })
        })?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    Ok(rows)
}

pub fn list_kanji(conn: &Connection) -> Result<Vec<Kanji>> {
    let mut st = conn.prepare(
        "SELECT id, character, meanings, on_readings, kun_readings, jlpt, strokes, grade
         FROM kanji WHERE deleted_at IS NULL ORDER BY jlpt DESC, strokes",
    )?;
    let v = |s: String| serde_json::from_str::<Vec<String>>(&s).unwrap_or_default();
    let rows = st
        .query_map([], |r| {
            Ok(Kanji {
                id: r.get(0)?,
                character: r.get(1)?,
                meanings: v(r.get(2)?),
                on_readings: v(r.get(3)?),
                kun_readings: v(r.get(4)?),
                jlpt: r.get(5)?,
                strokes: r.get(6)?,
                grade: r.get(7)?,
            })
        })?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    Ok(rows)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::migrations;
    use std::collections::HashSet;

    #[test]
    fn grammar_seed_is_consistent() {
        let f: File<GrammarPoint> = serde_json::from_str(GRAMMAR_JSON).unwrap();
        let slugs: HashSet<_> = f.items.iter().map(|g| g.slug.clone()).collect();
        assert_eq!(slugs.len(), f.items.len(), "duplicate slugs");
        for g in &f.items {
            for p in g.prereqs.as_array().unwrap() {
                assert!(slugs.contains(p.as_str().unwrap()), "{}: unknown prereq {p}", g.slug);
            }
            for c in g.compare.as_array().unwrap() {
                let s = c["slug"].as_str().unwrap();
                assert!(slugs.contains(s), "{}: unknown compare {s}", g.slug);
            }
            let cloze = g.cloze.as_array().unwrap();
            assert!(!cloze.is_empty(), "{} has no cloze", g.slug);
            for c in cloze {
                assert!(c["prompt"].as_str().unwrap().contains("＿＿"), "{} cloze lacks blank", g.slug);
                assert!(!c["answers"].as_array().unwrap().is_empty());
            }
        }
    }

    #[test]
    fn seeds_apply_once() {
        let mut c = Connection::open_in_memory().unwrap();
        migrations::migrate(&mut c).unwrap();
        assert!(apply_grammar_seed(&c, "d").unwrap() >= 30);
        assert_eq!(apply_grammar_seed(&c, "d").unwrap(), 0);
        assert!(apply_kanji_seed(&c, "d").unwrap() > 250);
        assert_eq!(list_kanji(&c).unwrap()[0].character.chars().count(), 1);
        assert_eq!(list_grammar(&c).unwrap()[0].slug, "te-kudasai");
    }
}

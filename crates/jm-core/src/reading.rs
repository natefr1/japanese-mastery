//! Reading samples (e.g. text typed or pasted from a manga page) used by the
//! coverage checker. Tokenizing and coverage maths happen in the UI; this
//! module only stores the samples.

use crate::{new_id, now_ms, CoreError, Result};
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};

pub const MAX_SAMPLE_CHARS: usize = 20_000;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Sample {
    #[serde(default)]
    pub id: Option<String>,
    pub series: String,
    #[serde(default)]
    pub title: String,
    pub text: String,
    #[serde(default)]
    pub created_at: i64,
    #[serde(default)]
    pub updated_at: i64,
}

pub fn save(conn: &Connection, dev: &str, s: Sample) -> Result<Sample> {
    let series = s.series.trim().to_string();
    let text = s.text.trim().to_string();
    if series.is_empty() || text.is_empty() {
        return Err(CoreError::Invalid("a series name and some text are required".into()));
    }
    if text.chars().count() > MAX_SAMPLE_CHARS {
        return Err(CoreError::Invalid(format!("samples are limited to {MAX_SAMPLE_CHARS} characters")));
    }
    let now = now_ms();
    let id = match &s.id {
        Some(id) => {
            let n = conn.execute(
                "UPDATE reading_samples SET series=?2, title=?3, text=?4, updated_at=?5, rev=rev+1, device_id=?6 WHERE id=?1 AND deleted_at IS NULL",
                params![id, series, s.title.trim(), text, now, dev],
            )?;
            if n == 0 {
                return Err(CoreError::NotFound(format!("sample {id}")));
            }
            id.clone()
        }
        None => {
            let id = new_id();
            conn.execute(
                "INSERT INTO reading_samples (id, series, title, text, created_at, updated_at, rev, device_id) VALUES (?1, ?2, ?3, ?4, ?5, ?5, 1, ?6)",
                params![id, series, s.title.trim(), text, now, dev],
            )?;
            id
        }
    };
    get(conn, &id)
}

pub fn get(conn: &Connection, id: &str) -> Result<Sample> {
    conn.query_row(
        "SELECT id, series, title, text, created_at, updated_at FROM reading_samples WHERE id=?1",
        [id],
        |r| Ok(Sample { id: Some(r.get(0)?), series: r.get(1)?, title: r.get(2)?, text: r.get(3)?, created_at: r.get(4)?, updated_at: r.get(5)? }),
    )
    .map_err(|_| CoreError::NotFound(format!("sample {id}")))
}

pub fn list(conn: &Connection) -> Result<Vec<Sample>> {
    let mut st = conn.prepare(
        "SELECT id, series, title, text, created_at, updated_at FROM reading_samples WHERE deleted_at IS NULL ORDER BY series, created_at",
    )?;
    let v = st
        .query_map([], |r| Ok(Sample { id: Some(r.get(0)?), series: r.get(1)?, title: r.get(2)?, text: r.get(3)?, created_at: r.get(4)?, updated_at: r.get(5)? }))?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    Ok(v)
}

pub fn delete(conn: &Connection, dev: &str, id: &str) -> Result<()> {
    let now = now_ms();
    let n = conn.execute(
        "UPDATE reading_samples SET deleted_at=?2, updated_at=?2, rev=rev+1, device_id=?3 WHERE id=?1 AND deleted_at IS NULL",
        params![id, now, dev],
    )?;
    if n == 0 {
        return Err(CoreError::NotFound(format!("sample {id}")));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::migrations;

    #[test]
    fn crud() {
        let mut c = Connection::open_in_memory().unwrap();
        migrations::migrate(&mut c).unwrap();
        let s = save(&c, "d", Sample { id: None, series: "ワンピース".into(), title: "1巻 p.3".into(), text: "海賊王に俺はなる！".into(), created_at: 0, updated_at: 0 }).unwrap();
        assert_eq!(list(&c).unwrap().len(), 1);
        let mut s2 = s.clone();
        s2.text = "変更".into();
        assert_eq!(save(&c, "d", s2).unwrap().text, "変更");
        delete(&c, "d", s.id.as_ref().unwrap()).unwrap();
        assert!(list(&c).unwrap().is_empty());
        assert!(save(&c, "d", Sample { id: None, series: " ".into(), title: String::new(), text: "x".into(), created_at: 0, updated_at: 0 }).is_err());
    }
}

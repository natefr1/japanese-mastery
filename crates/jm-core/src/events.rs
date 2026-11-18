//! Append-only domain event log (durable history for future sync / analytics).

use crate::{new_id, now_ms, Result};
use rusqlite::{params, Connection};
use serde::Serialize;

pub fn append(
    conn: &Connection,
    device_id: &str,
    event_type: &str,
    entity: &str,
    entity_id: &str,
    payload: &serde_json::Value,
) -> Result<()> {
    conn.execute(
        "INSERT INTO events(id, type, entity, entity_id, payload, created_at, device_id)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![new_id(), event_type, entity, entity_id, payload.to_string(), now_ms(), device_id],
    )?;
    Ok(())
}

#[derive(Debug, Serialize)]
pub struct EventRow {
    pub id: String,
    pub event_type: String,
    pub entity: String,
    pub entity_id: String,
    pub payload: serde_json::Value,
    pub created_at: i64,
}

pub fn for_entity(conn: &Connection, entity: &str, entity_id: &str) -> Result<Vec<EventRow>> {
    let mut st = conn.prepare(
        "SELECT id, type, entity, entity_id, payload, created_at FROM events
         WHERE entity = ?1 AND entity_id = ?2 ORDER BY seq",
    )?;
    let rows = st
        .query_map(params![entity, entity_id], |r| {
            let p: String = r.get(4)?;
            Ok(EventRow {
                id: r.get(0)?,
                event_type: r.get(1)?,
                entity: r.get(2)?,
                entity_id: r.get(3)?,
                payload: serde_json::from_str(&p).unwrap_or(serde_json::Value::Null),
                created_at: r.get(5)?,
            })
        })?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    Ok(rows)
}

//! Key/value app settings stored as JSON. Secrets (API keys) must NOT go here;
//! they belong in the OS credential store (added with the AI milestone).

use crate::{now_ms, CoreError, Result};
use rusqlite::{params, Connection};
use serde_json::{Map, Value};

const SECRET_HINTS: &[&str] = &["api_key", "apikey", "secret", "token", "password"];

pub fn all(conn: &Connection) -> Result<Map<String, Value>> {
    let mut st = conn.prepare("SELECT key, value FROM settings")?;
    let mut out = Map::new();
    for row in st.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))? {
        let (k, v) = row?;
        out.insert(k, serde_json::from_str(&v).unwrap_or(Value::Null));
    }
    Ok(out)
}

pub fn set(conn: &Connection, device_id: &str, key: &str, value: &Value) -> Result<()> {
    let k = key.to_ascii_lowercase();
    if SECRET_HINTS.iter().any(|h| k.contains(h)) {
        return Err(CoreError::Invalid("secrets are not stored in settings; use the credential store".into()));
    }
    conn.execute(
        "INSERT INTO settings(key, value, updated_at, device_id) VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at, device_id=excluded.device_id",
        params![key, value.to_string(), now_ms(), device_id],
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::migrations;

    #[test]
    fn set_get_and_reject_secrets() {
        let mut c = Connection::open_in_memory().unwrap();
        migrations::migrate(&mut c).unwrap();
        set(&c, "d", "theme", &Value::from("light")).unwrap();
        set(&c, "d", "theme", &Value::from("dark")).unwrap();
        assert_eq!(all(&c).unwrap()["theme"], "dark");
        assert!(set(&c, "d", "openai_api_key", &Value::from("x")).is_err());
    }
}

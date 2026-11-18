//! Progression rules, enforced at the persistence layer so the UI can't inflate them.
//!
//! Three separate tracks:
//!   * XP (player level): effort on meaningful study and quests, with anti-farming caps.
//!   * Yen (world currency): quests and goals only; buys cosmetics, never learning requirements.
//!   * Language mastery: NOT stored here. Derived from FSRS card evidence (see study.rs).

use crate::{new_id, now_ms, CoreError, Result};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

pub const REVIEW_XP_NEW: i64 = 5;
pub const REVIEW_XP_PASS: i64 = 3;
pub const REVIEW_XP_AGAIN: i64 = 1;
/// Review XP stops counting after this much per day (stops "grind 1000 easy cards" farming).
pub const REVIEW_XP_DAILY_CAP: i64 = 400;
pub const SESSION_XP: i64 = 10;
pub const SESSION_MIN_CARDS: i64 = 10;
pub const DAILY_GOAL_XP: i64 = 20;
pub const DAILY_GOAL_YEN: i64 = 30;

pub const CHARACTERS: &[&str] = &["haruto", "mika", "ren", "yui", "sota", "aoi", "natsuki", "chihiro"];

/// Known quests and their rewards. The client cannot choose its own payout.
pub struct QuestDef {
    pub id: &'static str,
    pub xp: i64,
    pub yen: i64,
}
pub const QUESTS: &[QuestDef] = &[
    QuestDef { id: "konbini-first-purchase", xp: 40, yen: 100 },
    QuestDef { id: "haruto-gaming-invite", xp: 30, yen: 80 },
    QuestDef { id: "mika-weekend-plans", xp: 30, yen: 80 },
];

/// Cumulative XP needed to reach `level` (level 1 = 0 XP).
pub fn xp_for_level(level: i64) -> i64 {
    25 * level * (level - 1)
}

pub fn level_for_xp(xp: i64) -> i64 {
    let mut l = 1;
    while xp_for_level(l + 1) <= xp {
        l += 1;
    }
    l
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Grant {
    pub currency: String,
    pub amount: i64,
    pub reason: String,
}

#[derive(Debug, Serialize)]
pub struct PlayerState {
    pub xp: i64,
    pub yen: i64,
    pub level: i64,
    pub level_floor: i64,
    pub level_ceil: i64,
    pub xp_today: i64,
    pub review_xp_today: i64,
    pub review_xp_cap: i64,
    pub daily_goal_done: bool,
}

fn sum(conn: &Connection, sql: &str, p: impl rusqlite::Params) -> Result<i64> {
    Ok(conn.query_row(sql, p, |r| r.get::<_, Option<i64>>(0))?.unwrap_or(0))
}

fn grant(conn: &Connection, dev: &str, currency: &str, amount: i64, reason: &str, rf: &str, day: &str) -> Result<Grant> {
    conn.execute(
        "INSERT INTO reward_ledger (id, currency, amount, reason, ref, day, created_at, device_id)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![new_id(), currency, amount, reason, rf, day, now_ms(), dev],
    )?;
    Ok(Grant { currency: currency.into(), amount, reason: reason.into() })
}

fn already(conn: &Connection, reason: &str, rf: &str, day: Option<&str>) -> Result<bool> {
    let n = match day {
        Some(d) => sum(conn, "SELECT COUNT(*) FROM reward_ledger WHERE reason=?1 AND ref=?2 AND day=?3", params![reason, rf, d])?,
        None => sum(conn, "SELECT COUNT(*) FROM reward_ledger WHERE reason=?1 AND ref=?2", params![reason, rf])?,
    };
    Ok(n > 0)
}

pub fn validate_day(day: &str) -> Result<()> {
    let ok = day.len() == 10 && day.as_bytes()[4] == b'-' && day.as_bytes()[7] == b'-';
    if !ok {
        return Err(CoreError::Invalid(format!("bad day '{day}' (expected YYYY-MM-DD)")));
    }
    Ok(())
}

pub fn player_state(conn: &Connection, day: &str) -> Result<PlayerState> {
    let xp = sum(conn, "SELECT SUM(amount) FROM reward_ledger WHERE currency='xp'", [])?;
    let yen = sum(conn, "SELECT SUM(amount) FROM reward_ledger WHERE currency='yen'", [])?;
    let level = level_for_xp(xp);
    Ok(PlayerState {
        xp,
        yen,
        level,
        level_floor: xp_for_level(level),
        level_ceil: xp_for_level(level + 1),
        xp_today: sum(conn, "SELECT SUM(amount) FROM reward_ledger WHERE currency='xp' AND day=?1", [day])?,
        review_xp_today: sum(conn, "SELECT SUM(amount) FROM reward_ledger WHERE currency='xp' AND reason='review' AND day=?1", [day])?,
        review_xp_cap: REVIEW_XP_DAILY_CAP,
        daily_goal_done: already(conn, "daily_goal", "daily", Some(day))?,
    })
}

/// XP for one graded card. Each card earns XP at most once per day (relearning
/// repeats are free), and review XP is capped per day.
pub fn award_review(conn: &Connection, dev: &str, card_id: &str, rating: i64, was_new: bool, day: &str) -> Result<Vec<Grant>> {
    if already(conn, "review", card_id, Some(day))? {
        return Ok(vec![]);
    }
    let today = sum(conn, "SELECT SUM(amount) FROM reward_ledger WHERE currency='xp' AND reason='review' AND day=?1", [day])?;
    let base = if was_new { REVIEW_XP_NEW } else if rating >= 2 { REVIEW_XP_PASS } else { REVIEW_XP_AGAIN };
    let amount = base.min(REVIEW_XP_DAILY_CAP - today);
    if amount <= 0 {
        return Ok(vec![]);
    }
    Ok(vec![grant(conn, dev, "xp", amount, "review", card_id, day)?])
}

pub fn award_session(conn: &Connection, dev: &str, session_id: &str, cards_done: i64, day: &str) -> Result<Vec<Grant>> {
    if cards_done < SESSION_MIN_CARDS || already(conn, "session", session_id, None)? {
        return Ok(vec![]);
    }
    Ok(vec![grant(conn, dev, "xp", SESSION_XP, "session", session_id, day)?])
}

/// Daily goal: counted from actual review logs since `day_start`, not a client-sent number.
pub fn check_daily_goal(conn: &Connection, dev: &str, day: &str, day_start: i64, goal: i64) -> Result<Vec<Grant>> {
    let goal = goal.clamp(5, 300);
    if already(conn, "daily_goal", "daily", Some(day))? {
        return Ok(vec![]);
    }
    let done = sum(conn, "SELECT COUNT(*) FROM review_logs WHERE reviewed_at >= ?1 AND source='review'", [day_start])?;
    if done < goal {
        return Ok(vec![]);
    }
    Ok(vec![
        grant(conn, dev, "xp", DAILY_GOAL_XP, "daily_goal", "daily", day)?,
        grant(conn, dev, "yen", DAILY_GOAL_YEN, "daily_goal", "daily", day)?,
    ])
}

// ---------------- quests ----------------

#[derive(Debug, Clone, Deserialize)]
pub struct MemoryInput {
    pub character: String,
    pub fact: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct PassportInput {
    pub kind: String,
    pub title: String,
    #[serde(default)]
    pub detail: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct QuestCompletion {
    pub quest_id: String,
    pub success: bool,
    pub score: i64,
    pub started_at: i64,
    #[serde(default)]
    pub relationship: Vec<(String, i64)>,
    #[serde(default)]
    pub memories: Vec<MemoryInput>,
    #[serde(default)]
    pub passport: Vec<PassportInput>,
    #[serde(default)]
    pub outcome: serde_json::Value,
}

#[derive(Debug, Serialize)]
pub struct QuestReward {
    pub grants: Vec<Grant>,
    pub first_completion: bool,
    pub relationship_applied: Vec<(String, i64)>,
    pub memories_added: usize,
    pub passport_added: usize,
}

pub fn ensure_characters(conn: &Connection, dev: &str) -> Result<()> {
    let now = now_ms();
    for c in CHARACTERS {
        conn.execute(
            "INSERT OR IGNORE INTO characters (id, relationship, flags, created_at, updated_at, rev, device_id)
             VALUES (?1, 0, '{}', ?2, ?2, 1, ?3)",
            params![c, now, dev],
        )?;
    }
    Ok(())
}

pub fn complete_quest(conn: &Connection, dev: &str, q: QuestCompletion, day: &str) -> Result<QuestReward> {
    let def = QUESTS
        .iter()
        .find(|d| d.id == q.quest_id)
        .ok_or_else(|| CoreError::Invalid(format!("unknown quest '{}'", q.quest_id)))?;
    let now = now_ms();
    let score = q.score.clamp(0, 100);
    conn.execute(
        "INSERT INTO quest_runs (id, quest_id, started_at, ended_at, success, score, outcome, device_id)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![new_id(), def.id, q.started_at, now, q.success, score, q.outcome.to_string(), dev],
    )?;
    let mut out = QuestReward { grants: vec![], first_completion: false, relationship_applied: vec![], memories_added: 0, passport_added: 0 };
    if !q.success {
        return Ok(out);
    }
    let prev: Option<i64> = conn
        .query_row("SELECT completions FROM quest_progress WHERE quest_id=?1", [def.id], |r| r.get(0))
        .optional()?;
    let first = prev.unwrap_or(0) == 0;
    out.first_completion = first;
    conn.execute(
        "INSERT INTO quest_progress (quest_id, completions, best_score, first_completed_at, last_completed_at, created_at, updated_at, rev, device_id)
         VALUES (?1, 1, ?2, ?3, ?3, ?3, ?3, 1, ?4)
         ON CONFLICT(quest_id) DO UPDATE SET completions=completions+1, best_score=MAX(best_score, excluded.best_score),
            last_completed_at=excluded.last_completed_at, updated_at=excluded.updated_at, rev=rev+1, device_id=excluded.device_id",
        params![def.id, score, now, dev],
    )?;

    if first {
        out.grants.push(grant(conn, dev, "xp", def.xp, "quest", def.id, day)?);
        out.grants.push(grant(conn, dev, "yen", def.yen, "quest", def.id, day)?);
        // Relationship changes only count once per quest, so replays can't farm friendship.
        for (ch, delta) in &q.relationship {
            if !CHARACTERS.contains(&ch.as_str()) {
                continue;
            }
            let d = (*delta).clamp(-3, 5);
            conn.execute(
                "UPDATE characters SET relationship = MAX(0, MIN(100, relationship + ?2)), updated_at=?3, rev=rev+1, device_id=?4 WHERE id=?1",
                params![ch, d, now, dev],
            )?;
            // Keep the 生活 relationship model in step (bounded and rate-limited there too).
            let _ = crate::npc::apply_delta(conn, dev, ch, &crate::npc::RelDelta { closeness: d as f64, trust: 0.0, shared_experience: true }, day);
            out.relationship_applied.push((ch.clone(), d));
        }
    } else if !already(conn, "quest_replay", def.id, Some(day))? && !already(conn, "quest", def.id, Some(day))? {
        // Replays: small XP once per day, no yen.
        out.grants.push(grant(conn, dev, "xp", (def.xp / 4).max(1), "quest_replay", def.id, day)?);
    }

    for m in &q.memories {
        if !CHARACTERS.contains(&m.character.as_str()) || m.fact.trim().is_empty() {
            continue;
        }
        let exists: bool = conn
            .query_row(
                "SELECT 1 FROM character_memories WHERE character_id=?1 AND fact=?2 AND deleted_at IS NULL",
                params![m.character, m.fact.trim()],
                |_| Ok(()),
            )
            .optional()?
            .is_some();
        if !exists {
            conn.execute(
                "INSERT INTO character_memories (id, character_id, fact, source, created_at, updated_at, rev, device_id)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?5, 1, ?6)",
                params![new_id(), m.character, m.fact.trim(), format!("quest:{}", def.id), now, dev],
            )?;
            out.memories_added += 1;
        }
    }
    for p in &q.passport {
        let exists: bool = conn
            .query_row(
                "SELECT 1 FROM passport_entries WHERE ref=?1 AND kind=?2 AND deleted_at IS NULL",
                params![def.id, p.kind],
                |_| Ok(()),
            )
            .optional()?
            .is_some();
        if !exists {
            conn.execute(
                "INSERT INTO passport_entries (id, kind, title, detail, simulated, ref, created_at, updated_at, rev, device_id)
                 VALUES (?1, ?2, ?3, ?4, 1, ?5, ?6, ?6, 1, ?7)",
                params![new_id(), p.kind, p.title, p.detail, def.id, now, dev],
            )?;
            out.passport_added += 1;
        }
    }
    Ok(out)
}

#[derive(Debug, Serialize)]
pub struct QuestProgress {
    pub quest_id: String,
    pub completions: i64,
    pub best_score: i64,
    pub last_completed_at: Option<i64>,
}

pub fn quest_progress(conn: &Connection) -> Result<Vec<QuestProgress>> {
    let mut st = conn.prepare("SELECT quest_id, completions, best_score, last_completed_at FROM quest_progress")?;
    let v = st
        .query_map([], |r| Ok(QuestProgress { quest_id: r.get(0)?, completions: r.get(1)?, best_score: r.get(2)?, last_completed_at: r.get(3)? }))?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    Ok(v)
}

#[derive(Debug, Serialize)]
pub struct Memory {
    pub id: String,
    pub fact: String,
    pub source: String,
    pub created_at: i64,
}

#[derive(Debug, Serialize)]
pub struct CharacterState {
    pub id: String,
    pub relationship: i64,
    pub memories: Vec<Memory>,
}

pub fn characters(conn: &Connection) -> Result<Vec<CharacterState>> {
    let mut out = vec![];
    for c in CHARACTERS {
        let rel: i64 = conn
            .query_row("SELECT relationship FROM characters WHERE id=?1", [c], |r| r.get(0))
            .optional()?
            .unwrap_or(0);
        let mut st = conn.prepare(
            "SELECT id, fact, source, created_at FROM character_memories WHERE character_id=?1 AND deleted_at IS NULL ORDER BY created_at",
        )?;
        let memories = st
            .query_map([c], |r| Ok(Memory { id: r.get(0)?, fact: r.get(1)?, source: r.get(2)?, created_at: r.get(3)? }))?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        out.push(CharacterState { id: c.to_string(), relationship: rel, memories });
    }
    Ok(out)
}

pub fn delete_memory(conn: &Connection, dev: &str, id: &str) -> Result<()> {
    let now = now_ms();
    let n = conn.execute(
        "UPDATE character_memories SET deleted_at=?2, updated_at=?2, rev=rev+1, device_id=?3 WHERE id=?1 AND deleted_at IS NULL",
        params![id, now, dev],
    )?;
    if n == 0 {
        return Err(CoreError::NotFound(format!("memory {id}")));
    }
    Ok(())
}

#[derive(Debug, Serialize)]
pub struct PassportEntry {
    pub id: String,
    pub kind: String,
    pub title: String,
    pub detail: String,
    pub simulated: bool,
    pub created_at: i64,
}

pub fn passport(conn: &Connection) -> Result<Vec<PassportEntry>> {
    let mut st = conn.prepare(
        "SELECT id, kind, title, detail, simulated, created_at FROM passport_entries WHERE deleted_at IS NULL ORDER BY created_at DESC",
    )?;
    let v = st
        .query_map([], |r| {
            Ok(PassportEntry { id: r.get(0)?, kind: r.get(1)?, title: r.get(2)?, detail: r.get(3)?, simulated: r.get(4)?, created_at: r.get(5)? })
        })?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    Ok(v)
}

/// Self-reported real-world achievement (kept distinct from simulated ones).
pub fn add_real_passport(conn: &Connection, dev: &str, title: &str, detail: &str) -> Result<()> {
    if title.trim().is_empty() {
        return Err(CoreError::Invalid("title required".into()));
    }
    let now = now_ms();
    conn.execute(
        "INSERT INTO passport_entries (id, kind, title, detail, simulated, ref, created_at, updated_at, rev, device_id)
         VALUES (?1, 'real_world', ?2, ?3, 0, NULL, ?4, ?4, 1, ?5)",
        params![new_id(), title.trim(), detail.trim(), now, dev],
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::migrations;

    fn db() -> Connection {
        let mut c = Connection::open_in_memory().unwrap();
        migrations::migrate(&mut c).unwrap();
        ensure_characters(&c, "d").unwrap();
        c
    }

    #[test]
    fn level_curve() {
        assert_eq!(level_for_xp(0), 1);
        assert_eq!(level_for_xp(49), 1);
        assert_eq!(level_for_xp(50), 2);
        assert_eq!(level_for_xp(150), 3);
        assert_eq!(xp_for_level(10), 2250);
    }

    #[test]
    fn review_xp_once_per_card_per_day_and_capped() {
        let c = db();
        assert_eq!(award_review(&c, "d", "card1", 3, true, "2026-11-18").unwrap()[0].amount, REVIEW_XP_NEW);
        assert!(award_review(&c, "d", "card1", 3, false, "2026-11-18").unwrap().is_empty());
        assert_eq!(award_review(&c, "d", "card1", 1, false, "2026-11-19").unwrap()[0].amount, REVIEW_XP_AGAIN);
        for i in 0..200 {
            award_review(&c, "d", &format!("c{i}"), 3, false, "2026-11-20").unwrap();
        }
        assert_eq!(player_state(&c, "2026-11-20").unwrap().review_xp_today, REVIEW_XP_DAILY_CAP);
    }

    #[test]
    fn quest_rewards_first_time_then_small_daily_replay() {
        let c = db();
        let q = |success| QuestCompletion {
            quest_id: "konbini-first-purchase".into(),
            success,
            score: 90,
            started_at: 0,
            relationship: vec![("mika".into(), 50)],
            memories: vec![MemoryInput { character: "mika".into(), fact: "Likes horror games".into() }],
            passport: vec![PassportInput { kind: "purchase".into(), title: "Bought lunch".into(), detail: String::new() }],
            outcome: serde_json::json!({}),
        };
        assert!(complete_quest(&c, "d", q(false), "2026-11-18").unwrap().grants.is_empty());
        let r = complete_quest(&c, "d", q(true), "2026-11-18").unwrap();
        assert!(r.first_completion);
        assert_eq!(r.grants.len(), 2);
        assert_eq!(r.relationship_applied, vec![("mika".to_string(), 5)]); // clamped
        assert_eq!((r.memories_added, r.passport_added), (1, 1));
        // Same day replay: nothing.
        let r = complete_quest(&c, "d", q(true), "2026-11-18").unwrap();
        assert!(r.grants.is_empty() && r.memories_added == 0 && r.passport_added == 0);
        // Next day replay: quarter XP, no yen, no relationship.
        let r = complete_quest(&c, "d", q(true), "2026-11-19").unwrap();
        assert_eq!(r.grants, vec![Grant { currency: "xp".into(), amount: 10, reason: "quest_replay".into() }]);
        assert!(r.relationship_applied.is_empty());
        let p = player_state(&c, "2026-11-19").unwrap();
        assert_eq!((p.xp, p.yen), (50, 100));
        assert_eq!(characters(&c).unwrap().iter().find(|x| x.id == "mika").unwrap().relationship, 5);
    }

    #[test]
    fn unknown_quest_rejected() {
        let c = db();
        let q = QuestCompletion { quest_id: "free-money".into(), success: true, score: 100, started_at: 0, relationship: vec![], memories: vec![], passport: vec![], outcome: serde_json::json!({}) };
        assert!(complete_quest(&c, "d", q, "2026-11-18").is_err());
    }

    #[test]
    fn memories_can_be_deleted() {
        let c = db();
        let q = QuestCompletion {
            quest_id: "mika-weekend-plans".into(), success: true, score: 80, started_at: 0, relationship: vec![],
            memories: vec![MemoryInput { character: "mika".into(), fact: "Free on Saturday".into() }], passport: vec![], outcome: serde_json::json!({}),
        };
        complete_quest(&c, "d", q, "2026-11-18").unwrap();
        let id = characters(&c).unwrap().into_iter().find(|x| x.id == "mika").unwrap().memories[0].id.clone();
        delete_memory(&c, "d", &id).unwrap();
        assert!(characters(&c).unwrap().iter().all(|x| x.memories.is_empty()));
    }
}

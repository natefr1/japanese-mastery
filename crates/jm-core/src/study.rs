//! Study Center persistence: FSRS card state, append-only review history,
//! sessions, queue data and statistics.
//!
//! Scheduling itself is computed by ts-fsrs (a maintained FSRS implementation)
//! in the frontend's learning layer. This module stores the result atomically
//! together with the review log, and checks it for consistency. It never
//! invents scheduling values.

use crate::{game, new_id, now_ms, CoreError, Result};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

const NS: Uuid = Uuid::from_u128(0x9c1d_7e22_45af_4b60_a3e8_0f5b_6d27_c1e9);
pub const SKILLS_VOCAB: &[&str] = &["recognition", "production"];

pub fn card_id(item_type: &str, item_id: &str, skill: &str) -> String {
    Uuid::new_v5(&NS, format!("{item_type}|{item_id}|{skill}").as_bytes()).to_string()
}

const LIVE: &str = "((c.item_type='vocab' AND EXISTS (SELECT 1 FROM vocab_items v WHERE v.id=c.item_id AND v.deleted_at IS NULL))
  OR (c.item_type='grammar' AND EXISTS (SELECT 1 FROM grammar_points g WHERE g.id=c.item_id AND g.deleted_at IS NULL))
  OR (c.item_type='kanji' AND EXISTS (SELECT 1 FROM kanji k WHERE k.id=c.item_id AND k.deleted_at IS NULL)))
  AND c.deleted_at IS NULL";

/// Creates any missing cards (idempotent). New cards stay unintroduced until studied.
pub fn ensure_cards(conn: &Connection, dev: &str) -> Result<usize> {
    let now = now_ms();
    let mut pairs: Vec<(String, String, &str)> = vec![];
    {
        // Production cards only for words you could actually type (not grammar
        // fragments like 〜ねえ or labels with notes in parentheses).
        let mut st = conn.prepare("SELECT id, word FROM vocab_items WHERE deleted_at IS NULL")?;
        for row in st.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))? {
            let (id, word) = row?;
            for s in SKILLS_VOCAB {
                if *s == "production" && !producible(&word) {
                    continue;
                }
                pairs.push(("vocab".into(), id.clone(), s));
            }
        }
        let mut st = conn.prepare("SELECT id FROM grammar_points WHERE deleted_at IS NULL")?;
        for id in st.query_map([], |r| r.get::<_, String>(0))? {
            pairs.push(("grammar".into(), id?, "cloze"));
        }
        let mut st = conn.prepare("SELECT id FROM kanji WHERE deleted_at IS NULL")?;
        for id in st.query_map([], |r| r.get::<_, String>(0))? {
            pairs.push(("kanji".into(), id?, "recognition"));
        }
    }
    let mut ins = conn.prepare_cached(
        "INSERT OR IGNORE INTO cards (id, item_type, item_id, skill, due, created_at, updated_at, rev, device_id)
         VALUES (?1, ?2, ?3, ?4, ?5, ?5, ?5, 1, ?6)",
    )?;
    let mut n = 0;
    for (t, id, s) in pairs {
        n += ins.execute(params![card_id(&t, &id, s), t, id, s, now, dev])?;
    }
    Ok(n)
}

pub fn producible(word: &str) -> bool {
    !word.starts_with('〜') && !word.contains('(') && !word.contains('（')
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct CardRow {
    pub id: String,
    pub item_type: String,
    pub item_id: String,
    pub skill: String,
    pub due: i64,
    pub stability: f64,
    pub difficulty: f64,
    pub elapsed_days: i64,
    pub scheduled_days: i64,
    pub learning_steps: i64,
    pub reps: i64,
    pub lapses: i64,
    pub state: i64,
    pub last_review: Option<i64>,
    pub introduced_at: Option<i64>,
    pub suspended: bool,
    pub rev: i64,
}

const CARD_COLS: &str = "c.id, c.item_type, c.item_id, c.skill, c.due, c.stability, c.difficulty, c.elapsed_days,
  c.scheduled_days, c.learning_steps, c.reps, c.lapses, c.state, c.last_review, c.introduced_at, c.suspended, c.rev";

fn row(r: &rusqlite::Row) -> rusqlite::Result<CardRow> {
    Ok(CardRow {
        id: r.get(0)?,
        item_type: r.get(1)?,
        item_id: r.get(2)?,
        skill: r.get(3)?,
        due: r.get(4)?,
        stability: r.get(5)?,
        difficulty: r.get(6)?,
        elapsed_days: r.get(7)?,
        scheduled_days: r.get(8)?,
        learning_steps: r.get(9)?,
        reps: r.get(10)?,
        lapses: r.get(11)?,
        state: r.get(12)?,
        last_review: r.get(13)?,
        introduced_at: r.get(14)?,
        suspended: r.get(15)?,
        rev: r.get(16)?,
    })
}

fn query_cards(conn: &Connection, where_sql: &str, p: impl rusqlite::Params) -> Result<Vec<CardRow>> {
    let mut st = conn.prepare(&format!("SELECT {CARD_COLS} FROM cards c WHERE {LIVE} AND {where_sql}"))?;
    let v = st.query_map(p, row)?.collect::<std::result::Result<Vec<_>, _>>()?;
    Ok(v)
}

pub fn get_card(conn: &Connection, id: &str) -> Result<CardRow> {
    conn.query_row(&format!("SELECT {CARD_COLS} FROM cards c WHERE c.id=?1"), [id], row)
        .optional()?
        .ok_or_else(|| CoreError::NotFound(format!("card {id}")))
}

/// All live cards of one item type (for knowledge lookups such as reading coverage).
pub fn cards_of_type(conn: &Connection, item_type: &str) -> Result<Vec<CardRow>> {
    query_cards(conn, "c.item_type=?1", [item_type])
}

pub fn cards_for_item(conn: &Connection, item_type: &str, item_id: &str) -> Result<Vec<CardRow>> {
    query_cards(conn, "c.item_type=?1 AND c.item_id=?2", params![item_type, item_id])
}

#[derive(Debug, Serialize)]
pub struct QueueData {
    /// Introduced, unsuspended cards due now (plus a short learn-ahead window).
    pub due: Vec<CardRow>,
    /// Unintroduced cards that are eligible to be introduced.
    pub new_candidates: Vec<CardRow>,
    pub new_today: i64,
    pub reviews_today: i64,
    /// Share of non-Again answers on cards in Review state over the last 30 days.
    pub retention_30d: Option<f64>,
    pub retention_samples: i64,
    /// Median-ish average answer time per skill (ms), last 300 answers.
    pub avg_ms: Vec<(String, f64)>,
}

pub const LEARN_AHEAD_MS: i64 = 15 * 60 * 1000;

pub fn queue_data(conn: &Connection, now: i64, day_start: i64) -> Result<QueueData> {
    let due = query_cards(
        conn,
        "c.introduced_at IS NOT NULL AND c.suspended=0 AND c.due <= ?1 ORDER BY c.due",
        [now + LEARN_AHEAD_MS],
    )?;
    // Production of a word is only introduced after its recognition card has graduated
    // to Review state, so you never have to produce a word you've never seen.
    let new_candidates = query_cards(
        conn,
        "c.introduced_at IS NULL AND c.suspended=0 AND (
            c.skill <> 'production' OR EXISTS (
              SELECT 1 FROM cards r WHERE r.item_type=c.item_type AND r.item_id=c.item_id
                AND r.skill='recognition' AND r.state=2))
         ORDER BY c.created_at, c.rowid",
        [],
    )?;
    let one = |sql: &str, p: i64| -> Result<i64> { Ok(conn.query_row(sql, [p], |r| r.get(0))?) };
    let new_today = one("SELECT COUNT(*) FROM cards WHERE introduced_at >= ?1", day_start)?;
    let reviews_today = one("SELECT COUNT(*) FROM review_logs WHERE reviewed_at >= ?1", day_start)?;
    let (retention_30d, retention_samples) = retention_since(conn, now - 30 * 86_400_000, None)?;
    let mut st = conn.prepare(
        "SELECT c.skill, AVG(l.response_ms) FROM (SELECT * FROM review_logs WHERE response_ms IS NOT NULL ORDER BY reviewed_at DESC LIMIT 300) l
         JOIN cards c ON c.id = l.card_id GROUP BY c.skill",
    )?;
    let avg_ms = st.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?.collect::<std::result::Result<Vec<_>, _>>()?;
    Ok(QueueData { due, new_candidates, new_today, reviews_today, retention_30d, retention_samples, avg_ms })
}

fn retention_since(conn: &Connection, since: i64, filter: Option<(&str, &str)>) -> Result<(Option<f64>, i64)> {
    let (t, sk) = match filter {
        Some((t, s)) => (Some(t), Some(s)),
        None => (None, None),
    };
    let (n, ok): (i64, i64) = conn.query_row(
        "SELECT COUNT(*), COALESCE(SUM(CASE WHEN l.rating >= 2 THEN 1 ELSE 0 END), 0)
         FROM review_logs l JOIN cards c ON c.id = l.card_id
         WHERE l.state_before = 2 AND l.reviewed_at >= ?1 AND (?2 IS NULL OR (c.item_type = ?2 AND c.skill = ?3))",
        params![since, t, sk],
        |r| Ok((r.get(0)?, r.get(1)?)),
    )?;
    Ok((if n > 0 { Some(ok as f64 / n as f64) } else { None }, n))
}

/// The scheduler output for one answer, as computed by ts-fsrs.
#[derive(Debug, Clone, Deserialize)]
pub struct FsrsState {
    pub due: i64,
    pub stability: f64,
    pub difficulty: f64,
    pub elapsed_days: i64,
    pub scheduled_days: i64,
    pub learning_steps: i64,
    pub reps: i64,
    pub lapses: i64,
    pub state: i64,
    pub last_review: Option<i64>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ReviewSubmit {
    pub card_id: String,
    /// Card `rev` the scheduler computed from; rejects stale or duplicate submissions.
    pub expected_rev: i64,
    pub rating: i64,
    pub reviewed_at: i64,
    pub next: FsrsState,
    #[serde(default)]
    pub response_ms: Option<i64>,
    #[serde(default)]
    pub auto_correct: Option<bool>,
    #[serde(default)]
    pub answer: Option<String>,
    #[serde(default)]
    pub session_id: Option<String>,
    #[serde(default = "default_source")]
    pub source: String,
    pub day: String,
}
fn default_source() -> String {
    "review".into()
}

#[derive(Debug, Serialize)]
pub struct ReviewOutcome {
    pub card: CardRow,
    pub grants: Vec<game::Grant>,
}

fn validate(next: &FsrsState, rating: i64) -> Result<()> {
    let bad = |m: &str| Err(CoreError::Invalid(format!("rejected scheduler output: {m}")));
    if !(1..=4).contains(&rating) {
        return bad("rating must be 1-4");
    }
    if !(0..=3).contains(&next.state) {
        return bad("state out of range");
    }
    if !next.stability.is_finite() || next.stability < 0.0 || !next.difficulty.is_finite() || next.difficulty < 0.0 || next.difficulty > 10.0 {
        return bad("stability/difficulty out of range");
    }
    if next.due <= 0 || next.reps < 1 || next.lapses < 0 || next.scheduled_days < 0 {
        return bad("due/reps/lapses invalid");
    }
    Ok(())
}

pub fn submit_review(conn: &Connection, dev: &str, s: ReviewSubmit) -> Result<ReviewOutcome> {
    game::validate_day(&s.day)?;
    validate(&s.next, s.rating)?;
    let before = get_card(conn, &s.card_id)?;
    if before.rev != s.expected_rev {
        return Err(CoreError::Invalid("this card changed since it was loaded; reload the session".into()));
    }
    if s.next.reps != before.reps + 1 {
        return Err(CoreError::Invalid("rejected scheduler output: reps must increase by exactly 1".into()));
    }
    let was_new = before.introduced_at.is_none();
    let answer = s.answer.as_deref().map(|a| a.chars().take(200).collect::<String>());
    conn.execute(
        "INSERT INTO review_logs (id, card_id, rating, state_before, stability_before, difficulty_before, due_before,
            state_after, stability_after, difficulty_after, due_after, scheduled_days, elapsed_days, reviewed_at,
            response_ms, auto_correct, answer, session_id, source, device_id)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20)",
        params![
            new_id(), s.card_id, s.rating, before.state, before.stability, before.difficulty, before.due,
            s.next.state, s.next.stability, s.next.difficulty, s.next.due, s.next.scheduled_days, s.next.elapsed_days,
            s.reviewed_at, s.response_ms.map(|m| m.clamp(0, 600_000)), s.auto_correct, answer, s.session_id, s.source, dev
        ],
    )?;
    conn.execute(
        "UPDATE cards SET due=?2, stability=?3, difficulty=?4, elapsed_days=?5, scheduled_days=?6, learning_steps=?7,
            reps=?8, lapses=?9, state=?10, last_review=?11, introduced_at=COALESCE(introduced_at, ?12),
            updated_at=?13, rev=rev+1, device_id=?14
         WHERE id=?1",
        params![
            s.card_id, s.next.due, s.next.stability, s.next.difficulty, s.next.elapsed_days, s.next.scheduled_days,
            s.next.learning_steps, s.next.reps, s.next.lapses, s.next.state, s.next.last_review, s.reviewed_at,
            now_ms(), dev
        ],
    )?;
    let grants = if s.source == "review" {
        game::award_review(conn, dev, &s.card_id, s.rating, was_new, &s.day)?
    } else {
        vec![]
    };
    Ok(ReviewOutcome { card: get_card(conn, &s.card_id)?, grants })
}

pub fn set_suspended(conn: &Connection, dev: &str, id: &str, suspended: bool) -> Result<()> {
    let n = conn.execute(
        "UPDATE cards SET suspended=?2, updated_at=?3, rev=rev+1, device_id=?4 WHERE id=?1",
        params![id, suspended, now_ms(), dev],
    )?;
    if n == 0 {
        return Err(CoreError::NotFound(format!("card {id}")));
    }
    Ok(())
}

// ---------------- sessions ----------------

pub fn session_start(conn: &Connection, dev: &str, mode: &str, minutes: i64) -> Result<String> {
    let id = new_id();
    let now = now_ms();
    conn.execute(
        "INSERT INTO study_sessions (id, mode, planned_minutes, started_at, created_at, updated_at, rev, device_id)
         VALUES (?1, ?2, ?3, ?4, ?4, ?4, 1, ?5)",
        params![id, mode, minutes.clamp(1, 240), now, dev],
    )?;
    Ok(id)
}

#[derive(Debug, Serialize)]
pub struct SessionSummary {
    pub cards_done: i64,
    pub new_done: i64,
    pub again: i64,
    pub accuracy: Option<f64>,
    pub avg_ms: Option<f64>,
    pub grants: Vec<game::Grant>,
}

/// Ends a session. Counts come from the review log, not the client.
pub fn session_end(conn: &Connection, dev: &str, id: &str, day: &str, day_start: i64, daily_goal: i64) -> Result<SessionSummary> {
    game::validate_day(day)?;
    let (cards, again, avg): (i64, i64, Option<f64>) = conn.query_row(
        "SELECT COUNT(*), COALESCE(SUM(CASE WHEN rating=1 THEN 1 ELSE 0 END),0), AVG(response_ms) FROM review_logs WHERE session_id=?1",
        [id],
        |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
    )?;
    let new_done: i64 = conn.query_row(
        "SELECT COUNT(*) FROM review_logs WHERE session_id=?1 AND state_before=0",
        [id],
        |r| r.get(0),
    )?;
    let now = now_ms();
    let n = conn.execute(
        "UPDATE study_sessions SET ended_at=COALESCE(ended_at, ?2), cards_done=?3, new_done=?4, updated_at=?2, rev=rev+1, device_id=?5 WHERE id=?1",
        params![id, now, cards, new_done, dev],
    )?;
    if n == 0 {
        return Err(CoreError::NotFound(format!("session {id}")));
    }
    let mut grants = game::award_session(conn, dev, id, cards, day)?;
    grants.extend(game::check_daily_goal(conn, dev, day, day_start, daily_goal)?);
    Ok(SessionSummary {
        cards_done: cards,
        new_done,
        again,
        accuracy: if cards > 0 { Some((cards - again) as f64 / cards as f64) } else { None },
        avg_ms: avg,
        grants,
    })
}

// ---------------- statistics ----------------

#[derive(Debug, Serialize)]
pub struct SkillMastery {
    pub item_type: String,
    pub skill: String,
    pub total: i64,
    pub introduced: i64,
    pub learning: i64,
    /// In Review state with stability ≥ 7 days.
    pub known: i64,
    /// Stability ≥ 21 days.
    pub mature: i64,
    pub retention_30d: Option<f64>,
    pub retention_samples: i64,
}

#[derive(Debug, Serialize)]
pub struct DayCount {
    pub day_offset: i64, // 0 = today, -1 = yesterday...
    pub reviews: i64,
    pub again: i64,
}

#[derive(Debug, Serialize)]
pub struct WeakCard {
    pub card: CardRow,
    pub recent_again: i64,
}

#[derive(Debug, Serialize)]
pub struct Overview {
    pub due_now: i64,
    pub due_today: i64,
    pub new_available: i64,
    pub new_today: i64,
    pub reviews_today: i64,
    pub retention_30d: Option<f64>,
    pub retention_samples: i64,
    pub studied_days_last_7: Vec<bool>,
    pub forecast_14: Vec<i64>,
    pub mastery: Vec<SkillMastery>,
}

pub fn overview(conn: &Connection, now: i64, day_start: i64) -> Result<Overview> {
    const DAY: i64 = 86_400_000;
    let count = |where_sql: &str, p: &[&dyn rusqlite::ToSql]| -> Result<i64> {
        Ok(conn.query_row(&format!("SELECT COUNT(*) FROM cards c WHERE {LIVE} AND {where_sql}"), p, |r| r.get(0))?)
    };
    let intro = "c.introduced_at IS NOT NULL AND c.suspended=0";
    let due_now = count(&format!("{intro} AND c.due <= ?1"), &[&(now + LEARN_AHEAD_MS)])?;
    let due_today = count(&format!("{intro} AND c.due < ?1"), &[&(day_start + DAY)])?;
    let new_available = count("c.introduced_at IS NULL AND c.suspended=0", &[])?;
    let new_today: i64 = conn.query_row("SELECT COUNT(*) FROM cards WHERE introduced_at >= ?1", [day_start], |r| r.get(0))?;
    let reviews_today: i64 = conn.query_row("SELECT COUNT(*) FROM review_logs WHERE reviewed_at >= ?1", [day_start], |r| r.get(0))?;
    let mut studied = vec![];
    for i in (0..7).rev() {
        let s = day_start - i * DAY;
        let n: i64 = conn.query_row("SELECT COUNT(*) FROM review_logs WHERE reviewed_at >= ?1 AND reviewed_at < ?2", [s, s + DAY], |r| r.get(0))?;
        studied.push(n > 0);
    }
    let mut forecast = vec![];
    for i in 0..14 {
        let lo = if i == 0 { i64::MIN } else { day_start + i * DAY };
        forecast.push(count(&format!("{intro} AND c.due >= ?1 AND c.due < ?2"), &[&lo, &(day_start + (i + 1) * DAY)])?);
    }
    let (retention_30d, retention_samples) = retention_since(conn, now - 30 * DAY, None)?;
    let mut mastery = vec![];
    for (t, s) in [("vocab", "recognition"), ("vocab", "production"), ("grammar", "cloze"), ("kanji", "recognition")] {
        let base = format!("c.item_type='{t}' AND c.skill='{s}'");
        let (r30, rn) = retention_since(conn, now - 30 * DAY, Some((t, s)))?;
        mastery.push(SkillMastery {
            item_type: t.into(),
            skill: s.into(),
            total: count(&base, &[])?,
            introduced: count(&format!("{base} AND c.introduced_at IS NOT NULL"), &[])?,
            learning: count(&format!("{base} AND c.state IN (1,3)"), &[])?,
            known: count(&format!("{base} AND c.state=2 AND c.stability >= 7"), &[])?,
            mature: count(&format!("{base} AND c.stability >= 21"), &[])?,
            retention_30d: r30,
            retention_samples: rn,
        });
    }
    Ok(Overview { due_now, due_today, new_available, new_today, reviews_today, retention_30d, retention_samples, studied_days_last_7: studied, forecast_14: forecast, mastery })
}

#[derive(Debug, Serialize)]
pub struct StatsDetail {
    pub daily: Vec<DayCount>,
    pub weak: Vec<WeakCard>,
    pub avg_ms_by_skill: Vec<(String, f64)>,
    pub total_reviews: i64,
}

pub fn stats_detail(conn: &Connection, day_start: i64) -> Result<StatsDetail> {
    const DAY: i64 = 86_400_000;
    let mut daily = vec![];
    for i in (0..30).rev() {
        let s = day_start - i * DAY;
        let (n, a): (i64, i64) = conn.query_row(
            "SELECT COUNT(*), COALESCE(SUM(CASE WHEN rating=1 THEN 1 ELSE 0 END),0) FROM review_logs WHERE reviewed_at >= ?1 AND reviewed_at < ?2",
            [s, s + DAY],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )?;
        daily.push(DayCount { day_offset: -i, reviews: n, again: a });
    }
    // Weak = introduced cards you keep failing: lapses first, then recent Again count, then low stability.
    let mut st = conn.prepare(&format!(
        "SELECT {CARD_COLS}, (SELECT COUNT(*) FROM review_logs l WHERE l.card_id=c.id AND l.rating=1 AND l.reviewed_at >= ?1) AS ra
         FROM cards c WHERE {LIVE} AND c.introduced_at IS NOT NULL AND (c.lapses > 0 OR ra > 0)
         ORDER BY c.lapses DESC, ra DESC, c.stability ASC LIMIT 25"
    ))?;
    let weak = st
        .query_map([day_start - 14 * DAY], |r| Ok(WeakCard { card: row(r)?, recent_again: r.get(17)? }))?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    let mut st = conn.prepare(
        "SELECT c.skill, AVG(l.response_ms) FROM review_logs l JOIN cards c ON c.id=l.card_id WHERE l.response_ms IS NOT NULL GROUP BY c.skill",
    )?;
    let avg_ms_by_skill = st.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?.collect::<std::result::Result<Vec<_>, _>>()?;
    let total_reviews = conn.query_row("SELECT COUNT(*) FROM review_logs", [], |r| r.get(0))?;
    Ok(StatsDetail { daily, weak, avg_ms_by_skill, total_reviews })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{content, migrations, seed};

    fn db() -> Connection {
        let mut c = Connection::open_in_memory().unwrap();
        migrations::migrate(&mut c).unwrap();
        seed::apply(&c, "d").unwrap();
        content::apply_grammar_seed(&c, "d").unwrap();
        content::apply_kanji_seed(&c, "d").unwrap();
        game::ensure_characters(&c, "d").unwrap();
        ensure_cards(&c, "d").unwrap();
        c
    }

    fn next(reps: i64, state: i64, due: i64) -> FsrsState {
        FsrsState { due, stability: 3.2, difficulty: 5.1, elapsed_days: 0, scheduled_days: 3, learning_steps: 0, reps, lapses: 0, state, last_review: Some(1) }
    }

    fn submit(c: &Connection, card: &CardRow, rating: i64, state: i64, due: i64) -> ReviewOutcome {
        submit_review(c, "d", ReviewSubmit {
            card_id: card.id.clone(), expected_rev: card.rev, rating, reviewed_at: now_ms(), next: next(card.reps + 1, state, due),
            response_ms: Some(2500), auto_correct: None, answer: None, session_id: Some("s1".into()), source: "review".into(), day: "2026-11-18".into(),
        }).unwrap()
    }

    #[test]
    fn ensure_cards_is_idempotent_and_ids_deterministic() {
        let c = db();
        assert_eq!(ensure_cards(&c, "d").unwrap(), 0);
        let total: i64 = c.query_row("SELECT COUNT(*) FROM cards", [], |r| r.get(0)).unwrap();
        let grammar: i64 = c.query_row("SELECT COUNT(*) FROM grammar_points", [], |r| r.get(0)).unwrap();
        let kanji: i64 = c.query_row("SELECT COUNT(*) FROM kanji", [], |r| r.get(0)).unwrap();
        let vocab: i64 = c.query_row("SELECT COUNT(*) FROM vocab_items", [], |r| r.get(0)).unwrap();
        let producible: i64 = c.query_row("SELECT COUNT(*) FROM vocab_items WHERE word NOT LIKE '〜%' AND instr(word, '(') = 0", [], |r| r.get(0)).unwrap();
        assert_eq!(total, vocab + producible + grammar + kanji);
        let v = crate::vocab::list(&c).unwrap();
        assert_eq!(cards_for_item(&c, "vocab", &v[0].id).unwrap().len(), 2);
        assert!(cards_for_item(&c, "vocab", &v[0].id).unwrap().iter().any(|x| x.id == card_id("vocab", &v[0].id, "production")));
    }

    #[test]
    fn production_waits_for_recognition_to_graduate() {
        let c = db();
        let q = queue_data(&c, now_ms(), 0).unwrap();
        assert!(q.new_candidates.iter().all(|x| x.skill != "production"));
        let rec = q.new_candidates.iter().find(|x| x.item_type == "vocab").unwrap().clone();
        submit(&c, &rec, 3, 2, now_ms() + 86_400_000);
        let q = queue_data(&c, now_ms(), 0).unwrap();
        assert!(q.new_candidates.iter().any(|x| x.skill == "production" && x.item_id == rec.item_id));
    }

    #[test]
    fn review_updates_card_logs_history_and_awards_once() {
        let c = db();
        let card = queue_data(&c, now_ms(), 0).unwrap().new_candidates[0].clone();
        let out = submit(&c, &card, 3, 1, now_ms() - 1000);
        assert_eq!(out.card.reps, 1);
        assert!(out.card.introduced_at.is_some());
        assert_eq!(out.grants[0].amount, game::REVIEW_XP_NEW);
        // Learning card is due again now and appears in the due queue.
        let q = queue_data(&c, now_ms(), 0).unwrap();
        assert!(q.due.iter().any(|x| x.id == card.id));
        assert_eq!(q.new_today, 1);
        // Second answer same day: logged, no extra XP.
        let out2 = submit(&c, &out.card, 3, 2, now_ms() + 3 * 86_400_000);
        assert!(out2.grants.is_empty());
        let logs: i64 = c.query_row("SELECT COUNT(*) FROM review_logs WHERE card_id=?1", [&card.id], |r| r.get(0)).unwrap();
        assert_eq!(logs, 2);
    }

    #[test]
    fn stale_or_invalid_submissions_rejected() {
        let c = db();
        let card = queue_data(&c, now_ms(), 0).unwrap().new_candidates[0].clone();
        submit(&c, &card, 3, 1, now_ms());
        // Same stale rev again (double click) is rejected, not double-counted.
        let dup = submit_review(&c, "d", ReviewSubmit {
            card_id: card.id.clone(), expected_rev: card.rev, rating: 3, reviewed_at: now_ms(), next: next(1, 1, now_ms()),
            response_ms: None, auto_correct: None, answer: None, session_id: None, source: "review".into(), day: "2026-11-18".into(),
        });
        assert!(dup.is_err());
        let fresh = get_card(&c, &card.id).unwrap();
        let mut bad = next(fresh.reps + 1, 2, now_ms());
        bad.difficulty = 42.0;
        assert!(submit_review(&c, "d", ReviewSubmit {
            card_id: card.id.clone(), expected_rev: fresh.rev, rating: 3, reviewed_at: now_ms(), next: bad,
            response_ms: None, auto_correct: None, answer: None, session_id: None, source: "review".into(), day: "2026-11-18".into(),
        }).is_err());
    }

    #[test]
    fn session_summary_counts_from_logs_and_overview_works() {
        let c = db();
        let id = session_start(&c, "d", "quick", 5).unwrap();
        let cands = queue_data(&c, now_ms(), 0).unwrap().new_candidates;
        for card in cands.iter().take(12) {
            submit_review(&c, "d", ReviewSubmit {
                card_id: card.id.clone(), expected_rev: card.rev, rating: 3, reviewed_at: now_ms(), next: next(1, 1, now_ms() + 600_000),
                response_ms: Some(3000), auto_correct: Some(true), answer: Some("x".into()), session_id: Some(id.clone()), source: "review".into(), day: "2026-11-18".into(),
            }).unwrap();
        }
        let s = session_end(&c, "d", &id, "2026-11-18", 0, 10).unwrap();
        assert_eq!((s.cards_done, s.new_done), (12, 12));
        // session bonus + daily goal xp + daily goal yen
        assert_eq!(s.grants.len(), 3);
        let o = overview(&c, now_ms(), 0).unwrap();
        assert_eq!(o.new_today, 12);
        assert_eq!(o.forecast_14.len(), 14);
        assert_eq!(o.mastery.len(), 4);
        assert!(stats_detail(&c, 0).unwrap().total_reviews >= 12);
    }
}

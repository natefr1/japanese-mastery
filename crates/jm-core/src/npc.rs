//! NPC profiles, relationship state, the per-character formality model and the
//! social graph. Profiles are seeded data; state evolves through interactions.

use crate::{now_ms, CoreError, Result};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::sync::OnceLock;

const NPC_JSON: &str = include_str!("../seed/npc_v1.json");
const STICKER_JSON: &str = include_str!("../seed/stickers_v1.json");

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Speech {
    pub first_person: String,
    pub register_start: u8,
    pub register_max: u8,
    pub thresholds: Vec<f64>,
    pub group_offset: i8,
    pub length: String,
    pub bubbles: [u8; 2],
    pub emoji_rate: f64,
    pub emoji: Vec<String>,
    pub sticker_rate: f64,
    pub sticker_packs: Vec<String>,
    pub laugh: String,
    pub quirks: Vec<String>,
    pub avoid: Vec<String>,
    pub examples: std::collections::BTreeMap<String, Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BusyBlock {
    pub days: Vec<u8>, // 0 = Sunday
    pub from: u8,
    pub to: u8,
    pub label: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Behavior {
    pub reply_engaged: [u32; 2],
    pub reply_idle: [u32; 2],
    pub typing_cps: f64,
    pub read_only_rate: f64,
    pub initiative_per_day: f64,
    /// Local-hour windows; values above 24 mean "after midnight" (26 = 2am).
    pub active_hours: Vec<[u8; 2]>,
    pub question_rate: f64,
    pub busy: Vec<BusyBlock>,
    pub checkin_after_days: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Opening {
    #[serde(default)]
    pub from: Option<String>,
    #[serde(rename = "type")]
    pub kind: String,
    #[serde(default)]
    pub text: Option<String>,
    #[serde(default)]
    pub id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Profile {
    pub id: String,
    pub name: String,
    pub display: String,
    pub full_name: String,
    pub age: u8,
    pub color: String,
    pub role: String,
    pub bio: String,
    pub personality: Vec<String>,
    pub interests: Vec<String>,
    pub dislikes: Vec<String>,
    pub speech: Speech,
    pub behavior: Behavior,
    pub opening: Vec<Opening>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GroupSeed {
    pub id: String,
    pub title: String,
    pub avatar: String,
    pub members: Vec<String>,
    pub opening: Vec<Opening>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RelationSeed {
    pub a: String,
    pub b: String,
    pub kind: String,
    pub closeness: i64,
    pub note: String,
}

#[derive(Debug, Clone, Deserialize)]
struct NpcFile {
    characters: Vec<Profile>,
    groups: Vec<GroupSeed>,
    relations: Vec<RelationSeed>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Sticker {
    pub id: String,
    pub caption: String,
    pub meaning: String,
    pub face: String,
    pub prop: String,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StickerPack {
    pub id: String,
    pub name: String,
    pub price_yen: i64,
    pub stickers: Vec<Sticker>,
}
#[derive(Debug, Clone, Deserialize)]
struct StickerFile {
    packs: Vec<StickerPack>,
}

fn data() -> &'static NpcFile {
    static D: OnceLock<NpcFile> = OnceLock::new();
    D.get_or_init(|| serde_json::from_str(NPC_JSON).expect("npc_v1.json is valid"))
}
pub fn profiles() -> &'static [Profile] {
    &data().characters
}
pub fn profile(id: &str) -> Option<&'static Profile> {
    profiles().iter().find(|p| p.id == id)
}
pub fn groups() -> &'static [GroupSeed] {
    &data().groups
}
pub fn relations() -> &'static [RelationSeed] {
    &data().relations
}
pub fn sticker_packs() -> &'static [StickerPack] {
    static S: OnceLock<Vec<StickerPack>> = OnceLock::new();
    S.get_or_init(|| serde_json::from_str::<StickerFile>(STICKER_JSON).expect("stickers_v1.json is valid").packs)
}
pub fn sticker(id: &str) -> Option<&'static Sticker> {
    sticker_packs().iter().flat_map(|p| p.stickers.iter()).find(|s| s.id == id)
}

// ---------------- relationship state ----------------

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
pub struct NpcState {
    pub character_id: String,
    pub closeness: f64,
    pub trust: f64,
    pub shared_experiences: i64,
    pub meaningful_days: i64,
    pub last_meaningful_day: Option<String>,
    pub last_player_msg_at: Option<i64>,
    pub last_npc_msg_at: Option<i64>,
    pub last_initiated_at: Option<i64>,
}

impl NpcState {
    /// 0..100 combined relationship score used by the register model.
    pub fn score(&self) -> f64 {
        let s = 0.5 * self.closeness + 0.3 * self.trust + (self.shared_experiences as f64 * 4.0).min(20.0) + (self.meaningful_days as f64).min(10.0);
        s.clamp(0.0, 100.0)
    }
}

/// Register (formality) stage for a character given the relationship and context.
/// Each character has its own start, ceiling, thresholds and group behaviour, so
/// there is no single "N messages → casual" rule.
pub fn register_stage(p: &Profile, st: &NpcState, in_group: bool) -> u8 {
    let score = st.score();
    let mut stage = p.speech.register_start;
    for s in (p.speech.register_start + 1)..=p.speech.register_max {
        match p.speech.thresholds.get(s as usize) {
            Some(t) if score >= *t => stage = s,
            _ => break,
        }
    }
    if in_group {
        let g = stage as i16 + p.speech.group_offset as i16;
        stage = g.clamp(0, 3) as u8;
    }
    stage
}

pub fn register_label(stage: u8) -> &'static str {
    match stage {
        0 => "polite: です/ます, no slang, considerate and complete sentences",
        1 => "polite but warm: mostly です/ます with friendly softeners, occasional casual endings",
        2 => "casual (タメ口): plain forms, natural contractions, relaxed",
        _ => "close casual: plain forms, jokes, shorthand and teasing where it fits the person",
    }
}

const STATE_COLS: &str = "character_id, closeness, trust, shared_experiences, meaningful_days, last_meaningful_day, last_player_msg_at, last_npc_msg_at, last_initiated_at";

fn row_state(r: &rusqlite::Row) -> rusqlite::Result<NpcState> {
    Ok(NpcState {
        character_id: r.get(0)?,
        closeness: r.get(1)?,
        trust: r.get(2)?,
        shared_experiences: r.get(3)?,
        meaningful_days: r.get(4)?,
        last_meaningful_day: r.get(5)?,
        last_player_msg_at: r.get(6)?,
        last_npc_msg_at: r.get(7)?,
        last_initiated_at: r.get(8)?,
    })
}

pub fn get_state(conn: &Connection, id: &str) -> Result<NpcState> {
    conn.query_row(&format!("SELECT {STATE_COLS} FROM npc_state WHERE character_id=?1"), [id], row_state)
        .optional()?
        .ok_or_else(|| CoreError::NotFound(format!("npc {id}")))
}

pub fn all_states(conn: &Connection) -> Result<Vec<NpcState>> {
    let mut st = conn.prepare(&format!("SELECT {STATE_COLS} FROM npc_state ORDER BY character_id"))?;
    let v = st.query_map([], row_state)?.collect::<std::result::Result<Vec<_>, _>>()?;
    Ok(v)
}

#[derive(Debug, Clone, Deserialize, Default)]
pub struct RelDelta {
    #[serde(default)]
    pub closeness: f64,
    #[serde(default)]
    pub trust: f64,
    #[serde(default)]
    pub shared_experience: bool,
}

pub const MAX_REL_UPDATES_PER_DAY: i64 = 6;

/// Applies a bounded relationship change from a meaningful interaction.
/// Deltas are clamped and rate-limited per day; grammar plays no part.
pub fn apply_delta(conn: &Connection, dev: &str, id: &str, d: &RelDelta, day: &str) -> Result<bool> {
    let (upd_day, count): (Option<String>, i64) =
        conn.query_row("SELECT rel_updates_day, rel_updates_count FROM npc_state WHERE character_id=?1", [id], |r| Ok((r.get(0)?, r.get(1)?)))?;
    let count = if upd_day.as_deref() == Some(day) { count } else { 0 };
    if count >= MAX_REL_UPDATES_PER_DAY {
        return Ok(false);
    }
    let c = d.closeness.clamp(-3.0, 2.0);
    let t = d.trust.clamp(-3.0, 2.0);
    let now = now_ms();
    conn.execute(
        "UPDATE npc_state SET closeness = MIN(100, MAX(0, closeness + ?2)), trust = MIN(100, MAX(0, trust + ?3)),
            shared_experiences = shared_experiences + ?4,
            meaningful_days = meaningful_days + CASE WHEN last_meaningful_day IS ?5 THEN 0 ELSE 1 END,
            last_meaningful_day = ?5, rel_updates_day = ?5, rel_updates_count = ?6,
            updated_at = ?7, rev = rev + 1, device_id = ?8
         WHERE character_id = ?1",
        params![id, c, t, d.shared_experience as i64, day, count + 1, now, dev],
    )?;
    Ok(true)
}

pub fn touch(conn: &Connection, id: &str, player: bool, initiated: bool, at: i64) -> Result<()> {
    let col = if player { "last_player_msg_at" } else { "last_npc_msg_at" };
    conn.execute(&format!("UPDATE npc_state SET {col} = ?2, updated_at = ?2 WHERE character_id = ?1"), params![id, at])?;
    if initiated {
        conn.execute("UPDATE npc_state SET last_initiated_at = ?2 WHERE character_id = ?1", params![id, at])?;
    }
    Ok(())
}

/// Migrates the old single friendship number (M2 quests) into the new model.
pub fn seed(conn: &Connection, dev: &str) -> Result<()> {
    let now = now_ms();
    for p in profiles() {
        let legacy: i64 = conn
            .query_row("SELECT relationship FROM characters WHERE id=?1", [&p.id], |r| r.get(0))
            .optional()?
            .unwrap_or(0);
        conn.execute(
            "INSERT OR IGNORE INTO npc_state (character_id, closeness, trust, created_at, updated_at, rev, device_id)
             VALUES (?1, ?2, ?3, ?4, ?4, 1, ?5)",
            params![p.id, (legacy as f64 * 2.0).min(30.0), (legacy as f64).min(20.0), now, dev],
        )?;
    }
    for r in relations() {
        conn.execute(
            "INSERT OR IGNORE INTO npc_relations (a, b, kind, closeness, note) VALUES (?1, ?2, ?3, ?4, ?5)",
            params![r.a, r.b, r.kind, r.closeness, r.note],
        )?;
    }
    conn.execute("INSERT OR IGNORE INTO sticker_owned (pack_id, source, created_at) VALUES ('mochi','default',?1), ('tora','default',?1)", [now])?;
    Ok(())
}

/// Relations of one character (for prompts: "who you know").
pub fn relations_of(id: &str) -> Vec<(&'static Profile, &'static RelationSeed)> {
    relations()
        .iter()
        .filter_map(|r| {
            let other = if r.a == id { &r.b } else if r.b == id { &r.a } else { return None };
            profile(other).map(|p| (p, r))
        })
        .collect()
}

/// Whether the character is in one of their active windows at this local hour.
pub fn is_active(p: &Profile, hour: u8) -> bool {
    p.behavior.active_hours.iter().any(|[s, e]| (hour >= *s && hour < *e) || (hour + 24 >= *s && hour + 24 < *e))
}

/// What the character is busy with at this local weekday/hour, if anything.
pub fn busy_with(p: &Profile, weekday: u8, hour: u8) -> Option<&str> {
    p.behavior.busy.iter().find(|b| b.days.contains(&weekday) && hour >= b.from && hour < b.to).map(|b| b.label.as_str())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::migrations;

    fn st(c: f64, t: f64, shared: i64, days: i64) -> NpcState {
        NpcState { closeness: c, trust: t, shared_experiences: shared, meaningful_days: days, ..Default::default() }
    }

    #[test]
    fn eight_distinct_characters() {
        assert!(profiles().len() >= 8);
        let mut ids: Vec<_> = profiles().iter().map(|p| &p.id).collect();
        ids.dedup();
        assert_eq!(ids.len(), profiles().len());
        // Starting formality genuinely differs: some casual, some polite.
        assert!(profiles().iter().any(|p| p.speech.register_start == 0));
        assert!(profiles().iter().any(|p| p.speech.register_start >= 2));
        // Distinct texting habits.
        let emoji: Vec<_> = profiles().iter().map(|p| (p.speech.emoji_rate * 100.0) as i64).collect();
        assert!(emoji.iter().max().unwrap() - emoji.iter().min().unwrap() >= 30);
        for p in profiles() {
            for pack in &p.speech.sticker_packs {
                assert!(sticker_packs().iter().any(|s| &s.id == pack), "{} uses unknown pack {pack}", p.id);
            }
            assert!(!p.opening.is_empty());
        }
    }

    #[test]
    fn formality_depends_on_person_relationship_and_context() {
        let ren = profile("ren").unwrap();
        let chihiro = profile("chihiro").unwrap();
        let haruto = profile("haruto").unwrap();
        let aoi = profile("aoi").unwrap();
        let stranger = st(0.0, 0.0, 0, 0);
        let friend = st(80.0, 70.0, 4, 10);
        assert_eq!(register_stage(ren, &stranger, false), 0);
        assert_eq!(register_stage(ren, &friend, false), 2);
        assert_eq!(register_stage(ren, &friend, true), 1, "Ren is more reserved in groups");
        assert_eq!(register_stage(chihiro, &friend, false), 1, "Chihiro stays polite indefinitely");
        assert_eq!(register_stage(haruto, &stranger, false), 2, "Haruto is casual from the start");
        assert_eq!(register_stage(aoi, &friend, true), 0, "Aoi stays polite in groups");
        // Many messages alone don't make anyone casual: only score dimensions count.
        let chatty_but_shallow = st(10.0, 5.0, 0, 2);
        assert_eq!(register_stage(ren, &chatty_but_shallow, false), 0);
    }

    #[test]
    fn deltas_are_clamped_and_rate_limited() {
        let mut c = Connection::open_in_memory().unwrap();
        migrations::migrate(&mut c).unwrap();
        crate::game::ensure_characters(&c, "d").unwrap();
        seed(&c, "d").unwrap();
        let big = RelDelta { closeness: 50.0, trust: 50.0, shared_experience: true };
        assert!(apply_delta(&c, "d", "ren", &big, "2026-11-18").unwrap());
        let s = get_state(&c, "ren").unwrap();
        assert_eq!((s.closeness, s.trust, s.shared_experiences, s.meaningful_days), (2.0, 2.0, 1, 1));
        for _ in 0..10 {
            apply_delta(&c, "d", "ren", &big, "2026-11-18").unwrap();
        }
        let s = get_state(&c, "ren").unwrap();
        assert_eq!(s.closeness, 2.0 * MAX_REL_UPDATES_PER_DAY as f64);
        assert_eq!(s.meaningful_days, 1, "one meaningful day, however many messages");
    }

    #[test]
    fn schedules() {
        let h = profile("haruto").unwrap();
        assert!(is_active(h, 20));
        assert!(is_active(h, 1), "26 means 2am");
        assert!(!is_active(h, 8));
        assert_eq!(busy_with(h, 1, 10), Some("大学の授業"));
        assert_eq!(busy_with(h, 0, 10), None);
    }
}

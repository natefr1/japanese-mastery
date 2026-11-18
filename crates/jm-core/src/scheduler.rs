//! Background NPC activity: who (if anyone) starts a conversation, and when.
//! Bounded on purpose: quiet hours, per-character spacing, a global daily cap,
//! a minimum gap between any two initiations, no double-texting, deduped events.
//! Decisions are pure so they can be tested; persistence is in small helpers.

use crate::chat::{self, PLAYER};
use crate::npc::{self, Profile};
use crate::prompt::{Rng, WorldTime};
use crate::{new_id, now_ms, Result};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct SocialSettings {
    pub background: bool,
    pub quiet_start: u8,
    pub quiet_end: u8,
    pub max_initiations_per_day: i64,
    pub min_gap_minutes: i64,
    pub daily_ai_budget: i64,
    pub background_ai_budget: i64,
    pub group_activity: bool,
}

impl Default for SocialSettings {
    fn default() -> Self {
        SocialSettings { background: true, quiet_start: 23, quiet_end: 8, max_initiations_per_day: 4, min_gap_minutes: 60, daily_ai_budget: 200, background_ai_budget: 20, group_activity: true }
    }
}

pub fn in_quiet_hours(cfg: &SocialSettings, hour: u8) -> bool {
    if cfg.quiet_start == cfg.quiet_end {
        return false;
    }
    if cfg.quiet_start < cfg.quiet_end {
        hour >= cfg.quiet_start && hour < cfg.quiet_end
    } else {
        hour >= cfg.quiet_start || hour < cfg.quiet_end
    }
}

#[derive(Debug, Clone)]
pub struct Candidate {
    pub profile: &'static Profile,
    pub last_player_msg_at: Option<i64>,
    pub last_initiated_at: Option<i64>,
    /// The latest visible message in the DM was sent by the NPC and is unanswered.
    pub awaiting_player: bool,
    pub last_dm_at: Option<i64>,
    /// Something is already scheduled/pending in this DM.
    pub busy_thread: bool,
    /// (calendar event id, "title when") of a recent plan with this person not yet followed up.
    pub upcoming_plan: Option<(String, String)>,
}

#[derive(Debug, Clone)]
pub struct Global {
    pub initiations_today: i64,
    pub last_initiation_at: Option<i64>,
    pub background_requests_today: i64,
    pub requests_today: i64,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Decision {
    pub character: String,
    pub conversation_id: String,
    pub kind: String, // initiate | group_topic
    pub reason: String,
    pub dedupe_key: String,
}

pub const TICK_MINUTES: f64 = 5.0;
const HOUR: i64 = 3_600_000;

fn active_ticks_per_day(p: &Profile) -> f64 {
    let hours: f64 = p.behavior.active_hours.iter().map(|[s, e]| (*e as f64 - *s as f64).max(0.0)).sum();
    (hours * 60.0 / TICK_MINUTES).max(1.0)
}

/// Decides at most one initiation for this tick.
pub fn decide(world: &WorldTime, day: &str, now: i64, cands: &[Candidate], groups: &[(String, Vec<&'static Profile>, bool)], g: &Global, cfg: &SocialSettings, rng: &mut Rng) -> Option<Decision> {
    if !cfg.background || in_quiet_hours(cfg, world.hour) {
        return None;
    }
    if g.initiations_today >= cfg.max_initiations_per_day || g.background_requests_today >= cfg.background_ai_budget || g.requests_today >= cfg.daily_ai_budget {
        return None;
    }
    if let Some(t) = g.last_initiation_at {
        if now - t < cfg.min_gap_minutes * 60_000 {
            return None;
        }
    }
    let mut options: Vec<(f64, Decision)> = vec![];
    for c in cands {
        let p = c.profile;
        if !npc::is_active(p, world.hour) || npc::busy_with(p, world.weekday, world.hour).is_some() || c.busy_thread {
            continue;
        }
        // Talking right now? Then it isn't an "initiation".
        if c.last_player_msg_at.map_or(false, |t| now - t < HOUR / 2) || c.last_dm_at.map_or(false, |t| now - t < HOUR) {
            continue;
        }
        let min_gap = ((24.0 / p.behavior.initiative_per_day.max(0.05)) * 0.5 * HOUR as f64) as i64;
        if c.last_initiated_at.map_or(false, |t| now - t < min_gap.max(6 * HOUR)) {
            continue;
        }
        let silence_days = c.last_dm_at.map(|t| (now - t) as f64 / (24.0 * HOUR as f64)).unwrap_or(99.0);
        let mut p_tick = p.behavior.initiative_per_day / active_ticks_per_day(p);
        let mut reason = String::new();
        let mut key = format!("init:{}:{}:{}", p.id, day, world.hour / 3);
        if let Some((plan_id, plan)) = &c.upcoming_plan {
            p_tick *= 6.0;
            reason = format!("follow up on your plan with the player: {plan}");
            key = format!("plan:{plan_id}");
        } else if let Some(days) = p.behavior.checkin_after_days {
            if silence_days >= days as f64 {
                p_tick *= 3.0;
                reason = format!("you haven't talked in about {} days; check in naturally (in your own style)", silence_days.floor());
            }
        }
        if c.awaiting_player {
            // No double-texting, except one natural nudge after a long silence for people who would.
            let nudge = p.behavior.checkin_after_days.map_or(false, |d| silence_days >= (d * 2) as f64);
            if !nudge {
                continue;
            }
            reason = "your last message was never answered; one light, natural nudge (no guilt-tripping)".into();
        }
        if reason.is_empty() {
            reason = match (world.hour, p.interests.first()) {
                (18..=22, Some(i)) if p.interests.iter().any(|x| x.contains("game")) => format!("it's evening; you feel like playing or talking about {i}"),
                (_, Some(i)) => format!("something related to your life or interests ({i}) is on your mind and you want to share or ask"),
                _ => "you want to chat".into(),
            };
        }
        let roll = rng.next_f64();
        if roll < p_tick {
            options.push((roll / p_tick, Decision {
                character: p.id.clone(),
                conversation_id: chat::dm_id(&p.id),
                kind: "initiate".into(),
                reason,
                dedupe_key: key,
            }));
        }
    }
    if cfg.group_activity {
        for (gid, members, quiet_thread) in groups {
            if *quiet_thread {
                continue;
            }
            let active: Vec<_> = members.iter().filter(|p| npc::is_active(p, world.hour) && npc::busy_with(p, world.weekday, world.hour).is_none()).collect();
            if active.len() < 2 {
                continue;
            }
            let opener = active[(rng.next_f64() * active.len() as f64) as usize % active.len()];
            let p_tick = 0.6 / 120.0; // about once every couple of active days
            let roll = rng.next_f64();
            if roll < p_tick {
                options.push((roll / p_tick, Decision {
                    character: opener.id.clone(),
                    conversation_id: gid.clone(),
                    kind: "group_topic".into(),
                    reason: "share something or suggest an activity the group would plausibly do this week".into(),
                    dedupe_key: format!("group:{gid}:{day}"),
                }));
            }
        }
    }
    options.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap_or(std::cmp::Ordering::Equal));
    options.into_iter().next().map(|(_, d)| d)
}

// ---------------- gathering state from the DB ----------------

pub fn gather(conn: &Connection, now: i64) -> Result<(Vec<Candidate>, Vec<(String, Vec<&'static Profile>, bool)>)> {
    let mut cands = vec![];
    for p in npc::profiles() {
        let st = npc::get_state(conn, &p.id)?;
        let conv = chat::dm_id(&p.id);
        let last = chat::recent(conn, &conv, now, 1)?.pop();
        let busy_thread = chat::has_scheduled(conn, &conv)? || !chat::pending_player_messages(conn, &conv)?.is_empty();
        let upcoming_plan: Option<(String, String)> = conn
            .query_row(
                "SELECT id, title || ' ' || when_text FROM calendar_events WHERE status='planned' AND deleted_at IS NULL AND participants LIKE ?1
                 AND created_at > ?2 AND NOT EXISTS (SELECT 1 FROM npc_events e WHERE e.dedupe_key = 'plan:' || calendar_events.id) LIMIT 1",
                params![format!("%\"{}\"%", p.id), now - 7 * 24 * HOUR],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()?;
        cands.push(Candidate {
            profile: p,
            last_player_msg_at: st.last_player_msg_at,
            last_initiated_at: st.last_initiated_at,
            awaiting_player: last.as_ref().map_or(false, |m| m.sender_id != PLAYER),
            last_dm_at: last.map(|m| m.deliver_at),
            busy_thread,
            upcoming_plan,
        });
    }
    let mut groups = vec![];
    for g in npc::groups() {
        let members: Vec<&'static Profile> = g.members.iter().filter_map(|m| npc::profile(m)).collect();
        let last = chat::recent(conn, &g.id, now, 1)?.pop();
        // Don't open a new topic if the group already has unanswered NPC chatter or recent activity.
        let quiet_thread = chat::has_scheduled(conn, &g.id)? || last.map_or(false, |m| m.sender_id != PLAYER && now - m.deliver_at < 24 * HOUR || now - m.deliver_at < 3 * HOUR);
        groups.push((g.id.clone(), members, quiet_thread));
    }
    Ok((cands, groups))
}

pub fn global(conn: &Connection, day: &str, day_start: i64) -> Result<Global> {
    let (n, last): (i64, Option<i64>) = conn.query_row(
        "SELECT COUNT(*), MAX(created_at) FROM npc_events WHERE status IN ('pending','done') AND created_at >= ?1",
        [day_start],
        |r| Ok((r.get(0)?, r.get(1)?)),
    )?;
    let u = chat::usage(conn, day)?;
    Ok(Global { initiations_today: n, last_initiation_at: last, background_requests_today: u.background_requests, requests_today: u.requests })
}

// ---------------- event records ----------------

#[derive(Debug, Clone, Serialize)]
pub struct Event {
    pub id: String,
    pub character_id: String,
    pub conversation_id: String,
    pub kind: String,
    pub reason: String,
    pub attempts: i64,
}

/// Records a decision; returns None if an identical event already exists (dedupe).
pub fn record(conn: &Connection, d: &Decision, now: i64) -> Result<Option<Event>> {
    let id = new_id();
    let n = conn.execute(
        "INSERT OR IGNORE INTO npc_events (id, character_id, conversation_id, kind, reason, dedupe_key, status, due_at, expires_at, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'pending', ?7, ?8, ?7, ?7)",
        params![id, d.character, d.conversation_id, d.kind, d.reason, d.dedupe_key, now, now + 6 * HOUR],
    )?;
    if n == 0 {
        return Ok(None);
    }
    Ok(Some(Event { id, character_id: d.character.clone(), conversation_id: d.conversation_id.clone(), kind: d.kind.clone(), reason: d.reason.clone(), attempts: 0 }))
}

/// Pending events still worth processing (e.g. after the AI was offline).
pub fn pending(conn: &Connection, now: i64) -> Result<Vec<Event>> {
    conn.execute("UPDATE npc_events SET status='expired', updated_at=?1 WHERE status='pending' AND expires_at < ?1", [now])?;
    let mut st = conn.prepare("SELECT id, character_id, conversation_id, kind, reason, attempts FROM npc_events WHERE status='pending' AND due_at <= ?1 ORDER BY due_at LIMIT 3")?;
    let v = st
        .query_map([now], |r| Ok(Event { id: r.get(0)?, character_id: r.get(1)?, conversation_id: r.get::<_, Option<String>>(2)?.unwrap_or_default(), kind: r.get(3)?, reason: r.get(4)?, attempts: r.get(5)? }))?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    Ok(v)
}

pub fn finish(conn: &Connection, id: &str, status: &str, error: Option<&str>, retry_in_ms: Option<i64>) -> Result<()> {
    let now = now_ms();
    match retry_in_ms {
        Some(ms) => conn.execute(
            "UPDATE npc_events SET attempts=attempts+1, last_error=?2, due_at=?3, updated_at=?4, status=CASE WHEN attempts+1 >= 5 THEN 'expired' ELSE 'pending' END WHERE id=?1",
            params![id, error, now + ms, now],
        )?,
        None => conn.execute("UPDATE npc_events SET status=?2, last_error=?3, updated_at=?4 WHERE id=?1", params![id, status, error, now])?,
    };
    Ok(())
}

/// Marks that a plan has had its follow-up, so it isn't followed up repeatedly.
pub fn mark_plan_followed(conn: &Connection, plan_id: &str, character: &str, now: i64) -> Result<()> {
    conn.execute(
        "INSERT OR IGNORE INTO npc_events (id, character_id, kind, reason, dedupe_key, status, due_at, expires_at, created_at, updated_at)
         VALUES (?1, ?2, 'follow_up', 'plan', ?3, 'done', ?4, ?4, ?4, ?4)",
        params![new_id(), character, format!("plan:{plan_id}"), now],
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cand(id: &str) -> Candidate {
        Candidate { profile: npc::profile(id).unwrap(), last_player_msg_at: None, last_initiated_at: None, awaiting_player: false, last_dm_at: None, busy_thread: false, upcoming_plan: None }
    }
    fn g0() -> Global {
        Global { initiations_today: 0, last_initiation_at: None, background_requests_today: 0, requests_today: 0 }
    }
    fn evening() -> WorldTime {
        WorldTime { hour: 20, minute: 0, weekday: 0 }
    }

    /// Simulates a day of 5-minute ticks; returns initiations per character.
    fn simulate(cfg: &SocialSettings, seed: u64) -> std::collections::HashMap<String, i64> {
        let mut rng = Rng::new(seed);
        let mut cands: Vec<Candidate> = npc::profiles().iter().map(|p| cand(&p.id)).collect();
        let mut g = g0();
        let mut out = std::collections::HashMap::new();
        let start = 1_800_000_000_000i64;
        for tick in 0..288 {
            let now = start + tick * 5 * 60_000;
            let hour = ((tick * 5) / 60) as u8;
            let w = WorldTime { hour, minute: 0, weekday: 6 };
            if let Some(d) = decide(&w, "2026-11-21", now, &cands, &[], &g, cfg, &mut rng) {
                *out.entry(d.character.clone()).or_insert(0) += 1;
                g.initiations_today += 1;
                g.last_initiation_at = Some(now);
                let c = cands.iter_mut().find(|c| c.profile.id == d.character).unwrap();
                c.last_initiated_at = Some(now);
                c.awaiting_player = true; // player never answers in this simulation
                c.last_dm_at = Some(now);
            }
        }
        out
    }

    #[test]
    fn quiet_hours_and_caps_hold_over_many_simulated_days() {
        let cfg = SocialSettings::default();
        for seed in 1..40 {
            let day = simulate(&cfg, seed);
            let total: i64 = day.values().sum();
            assert!(total <= cfg.max_initiations_per_day, "seed {seed}: {total}");
            assert!(day.values().all(|n| *n <= 1), "no character double-texts an unanswered message the same day: {day:?}");
        }
        assert!(in_quiet_hours(&cfg, 23) && in_quiet_hours(&cfg, 3) && !in_quiet_hours(&cfg, 12));
        let mut rng = Rng::new(1);
        let cands: Vec<Candidate> = npc::profiles().iter().map(|p| cand(&p.id)).collect();
        for _ in 0..500 {
            assert!(decide(&WorldTime { hour: 2, minute: 0, weekday: 1 }, "d", 0, &cands, &[], &g0(), &cfg, &mut rng).is_none());
        }
    }

    #[test]
    fn chatty_characters_initiate_more_than_quiet_ones() {
        let cfg = SocialSettings { max_initiations_per_day: 100, min_gap_minutes: 0, background_ai_budget: 1000, ..Default::default() };
        let mut mika = 0;
        let mut yui = 0;
        for seed in 1..60 {
            let d = simulate(&cfg, seed);
            mika += d.get("mika").copied().unwrap_or(0);
            yui += d.get("yui").copied().unwrap_or(0);
        }
        assert!(mika > yui * 2, "mika {mika} vs yui {yui}");
    }

    #[test]
    fn no_initiation_mid_conversation_or_when_disabled_or_over_budget() {
        let mut rng = Rng::new(3);
        let now = 1_800_000_000_000i64;
        let mut c = cand("mika");
        c.last_player_msg_at = Some(now - 60_000);
        let always = SocialSettings { max_initiations_per_day: 100, min_gap_minutes: 0, ..Default::default() };
        for _ in 0..2000 {
            assert!(decide(&evening(), "d", now, &[c.clone()], &[], &g0(), &always, &mut rng).is_none());
        }
        let off = SocialSettings { background: false, ..Default::default() };
        let fresh = cand("mika");
        for _ in 0..2000 {
            assert!(decide(&evening(), "d", now, &[fresh.clone()], &[], &g0(), &off, &mut rng).is_none());
        }
        let spent = Global { background_requests_today: 999, ..g0() };
        for _ in 0..2000 {
            assert!(decide(&evening(), "d", now, &[fresh.clone()], &[], &spent, &always, &mut rng).is_none());
        }
    }

    #[test]
    fn events_dedupe_and_expire() {
        let mut c = Connection::open_in_memory().unwrap();
        crate::migrations::migrate(&mut c).unwrap();
        let d = Decision { character: "mika".into(), conversation_id: "dm-mika".into(), kind: "initiate".into(), reason: "x".into(), dedupe_key: "init:mika:2026-11-18:6".into() };
        assert!(record(&c, &d, 1000).unwrap().is_some());
        assert!(record(&c, &d, 2000).unwrap().is_none(), "duplicate prevented");
        assert_eq!(pending(&c, 5000).unwrap().len(), 1);
        assert!(pending(&c, 1000 + 7 * HOUR).unwrap().is_empty(), "expired after 6h");
    }
}

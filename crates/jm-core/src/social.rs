//! Orchestration between stored state and the AI: build a Job (prompt + metadata)
//! for a conversation or a scheduler event, then apply the model's validated
//! reply as timed, persisted effects. The network call itself lives in the app shell.

use crate::chat::{self, Message, Planned, PLAYER};
use crate::npc::{self, NpcState, Profile};
use crate::prompt::{self, Pace, PlayerInfo, Prompt, PromptInput, Rng, Task, WorldTime};
use crate::{memory, scheduler, CoreError, Result};
use rusqlite::Connection;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Env {
    pub world: WorldTime,
    pub day: String,
    pub tz_offset_min: i32,
    pub player: PlayerInfo,
    pub pace: Pace,
}

#[derive(Debug, Clone)]
pub struct Job {
    pub purpose: &'static str, // reply | group | initiate | group_topic
    pub conversation_id: String,
    pub speakers: Vec<String>,
    pub player_msg_ids: Vec<String>,
    pub event_id: Option<String>,
    pub plan_id: Option<String>,
    pub engaged: bool,
    pub busy: bool,
    pub prompt: Prompt,
}

/// Wait this long after the player's last message before replying, so several
/// quick bubbles from the player get one natural response.
pub const DEBOUNCE_MS: i64 = 1800;
const RECENT_MESSAGES: i64 = 16;
const MEMORIES_PER_SPEAKER: usize = 6;

fn npc_members(conn: &Connection, conv: &str) -> Result<Vec<&'static Profile>> {
    Ok(chat::conversation_members(conn, conv)?.iter().filter(|m| m.as_str() != PLAYER).filter_map(|m| npc::profile(m)).collect())
}

fn context_text(recent: &[Message]) -> String {
    recent.iter().rev().take(8).map(|m| m.body.as_str()).collect::<Vec<_>>().join(" ")
}

fn build_job(
    conn: &Connection,
    conv: &str,
    task: Task,
    speakers: Vec<&'static Profile>,
    env: &Env,
    now: i64,
) -> Result<(Prompt, Vec<NpcState>, Vec<Message>)> {
    let kind: String = conn.query_row("SELECT kind FROM conversations WHERE id=?1", [conv], |r| r.get(0))?;
    let title: String = conn.query_row("SELECT title FROM conversations WHERE id=?1", [conv], |r| r.get(0))?;
    let recent = chat::recent(conn, conv, now, RECENT_MESSAGES)?;
    let ctx = context_text(&recent);
    let states: Vec<NpcState> = speakers.iter().map(|p| npc::get_state(conn, &p.id)).collect::<Result<_>>()?;
    let mut memories = vec![];
    for p in &speakers {
        let m = memory::retrieve(conn, &p.id, &ctx, MEMORIES_PER_SPEAKER, now)?;
        memories.push((p.id.clone(), m.into_iter().map(|m| prompt::MemoryLine { id: m.id, fact: m.fact }).collect()));
    }
    let summary = chat::summary(conn, conv)?.map(|(s, _)| s);
    let input = PromptInput {
        task,
        speakers: speakers.iter().zip(states.iter()).map(|(p, s)| (*p, s)).collect(),
        group_title: (kind == "group").then_some(title),
        memories,
        summary,
        recent: recent.clone(),
        world: env.world.clone(),
        player: env.player.clone(),
        tz_offset_min: env.tz_offset_min,
    };
    Ok((prompt::build(&input), states, recent))
}

/// A reply job for a conversation with pending player messages, if one is due.
pub fn prepare_reply(conn: &Connection, conv: &str, env: &Env, now: i64) -> Result<Option<Job>> {
    let pending = chat::pending_player_messages(conn, conv)?;
    let Some(last) = pending.last() else { return Ok(None) };
    if now - last.deliver_at < DEBOUNCE_MS || chat::has_scheduled(conn, conv)? {
        return Ok(None);
    }
    let speakers = npc_members(conn, conv)?;
    if speakers.is_empty() {
        chat::set_reply_state(conn, &pending.iter().map(|m| m.id.clone()).collect::<Vec<_>>(), "none", None)?;
        return Ok(None);
    }
    let group = speakers.len() > 1;
    let task = if group { Task::GroupReply } else { Task::Reply };
    let (prompt, _, recent) = build_job(conn, conv, task, speakers.clone(), env, now)?;
    let engaged = recent.iter().rev().any(|m| m.sender_id != PLAYER && now - m.deliver_at < 5 * 60_000)
        || pending.len() > 1
        || pending.first().map_or(false, |m| now - m.deliver_at < 10_000 && recent.iter().rev().nth(pending.len()).map_or(false, |prev| m.deliver_at - prev.deliver_at < 5 * 60_000));
    let busy = !group && npc::busy_with(speakers[0], env.world.weekday, env.world.hour).is_some();
    Ok(Some(Job {
        purpose: if group { "group" } else { "reply" },
        conversation_id: conv.into(),
        speakers: speakers.iter().map(|p| p.id.clone()).collect(),
        player_msg_ids: pending.iter().map(|m| m.id.clone()).collect(),
        event_id: None,
        plan_id: None,
        engaged,
        busy,
        prompt,
    }))
}

/// A job for a scheduler event (unprompted message / group topic).
pub fn prepare_event(conn: &Connection, ev: &scheduler::Event, env: &Env, now: i64) -> Result<Option<Job>> {
    let Some(p) = npc::profile(&ev.character_id) else { return Ok(None) };
    let conv = if ev.conversation_id.is_empty() { chat::dm_id(&p.id) } else { ev.conversation_id.clone() };
    // Conditions may have changed since the decision (player started chatting, etc.).
    if chat::has_scheduled(conn, &conv)? || !chat::pending_player_messages(conn, &conv)?.is_empty() {
        return Ok(None);
    }
    let (task, speakers, purpose) = if ev.kind == "group_topic" {
        (Task::GroupTopic { opener: p.id.clone(), reason: ev.reason.clone() }, npc_members(conn, &conv)?, "group_topic")
    } else {
        (Task::Initiate { reason: ev.reason.clone() }, vec![p], "initiate")
    };
    let (prompt, _, _) = build_job(conn, &conv, task, speakers.clone(), env, now)?;
    let plan_id = conn
        .query_row("SELECT substr(dedupe_key, 6) FROM npc_events WHERE id=?1 AND dedupe_key LIKE 'plan:%'", [&ev.id], |r| r.get::<_, String>(0))
        .ok();
    Ok(Some(Job {
        purpose,
        conversation_id: conv,
        speakers: speakers.iter().map(|p| p.id.clone()).collect(),
        player_msg_ids: vec![],
        event_id: Some(ev.id.clone()),
        plan_id,
        engaged: false,
        busy: false,
        prompt,
    }))
}

#[derive(Debug, Clone, Serialize)]
pub struct Applied {
    pub scheduled: usize,
    pub read_only: bool,
    pub understood: String,
    pub plan_added: bool,
    pub memories_added: usize,
}

/// Applies a model completion to the world. On parse failure, marks the player
/// messages as failed (so the UI can offer a retry) and returns the error.
pub fn apply(conn: &Connection, dev: &str, job: &Job, raw: &str, env: &Env, now: i64, rng: &mut Rng) -> Result<Applied> {
    let speakers: Vec<&Profile> = job.speakers.iter().filter_map(|s| npc::profile(s)).collect();
    let group = job.purpose == "group" || job.purpose == "group_topic";
    let reply = match prompt::parse_reply(raw, &speakers, group) {
        Ok(r) => r,
        Err(e) => {
            chat::set_reply_state(conn, &job.player_msg_ids, "failed", Some(&e.to_string()))?;
            return Err(e);
        }
    };
    let timing = prompt::plan_timing(&reply, now, job.engaged, job.busy, env.pace, rng);
    chat::set_read_receipt(conn, &job.player_msg_ids, timing.read_at)?;
    let mut plans: Vec<Planned> = timing.plans;
    if let (Some(r), Some(target)) = (&reply.react, job.player_msg_ids.last()) {
        plans.push(Planned {
            sender_id: r.from.clone(),
            kind: "reaction".into(),
            body: String::new(),
            sticker_id: None,
            typing_from: timing.read_at,
            deliver_at: timing.read_at + 400,
            meta: serde_json::json!({"target": target, "emoji": r.emoji}),
        });
    }
    let mut plan_added = false;
    if let Some(pl) = &reply.plan {
        let src = job.player_msg_ids.last().cloned().or_else(|| Some(format!("{}:{}", job.conversation_id, now)));
        chat::add_event(conn, dev, &chat::CalendarEvent {
            id: String::new(),
            title: pl.title.clone(),
            starts_at: None,
            when_text: pl.when.clone(),
            place: pl.place.clone(),
            participants: job.speakers.clone(),
            source_message_id: src,
            status: "planned".into(),
            created_at: 0,
        })?;
        let at = plans.iter().filter(|p| p.kind != "reaction").map(|p| p.deliver_at).max().unwrap_or(timing.read_at) + 300;
        plans.push(Planned {
            sender_id: "system".into(),
            kind: "plan".into(),
            body: pl.title.clone(),
            sticker_id: None,
            typing_from: at,
            deliver_at: at,
            meta: serde_json::json!({"when": pl.when, "place": pl.place}),
        });
        plan_added = true;
    }
    let n = plans.iter().filter(|p| p.kind == "text" || p.kind == "sticker").count();
    chat::schedule(conn, dev, &job.conversation_id, &plans)?;
    let mut memories_added = 0;
    for m in &reply.memories {
        let about = m.about.as_deref().unwrap_or("");
        if memory::add(conn, dev, about, &m.fact, m.importance, "chat", job.player_msg_ids.last().map(|s| s.as_str()))?.is_some() {
            memories_added += 1;
        }
    }
    // Relationship changes only come from real exchanges with the player.
    if !job.player_msg_ids.is_empty() {
        for (who, d) in &reply.relationship {
            npc::apply_delta(conn, dev, who, d, &env.day)?;
        }
    }
    let state = if reply.read_only { "read_only" } else { "done" };
    chat::set_reply_state(conn, &job.player_msg_ids, state, None)?;
    if let Some(ev) = &job.event_id {
        scheduler::finish(conn, ev, "done", None, None)?;
        for s in &job.speakers {
            if job.purpose == "initiate" {
                npc::touch(conn, s, false, true, now)?;
            }
        }
    }
    Ok(Applied { scheduled: n, read_only: reply.read_only, understood: reply.understood, plan_added, memories_added })
}

/// Records an AI failure for a job (player messages can be retried; events back off).
pub fn fail(conn: &Connection, job: &Job, error: &str, retryable: bool) -> Result<()> {
    if !job.player_msg_ids.is_empty() {
        chat::set_reply_state(conn, &job.player_msg_ids, "failed", Some(error))?;
    }
    if let Some(ev) = &job.event_id {
        scheduler::finish(conn, ev, "skipped", Some(error), retryable.then_some(15 * 60_000))?;
    }
    Ok(())
}

/// Puts failed player messages back in the queue.
pub fn retry(conn: &Connection, conv: &str) -> Result<usize> {
    Ok(conn.execute("UPDATE messages SET reply_state='pending', reply_error=NULL WHERE conversation_id=?1 AND sender_id='player' AND reply_state='failed'", [conv])?)
}

// ---------------- summaries, review, hints ----------------

pub const SUMMARY_EVERY: i64 = 24;

pub fn prepare_summary(conn: &Connection, conv: &str, env: &Env, now: i64) -> Result<Option<(Prompt, i64)>> {
    let prev = chat::summary(conn, conv)?;
    let since = prev.as_ref().map(|(_, t)| *t).unwrap_or(0);
    if chat::count_since(conn, conv, since, now)? < SUMMARY_EVERY {
        return Ok(None);
    }
    let msgs: Vec<Message> = chat::messages(conn, conv, now, None, 60)?.into_iter().filter(|m| m.deliver_at > since).collect();
    let upto = msgs.last().map(|m| m.deliver_at).unwrap_or(now);
    let names: Vec<String> = npc_members(conn, conv)?.iter().map(|p| p.display.clone()).collect();
    let lines = prompt::render_transcript(&msgs, &env.player, env.tz_offset_min);
    Ok(Some((prompt::summary_prompt(&names.join(", "), prev.as_ref().map(|(s, _)| s.as_str()), &lines), upto)))
}

pub fn prepare_review(conn: &Connection, conv: &str, env: &Env, now: i64) -> Result<(Prompt, Vec<Message>)> {
    let mine = chat::unreviewed_player_messages(conn, conv, now)?;
    if mine.is_empty() {
        return Err(CoreError::Invalid("no new messages of yours to review in this chat".into()));
    }
    let ctx_msgs = chat::messages(conn, conv, now, None, 60)?;
    let ctx = prompt::render_transcript(&ctx_msgs, &env.player, env.tz_offset_min);
    let lines: Vec<(String, String)> = mine.iter().map(|m| (m.id.clone(), m.body.clone())).collect();
    Ok((prompt::review_prompt(&ctx, &lines), mine))
}

#[derive(Debug, Deserialize)]
struct RawReview {
    #[serde(default)]
    items: Vec<chat::Observation>,
    #[serde(default)]
    vocab: Vec<serde_json::Value>,
    #[serde(default)]
    overall: String,
}

#[derive(Debug, Serialize)]
pub struct Review {
    pub items: Vec<chat::Observation>,
    pub vocab: Vec<serde_json::Value>,
    pub overall: String,
}

pub fn apply_review(conn: &Connection, dev: &str, conv: &str, raw: &str, mine: &[Message]) -> Result<Review> {
    let json = prompt::extract_json(raw).ok_or_else(|| CoreError::Invalid("review had no JSON".into()))?;
    let r: RawReview = serde_json::from_str(json).map_err(|e| CoreError::Invalid(format!("review JSON invalid: {e}")))?;
    let ids: Vec<&str> = mine.iter().map(|m| m.id.as_str()).collect();
    let mut items: Vec<chat::Observation> = r
        .items
        .into_iter()
        .filter(|o| chat::OBS_CATEGORIES.contains(&o.category.as_str()) && o.category != "vocab")
        .map(|mut o| {
            o.conversation_id = conv.into();
            if !o.message_id.as_deref().map_or(false, |id| ids.contains(&id)) {
                o.message_id = None;
            }
            o
        })
        .collect();
    let vocab: Vec<serde_json::Value> = r.vocab.into_iter().filter(|v| v.get("word").and_then(|w| w.as_str()).map_or(false, |w| !w.is_empty())).take(6).collect();
    for v in &vocab {
        items.push(chat::Observation {
            id: String::new(), conversation_id: conv.into(), message_id: None, category: "vocab".into(),
            original: v.get("word").and_then(|x| x.as_str()).unwrap_or("").into(), suggestion: String::new(),
            note: v.get("meaning").and_then(|x| x.as_str()).unwrap_or("").into(), payload: v.clone(), created_at: 0,
        });
    }
    // Always record at least one row so these messages count as reviewed.
    if items.is_empty() {
        items.push(chat::Observation { id: String::new(), conversation_id: conv.into(), message_id: None, category: "success".into(), original: String::new(), suggestion: String::new(), note: r.overall.clone(), payload: serde_json::Value::Null, created_at: 0 });
    }
    chat::add_observations(conn, dev, &items)?;
    Ok(Review { items: items.into_iter().filter(|o| o.category != "vocab").collect(), vocab, overall: r.overall })
}

pub fn prepare_hint(conn: &Connection, conv: &str, env: &Env, now: i64) -> Result<Prompt> {
    let msgs = chat::recent(conn, conv, now, 12)?;
    Ok(prompt::hint_prompt(&prompt::render_transcript(&msgs, &env.player, env.tz_offset_min), None))
}

// ---------------- configuration ----------------

/// Everything the social runtime needs from settings, stored as one JSON value
/// under `social.config`. Missing or invalid fields fall back to defaults.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(default)]
pub struct Config {
    pub social: scheduler::SocialSettings,
    pub pace: Pace,
    pub player: PlayerInfo,
    pub tz_offset_min: i32,
    pub notifications: bool,
    /// Show message text in Windows notifications (off = "新しいメッセージ").
    pub notification_preview: bool,
    pub close_to_tray: bool,
    /// Tray "Pause": no unprompted messages or group topics. Replies to your own messages still happen.
    pub paused: bool,
}

impl Default for Config {
    fn default() -> Self {
        Config {
            social: Default::default(),
            pace: Pace::Natural,
            player: PlayerInfo { name: "プレイヤー".into(), status_message: String::new(), level_note: "Japanese learner (around N4); texts casually with friends".into() },
            tz_offset_min: 0,
            notifications: true,
            notification_preview: true,
            close_to_tray: true,
            paused: false,
        }
    }
}

pub const CONFIG_KEY: &str = "social.config";

impl Config {
    pub fn load(conn: &Connection) -> Result<Config> {
        let v: Option<String> = conn
            .query_row("SELECT value FROM settings WHERE key=?1", [CONFIG_KEY], |r| r.get(0))
            .ok();
        Ok(v.and_then(|s| serde_json::from_str::<Config>(&s).ok()).unwrap_or_default().sanitized())
    }

    pub fn save(&self, conn: &Connection, dev: &str) -> Result<Config> {
        let c = self.clone().sanitized();
        crate::settings::set(conn, dev, CONFIG_KEY, &serde_json::to_value(&c).map_err(|e| CoreError::Invalid(e.to_string()))?)?;
        Ok(c)
    }

    /// Clamps values to safe ranges so a bad edit can't create runaway activity.
    pub fn sanitized(mut self) -> Config {
        let s = &mut self.social;
        s.quiet_start = s.quiet_start.min(23);
        s.quiet_end = s.quiet_end.min(23);
        s.max_initiations_per_day = s.max_initiations_per_day.clamp(0, 12);
        s.min_gap_minutes = s.min_gap_minutes.clamp(15, 24 * 60);
        s.daily_ai_budget = s.daily_ai_budget.clamp(0, 2000);
        s.background_ai_budget = s.background_ai_budget.clamp(0, s.daily_ai_budget);
        self.tz_offset_min = self.tz_offset_min.clamp(-14 * 60, 14 * 60);
        self.player.name = self.player.name.trim().chars().take(24).collect();
        if self.player.name.is_empty() {
            self.player.name = "プレイヤー".into();
        }
        self.player.status_message = self.player.status_message.chars().take(60).collect();
        self.player.level_note = self.player.level_note.chars().take(120).collect();
        self
    }

    pub fn env(&self, now: i64) -> Env {
        let (world, day) = local_time(now, self.tz_offset_min);
        Env { world, day, tz_offset_min: self.tz_offset_min, player: self.player.clone(), pace: self.pace }
    }
}

/// Local wall-clock time and YYYY-MM-DD day for a UTC ms timestamp.
pub fn local_time(now: i64, tz_offset_min: i32) -> (WorldTime, String) {
    let local = now + tz_offset_min as i64 * 60_000;
    let days = local.div_euclid(86_400_000);
    let ms = local.rem_euclid(86_400_000);
    let weekday = ((days + 4).rem_euclid(7)) as u8; // 1970-01-01 was a Thursday
    // Civil date from days since epoch (Howard Hinnant's algorithm).
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = yoe + era * 400 + if m <= 2 { 1 } else { 0 };
    let world = WorldTime { hour: (ms / 3_600_000) as u8, minute: ((ms / 60_000) % 60) as u8, weekday };
    (world, format!("{y:04}-{m:02}-{d:02}"))
}

/// Start of the local day containing `now`, as UTC ms.
pub fn local_day_start(now: i64, tz_offset_min: i32) -> i64 {
    let off = tz_offset_min as i64 * 60_000;
    (now + off).div_euclid(86_400_000) * 86_400_000 - off
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{chat::Outgoing, migrations, now_ms};

    fn db() -> Connection {
        let mut c = Connection::open_in_memory().unwrap();
        migrations::migrate(&mut c).unwrap();
        crate::game::ensure_characters(&c, "d").unwrap();
        npc::seed(&c, "d").unwrap();
        chat::seed(&c, "d").unwrap();
        c
    }
    fn env() -> Env {
        Env {
            world: WorldTime { hour: 20, minute: 0, weekday: 0 },
            day: "2026-11-22".into(),
            tz_offset_min: 0,
            player: PlayerInfo { name: "ネイト".into(), status_message: String::new(), level_note: "N4 learner".into() },
            pace: Pace::Natural,
        }
    }
    fn send(c: &Connection, conv: &str, text: &str, at: i64) -> Message {
        chat::send_player(c, "d", &Outgoing { conversation_id: conv.into(), kind: "text".into(), body: text.into(), sticker_id: None }, true, at).unwrap()
    }

    #[test]
    fn local_time_and_config_defaults() {
        // 2026-11-18 15:30 UTC is a Wednesday; in Houston (UTC-6) it's 09:30.
        let t = 1_795_015_800_000; // 2026-11-18T15:30:00Z
        let (w, d) = local_time(t, 0);
        assert_eq!((w.hour, w.minute, w.weekday, d.as_str()), (15, 30, 3, "2026-11-18"));
        let (w, d) = local_time(t, -360);
        assert_eq!((w.hour, d.as_str()), (9, "2026-11-18"));
        let (_, d) = local_time(t - 10 * 3_600_000, -360);
        assert_eq!(d, "2026-11-17");
        assert_eq!(local_day_start(t, -360), 1_794_981_600_000);
        let c = db();
        let cfg = Config::load(&c).unwrap();
        assert_eq!(cfg, Config::default());
        let mut bad = cfg.clone();
        bad.social.max_initiations_per_day = 500;
        bad.player.name = "  ".into();
        let saved = bad.save(&c, "d").unwrap();
        assert_eq!(saved.social.max_initiations_per_day, 12);
        assert_eq!(Config::load(&c).unwrap(), saved);
    }

    #[test]
    fn full_reply_cycle_with_receipts_typing_reaction_memory_plan() {
        let c = db();
        let t0 = now_ms();
        let m = send(&c, "dm-mika", "土曜日カフェいこう！", t0);
        assert!(prepare_reply(&c, "dm-mika", &env(), t0 + 500).unwrap().is_none(), "debounced");
        let job = prepare_reply(&c, "dm-mika", &env(), t0 + DEBOUNCE_MS).unwrap().unwrap();
        assert_eq!(job.speakers, vec!["mika".to_string()]);
        assert!(job.prompt.user.contains("土曜日カフェいこう"));
        let raw = r#"{"messages":[{"type":"text","text":"いく〜！"},{"type":"text","text":"何時にする？"}],"react":"🙌",
            "plan":{"title":"カフェ","when":"土曜 14:00","place":"駅前"},"memories":[{"fact":"Player wants to try the new café","importance":3}],
            "relationship":{"closeness":1,"trust":0}}"#;
        let a = apply(&c, "d", &job, raw, &env(), t0 + DEBOUNCE_MS, &mut Rng::new(9)).unwrap();
        assert_eq!((a.scheduled, a.plan_added, a.memories_added), (2, true, 1));
        // Reply state, receipt, and nothing visible yet.
        let mine = chat::get_message(&c, &m.id).unwrap();
        assert_eq!(mine.reply_state.as_deref(), Some("done"));
        let read_at = mine.read_by_npc_at.unwrap();
        assert!(read_at > t0);
        assert!(chat::messages(&c, "dm-mika", t0 + DEBOUNCE_MS, None, 100).unwrap().iter().all(|x| x.body != "いく〜！"));
        // Later everything lands, including the reaction and the plan card.
        let later = t0 + 10 * 60_000;
        chat::deliver_due(&c, later).unwrap();
        let msgs = chat::messages(&c, "dm-mika", later, None, 100).unwrap();
        assert!(msgs.iter().any(|x| x.body == "何時にする？"));
        assert!(msgs.iter().any(|x| x.kind == "plan" && x.body == "カフェ"));
        assert_eq!(chat::get_message(&c, &m.id).unwrap().reactions, vec![("mika".to_string(), "🙌".to_string())]);
        assert_eq!(chat::events(&c).unwrap().len(), 1);
        assert_eq!(npc::get_state(&c, "mika").unwrap().closeness, 1.0);
        assert!(prepare_reply(&c, "dm-mika", &env(), later).unwrap().is_none(), "nothing pending any more");
    }

    #[test]
    fn group_reply_is_bounded_and_never_self_triggers() {
        let c = db();
        let t0 = now_ms();
        send(&c, "g-game", "今夜だれかやる？", t0);
        let job = prepare_reply(&c, "g-game", &env(), t0 + DEBOUNCE_MS).unwrap().unwrap();
        assert_eq!(job.purpose, "group");
        assert_eq!(job.speakers.len(), 3);
        let raw = r#"{"messages":[{"from":"haruto","type":"text","text":"やる！"},{"from":"sota","type":"text","text":"俺バイトだわ"},{"from":"natsuki","type":"text","text":"うちも行けるで"},{"from":"haruto","type":"text","text":"9時な"},{"from":"sota","type":"text","text":"extra"}]}"#;
        let a = apply(&c, "d", &job, raw, &env(), t0 + DEBOUNCE_MS, &mut Rng::new(1)).unwrap();
        assert_eq!(a.scheduled, prompt::MAX_GROUP_MESSAGES);
        chat::deliver_due(&c, t0 + 3_600_000).unwrap();
        // NPC messages never create pending work by themselves: no runaway loops.
        assert!(prepare_reply(&c, "g-game", &env(), t0 + 3_600_000).unwrap().is_none());
    }

    #[test]
    fn bad_ai_output_marks_failed_and_retry_requeues() {
        let c = db();
        let t0 = now_ms();
        send(&c, "dm-ren", "こんにちは", t0);
        let job = prepare_reply(&c, "dm-ren", &env(), t0 + DEBOUNCE_MS).unwrap().unwrap();
        assert!(apply(&c, "d", &job, "Sorry, I can't help.", &env(), t0 + DEBOUNCE_MS, &mut Rng::new(1)).is_err());
        assert_eq!(chat::pending_player_messages(&c, "dm-ren").unwrap().len(), 0);
        assert_eq!(retry(&c, "dm-ren").unwrap(), 1);
        assert_eq!(chat::pending_player_messages(&c, "dm-ren").unwrap().len(), 1);
    }

    #[test]
    fn initiation_event_job_and_apply() {
        let c = db();
        let now = now_ms() + 2 * 3_600_000;
        let d = scheduler::Decision { character: "haruto".into(), conversation_id: "dm-haruto".into(), kind: "initiate".into(), reason: "evening game".into(), dedupe_key: "k1".into() };
        let ev = scheduler::record(&c, &d, now).unwrap().unwrap();
        let job = prepare_event(&c, &ev, &env(), now).unwrap().unwrap();
        assert_eq!(job.purpose, "initiate");
        assert!(job.prompt.user.contains("unprompted"));
        apply(&c, "d", &job, r#"{"messages":[{"type":"text","text":"今夜ランクいく？"}]}"#, &env(), now, &mut Rng::new(2)).unwrap();
        assert!(scheduler::pending(&c, now).unwrap().is_empty());
        assert_eq!(npc::get_state(&c, "haruto").unwrap().last_initiated_at, Some(now));
    }

    #[test]
    fn review_records_observations_and_marks_reviewed() {
        let c = db();
        let t0 = now_ms();
        let m = send(&c, "dm-yui", "私は本を読むのが好きだ", t0);
        let (_p, mine) = prepare_review(&c, "dm-yui", &env(), t0 + 1000).unwrap();
        let raw = format!(r#"{{"items":[{{"message_id":"{}","category":"unnatural","original":"私は本を読むのが好きだ","suggestion":"本読むの好きなんだ","note":"だ sounds stiff in chat"}}],
            "vocab":[{{"word":"返信","reading":"へんしん","meaning":"reply"}}],"overall":"Clear."}}"#, m.id);
        let r = apply_review(&c, "d", "dm-yui", &raw, &mine).unwrap();
        assert_eq!(r.items.len(), 1);
        assert_eq!(r.vocab.len(), 1);
        assert!(prepare_review(&c, "dm-yui", &env(), t0 + 2000).is_err(), "nothing new to review");
    }
}

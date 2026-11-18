//! Background social runtime: delivers scheduled messages, generates character
//! replies, runs the bounded initiation scheduler, and raises notifications.
//! Runs only while the app process is alive (window open or in the tray);
//! nothing is ever back-dated to look like it happened while the app was closed.

use crate::ai::{self, AiError, Consent, ProviderConfig, Purpose};
use crate::AppState;
use jm_core::social::{self, Config, Job};
use jm_core::{chat, now_ms, prompt::Rng, scheduler, Db};
use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_notification::NotificationExt;

#[derive(Default)]
pub struct Engine {
    inflight: Mutex<HashSet<String>>,
    /// Conversation id -> (retry not before, consecutive offline failures).
    backoff: Mutex<HashMap<String, (i64, u32)>>,
    last_tick: Mutex<i64>,
    pub window_focused: AtomicBool,
    /// Conversation the player currently has open on the phone, if any.
    pub open_conversation: Mutex<Option<String>>,
    pub tray_hint_shown: AtomicBool,
}

#[derive(Serialize, Clone)]
pub struct ChatChanged {
    pub conversations: Vec<String>,
}

pub fn with_db<T>(app: &AppHandle, f: impl FnOnce(&Db) -> jm_core::Result<T>) -> Result<T, String> {
    let st = app.state::<AppState>();
    let guard = st.db.lock().map_err(|_| "database lock poisoned".to_string())?;
    let db = guard.as_ref().ok_or_else(|| "database is not open".to_string())?;
    f(db).map_err(|e| e.to_string())
}

pub fn read_setting<T: serde::de::DeserializeOwned + Default>(db: &Db, key: &str) -> T {
    db.conn
        .query_row("SELECT value FROM settings WHERE key=?1", [key], |r| r.get::<_, String>(0))
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

pub fn ai_ready(db: &Db) -> Result<ai::Ready, AiError> {
    let cfg: ProviderConfig = read_setting(db, ai::CONFIG_KEY);
    let consent: Consent = read_setting(db, ai::CONSENT_KEY);
    ai::ready(&cfg, &consent)
}

pub fn emit_changed(app: &AppHandle, convs: Vec<String>) {
    if !convs.is_empty() {
        let _ = app.emit("chat-changed", ChatChanged { conversations: convs });
    }
}

fn rng() -> Rng {
    Rng::new(now_ms() as u64 ^ 0x9E37_79B9_7F4A_7C15)
}

pub fn start(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let mut tick: u64 = 0;
        loop {
            tokio::time::sleep(Duration::from_millis(1000)).await;
            tick += 1;
            deliver(&app);
            if tick % 2 == 0 {
                pump_replies(&app);
            }
            if tick % 30 == 7 {
                pump_events(&app);
            }
            if tick % (scheduler::TICK_MINUTES as u64 * 60) == 20 {
                schedule_tick(&app);
            }
        }
    });
}

// ---------------- delivery & presence ----------------

fn deliver(app: &AppHandle) {
    let engine = app.state::<Engine>();
    let now = now_ms();
    let last = {
        let mut l = engine.last_tick.lock().unwrap();
        let prev = if *l == 0 { now - 1000 } else { *l };
        *l = now;
        prev
    };
    let res = with_db(app, |db| {
        let delivered = chat::deliver_due(&db.conn, now)?;
        // Typing started or a read receipt landed since the last tick: presence changed.
        let mut st = db.conn.prepare(
            "SELECT DISTINCT conversation_id FROM messages WHERE
               (status='scheduled' AND typing_from > ?1 AND typing_from <= ?2)
               OR (read_by_npc_at > ?1 AND read_by_npc_at <= ?2)",
        )?;
        let presence = st.query_map([last, now], |r| r.get::<_, String>(0))?.collect::<Result<Vec<_>, _>>()?;
        let cfg = Config::load(&db.conn)?;
        Ok((delivered, presence, cfg))
    });
    let Ok((delivered, presence, cfg)) = res else { return };
    let mut changed: HashSet<String> = presence.into_iter().collect();
    let focused = engine.window_focused.load(Ordering::Relaxed);
    let open = engine.open_conversation.lock().unwrap().clone();
    let env = cfg.env(now);
    let quiet = scheduler::in_quiet_hours(&cfg.social, env.world.hour);
    for d in delivered {
        changed.insert(d.message.conversation_id.clone());
        let m = &d.message;
        if m.sender_id == chat::PLAYER || m.sender_id == "system" || !(m.kind == "text" || m.kind == "sticker") {
            continue;
        }
        let viewing = focused && open.as_deref() == Some(m.conversation_id.as_str());
        if viewing || d.muted {
            continue;
        }
        let name = jm_core::npc::profile(&m.sender_id).map(|p| p.display.clone()).unwrap_or_default();
        let title = if d.conversation_kind == "group" { format!("{} — {}", d.conversation_title, name) } else { name };
        let body = if m.kind == "sticker" {
            "スタンプを送信しました".to_string()
        } else if cfg.notification_preview {
            m.body.chars().take(80).collect()
        } else {
            "新しいメッセージ".to_string()
        };
        let _ = with_db(app, |db| chat::add_notification(&db.conn, Some(&m.conversation_id), &title, &body, m.deliver_at));
        if cfg.notifications && !quiet && !focused {
            let _ = app.notification().builder().title(&title).body(&body).show();
        }
    }
    emit_changed(app, changed.into_iter().collect());
}

// ---------------- replies to the player ----------------

fn backoff_ok(engine: &Engine, conv: &str, now: i64) -> bool {
    engine.backoff.lock().unwrap().get(conv).map_or(true, |(t, _)| now >= *t)
}

fn note_offline(engine: &Engine, conv: &str, now: i64) {
    let mut b = engine.backoff.lock().unwrap();
    let e = b.entry(conv.to_string()).or_insert((0, 0));
    e.1 = (e.1 + 1).min(6);
    e.0 = now + (15_000i64 << e.1).min(5 * 60_000);
}

fn pump_replies(app: &AppHandle) {
    let engine = app.state::<Engine>();
    let now = now_ms();
    let prepared = with_db(app, |db| {
        let cfg = Config::load(&db.conn)?;
        let env = cfg.env(now);
        let mut jobs = vec![];
        let mut blocked = vec![];
        for conv in chat::conversations_with_pending(&db.conn)? {
            if engine.inflight.lock().unwrap().contains(&conv) || !backoff_ok(&engine, &conv, now) {
                continue;
            }
            if let Some(job) = social::prepare_reply(&db.conn, &conv, &env, now)? {
                jobs.push(job);
            }
        }
        if !jobs.is_empty() {
            let usage = chat::usage(&db.conn, &env.day)?;
            let ready = ai_ready(db);
            let over_budget = usage.requests >= cfg.social.daily_ai_budget;
            if ready.is_err() || over_budget {
                let why = match &ready {
                    Err(e) => e.to_string(),
                    Ok(_) => format!("Today's AI budget ({} requests) is used up. Raise it in Phone → Settings → AI, or try again tomorrow.", cfg.social.daily_ai_budget),
                };
                for j in jobs.drain(..) {
                    chat::set_reply_state(&db.conn, &j.player_msg_ids, "failed", Some(&why))?;
                    blocked.push(j.conversation_id);
                }
            }
        }
        Ok((jobs, blocked, env))
    });
    let Ok((jobs, blocked, env)) = prepared else { return };
    emit_changed(app, blocked);
    for job in jobs {
        engine.inflight.lock().unwrap().insert(job.conversation_id.clone());
        let app = app.clone();
        let env = env.clone();
        tauri::async_runtime::spawn(async move {
            run_job(&app, job, env).await;
        });
    }
}

async fn run_job(app: &AppHandle, job: Job, env: social::Env) {
    let engine = app.state::<Engine>();
    let conv = job.conversation_id.clone();
    let ready = with_db(app, |db| Ok(ai_ready(db))).ok().and_then(|r| r.ok());
    let result = match &ready {
        Some(r) => ai::complete(r, Purpose::Chat, &job.prompt, 800).await,
        None => Err(AiError::NotReady("AI is not set up".into())),
    };
    let now = now_ms();
    match result {
        Ok(c) => {
            engine.backoff.lock().unwrap().remove(&conv);
            let _ = with_db(app, |db| {
                chat::add_usage(&db.conn, &env.day, job.purpose, c.input_tokens, c.output_tokens)?;
                // A parse failure is recorded on the messages (retryable) by apply().
                let _ = social::apply(&db.conn, &db.device_id, &job, &c.text, &env, now, &mut rng());
                Ok(())
            });
            if let Some(r) = &ready {
                summarize(app, r, &conv, &env).await;
            }
        }
        Err(AiError::Offline(msg)) => {
            note_offline(&engine, &conv, now);
            let _ = with_db(app, |db| {
                if !job.player_msg_ids.is_empty() {
                    // Stays queued; shown as "waiting for connection".
                    chat::set_reply_state(&db.conn, &job.player_msg_ids, "pending", Some(&format!("offline: {msg}")))?;
                }
                if let Some(ev) = &job.event_id {
                    scheduler::finish(&db.conn, ev, "pending", Some("offline"), Some(10 * 60_000))?;
                }
                Ok(())
            });
        }
        Err(e) => {
            let _ = with_db(app, |db| social::fail(&db.conn, &job, &e.to_string(), false));
        }
    }
    engine.inflight.lock().unwrap().remove(&conv);
    emit_changed(app, vec![conv]);
}

/// Rolling summaries keep long chats coherent without resending everything.
async fn summarize(app: &AppHandle, r: &ai::Ready, conv: &str, env: &social::Env) {
    let now = now_ms();
    let Ok(Some((p, upto))) = with_db(app, |db| social::prepare_summary(&db.conn, conv, env, now)) else { return };
    if let Ok(c) = ai::complete(r, Purpose::Chat, &p, 400).await {
        let text = c.text.trim().to_string();
        let _ = with_db(app, |db| {
            chat::add_usage(&db.conn, &env.day, "summary", c.input_tokens, c.output_tokens)?;
            if !text.is_empty() {
                chat::set_summary(&db.conn, conv, &text, upto)?;
            }
            Ok(())
        });
    }
}

// ---------------- unprompted activity ----------------

fn background_allowed(db: &Db, cfg: &Config, day: &str) -> jm_core::Result<bool> {
    if !cfg.social.background || cfg.paused || ai_ready(db).is_err() {
        return Ok(false);
    }
    let u = chat::usage(&db.conn, day)?;
    Ok(u.requests < cfg.social.daily_ai_budget && u.background_requests < cfg.social.background_ai_budget)
}

fn pump_events(app: &AppHandle) {
    let engine = app.state::<Engine>();
    let now = now_ms();
    let prepared = with_db(app, |db| {
        let cfg = Config::load(&db.conn)?;
        let env = cfg.env(now);
        let mut jobs = vec![];
        if !background_allowed(db, &cfg, &env.day)? || scheduler::in_quiet_hours(&cfg.social, env.world.hour) {
            return Ok((jobs, env));
        }
        for ev in scheduler::pending(&db.conn, now)? {
            let conv = if ev.conversation_id.is_empty() { chat::dm_id(&ev.character_id) } else { ev.conversation_id.clone() };
            if engine.inflight.lock().unwrap().contains(&conv) {
                continue;
            }
            match social::prepare_event(&db.conn, &ev, &env, now)? {
                Some(job) => jobs.push(job),
                // The moment passed (player is mid-conversation, etc.): drop it.
                None => scheduler::finish(&db.conn, &ev.id, "skipped", Some("no longer relevant"), None)?,
            }
        }
        jobs.truncate(1);
        Ok((jobs, env))
    });
    let Ok((jobs, env)) = prepared else { return };
    for job in jobs {
        engine.inflight.lock().unwrap().insert(job.conversation_id.clone());
        let app = app.clone();
        let env = env.clone();
        tauri::async_runtime::spawn(async move {
            run_job(&app, job, env).await;
        });
    }
}

fn schedule_tick(app: &AppHandle) {
    let now = now_ms();
    let recorded = with_db(app, |db| {
        let cfg = Config::load(&db.conn)?;
        let env = cfg.env(now);
        if !background_allowed(db, &cfg, &env.day)? {
            return Ok(false);
        }
        let (cands, groups) = scheduler::gather(&db.conn, now)?;
        let g = scheduler::global(&db.conn, &env.day, social::local_day_start(now, cfg.tz_offset_min))?;
        match scheduler::decide(&env.world, &env.day, now, &cands, &groups, &g, &cfg.social, &mut rng()) {
            Some(d) => Ok(scheduler::record(&db.conn, &d, now)?.is_some()),
            None => Ok(false),
        }
    });
    if recorded == Ok(true) {
        pump_events(app);
    }
}

// ---------------- one-off AI tasks for commands ----------------

pub async fn one_shot(app: &AppHandle, purpose: Purpose, label: &str, p: &jm_core::prompt::Prompt, max_tokens: u32) -> Result<String, String> {
    let now = now_ms();
    let (ready, day, budget_ok) = with_db(app, |db| {
        let cfg = Config::load(&db.conn)?;
        let day = cfg.env(now).day;
        let u = chat::usage(&db.conn, &day)?;
        Ok((ai_ready(db), day, u.requests < cfg.social.daily_ai_budget))
    })?;
    let ready = ready.map_err(|e| e.to_string())?;
    if !budget_ok {
        return Err("Today's AI budget is used up. You can raise it in Phone → Settings → AI.".into());
    }
    let c = ai::complete(&ready, purpose, p, max_tokens).await.map_err(|e| e.to_string())?;
    with_db(app, |db| chat::add_usage(&db.conn, &day, label, c.input_tokens, c.output_tokens))?;
    Ok(c.text)
}

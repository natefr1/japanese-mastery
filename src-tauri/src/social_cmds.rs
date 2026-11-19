//! Commands for the phone (messaging), characters, memories, stickers and AI setup.

use crate::ai::{self, Consent, ProviderConfig, ProviderKind, Purpose};
use crate::engine::{self, emit_changed, read_setting, with_db, Engine};
use crate::TrayState;
use jm_core::chat::{self, CalendarEvent, CallLog, ConversationView, Message, Notification, Observation, Outgoing, SearchHit, StickerState, Usage};
use jm_core::memory::{self, Memory};
use jm_core::npc::{self, NpcState, StickerPack};
use jm_core::social::{self, Config, Review};
use jm_core::{now_ms, prompt, settings};
use serde::Serialize;
use tauri::{AppHandle, Manager};
use tauri_plugin_autostart::ManagerExt;

type R<T> = Result<T, String>;

// ---------------- config ----------------

#[tauri::command(async)]
pub fn social_config_get(app: AppHandle) -> R<Config> {
    with_db(&app, |db| Config::load(&db.conn))
}

#[tauri::command(async)]
pub fn social_config_set(app: AppHandle, config: Config) -> R<Config> {
    let c = with_db(&app, |db| config.save(&db.conn, &db.device_id))?;
    if let Some(item) = app.state::<TrayState>().pause.lock().unwrap().as_ref() {
        let _ = item.set_checked(c.paused);
    }
    Ok(c)
}

/// Called by the UI on start so the background runtime knows local time.
#[tauri::command(async)]
pub fn social_clock(app: AppHandle, tz_offset_min: i32) -> R<Config> {
    with_db(&app, |db| {
        let mut c = Config::load(&db.conn)?;
        if c.tz_offset_min != tz_offset_min {
            c.tz_offset_min = tz_offset_min;
            c = c.save(&db.conn, &db.device_id)?;
        }
        Ok(c)
    })
}

// ---------------- characters & memories ----------------

#[derive(Serialize)]
pub struct NpcView {
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
    pub active_hours: Vec<[u8; 2]>,
    pub state: NpcState,
    pub score: f64,
    /// 0 = polite … 3 = very casual, as they currently talk to you.
    pub register_stage: u8,
    pub register_label: String,
    pub online_now: bool,
    pub busy_now: Option<String>,
    pub relations: Vec<(String, String, String)>,
}

#[tauri::command(async)]
pub fn npc_list(app: AppHandle) -> R<Vec<NpcView>> {
    with_db(&app, |db| {
        let cfg = Config::load(&db.conn)?;
        let env = cfg.env(now_ms());
        let mut v = vec![];
        for p in npc::profiles() {
            let st = npc::get_state(&db.conn, &p.id)?;
            let stage = npc::register_stage(p, &st, false);
            v.push(NpcView {
                id: p.id.clone(),
                name: p.name.clone(),
                display: p.display.clone(),
                full_name: p.full_name.clone(),
                age: p.age,
                color: p.color.clone(),
                role: p.role.clone(),
                bio: p.bio.clone(),
                personality: p.personality.clone(),
                interests: p.interests.clone(),
                active_hours: p.behavior.active_hours.clone(),
                score: st.score(),
                register_stage: stage,
                register_label: npc::register_label(stage).into(),
                online_now: npc::is_active(p, env.world.hour),
                busy_now: npc::busy_with(p, env.world.weekday, env.world.hour).map(String::from),
                relations: npc::relations_of(&p.id).into_iter().map(|(o, r)| (o.id.clone(), r.kind.clone(), r.note.clone())).collect(),
                state: st,
            });
        }
        Ok(v)
    })
}

#[tauri::command(async)]
pub fn npc_memories(app: AppHandle, character: String) -> R<Vec<Memory>> {
    with_db(&app, |db| memory::list(&db.conn, &character))
}

#[tauri::command(async)]
pub fn npc_memory_add(app: AppHandle, character: String, fact: String) -> R<()> {
    let fact = fact.trim().to_string();
    if fact.is_empty() || fact.chars().count() > 300 {
        return Err("A memory must be 1–300 characters.".into());
    }
    with_db(&app, |db| memory::add(&db.conn, &db.device_id, &character, &fact, 3, "player", None).map(|_| ()))
}

#[tauri::command(async)]
pub fn npc_memory_correct(app: AppHandle, id: String, fact: String) -> R<()> {
    let fact = fact.trim().to_string();
    if fact.is_empty() || fact.chars().count() > 300 {
        return Err("A memory must be 1–300 characters.".into());
    }
    with_db(&app, |db| memory::correct(&db.conn, &db.device_id, &id, &fact))
}

#[tauri::command(async)]
pub fn npc_memory_delete_all(app: AppHandle, character: String) -> R<usize> {
    with_db(&app, |db| memory::delete_all(&db.conn, &db.device_id, &character))
}

// ---------------- conversations ----------------

#[tauri::command(async)]
pub fn chat_list(app: AppHandle) -> R<Vec<ConversationView>> {
    with_db(&app, |db| chat::list_conversations(&db.conn, now_ms()))
}

#[tauri::command(async)]
pub fn chat_get(app: AppHandle, id: String) -> R<ConversationView> {
    with_db(&app, |db| chat::get_conversation(&db.conn, &id, now_ms()))
}

#[tauri::command(async)]
pub fn chat_messages(app: AppHandle, id: String, before: Option<i64>, limit: Option<i64>) -> R<Vec<Message>> {
    with_db(&app, |db| chat::messages(&db.conn, &id, now_ms(), before, limit.unwrap_or(80)))
}

#[tauri::command(async)]
pub fn chat_send(app: AppHandle, outgoing: Outgoing) -> R<Message> {
    let conv = outgoing.conversation_id.clone();
    let m = with_db(&app, |db| chat::send_player(&db.conn, &db.device_id, &outgoing, true, now_ms()))?;
    emit_changed(&app, vec![conv]);
    Ok(m)
}

/// The phone tells the runtime which chat is on screen (None = none). Opening marks it read.
#[tauri::command(async)]
pub fn chat_open(app: AppHandle, id: Option<String>) -> R<()> {
    *app.state::<Engine>().open_conversation.lock().unwrap() = id.clone();
    if let Some(id) = id {
        with_db(&app, |db| chat::mark_read(&db.conn, &id, now_ms()))?;
        emit_changed(&app, vec![id]);
    }
    Ok(())
}

#[tauri::command(async)]
pub fn chat_mark_read(app: AppHandle, id: String) -> R<()> {
    with_db(&app, |db| chat::mark_read(&db.conn, &id, now_ms()))?;
    emit_changed(&app, vec![id]);
    Ok(())
}

#[tauri::command(async)]
pub fn chat_flag(app: AppHandle, id: String, flag: String, on: bool) -> R<()> {
    with_db(&app, |db| chat::set_flag(&db.conn, &id, &flag, on))?;
    emit_changed(&app, vec![id]);
    Ok(())
}

#[tauri::command(async)]
pub fn chat_draft(app: AppHandle, id: String, body: String) -> R<()> {
    with_db(&app, |db| chat::set_draft(&db.conn, &id, &body))
}

#[tauri::command(async)]
pub fn chat_react(app: AppHandle, message_id: String, emoji: Option<String>) -> R<()> {
    let conv = with_db(&app, |db| {
        chat::react(&db.conn, &message_id, chat::PLAYER, emoji.as_deref())?;
        Ok(chat::get_message(&db.conn, &message_id)?.conversation_id)
    })?;
    emit_changed(&app, vec![conv]);
    Ok(())
}

#[tauri::command(async)]
pub fn chat_retry(app: AppHandle, id: String) -> R<usize> {
    let n = with_db(&app, |db| social::retry(&db.conn, &id))?;
    emit_changed(&app, vec![id]);
    Ok(n)
}

#[tauri::command(async)]
pub fn chat_clear(app: AppHandle, id: String) -> R<()> {
    with_db(&app, |db| chat::clear_history(&db.conn, &id))?;
    emit_changed(&app, vec![id]);
    Ok(())
}

#[tauri::command(async)]
pub fn chat_search(app: AppHandle, q: String) -> R<Vec<SearchHit>> {
    with_db(&app, |db| chat::search(&db.conn, &q, now_ms()))
}

// ---------------- learning help (on demand only) ----------------

#[tauri::command(async)]
pub async fn chat_review(app: AppHandle, id: String) -> R<Review> {
    let now = now_ms();
    let (p, mine) = with_db(&app, |db| {
        let env = Config::load(&db.conn)?.env(now);
        social::prepare_review(&db.conn, &id, &env, now)
    })?;
    let raw = engine::one_shot(&app, Purpose::Review, "review", &p, 1800).await?;
    with_db(&app, |db| social::apply_review(&db.conn, &db.device_id, &id, &raw, &mine))
}

#[tauri::command(async)]
pub fn chat_observations(app: AppHandle, id: String) -> R<Vec<Observation>> {
    with_db(&app, |db| chat::observations(&db.conn, &id))
}

#[tauri::command(async)]
pub async fn chat_hint(app: AppHandle, id: String) -> R<String> {
    let now = now_ms();
    let p = with_db(&app, |db| {
        let env = Config::load(&db.conn)?.env(now);
        social::prepare_hint(&db.conn, &id, &env, now)
    })?;
    Ok(engine::one_shot(&app, Purpose::Chat, "hint", &p, 300).await?.trim().to_string())
}

#[tauri::command(async)]
pub async fn chat_gloss(app: AppHandle, word: String, sentence: String) -> R<String> {
    if word.chars().count() > 40 || sentence.chars().count() > 400 {
        return Err("Selection is too long to explain.".into());
    }
    let p = prompt::gloss_prompt(&word, &sentence);
    Ok(engine::one_shot(&app, Purpose::Chat, "gloss", &p, 300).await?.trim().to_string())
}

// ---------------- notifications, calls, stickers, calendar ----------------

#[tauri::command(async)]
pub fn notifications_list(app: AppHandle) -> R<Vec<Notification>> {
    with_db(&app, |db| chat::notifications(&db.conn))
}

#[tauri::command(async)]
pub fn notifications_seen(app: AppHandle) -> R<()> {
    with_db(&app, |db| chat::mark_notifications_seen(&db.conn))
}

#[tauri::command(async)]
pub fn calls_list(app: AppHandle) -> R<Vec<CallLog>> {
    with_db(&app, |db| chat::calls(&db.conn))
}

/// Voice/video calls need a speech provider that isn't built yet. This records an
/// honest "unavailable" attempt instead of pretending a call happened.
#[tauri::command(async)]
pub fn call_attempt(app: AppHandle, character: String, kind: String) -> R<String> {
    let kind = if kind == "video" { "video" } else { "voice" };
    with_db(&app, |db| chat::log_call(&db.conn, &db.device_id, &character, kind, "unavailable", None))?;
    Ok("Calls aren't available yet — they need a voice provider, which this version doesn't include.".into())
}

#[derive(Serialize)]
pub struct Stickers {
    pub packs: Vec<StickerPack>,
    pub state: StickerState,
}

#[tauri::command(async)]
pub fn stickers_get(app: AppHandle) -> R<Stickers> {
    with_db(&app, |db| Ok(Stickers { packs: npc::sticker_packs().to_vec(), state: chat::sticker_state(&db.conn)? }))
}

#[tauri::command(async)]
pub fn sticker_favorite(app: AppHandle, id: String, fav: bool) -> R<()> {
    with_db(&app, |db| chat::set_favorite(&db.conn, &id, fav))
}

#[tauri::command(async)]
pub fn sticker_buy(app: AppHandle, pack: String) -> R<()> {
    with_db(&app, |db| {
        let day = Config::load(&db.conn)?.env(now_ms()).day;
        chat::buy_pack(&db.conn, &db.device_id, &pack, &day)
    })
}

#[tauri::command(async)]
pub fn calendar_list(app: AppHandle) -> R<Vec<CalendarEvent>> {
    with_db(&app, |db| chat::events(&db.conn))
}

#[tauri::command(async)]
pub fn calendar_status(app: AppHandle, id: String, status: String) -> R<()> {
    with_db(&app, |db| chat::set_event_status(&db.conn, &id, &status))
}

// ---------------- AI setup & consent ----------------

#[derive(Serialize)]
pub struct AiStatus {
    pub config: ProviderConfig,
    pub has_key: bool,
    pub consent: Consent,
    pub ready: bool,
    pub problem: Option<String>,
    pub usage_today: Usage,
    pub daily_budget: i64,
    pub background_budget: i64,
}

fn status(app: &AppHandle) -> R<AiStatus> {
    with_db(app, |db| {
        let config: ProviderConfig = read_setting(db, ai::CONFIG_KEY);
        let consent: Consent = read_setting(db, ai::CONSENT_KEY);
        let cfg = Config::load(&db.conn)?;
        let ready = ai::ready(&config, &consent);
        Ok(AiStatus {
            has_key: ai::get_key(&config.kind).is_some(),
            ready: ready.is_ok(),
            problem: ready.err().map(|e| e.to_string()),
            usage_today: chat::usage(&db.conn, &cfg.env(now_ms()).day)?,
            daily_budget: cfg.social.daily_ai_budget,
            background_budget: cfg.social.background_ai_budget,
            config,
            consent,
        })
    })
}

#[tauri::command(async)]
pub fn ai_status(app: AppHandle) -> R<AiStatus> {
    status(&app)
}

#[tauri::command(async)]
pub fn ai_configure(app: AppHandle, config: ProviderConfig) -> R<AiStatus> {
    let mut c = config;
    c.chat_model = c.chat_model.trim().chars().take(100).collect();
    c.review_model = c.review_model.trim().chars().take(100).collect();
    c.base_url = c.base_url.trim().chars().take(200).collect();
    if c.chat_model.is_empty() || (c.kind != ProviderKind::None && c.review_model.is_empty()) {
        return Err("Model names can't be empty.".into());
    }
    if c.kind == ProviderKind::OpenaiCompat && !(c.base_url.starts_with("http://") || c.base_url.starts_with("https://")) {
        return Err("The server address must start with http:// or https://".into());
    }
    with_db(&app, |db| settings::set(&db.conn, &db.device_id, ai::CONFIG_KEY, &serde_json::to_value(&c).unwrap()))?;
    status(&app)
}

/// The key goes straight to Windows Credential Manager; it is never stored in settings or returned.
#[tauri::command(async)]
pub fn ai_save_key(app: AppHandle, kind: ProviderKind, key: String) -> R<AiStatus> {
    if key.trim().is_empty() {
        return Err("The key is empty.".into());
    }
    ai::set_key(&kind, &key)?;
    status(&app)
}

#[tauri::command(async)]
pub fn ai_clear_key(app: AppHandle, kind: ProviderKind) -> R<AiStatus> {
    ai::clear_key(&kind)?;
    status(&app)
}

#[tauri::command(async)]
pub fn ai_consent(app: AppHandle, granted: bool) -> R<AiStatus> {
    with_db(&app, |db| {
        let config: ProviderConfig = read_setting(db, ai::CONFIG_KEY);
        let c = Consent { granted, at: now_ms(), provider: granted.then_some(config.kind) };
        settings::set(&db.conn, &db.device_id, ai::CONSENT_KEY, &serde_json::to_value(&c).unwrap())
    })?;
    status(&app)
}

/// Sends a tiny fixed prompt (no personal data) to check the connection.
#[tauri::command(async)]
pub async fn ai_test(app: AppHandle) -> R<String> {
    let p = prompt::Prompt { system: "You are a connection test.".into(), user: "Reply with exactly: OK".into() };
    let out = engine::one_shot(&app, Purpose::Chat, "test", &p, 10).await?;
    Ok(out.trim().chars().take(40).collect())
}

// ---------------- privacy ----------------

/// what: "chats" (all message history + summaries), "memories" (all character memories),
/// "observations" (learning notes from reviews).
#[tauri::command(async)]
pub fn social_delete(app: AppHandle, what: String) -> R<usize> {
    let n = with_db(&app, |db| {
        let c = &db.conn;
        match what.as_str() {
            "chats" => {
                let ids: Vec<String> = chat::list_conversations(c, now_ms())?.into_iter().map(|v| v.id).collect();
                for id in &ids {
                    chat::clear_history(c, id)?;
                }
                c.execute("DELETE FROM notifications", [])?;
                Ok(ids.len())
            }
            "memories" => {
                let mut n = 0;
                for p in npc::profiles() {
                    n += memory::delete_all(c, &db.device_id, &p.id)?;
                }
                Ok(n)
            }
            "observations" => Ok(c.execute("DELETE FROM learning_observations", [])?),
            _ => Err(jm_core::CoreError::Invalid("unknown delete target".into())),
        }
    })?;
    let ids = with_db(&app, |db| Ok(chat::list_conversations(&db.conn, now_ms())?.into_iter().map(|v| v.id).collect()))?;
    emit_changed(&app, ids);
    Ok(n)
}

// ---------------- desktop integration ----------------

#[tauri::command(async)]
pub fn autostart_get(app: AppHandle) -> R<bool> {
    app.autolaunch().is_enabled().map_err(|e| e.to_string())
}

/// Opt-in "start with Windows" (starts minimized to the tray).
#[tauri::command(async)]
pub fn autostart_set(app: AppHandle, on: bool) -> R<bool> {
    let a = app.autolaunch();
    if on { a.enable() } else { a.disable() }.map_err(|e| e.to_string())?;
    a.is_enabled().map_err(|e| e.to_string())
}

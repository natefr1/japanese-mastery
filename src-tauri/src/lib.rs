//! Tauri shell: thin command layer over `jm-core`, plus the desktop runtime
//! (AI calls, background delivery, tray, notifications). Domain logic lives in jm-core.

mod ai;
mod engine;
mod social_cmds;

use social_cmds::*;

use jm_core::backup::{BackupInfo, VerifyResult};
use jm_core::io::{ImportMode, ImportReport};
use jm_core::vocab::{VocabInput, VocabItem, VocabStats};
use jm_core::content::{GrammarPoint, Kanji};
use jm_core::reading::Sample;
use jm_core::game::{CharacterState, PassportEntry, PlayerState, QuestCompletion, QuestProgress, QuestReward};
use jm_core::study::{CardRow, Overview, QueueData, ReviewOutcome, ReviewSubmit, SessionSummary, StatsDetail};
use jm_core::{Db, DbPaths, OpenReport};
use serde::Serialize;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::menu::{CheckMenuItem, CheckMenuItemBuilder, MenuBuilder, MenuItemBuilder};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, State, WindowEvent, Wry};
use tauri_plugin_notification::NotificationExt;

#[derive(Default)]
pub(crate) struct TrayState {
    pub pause: Mutex<Option<CheckMenuItem<Wry>>>,
}

pub(crate) struct AppState {
    db: Mutex<Option<Db>>,
    open_report: Option<OpenReport>,
    open_error: Option<String>,
    data_dir: PathBuf,
}

type CmdResult<T> = Result<T, String>;

fn with_db<T>(state: &State<AppState>, f: impl FnOnce(&mut Db) -> jm_core::Result<T>) -> CmdResult<T> {
    let mut guard = state.db.lock().map_err(|_| "database lock poisoned".to_string())?;
    let db = guard
        .as_mut()
        .ok_or_else(|| state.open_error.clone().unwrap_or_else(|| "database is not open".into()))?;
    f(db).map_err(|e| e.to_string())
}

#[derive(Serialize)]
struct AppStatus {
    ok: bool,
    error: Option<String>,
    report: Option<OpenReport>,
    schema_version: i64,
    device_id: String,
    data_dir: String,
    backup_dir: String,
    app_version: String,
}

#[tauri::command(async)]
fn app_status(state: State<AppState>) -> CmdResult<AppStatus> {
    let guard = state.db.lock().map_err(|_| "database lock poisoned".to_string())?;
    let (schema_version, device_id, backup_dir) = match guard.as_ref() {
        Some(db) => (
            db.schema_version().unwrap_or(0),
            db.device_id.clone(),
            db.paths.backup_dir.display().to_string(),
        ),
        None => (0, String::new(), String::new()),
    };
    Ok(AppStatus {
        ok: guard.is_some(),
        error: state.open_error.clone(),
        report: state.open_report.clone(),
        schema_version,
        device_id,
        data_dir: state.data_dir.display().to_string(),
        backup_dir,
        app_version: env!("CARGO_PKG_VERSION").into(),
    })
}

#[tauri::command(async)]
fn vocab_list(state: State<AppState>) -> CmdResult<Vec<VocabItem>> {
    with_db(&state, |db| db.vocab_list())
}

#[tauri::command(async)]
fn vocab_save(state: State<AppState>, input: VocabInput) -> CmdResult<VocabItem> {
    with_db(&state, |db| db.vocab_save(input))
}

#[tauri::command(async)]
fn vocab_delete(state: State<AppState>, id: String) -> CmdResult<()> {
    with_db(&state, |db| db.vocab_delete(&id))
}

#[tauri::command(async)]
fn vocab_restore(state: State<AppState>, id: String) -> CmdResult<()> {
    with_db(&state, |db| db.vocab_restore(&id))
}

#[tauri::command(async)]
fn vocab_stats(state: State<AppState>) -> CmdResult<VocabStats> {
    with_db(&state, |db| db.vocab_stats())
}

#[tauri::command(async)]
fn settings_get(state: State<AppState>) -> CmdResult<serde_json::Map<String, serde_json::Value>> {
    with_db(&state, |db| db.settings())
}

#[tauri::command(async)]
fn settings_set(state: State<AppState>, key: String, value: serde_json::Value) -> CmdResult<()> {
    with_db(&state, |db| db.set_setting(&key, &value))
}

#[tauri::command(async)]
fn vocab_export(state: State<AppState>, path: String, format: String) -> CmdResult<usize> {
    with_db(&state, |db| db.export(&PathBuf::from(path), &format))
}

#[tauri::command(async)]
fn vocab_import(state: State<AppState>, path: String, format: String, mode: ImportMode) -> CmdResult<ImportReport> {
    with_db(&state, |db| db.import(&PathBuf::from(path), &format, mode))
}

#[tauri::command(async)]
fn backup_create(state: State<AppState>, reason: Option<String>) -> CmdResult<BackupInfo> {
    // Only known reasons are accepted; anything else is a manual backup.
    let r = match reason.as_deref() {
        Some("pre-update") => "pre-update",
        _ => "manual",
    };
    with_db(&state, |db| db.backup_create(r))
}

#[tauri::command(async)]
fn backup_list(state: State<AppState>) -> CmdResult<Vec<BackupInfo>> {
    with_db(&state, |db| db.backup_list())
}

#[tauri::command(async)]
fn backup_verify(state: State<AppState>, id: String) -> CmdResult<VerifyResult> {
    with_db(&state, |db| db.backup_verify(&id))
}

#[tauri::command(async)]
fn backup_restore(state: State<AppState>, id: String) -> CmdResult<BackupInfo> {
    with_db(&state, |db| db.backup_restore(&id))
}

// ---------------- Study Center ----------------
#[tauri::command(async)]
fn study_queue(state: State<AppState>, now: i64, day_start: i64) -> CmdResult<QueueData> {
    with_db(&state, |db| db.study_queue(now, day_start))
}
#[tauri::command(async)]
fn review_submit(state: State<AppState>, submit: ReviewSubmit) -> CmdResult<ReviewOutcome> {
    with_db(&state, |db| db.review_submit(submit))
}
#[tauri::command(async)]
fn card_suspend(state: State<AppState>, id: String, suspended: bool) -> CmdResult<()> {
    with_db(&state, |db| db.card_suspend(&id, suspended))
}
#[tauri::command(async)]
fn cards_for_item(state: State<AppState>, item_type: String, item_id: String) -> CmdResult<Vec<CardRow>> {
    with_db(&state, |db| db.cards_for_item(&item_type, &item_id))
}
#[tauri::command(async)]
fn session_start(state: State<AppState>, mode: String, minutes: i64) -> CmdResult<String> {
    with_db(&state, |db| db.session_start(&mode, minutes))
}
#[tauri::command(async)]
fn session_end(state: State<AppState>, id: String, day: String, day_start: i64, goal: i64) -> CmdResult<SessionSummary> {
    with_db(&state, |db| db.session_end(&id, &day, day_start, goal))
}
#[tauri::command(async)]
fn study_overview(state: State<AppState>, now: i64, day_start: i64) -> CmdResult<Overview> {
    with_db(&state, |db| db.study_overview(now, day_start))
}
#[tauri::command(async)]
fn study_stats(state: State<AppState>, day_start: i64) -> CmdResult<StatsDetail> {
    with_db(&state, |db| db.study_stats(day_start))
}
#[tauri::command(async)]
fn grammar_list(state: State<AppState>) -> CmdResult<Vec<GrammarPoint>> {
    with_db(&state, |db| db.grammar_list())
}
#[tauri::command(async)]
fn kanji_list(state: State<AppState>) -> CmdResult<Vec<Kanji>> {
    with_db(&state, |db| db.kanji_list())
}

#[tauri::command(async)]
fn cards_of_type(state: State<AppState>, item_type: String) -> CmdResult<Vec<CardRow>> {
    with_db(&state, |db| db.cards_of_type(&item_type))
}
#[tauri::command(async)]
fn sample_save(state: State<AppState>, sample: Sample) -> CmdResult<Sample> {
    with_db(&state, |db| db.sample_save(sample))
}
#[tauri::command(async)]
fn sample_list(state: State<AppState>) -> CmdResult<Vec<Sample>> {
    with_db(&state, |db| db.sample_list())
}
#[tauri::command(async)]
fn sample_delete(state: State<AppState>, id: String) -> CmdResult<()> {
    with_db(&state, |db| db.sample_delete(&id))
}

// ---------------- 生活 / progression ----------------
#[tauri::command(async)]
fn player_state(state: State<AppState>, day: String) -> CmdResult<PlayerState> {
    with_db(&state, |db| db.player_state(&day))
}
#[tauri::command(async)]
fn quest_complete(state: State<AppState>, completion: QuestCompletion, day: String) -> CmdResult<QuestReward> {
    with_db(&state, |db| db.quest_complete(completion, &day))
}
#[tauri::command(async)]
fn quest_progress(state: State<AppState>) -> CmdResult<Vec<QuestProgress>> {
    with_db(&state, |db| db.quest_progress())
}
#[tauri::command(async)]
fn characters_list(state: State<AppState>) -> CmdResult<Vec<CharacterState>> {
    with_db(&state, |db| db.characters())
}
#[tauri::command(async)]
fn memory_delete(state: State<AppState>, id: String) -> CmdResult<()> {
    with_db(&state, |db| db.memory_delete(&id))
}
#[tauri::command(async)]
fn passport_list(state: State<AppState>) -> CmdResult<Vec<PassportEntry>> {
    with_db(&state, |db| db.passport())
}
#[tauri::command(async)]
fn passport_add_real(state: State<AppState>, title: String, detail: String) -> CmdResult<()> {
    with_db(&state, |db| db.passport_add_real(&title, &detail))
}

fn show_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

fn build_tray(app: &AppHandle) -> tauri::Result<()> {
    let paused = engine::with_db(app, |db| jm_core::social::Config::load(&db.conn)).map(|c| c.paused).unwrap_or(false);
    let open = MenuItemBuilder::with_id("open", "Open Japanese Mastery").build(app)?;
    let pause = CheckMenuItemBuilder::with_id("pause", "Pause character messages").checked(paused).build(app)?;
    let quit = MenuItemBuilder::with_id("quit", "Quit").build(app)?;
    let menu = MenuBuilder::new(app).item(&open).item(&pause).separator().item(&quit).build()?;
    *app.state::<TrayState>().pause.lock().unwrap() = Some(pause.clone());
    let mut tb = TrayIconBuilder::with_id("main")
        .tooltip("Japanese Mastery")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(move |app, ev| match ev.id().as_ref() {
            "open" => show_main(app),
            "pause" => {
                let r = engine::with_db(app, |db| {
                    let mut c = jm_core::social::Config::load(&db.conn)?;
                    c.paused = !c.paused;
                    c.save(&db.conn, &db.device_id)
                });
                if let (Ok(c), Some(item)) = (r, app.state::<TrayState>().pause.lock().unwrap().as_ref()) {
                    let _ = item.set_checked(c.paused);
                }
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, ev| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = ev {
                show_main(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        tb = tb.icon(icon.clone());
    }
    tb.build(app)?;
    Ok(())
}

pub fn run() {
    tauri::Builder::default()
        // Must be first: a second launch focuses the running app instead of starting another engine.
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| show_main(app)))
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_autostart::init(tauri_plugin_autostart::MacosLauncher::LaunchAgent, Some(vec!["--minimized"])))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            let data_dir = app.path().app_data_dir()?;
            let (db, open_report, open_error) = match Db::open(DbPaths::in_dir(&data_dir)) {
                Ok((db, rep)) => {
                    // A failed automatic backup must not block the app from starting.
                    if let Err(e) = db.auto_backup_if_due() {
                        eprintln!("automatic backup failed: {e}");
                    }
                    (Some(db), Some(rep), None)
                }
                Err(e) => (None, None, Some(e.to_string())),
            };
            let db_ok = db.is_some();
            app.manage(AppState { db: Mutex::new(db), open_report, open_error, data_dir });
            app.manage(engine::Engine::default());
            app.manage(TrayState::default());
            let handle = app.handle().clone();
            if let Err(e) = build_tray(&handle) {
                eprintln!("tray unavailable: {e}");
            }
            // Started by Windows at login (opt-in): stay in the tray.
            if !std::env::args().any(|a| a == "--minimized") {
                show_main(&handle);
            }
            if db_ok {
                engine::start(handle);
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            let app = window.app_handle();
            match event {
                WindowEvent::Focused(f) => {
                    app.state::<engine::Engine>().window_focused.store(*f, std::sync::atomic::Ordering::Relaxed);
                }
                WindowEvent::CloseRequested { api, .. } => {
                    let to_tray = engine::with_db(app, |db| jm_core::social::Config::load(&db.conn)).map(|c| c.close_to_tray).unwrap_or(false);
                    if to_tray && app.tray_by_id("main").is_some() {
                        api.prevent_close();
                        let _ = window.hide();
                        let eng = app.state::<engine::Engine>();
                        eng.window_focused.store(false, std::sync::atomic::Ordering::Relaxed);
                        if !eng.tray_hint_shown.swap(true, std::sync::atomic::Ordering::Relaxed) {
                            let _ = app
                                .notification()
                                .builder()
                                .title("Still running in the tray")
                                .body("Your friends can still message you. Right-click the tray icon to pause or quit.")
                                .show();
                        }
                    }
                }
                _ => {}
            }
        })
        .invoke_handler(tauri::generate_handler![
            app_status,
            vocab_list,
            vocab_save,
            vocab_delete,
            vocab_restore,
            vocab_stats,
            settings_get,
            settings_set,
            vocab_export,
            vocab_import,
            backup_create,
            backup_list,
            backup_verify,
            backup_restore,
            study_queue,
            review_submit,
            card_suspend,
            cards_for_item,
            session_start,
            session_end,
            study_overview,
            study_stats,
            grammar_list,
            kanji_list,
            player_state,
            quest_complete,
            quest_progress,
            characters_list,
            memory_delete,
            passport_list,
            passport_add_real,
            cards_of_type,
            sample_save,
            sample_list,
            sample_delete,
            social_config_get,
            social_config_set,
            social_clock,
            npc_list,
            npc_memories,
            npc_memory_add,
            npc_memory_correct,
            npc_memory_delete_all,
            chat_list,
            chat_get,
            chat_messages,
            chat_send,
            chat_open,
            chat_mark_read,
            chat_flag,
            chat_draft,
            chat_react,
            chat_retry,
            chat_clear,
            chat_search,
            chat_review,
            chat_observations,
            chat_hint,
            chat_gloss,
            notifications_list,
            notifications_seen,
            calls_list,
            call_attempt,
            stickers_get,
            sticker_favorite,
            sticker_buy,
            calendar_list,
            calendar_status,
            ai_status,
            ai_configure,
            ai_save_key,
            ai_clear_key,
            ai_consent,
            ai_test,
            social_delete,
            autostart_get,
            autostart_set
        ])
        .run(tauri::generate_context!())
        .expect("error while running Japanese Mastery");
}

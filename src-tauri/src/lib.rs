//! Tauri shell: thin command layer over `jm-core`. No business logic lives here.

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
use tauri::{Manager, State};

struct AppState {
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

pub fn run() {
    tauri::Builder::default()
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
            app.manage(AppState { db: Mutex::new(db), open_report, open_error, data_dir });
            Ok(())
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
            sample_delete
        ])
        .run(tauri::generate_context!())
        .expect("error while running Japanese Mastery");
}

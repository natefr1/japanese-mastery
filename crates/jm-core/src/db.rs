//! The live database handle: opening, durability settings, migration with a
//! pre-migration backup, corruption recovery, and transaction-wrapped operations.

use crate::io::{self, ImportMode, ImportReport};
use crate::vocab::{self, VocabInput, VocabItem, VocabStats};
use crate::{backup, chat, content, game, migrations, new_id, npc, reading, seed, settings, study, CoreError, Result};
use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::Duration;

#[derive(Debug, Clone)]
pub struct DbPaths {
    pub db_file: PathBuf,
    pub backup_dir: PathBuf,
}

impl DbPaths {
    pub fn in_dir(dir: &Path) -> Self {
        Self { db_file: dir.join("japanese-mastery.sqlite"), backup_dir: dir.join("backups") }
    }
}

#[derive(Debug, Clone, Serialize, Default)]
pub struct OpenReport {
    pub created_new: bool,
    pub migrated_from: i64,
    pub migrated_to: i64,
    pub seeded: usize,
    pub pre_migration_backup: Option<String>,
    /// Set when the database was damaged and replaced from a backup.
    pub recovered_from_backup: Option<String>,
    pub quarantined_file: Option<String>,
}

pub struct Db {
    pub conn: Connection,
    pub paths: DbPaths,
    pub device_id: String,
}

fn configure(conn: &Connection) -> Result<()> {
    let _: String = conn.query_row("PRAGMA journal_mode=WAL", [], |r| r.get(0))?;
    // FULL: a committed transaction survives power loss, not just app crashes.
    conn.pragma_update(None, "synchronous", "FULL")?;
    conn.pragma_update(None, "foreign_keys", "ON")?;
    conn.busy_timeout(Duration::from_secs(5))?;
    Ok(())
}

fn healthy(conn: &Connection) -> bool {
    conn.query_row("PRAGMA quick_check", [], |r| r.get::<_, String>(0))
        .map(|s| s == "ok")
        .unwrap_or(false)
}

fn open_conn(path: &Path) -> Result<Connection> {
    let conn = Connection::open(path)?;
    configure(&conn)?;
    if !healthy(&conn) {
        return Err(CoreError::Corrupt("quick_check failed".into()));
    }
    Ok(conn)
}

/// Only real damage triggers recovery; e.g. a locked file must not.
fn is_corruption(e: &CoreError) -> bool {
    use rusqlite::ErrorCode::{DatabaseCorrupt, NotADatabase};
    match e {
        CoreError::Corrupt(_) => true,
        CoreError::Sqlite(rusqlite::Error::SqliteFailure(f, _)) => matches!(f.code, DatabaseCorrupt | NotADatabase),
        _ => false,
    }
}

/// Moves a damaged DB (and its WAL/SHM sidecars) aside instead of deleting it.
fn quarantine(db_file: &Path) -> Result<PathBuf> {
    let stamp = crate::now_ms();
    let dest = db_file.with_extension(format!("corrupt-{stamp}.sqlite"));
    fs::rename(db_file, &dest)?;
    for ext in ["sqlite-wal", "sqlite-shm"] {
        let side = db_file.with_extension(ext);
        if side.exists() {
            let _ = fs::rename(&side, dest.with_extension(format!("{ext}")));
        }
    }
    Ok(dest)
}

impl Db {
    /// Opens (or creates) the database, recovering from a verified backup if the
    /// file is damaged, backing up before any migration, migrating, and seeding.
    pub fn open(paths: DbPaths) -> Result<(Db, OpenReport)> {
        if let Some(parent) = paths.db_file.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::create_dir_all(&paths.backup_dir)?;
        let mut report = OpenReport::default();
        let existed = paths.db_file.metadata().map(|m| m.len() > 0).unwrap_or(false);
        report.created_new = !existed;

        let mut conn = match open_conn(&paths.db_file) {
            Ok(c) => c,
            Err(e) if existed && is_corruption(&e) => {
                // Damaged: keep the bad file for inspection, restore newest good backup.
                let bad = quarantine(&paths.db_file)?;
                report.quarantined_file = Some(bad.display().to_string());
                match backup::latest_verified(&paths.backup_dir)? {
                    Some(b) => {
                        fs::copy(backup::backup_path(&paths.backup_dir, &b), &paths.db_file)?;
                        report.recovered_from_backup = Some(b.id.clone());
                        open_conn(&paths.db_file)?
                    }
                    None => {
                        return Err(CoreError::Corrupt(format!(
                            "{e}. The damaged file was kept at {} and no valid backup exists.",
                            bad.display()
                        )))
                    }
                }
            }
            Err(e) => return Err(e),
        };

        let pending = migrations::pending(&conn)?;
        if (existed || report.recovered_from_backup.is_some()) && !pending.is_empty() && migrations::current_version(&conn)? > 0 {
            let target = migrations::latest_version();
            let b = backup::create(&conn, &paths.backup_dir, &format!("pre-migration-v{target}"))?;
            report.pre_migration_backup = Some(b.id);
        }
        let (from, to) = migrations::migrate(&mut conn)?;
        report.migrated_from = from;
        report.migrated_to = to;

        let device_id = {
            let existing: Option<String> = conn
                .query_row("SELECT value FROM meta WHERE key = 'device_id'", [], |r| r.get(0))
                .optional()?;
            match existing {
                Some(d) => d,
                None => {
                    let d = new_id();
                    conn.execute("INSERT INTO meta(key, value) VALUES ('device_id', ?1)", params![d])?;
                    d
                }
            }
        };

        let mut db = Db { conn, paths, device_id };
        report.seeded = db.tx(|c, dev| {
            let n = seed::apply(c, dev)?;
            seed::apply_manga(c, dev)?;
            seed::apply_core(c, dev)?;
            content::apply_grammar_seed(c, dev)?;
            content::apply_kanji_seed(c, dev)?;
            game::ensure_characters(c, dev)?;
            npc::seed(c, dev)?;
            chat::seed(c, dev)?;
            study::ensure_cards(c, dev)?;
            Ok(n)
        })?;
        Ok((db, report))
    }

    /// Runs `f` inside a transaction; commits only if it returns Ok.
    pub fn tx<T>(&mut self, f: impl FnOnce(&Connection, &str) -> Result<T>) -> Result<T> {
        let dev = self.device_id.clone();
        let tx = self.conn.transaction()?;
        let out = f(&tx, &dev)?;
        tx.commit()?;
        Ok(out)
    }

    pub fn schema_version(&self) -> Result<i64> {
        migrations::current_version(&self.conn)
    }

    // ---- vocabulary ----
    pub fn vocab_list(&self) -> Result<Vec<VocabItem>> {
        vocab::list(&self.conn)
    }
    pub fn vocab_get(&self, id: &str) -> Result<VocabItem> {
        vocab::get(&self.conn, id)
    }
    pub fn vocab_save(&mut self, input: VocabInput) -> Result<VocabItem> {
        let id = self.tx(|c, d| {
            let src = match &input.id {
                Some(id) if vocab::exists(c, id)? => vocab::get(c, id)?.source,
                _ => "user".to_string(),
            };
            let id = vocab::upsert(c, d, input, &src)?;
            study::ensure_cards(c, d)?;
            Ok(id)
        })?;
        self.vocab_get(&id)
    }
    pub fn vocab_delete(&mut self, id: &str) -> Result<()> {
        self.tx(|c, d| vocab::soft_delete(c, d, id))
    }
    pub fn vocab_restore(&mut self, id: &str) -> Result<()> {
        self.tx(|c, d| vocab::restore(c, d, id))
    }
    pub fn vocab_stats(&self) -> Result<VocabStats> {
        vocab::stats(&self.conn)
    }

    // ---- settings ----
    pub fn settings(&self) -> Result<serde_json::Map<String, serde_json::Value>> {
        settings::all(&self.conn)
    }
    pub fn set_setting(&mut self, key: &str, value: &serde_json::Value) -> Result<()> {
        self.tx(|c, d| settings::set(c, d, key, value))
    }

    // ---- import / export ----
    pub fn export(&self, path: &Path, format: &str) -> Result<usize> {
        match format {
            "json" => io::export_json(&self.conn, path),
            "csv" => io::export_csv(&self.conn, path),
            f => Err(CoreError::Invalid(format!("unknown export format '{f}'"))),
        }
    }

    /// Imports a JSON or CSV file atomically, taking a backup first.
    pub fn import(&mut self, path: &Path, format: &str, mode: ImportMode) -> Result<ImportReport> {
        let text = fs::read_to_string(path)?;
        let inputs = match format {
            "json" => io::parse_json(&text)?,
            "csv" => io::parse_csv(&text)?,
            f => return Err(CoreError::Invalid(format!("unknown import format '{f}'"))),
        };
        backup::create(&self.conn, &self.paths.backup_dir, "pre-import")?;
        let source = format!("import:{format}");
        let rep = self.tx(|c, d| {
            let r = io::apply_inputs(c, d, inputs, mode, &source)?;
            study::ensure_cards(c, d)?;
            Ok(r)
        })?;
        backup::prune_automatic(&self.paths.backup_dir, backup::KEEP_AUTO)?;
        Ok(rep)
    }

    // ---- backups ----
    pub fn backup_create(&self, reason: &str) -> Result<backup::BackupInfo> {
        let b = backup::create(&self.conn, &self.paths.backup_dir, reason)?;
        backup::prune_automatic(&self.paths.backup_dir, backup::KEEP_AUTO)?;
        Ok(b)
    }
    pub fn backup_list(&self) -> Result<Vec<backup::BackupInfo>> {
        backup::list(&self.paths.backup_dir)
    }
    pub fn backup_verify(&self, id: &str) -> Result<backup::VerifyResult> {
        backup::verify(&self.paths.backup_dir, id)
    }
    /// Restores a backup, then brings it up to the current schema.
    pub fn backup_restore(&mut self, id: &str) -> Result<backup::BackupInfo> {
        let info = backup::restore_into(&mut self.conn, &self.paths.backup_dir, id)?;
        configure(&self.conn)?;
        migrations::migrate(&mut self.conn)?;
        // The restored DB may come from another device id era; keep ours.
        let dev = self.device_id.clone();
        self.conn.execute(
            "INSERT INTO meta(key, value) VALUES ('device_id', ?1) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![dev],
        )?;
        Ok(info)
    }
    // ---- study ----
    pub fn study_queue(&self, now: i64, day_start: i64) -> Result<study::QueueData> {
        study::queue_data(&self.conn, now, day_start)
    }
    pub fn review_submit(&mut self, s: study::ReviewSubmit) -> Result<study::ReviewOutcome> {
        self.tx(|c, d| study::submit_review(c, d, s))
    }
    pub fn card_suspend(&mut self, id: &str, suspended: bool) -> Result<()> {
        self.tx(|c, d| study::set_suspended(c, d, id, suspended))
    }
    pub fn cards_for_item(&self, item_type: &str, item_id: &str) -> Result<Vec<study::CardRow>> {
        study::cards_for_item(&self.conn, item_type, item_id)
    }
    pub fn session_start(&mut self, mode: &str, minutes: i64) -> Result<String> {
        self.tx(|c, d| study::session_start(c, d, mode, minutes))
    }
    pub fn session_end(&mut self, id: &str, day: &str, day_start: i64, goal: i64) -> Result<study::SessionSummary> {
        self.tx(|c, d| study::session_end(c, d, id, day, day_start, goal))
    }
    pub fn study_overview(&self, now: i64, day_start: i64) -> Result<study::Overview> {
        study::overview(&self.conn, now, day_start)
    }
    pub fn study_stats(&self, day_start: i64) -> Result<study::StatsDetail> {
        study::stats_detail(&self.conn, day_start)
    }
    pub fn grammar_list(&self) -> Result<Vec<content::GrammarPoint>> {
        content::list_grammar(&self.conn)
    }
    pub fn kanji_list(&self) -> Result<Vec<content::Kanji>> {
        content::list_kanji(&self.conn)
    }

    pub fn cards_of_type(&self, item_type: &str) -> Result<Vec<study::CardRow>> {
        study::cards_of_type(&self.conn, item_type)
    }

    // ---- reading samples ----
    pub fn sample_save(&mut self, s: reading::Sample) -> Result<reading::Sample> {
        self.tx(|c, d| reading::save(c, d, s))
    }
    pub fn sample_list(&self) -> Result<Vec<reading::Sample>> {
        reading::list(&self.conn)
    }
    pub fn sample_delete(&mut self, id: &str) -> Result<()> {
        self.tx(|c, d| reading::delete(c, d, id))
    }

    // ---- game ----
    pub fn player_state(&self, day: &str) -> Result<game::PlayerState> {
        game::validate_day(day)?;
        game::player_state(&self.conn, day)
    }
    pub fn quest_complete(&mut self, q: game::QuestCompletion, day: &str) -> Result<game::QuestReward> {
        game::validate_day(day)?;
        self.tx(|c, d| game::complete_quest(c, d, q, day))
    }
    pub fn quest_progress(&self) -> Result<Vec<game::QuestProgress>> {
        game::quest_progress(&self.conn)
    }
    pub fn characters(&self) -> Result<Vec<game::CharacterState>> {
        game::characters(&self.conn)
    }
    pub fn memory_delete(&mut self, id: &str) -> Result<()> {
        self.tx(|c, d| game::delete_memory(c, d, id))
    }
    pub fn passport(&self) -> Result<Vec<game::PassportEntry>> {
        game::passport(&self.conn)
    }
    pub fn passport_add_real(&mut self, title: &str, detail: &str) -> Result<()> {
        self.tx(|c, d| game::add_real_passport(c, d, title, detail))
    }

    /// Daily automatic backup (call at startup). Returns the backup if one was made.
    pub fn auto_backup_if_due(&self) -> Result<Option<backup::BackupInfo>> {
        const DAY: i64 = 24 * 60 * 60 * 1000;
        if backup::auto_due(&self.paths.backup_dir, DAY)? {
            return Ok(Some(self.backup_create("auto-daily")?));
        }
        Ok(None)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn open_creates_seeds_and_reopens_without_reseeding() {
        let t = tempfile::tempdir().unwrap();
        let paths = DbPaths::in_dir(t.path());
        let (mut db, rep) = Db::open(paths.clone()).unwrap();
        assert!(rep.created_new);
        assert_eq!(rep.seeded, 385);
        let dev = db.device_id.clone();
        let total = db.vocab_list().unwrap().len();
        assert!(total > 3000, "website + manga + core decks");
        let id = db.vocab_list().unwrap()[0].id.clone();
        db.vocab_delete(&id).unwrap();
        drop(db);
        let (db, rep) = Db::open(paths).unwrap();
        assert!(!rep.created_new);
        assert_eq!(rep.seeded, 0);
        assert_eq!(db.device_id, dev);
        assert_eq!(db.vocab_list().unwrap().len(), total - 1);
    }

    #[test]
    fn recovers_from_corrupt_file_using_latest_backup() {
        let t = tempfile::tempdir().unwrap();
        let paths = DbPaths::in_dir(t.path());
        let total;
        {
            let (db, _) = Db::open(paths.clone()).unwrap();
            total = db.vocab_list().unwrap().len();
            db.backup_create("manual").unwrap();
            db.conn.execute_batch("PRAGMA wal_checkpoint(TRUNCATE);").unwrap();
        }
        fs::write(&paths.db_file, b"this is not a sqlite database at all, it is garbage............").unwrap();
        let _ = fs::remove_file(paths.db_file.with_extension("sqlite-wal"));
        let _ = fs::remove_file(paths.db_file.with_extension("sqlite-shm"));
        let (db, rep) = Db::open(paths).unwrap();
        assert!(rep.recovered_from_backup.is_some());
        assert!(rep.quarantined_file.is_some());
        assert_eq!(db.vocab_list().unwrap().len(), total);
    }

    #[test]
    fn upgrades_m1_database_preserving_data_with_backup_first() {
        let t = tempfile::tempdir().unwrap();
        let paths = DbPaths::in_dir(t.path());
        std::fs::create_dir_all(&paths.backup_dir).unwrap();
        // Build a database exactly as Milestone 1 left it (schema v1, edited by the user).
        {
            let c = Connection::open(&paths.db_file).unwrap();
            c.execute_batch(migrations::MIGRATIONS[0].sql).unwrap();
            c.pragma_update(None, "user_version", 1).unwrap();
            // Insert the website words with v1 columns only, as Milestone 1 did.
            let seed: serde_json::Value = serde_json::from_str(include_str!("../seed/vocab_v1.json")).unwrap();
            for it in seed["items"].as_array().unwrap() {
                let (w, r, t) = (it["word"].as_str().unwrap(), it["reading"].as_str().unwrap(), it["word_type"].as_str().unwrap());
                c.execute(
                    "INSERT INTO vocab_items (id, word, reading, meaning, word_type, level, category, note, source, created_at, updated_at, rev, device_id)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'seed:v1', 1, 1, 1, 'm1-device')",
                    params![seed::seed_id(w, r, t), w, r, it["meaning"].as_str().unwrap(), t, it["level"].as_str().unwrap(), it["category"].as_str().unwrap(), it["note"].as_str().unwrap()],
                ).unwrap();
            }
            c.execute("INSERT INTO meta(key, value) VALUES ('seed.vocab_v1', '1')", []).unwrap();
            c.execute("INSERT INTO meta(key, value) VALUES ('device_id', 'm1-device')", []).unwrap();
            c.execute("UPDATE vocab_items SET personal_note='mine' WHERE word='行く'", []).unwrap();
        }
        let (db, rep) = Db::open(paths.clone()).unwrap();
        assert_eq!((rep.migrated_from, rep.migrated_to), (1, migrations::latest_version()));
        assert!(rep.pre_migration_backup.is_some());
        assert_eq!(rep.seeded, 0);
        assert_eq!(db.device_id, "m1-device");
        let v = db.vocab_list().unwrap();
        assert!(v.len() > 3000, "manga + core packs added on upgrade");
        assert_eq!(v.iter().filter(|x| x.source == "seed:v1").count(), 385);
        assert_eq!(v.iter().find(|x| x.word == "行く").unwrap().personal_note, "mine");
        assert!(db.study_queue(crate::now_ms(), 0).unwrap().new_candidates.len() > 385);
        assert!(!db.grammar_list().unwrap().is_empty());
        // The pre-migration backup is a valid v1 database.
        let b = &db.backup_list().unwrap()[0];
        assert_eq!(b.schema_version, 1);
        assert!(db.backup_verify(&b.id).unwrap().ok);
    }

    #[test]
    fn auto_backup_runs_once_per_day() {
        let t = tempfile::tempdir().unwrap();
        let (db, _) = Db::open(DbPaths::in_dir(t.path())).unwrap();
        assert!(db.auto_backup_if_due().unwrap().is_some());
        assert!(db.auto_backup_if_due().unwrap().is_none());
    }

    #[test]
    fn failed_import_changes_nothing() {
        let t = tempfile::tempdir().unwrap();
        let (mut db, _) = Db::open(DbPaths::in_dir(t.path())).unwrap();
        let before = db.vocab_list().unwrap().len();
        let p = t.path().join("bad.json");
        fs::write(&p, "{ not json").unwrap();
        assert!(db.import(&p, "json", ImportMode::UpdateExisting).is_err());
        assert_eq!(db.vocab_list().unwrap().len(), before);
    }
}

#[cfg(test)]
mod social_upgrade_tests {
    use super::*;
    use crate::{chat, migrations, social};

    /// A v0.2.0 database (schema v2, with quest memories and old friendship values)
    /// upgraded to v3 must be able to run the whole reply path.
    #[test]
    fn upgraded_v2_database_can_prepare_and_apply_replies() {
        let t2 = tempfile::tempdir().unwrap();
        let p2 = DbPaths::in_dir(t2.path());
        std::fs::create_dir_all(&p2.backup_dir).unwrap();
        {
            let c = Connection::open(&p2.db_file).unwrap();
            c.execute_batch(migrations::MIGRATIONS[0].sql).unwrap();
            c.execute_batch(migrations::MIGRATIONS[1].sql).unwrap();
            c.pragma_update(None, "user_version", 2).unwrap();
            c.execute("INSERT INTO meta(key, value) VALUES ('device_id', 'v2-device')", []).unwrap();
        }
        // Let v0.2.0's seeding run, then add quest memories like a real player would have.
        {
            let (db, _) = Db::open(p2.clone()).unwrap();
            db.conn.execute(
                "INSERT INTO character_memories (id, character_id, fact, source, created_at, updated_at, rev, device_id)
                 VALUES ('m-old', 'haruto', 'Player likes FPS games', 'quest:haruto-game-night', 1, 1, 1, 'v2-device')", []).unwrap();
            let now = crate::now_ms();
            chat::send_player(&db.conn, &db.device_id, &chat::Outgoing { conversation_id: "dm-haruto".into(), kind: "text".into(), body: "今日なにしてる？".into(), sticker_id: None }, true, now).unwrap();
            let cfg = social::Config::load(&db.conn).unwrap();
            let env = cfg.env(now + 5000);
            assert_eq!(chat::conversations_with_pending(&db.conn).unwrap(), vec!["dm-haruto".to_string()]);
            let job = social::prepare_reply(&db.conn, "dm-haruto", &env, now + 5000).unwrap().expect("job");
            let usage = chat::usage(&db.conn, &env.day).unwrap();
            assert_eq!(usage.requests, 0);
            let raw = "```json\n{\"messages\":[{\"type\":\"text\",\"text\":\"家でゲームしてる\"}]}\n```";
            social::apply(&db.conn, &db.device_id, &job, raw, &env, now + 5000, &mut crate::prompt::Rng::new(1)).unwrap();
            chat::deliver_due(&db.conn, now + 3_600_000).unwrap();
            let msgs = chat::messages(&db.conn, "dm-haruto", now + 3_600_000, None, 50).unwrap();
            assert!(msgs.iter().any(|m| m.body == "家でゲームしてる"));
            chat::mark_read(&db.conn, "dm-haruto", now + 3_600_000).unwrap();
            assert_eq!(chat::get_conversation(&db.conn, "dm-haruto", now + 3_600_000).unwrap().unread, 0, "opening a chat clears unread");
        }
    }
}

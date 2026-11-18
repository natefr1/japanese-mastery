//! JSON / CSV import and export of vocabulary.
//!
//! JSON is the lossless format (keeps ids, so re-importing on another device
//! matches the same items). CSV is for spreadsheets and other tools.
//! Imports run in ONE transaction: either the whole file applies or nothing does.

use crate::vocab::{self, Example, VocabInput, VocabItem};
use crate::{now_ms, CoreError, Result};
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;

pub const JSON_FORMAT: &str = "japanese-mastery.vocab";
pub const JSON_VERSION: u32 = 1;
const MAX_CSV_EXAMPLES: usize = 5;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum ImportMode {
    /// Keep existing items untouched when a match is found.
    SkipExisting,
    /// Overwrite matched items with the imported version.
    UpdateExisting,
}

#[derive(Debug, Default, Serialize)]
pub struct ImportReport {
    pub added: usize,
    pub updated: usize,
    pub skipped: usize,
    pub errors: Vec<String>,
}

#[derive(Serialize, Deserialize)]
struct JsonEnvelope {
    format: String,
    version: u32,
    #[serde(default)]
    exported_at: i64,
    items: Vec<VocabInput>,
}

fn to_input(it: &VocabItem) -> VocabInput {
    VocabInput {
        id: Some(it.id.clone()),
        word: it.word.clone(),
        reading: it.reading.clone(),
        meaning: it.meaning.clone(),
        word_type: it.word_type.clone(),
        level: it.level.clone(),
        category: it.category.clone(),
        note: it.note.clone(),
        personal_note: it.personal_note.clone(),
        pitch_accent: it.pitch_accent.clone(),
        tags: it.tags.clone(),
        examples: it.examples.clone(),
        freq_rank: it.freq_rank,
    }
}

fn write_atomic(path: &Path, bytes: &[u8]) -> Result<()> {
    let tmp = path.with_extension("partial");
    fs::write(&tmp, bytes)?;
    fs::rename(&tmp, path)?;
    Ok(())
}

pub fn export_json(conn: &Connection, path: &Path) -> Result<usize> {
    let items = vocab::list(conn)?;
    let env = JsonEnvelope {
        format: JSON_FORMAT.into(),
        version: JSON_VERSION,
        exported_at: now_ms(),
        items: items.iter().map(to_input).collect(),
    };
    write_atomic(path, &serde_json::to_vec_pretty(&env)?)?;
    Ok(items.len())
}

fn csv_headers() -> Vec<String> {
    let mut h: Vec<String> = ["id", "word", "reading", "meaning", "word_type", "level", "category", "note", "personal_note", "tags"]
        .iter()
        .map(|s| s.to_string())
        .collect();
    for i in 1..=MAX_CSV_EXAMPLES {
        h.push(format!("example{i}_jp"));
        h.push(format!("example{i}_en"));
    }
    h
}

pub fn export_csv(conn: &Connection, path: &Path) -> Result<usize> {
    let items = vocab::list(conn)?;
    // UTF-8 BOM so Excel opens Japanese text correctly.
    let mut buf: Vec<u8> = vec![0xEF, 0xBB, 0xBF];
    {
        let mut w = csv::Writer::from_writer(&mut buf);
        w.write_record(csv_headers())?;
        for it in &items {
            let mut rec = vec![
                it.id.clone(), it.word.clone(), it.reading.clone(), it.meaning.clone(), it.word_type.clone(),
                it.level.clone(), it.category.clone(), it.note.clone(), it.personal_note.clone(), it.tags.join(";"),
            ];
            for i in 0..MAX_CSV_EXAMPLES {
                let e = it.examples.get(i);
                rec.push(e.map(|e| e.jp.clone()).unwrap_or_default());
                rec.push(e.map(|e| e.en.clone()).unwrap_or_default());
            }
            w.write_record(rec)?;
        }
        w.flush()?;
    }
    write_atomic(path, &buf)?;
    Ok(items.len())
}

/// Applies parsed inputs. Must be called inside a transaction.
pub fn apply_inputs(conn: &Connection, device_id: &str, inputs: Vec<VocabInput>, mode: ImportMode, source: &str) -> Result<ImportReport> {
    let mut rep = ImportReport::default();
    for (n, raw) in inputs.into_iter().enumerate() {
        let mut inp = match raw.normalize() {
            Ok(i) => i,
            Err(e) => {
                rep.errors.push(format!("row {}: {e}", n + 1));
                continue;
            }
        };
        // Match by id first (lossless round-trips), then by spelling + reading.
        let matched = match &inp.id {
            Some(id) if vocab::exists(conn, id)? => Some(id.clone()),
            _ => vocab::find_duplicate(conn, &inp.word, &inp.reading)?,
        };
        match matched {
            Some(id) if mode == ImportMode::SkipExisting => {
                let _ = id;
                rep.skipped += 1;
            }
            Some(id) => {
                inp.id = Some(id);
                vocab::upsert(conn, device_id, inp, source)?;
                rep.updated += 1;
            }
            None => {
                // Keep a valid UUID from the file; otherwise generate one.
                if let Some(id) = &inp.id {
                    if uuid::Uuid::parse_str(id).is_err() {
                        inp.id = None;
                    }
                }
                vocab::upsert(conn, device_id, inp, source)?;
                rep.added += 1;
            }
        }
    }
    Ok(rep)
}

pub fn parse_json(text: &str) -> Result<Vec<VocabInput>> {
    let text = text.trim_start_matches('\u{feff}');
    // Accept our envelope, or a bare array of items.
    if let Ok(env) = serde_json::from_str::<JsonEnvelope>(text) {
        if env.format != JSON_FORMAT {
            return Err(CoreError::Invalid(format!("unrecognized file format '{}'", env.format)));
        }
        if env.version > JSON_VERSION {
            return Err(CoreError::Invalid(format!("export version {} is newer than this app supports", env.version)));
        }
        return Ok(env.items);
    }
    Ok(serde_json::from_str::<Vec<VocabInput>>(text)?)
}

pub fn parse_csv(text: &str) -> Result<Vec<VocabInput>> {
    let text = text.trim_start_matches('\u{feff}');
    let mut r = csv::ReaderBuilder::new().flexible(true).trim(csv::Trim::All).from_reader(text.as_bytes());
    let headers: Vec<String> = r.headers()?.iter().map(|h| h.trim().to_ascii_lowercase()).collect();
    let col = |name: &str| headers.iter().position(|h| h == name);
    let alias = |names: &[&str]| names.iter().find_map(|n| col(n));
    let (c_word, c_reading, c_meaning) = (
        alias(&["word", "kanji", "japanese", "expression"]),
        alias(&["reading", "kana", "furigana"]),
        alias(&["meaning", "english", "definition", "translation"]),
    );
    if c_meaning.is_none() || (c_word.is_none() && c_reading.is_none()) {
        return Err(CoreError::Invalid(
            "CSV needs a 'meaning' column and a 'word' or 'reading' column".into(),
        ));
    }
    let (c_id, c_type, c_level, c_cat, c_note, c_pnote, c_tags) = (
        col("id"), alias(&["word_type", "type"]), alias(&["level", "jlpt"]), col("category"),
        col("note"), col("personal_note"), col("tags"),
    );
    let mut out = vec![];
    for rec in r.records() {
        let rec = rec?;
        let get = |c: Option<usize>| c.and_then(|i| rec.get(i)).unwrap_or("").to_string();
        let mut examples = vec![];
        for i in 1..=10 {
            let jp = get(col(&format!("example{i}_jp")));
            if !jp.is_empty() {
                examples.push(Example { jp, en: get(col(&format!("example{i}_en"))) });
            }
        }
        let id = get(c_id);
        out.push(VocabInput {
            id: if id.is_empty() { None } else { Some(id) },
            word: get(c_word),
            reading: get(c_reading),
            meaning: get(c_meaning),
            word_type: get(c_type),
            level: get(c_level),
            category: get(c_cat),
            note: get(c_note),
            personal_note: get(c_pnote),
            pitch_accent: None,
            tags: get(c_tags).split([';', ',']).map(|s| s.trim().to_string()).filter(|s| !s.is_empty()).collect(),
            examples,
            freq_rank: None,
        });
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{migrations, seed};

    fn db() -> Connection {
        let mut c = Connection::open_in_memory().unwrap();
        migrations::migrate(&mut c).unwrap();
        seed::apply(&c, "dev").unwrap();
        c
    }

    #[test]
    fn json_roundtrip_matches_by_id() {
        let t = tempfile::tempdir().unwrap();
        let p = t.path().join("v.json");
        let c = db();
        assert_eq!(export_json(&c, &p).unwrap(), 385);
        let inputs = parse_json(&fs::read_to_string(&p).unwrap()).unwrap();
        let rep = apply_inputs(&c, "dev", inputs.clone(), ImportMode::SkipExisting, "import:json").unwrap();
        assert_eq!((rep.added, rep.skipped), (0, 385));
        // Into an empty DB everything is added with the same ids.
        let mut c2 = Connection::open_in_memory().unwrap();
        migrations::migrate(&mut c2).unwrap();
        let rep = apply_inputs(&c2, "dev2", inputs, ImportMode::SkipExisting, "import:json").unwrap();
        assert_eq!(rep.added, 385);
        assert_eq!(vocab::list(&c).unwrap()[0].id, vocab::list(&c2).unwrap()[0].id);
    }

    #[test]
    fn csv_roundtrip_and_update_mode() {
        let t = tempfile::tempdir().unwrap();
        let p = t.path().join("v.csv");
        let c = db();
        export_csv(&c, &p).unwrap();
        let mut inputs = parse_csv(&fs::read_to_string(&p).unwrap()).unwrap();
        assert_eq!(inputs.len(), 385);
        assert_eq!(inputs[0].examples.len(), 2);
        inputs[0].personal_note = "my note".into();
        let id = inputs[0].id.clone().unwrap();
        let rep = apply_inputs(&c, "dev", inputs, ImportMode::UpdateExisting, "import:csv").unwrap();
        assert_eq!(rep.updated, 385);
        assert_eq!(vocab::get(&c, &id).unwrap().personal_note, "my note");
    }

    #[test]
    fn simple_csv_without_ids_dedupes_by_spelling() {
        let c = db();
        let csv = "word,reading,meaning,tags\n行く,いく,to go,\n新語,しんご,new word,mine;test\n,,missing,\n";
        let rep = apply_inputs(&c, "dev", parse_csv(csv).unwrap(), ImportMode::SkipExisting, "import:csv").unwrap();
        assert_eq!((rep.added, rep.skipped, rep.errors.len()), (1, 1, 1));
        let added = vocab::list(&c).unwrap().into_iter().find(|v| v.word == "新語").unwrap();
        assert_eq!(added.tags, vec!["mine", "test"]);
    }

    #[test]
    fn rejects_foreign_json() {
        assert!(parse_json(r#"{"format":"other","version":1,"items":[]}"#).is_err());
    }
}

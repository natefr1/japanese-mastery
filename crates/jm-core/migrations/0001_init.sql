-- 0001_init: foundation schema.
--
-- Sync-readiness conventions (every syncable table):
--   id          TEXT  stable UUID (never reused, never an autoincrement)
--   created_at  INTEGER  unix ms
--   updated_at  INTEGER  unix ms, bumped on every change
--   deleted_at  INTEGER  unix ms or NULL (logical deletion / tombstone)
--   rev         INTEGER  per-row revision counter, bumped on every change
--   device_id   TEXT     device that made the latest change
-- Domain changes are also appended to `events` (append-only), so a future sync
-- engine can reconcile instead of overwriting one device with another.

CREATE TABLE IF NOT EXISTS meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

CREATE TABLE vocab_items (
    id            TEXT PRIMARY KEY,
    word          TEXT NOT NULL,            -- display spelling (kanji or kana)
    reading       TEXT NOT NULL,            -- kana reading
    meaning       TEXT NOT NULL,
    word_type     TEXT NOT NULL,            -- g|i|iku|s|su|k|ia|na|n|x|adv|gr
    level         TEXT NOT NULL DEFAULT '', -- N5..N1 | Slang | Net
    category      TEXT NOT NULL DEFAULT '',
    note          TEXT NOT NULL DEFAULT '', -- usage note (authored content)
    personal_note TEXT NOT NULL DEFAULT '', -- the learner's own note
    pitch_accent  TEXT,                     -- only when reliably sourced
    audio_ref     TEXT,
    source        TEXT NOT NULL,            -- seed:v1 | user | import:json | import:csv
    created_at    INTEGER NOT NULL,
    updated_at    INTEGER NOT NULL,
    deleted_at    INTEGER,
    rev           INTEGER NOT NULL DEFAULT 1,
    device_id     TEXT NOT NULL
);
CREATE INDEX idx_vocab_word_reading ON vocab_items(word, reading);
CREATE INDEX idx_vocab_updated ON vocab_items(updated_at);

CREATE TABLE vocab_examples (
    id         TEXT PRIMARY KEY,
    vocab_id   TEXT NOT NULL REFERENCES vocab_items(id),
    position   INTEGER NOT NULL,
    jp         TEXT NOT NULL,
    en         TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    deleted_at INTEGER,
    rev        INTEGER NOT NULL DEFAULT 1,
    device_id  TEXT NOT NULL
);
CREATE INDEX idx_examples_vocab ON vocab_examples(vocab_id, position);

CREATE TABLE tags (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL UNIQUE,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    deleted_at INTEGER,
    rev        INTEGER NOT NULL DEFAULT 1,
    device_id  TEXT NOT NULL
);

CREATE TABLE vocab_tags (
    vocab_id   TEXT NOT NULL REFERENCES vocab_items(id),
    tag_id     TEXT NOT NULL REFERENCES tags(id),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    deleted_at INTEGER,
    device_id  TEXT NOT NULL,
    PRIMARY KEY (vocab_id, tag_id)
);

CREATE TABLE decks (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL,
    deleted_at  INTEGER,
    rev         INTEGER NOT NULL DEFAULT 1,
    device_id   TEXT NOT NULL
);

CREATE TABLE deck_items (
    deck_id    TEXT NOT NULL REFERENCES decks(id),
    vocab_id   TEXT NOT NULL REFERENCES vocab_items(id),
    position   INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    deleted_at INTEGER,
    device_id  TEXT NOT NULL,
    PRIMARY KEY (deck_id, vocab_id)
);

CREATE TABLE settings (
    key        TEXT PRIMARY KEY,
    value      TEXT NOT NULL,               -- JSON
    updated_at INTEGER NOT NULL,
    device_id  TEXT NOT NULL
);

-- Append-only domain event log. Never updated or deleted by the app.
CREATE TABLE events (
    seq        INTEGER PRIMARY KEY AUTOINCREMENT, -- local order only
    id         TEXT NOT NULL UNIQUE,              -- global UUID
    type       TEXT NOT NULL,
    entity     TEXT NOT NULL,
    entity_id  TEXT NOT NULL,
    payload    TEXT NOT NULL DEFAULT '{}',        -- JSON
    created_at INTEGER NOT NULL,
    device_id  TEXT NOT NULL
);
CREATE INDEX idx_events_entity ON events(entity, entity_id);

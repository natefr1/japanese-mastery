-- 0002: Study Center (FSRS cards, review history, sessions, grammar, kanji)
--       and the first 生活 / progression tables.
-- Same sync conventions as 0001 (UUID ids, timestamps, rev, device_id, tombstones).

-- Frequency rank for the core deck (lower = more common). NULL for other words.
ALTER TABLE vocab_items ADD COLUMN freq_rank INTEGER;

-- Reading samples (manga pages etc.) for the coverage checker. Text the learner
-- typed or pasted from their own books stays local.
CREATE TABLE reading_samples (
    id          TEXT PRIMARY KEY,
    series      TEXT NOT NULL,
    title       TEXT NOT NULL DEFAULT '',
    text        TEXT NOT NULL,
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL,
    deleted_at  INTEGER,
    rev         INTEGER NOT NULL DEFAULT 1,
    device_id   TEXT NOT NULL
);

-- One card per (item, skill). Recognition and production are separate cards so
-- recognising a word is never counted as being able to produce it.
CREATE TABLE cards (
    id             TEXT PRIMARY KEY,           -- UUIDv5(item_type|item_id|skill): same on every device
    item_type      TEXT NOT NULL,              -- vocab | grammar | kanji
    item_id        TEXT NOT NULL,
    skill          TEXT NOT NULL,              -- recognition | production | cloze
    -- FSRS state (mirrors ts-fsrs Card)
    due            INTEGER NOT NULL,           -- unix ms
    stability      REAL NOT NULL DEFAULT 0,
    difficulty     REAL NOT NULL DEFAULT 0,
    elapsed_days   INTEGER NOT NULL DEFAULT 0,
    scheduled_days INTEGER NOT NULL DEFAULT 0,
    learning_steps INTEGER NOT NULL DEFAULT 0,
    reps           INTEGER NOT NULL DEFAULT 0,
    lapses         INTEGER NOT NULL DEFAULT 0,
    state          INTEGER NOT NULL DEFAULT 0, -- 0 New, 1 Learning, 2 Review, 3 Relearning
    last_review    INTEGER,
    introduced_at  INTEGER,                    -- NULL until first studied
    suspended      INTEGER NOT NULL DEFAULT 0,
    created_at     INTEGER NOT NULL,
    updated_at     INTEGER NOT NULL,
    deleted_at     INTEGER,
    rev            INTEGER NOT NULL DEFAULT 1,
    device_id      TEXT NOT NULL,
    UNIQUE (item_type, item_id, skill)
);
CREATE INDEX idx_cards_due ON cards(due) WHERE introduced_at IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX idx_cards_item ON cards(item_type, item_id);

-- Append-only. One row per graded answer, with the scheduler state before and after.
CREATE TABLE review_logs (
    id                TEXT PRIMARY KEY,
    card_id           TEXT NOT NULL REFERENCES cards(id),
    rating            INTEGER NOT NULL,        -- 1 Again, 2 Hard, 3 Good, 4 Easy
    state_before      INTEGER NOT NULL,
    stability_before  REAL NOT NULL,
    difficulty_before REAL NOT NULL,
    due_before        INTEGER NOT NULL,
    state_after       INTEGER NOT NULL,
    stability_after   REAL NOT NULL,
    difficulty_after  REAL NOT NULL,
    due_after         INTEGER NOT NULL,
    scheduled_days    INTEGER NOT NULL,
    elapsed_days      INTEGER NOT NULL,
    reviewed_at       INTEGER NOT NULL,
    response_ms       INTEGER,
    auto_correct      INTEGER,                 -- typed answer auto-check result (NULL = self-graded)
    answer            TEXT,
    session_id        TEXT,
    source            TEXT NOT NULL DEFAULT 'review', -- review | placement
    device_id         TEXT NOT NULL
);
CREATE INDEX idx_reviews_card ON review_logs(card_id, reviewed_at);
CREATE INDEX idx_reviews_time ON review_logs(reviewed_at);

CREATE TABLE study_sessions (
    id             TEXT PRIMARY KEY,
    mode           TEXT NOT NULL,              -- quick | standard | deep | custom | placement | grammar | kanji
    planned_minutes INTEGER NOT NULL,
    started_at     INTEGER NOT NULL,
    ended_at       INTEGER,
    cards_done     INTEGER NOT NULL DEFAULT 0,
    new_done       INTEGER NOT NULL DEFAULT 0,
    created_at     INTEGER NOT NULL,
    updated_at     INTEGER NOT NULL,
    rev            INTEGER NOT NULL DEFAULT 1,
    device_id      TEXT NOT NULL
);

CREATE TABLE grammar_points (
    id          TEXT PRIMARY KEY,
    slug        TEXT NOT NULL UNIQUE,
    level       TEXT NOT NULL,
    title       TEXT NOT NULL,
    meaning     TEXT NOT NULL,
    formation   TEXT NOT NULL,
    explanation TEXT NOT NULL,
    examples    TEXT NOT NULL DEFAULT '[]',   -- JSON [{jp,en}]
    cloze       TEXT NOT NULL DEFAULT '[]',   -- JSON [{prompt,answers[],en,hint}]
    mistakes    TEXT NOT NULL DEFAULT '[]',   -- JSON [string]
    compare     TEXT NOT NULL DEFAULT '[]',   -- JSON [{slug,note}]
    prereqs     TEXT NOT NULL DEFAULT '[]',   -- JSON [slug]
    position    INTEGER NOT NULL DEFAULT 0,
    source      TEXT NOT NULL,
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL,
    deleted_at  INTEGER,
    rev         INTEGER NOT NULL DEFAULT 1,
    device_id   TEXT NOT NULL
);

CREATE TABLE kanji (
    id          TEXT PRIMARY KEY,
    character   TEXT NOT NULL UNIQUE,
    meanings    TEXT NOT NULL DEFAULT '[]',
    on_readings TEXT NOT NULL DEFAULT '[]',
    kun_readings TEXT NOT NULL DEFAULT '[]',
    jlpt        INTEGER,
    strokes     INTEGER,
    grade       INTEGER,
    source      TEXT NOT NULL,
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL,
    deleted_at  INTEGER,
    rev         INTEGER NOT NULL DEFAULT 1,
    device_id   TEXT NOT NULL
);

-- Progression. XP and yen are append-only ledgers (sum = balance), which merge
-- cleanly across devices. Language mastery is NOT stored: it is computed from
-- card/review evidence so it can never be bought or farmed.
CREATE TABLE reward_ledger (
    id         TEXT PRIMARY KEY,
    currency   TEXT NOT NULL,                  -- xp | yen
    amount     INTEGER NOT NULL,
    reason     TEXT NOT NULL,                  -- review | session | daily_goal | quest | quest_replay
    ref        TEXT,                           -- card id / quest id / session id
    day        TEXT NOT NULL,                  -- local YYYY-MM-DD
    created_at INTEGER NOT NULL,
    device_id  TEXT NOT NULL
);
CREATE INDEX idx_ledger_day ON reward_ledger(day, reason, ref);

CREATE TABLE quest_progress (
    quest_id           TEXT PRIMARY KEY,
    completions        INTEGER NOT NULL DEFAULT 0,
    best_score         INTEGER NOT NULL DEFAULT 0,
    first_completed_at INTEGER,
    last_completed_at  INTEGER,
    created_at         INTEGER NOT NULL,
    updated_at         INTEGER NOT NULL,
    rev                INTEGER NOT NULL DEFAULT 1,
    device_id          TEXT NOT NULL
);

-- Append-only record of every quest attempt and its evaluated outcome.
CREATE TABLE quest_runs (
    id          TEXT PRIMARY KEY,
    quest_id    TEXT NOT NULL,
    started_at  INTEGER NOT NULL,
    ended_at    INTEGER NOT NULL,
    success     INTEGER NOT NULL,
    score       INTEGER NOT NULL,
    outcome     TEXT NOT NULL DEFAULT '{}',    -- JSON: objectives, feedback, transcript
    device_id   TEXT NOT NULL
);

CREATE TABLE characters (
    id           TEXT PRIMARY KEY,             -- haruto | mika | ren
    relationship INTEGER NOT NULL DEFAULT 0,
    flags        TEXT NOT NULL DEFAULT '{}',
    created_at   INTEGER NOT NULL,
    updated_at   INTEGER NOT NULL,
    rev          INTEGER NOT NULL DEFAULT 1,
    device_id    TEXT NOT NULL
);

-- Structured long-term memory per character (facts, not raw chat logs).
CREATE TABLE character_memories (
    id           TEXT PRIMARY KEY,
    character_id TEXT NOT NULL,
    fact         TEXT NOT NULL,
    source       TEXT NOT NULL,                -- quest:<id> | chat (M5)
    created_at   INTEGER NOT NULL,
    updated_at   INTEGER NOT NULL,
    deleted_at   INTEGER,
    rev          INTEGER NOT NULL DEFAULT 1,
    device_id    TEXT NOT NULL
);
CREATE INDEX idx_memories_char ON character_memories(character_id);

CREATE TABLE passport_entries (
    id          TEXT PRIMARY KEY,
    kind        TEXT NOT NULL,                 -- e.g. purchase, text_plans, conversation
    title       TEXT NOT NULL,
    detail      TEXT NOT NULL DEFAULT '',
    simulated   INTEGER NOT NULL,              -- 1 = in-app/simulated, 0 = real world (self-reported)
    ref         TEXT,
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL,
    deleted_at  INTEGER,
    rev         INTEGER NOT NULL DEFAULT 1,
    device_id   TEXT NOT NULL
);

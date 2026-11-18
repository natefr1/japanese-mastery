-- 0003: 生活 social layer: messaging, NPC state, social graph, scheduler, memories v2,
-- calls, stickers, learning observations, AI usage accounting.
-- Same sync conventions as earlier migrations.

-- Per-character simulation state. Relationship is multi-dimensional on purpose:
-- formality is derived from several of these by a per-character function.
CREATE TABLE npc_state (
    character_id        TEXT PRIMARY KEY,
    closeness           REAL NOT NULL DEFAULT 0,   -- 0..100 warmth / friendship
    trust               REAL NOT NULL DEFAULT 0,   -- 0..100 openness, reliability
    shared_experiences  INTEGER NOT NULL DEFAULT 0,-- plans kept, quests, meaningful moments
    meaningful_days     INTEGER NOT NULL DEFAULT 0,-- distinct days with a real exchange
    last_meaningful_day TEXT,
    last_player_msg_at  INTEGER,
    last_npc_msg_at     INTEGER,
    last_initiated_at   INTEGER,
    rel_updates_day     TEXT,                      -- rate limit for relationship deltas
    rel_updates_count   INTEGER NOT NULL DEFAULT 0,
    created_at          INTEGER NOT NULL,
    updated_at          INTEGER NOT NULL,
    rev                 INTEGER NOT NULL DEFAULT 1,
    device_id           TEXT NOT NULL
);

-- Who knows whom among NPCs (seeded; can evolve).
CREATE TABLE npc_relations (
    a          TEXT NOT NULL,
    b          TEXT NOT NULL,
    kind       TEXT NOT NULL,     -- classmates, coworkers, childhood friends, ...
    closeness  INTEGER NOT NULL DEFAULT 50,
    note       TEXT NOT NULL DEFAULT '',
    PRIMARY KEY (a, b)
);

CREATE TABLE conversations (
    id           TEXT PRIMARY KEY,
    kind         TEXT NOT NULL,           -- direct | group | memo
    title        TEXT NOT NULL DEFAULT '',
    avatar       TEXT NOT NULL DEFAULT '',-- group avatar key
    pinned       INTEGER NOT NULL DEFAULT 0,
    muted        INTEGER NOT NULL DEFAULT 0,
    archived     INTEGER NOT NULL DEFAULT 0,
    last_activity_at INTEGER NOT NULL,
    player_read_at   INTEGER NOT NULL DEFAULT 0,
    created_at   INTEGER NOT NULL,
    updated_at   INTEGER NOT NULL,
    deleted_at   INTEGER,
    rev          INTEGER NOT NULL DEFAULT 1,
    device_id    TEXT NOT NULL
);

CREATE TABLE conversation_members (
    conversation_id TEXT NOT NULL REFERENCES conversations(id),
    member_id       TEXT NOT NULL,        -- 'player' or a character id
    PRIMARY KEY (conversation_id, member_id)
);

-- Raw history (append-mostly). NPC messages may be scheduled in the future:
-- they are invisible until deliver_at <= now (status 'scheduled' -> 'delivered').
CREATE TABLE messages (
    id              TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL REFERENCES conversations(id),
    sender_id       TEXT NOT NULL,         -- 'player' | character id | 'system'
    kind            TEXT NOT NULL,         -- text | sticker | system | plan
    body            TEXT NOT NULL DEFAULT '',
    sticker_id      TEXT,
    meta            TEXT NOT NULL DEFAULT '{}',
    status          TEXT NOT NULL,         -- player: sent | npc: scheduled | delivered | cancelled
    created_at      INTEGER NOT NULL,      -- when it entered the timeline (deliver time for NPCs)
    deliver_at      INTEGER NOT NULL,
    typing_from     INTEGER,               -- NPC: typing indicator starts here
    read_by_npc_at  INTEGER,               -- player messages: simulated read receipt time
    reply_state     TEXT,                  -- player messages: none | pending | done | failed | read_only
    reply_error     TEXT,
    deleted_at      INTEGER,
    rev             INTEGER NOT NULL DEFAULT 1,
    device_id       TEXT NOT NULL
);
CREATE INDEX idx_messages_conv ON messages(conversation_id, deliver_at);
CREATE INDEX idx_messages_sched ON messages(status, deliver_at);

CREATE TABLE message_reactions (
    message_id TEXT NOT NULL REFERENCES messages(id),
    member_id  TEXT NOT NULL,
    emoji      TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (message_id, member_id)
);

CREATE TABLE drafts (
    conversation_id TEXT PRIMARY KEY,
    body            TEXT NOT NULL,
    updated_at      INTEGER NOT NULL
);

-- Rolling summaries keep prompts small (we never send whole histories).
CREATE TABLE conversation_summaries (
    conversation_id TEXT PRIMARY KEY,
    summary         TEXT NOT NULL,
    upto_message_at INTEGER NOT NULL,
    updated_at      INTEGER NOT NULL
);

-- Memory v2: typed, scored, sourced long-term memories.
ALTER TABLE character_memories ADD COLUMN kind TEXT NOT NULL DEFAULT 'fact';
ALTER TABLE character_memories ADD COLUMN importance INTEGER NOT NULL DEFAULT 3;
ALTER TABLE character_memories ADD COLUMN confidence REAL NOT NULL DEFAULT 0.8;
ALTER TABLE character_memories ADD COLUMN source_message_id TEXT;
ALTER TABLE character_memories ADD COLUMN last_used_at INTEGER;
ALTER TABLE character_memories ADD COLUMN verified INTEGER NOT NULL DEFAULT 0;

-- Scheduler events (initiations, follow-ups, group events). dedupe_key prevents duplicates.
CREATE TABLE npc_events (
    id           TEXT PRIMARY KEY,
    character_id TEXT NOT NULL,
    conversation_id TEXT,
    kind         TEXT NOT NULL,            -- initiate | follow_up | group_topic
    reason       TEXT NOT NULL DEFAULT '',
    dedupe_key   TEXT NOT NULL UNIQUE,
    status       TEXT NOT NULL,            -- pending | done | skipped | expired
    attempts     INTEGER NOT NULL DEFAULT 0,
    last_error   TEXT,
    due_at       INTEGER NOT NULL,
    expires_at   INTEGER NOT NULL,
    created_at   INTEGER NOT NULL,
    updated_at   INTEGER NOT NULL
);
CREATE INDEX idx_events_due ON npc_events(status, due_at);

CREATE TABLE calendar_events (
    id            TEXT PRIMARY KEY,
    title         TEXT NOT NULL,
    starts_at     INTEGER,
    when_text     TEXT NOT NULL DEFAULT '',
    place         TEXT NOT NULL DEFAULT '',
    participants  TEXT NOT NULL DEFAULT '[]',
    source_message_id TEXT,
    status        TEXT NOT NULL DEFAULT 'planned',  -- planned | done | cancelled
    created_at    INTEGER NOT NULL,
    updated_at    INTEGER NOT NULL,
    deleted_at    INTEGER,
    rev           INTEGER NOT NULL DEFAULT 1,
    device_id     TEXT NOT NULL
);

CREATE TABLE call_logs (
    id            TEXT PRIMARY KEY,
    character_id  TEXT NOT NULL,
    conversation_id TEXT,
    direction     TEXT NOT NULL,           -- outgoing | incoming
    kind          TEXT NOT NULL,           -- voice | video
    status        TEXT NOT NULL,           -- unavailable | missed | completed
    duration_s    INTEGER,
    created_at    INTEGER NOT NULL,
    device_id     TEXT NOT NULL
);

CREATE TABLE sticker_owned (
    pack_id    TEXT PRIMARY KEY,
    source     TEXT NOT NULL,              -- default | purchase
    created_at INTEGER NOT NULL
);
CREATE TABLE sticker_usage (
    sticker_id TEXT PRIMARY KEY,
    favorite   INTEGER NOT NULL DEFAULT 0,
    uses       INTEGER NOT NULL DEFAULT 0,
    last_used_at INTEGER
);

CREATE TABLE notifications (
    id              TEXT PRIMARY KEY,
    conversation_id TEXT,
    title           TEXT NOT NULL,
    body            TEXT NOT NULL,
    created_at      INTEGER NOT NULL,
    seen            INTEGER NOT NULL DEFAULT 0
);

-- Post-conversation language analysis (separate from the chat itself).
CREATE TABLE learning_observations (
    id              TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL,
    message_id      TEXT,
    category        TEXT NOT NULL,         -- error | unnatural | natural_casual | slang | success | vocab
    original        TEXT NOT NULL DEFAULT '',
    suggestion      TEXT NOT NULL DEFAULT '',
    note            TEXT NOT NULL DEFAULT '',
    payload         TEXT NOT NULL DEFAULT '{}',
    created_at      INTEGER NOT NULL,
    deleted_at      INTEGER,
    device_id       TEXT NOT NULL
);
CREATE INDEX idx_obs_conv ON learning_observations(conversation_id);

-- Request accounting for AI budgets (no message content is stored here).
CREATE TABLE ai_usage (
    day           TEXT NOT NULL,
    purpose       TEXT NOT NULL,           -- reply | initiate | group | review | hint | summary
    requests      INTEGER NOT NULL DEFAULT 0,
    input_tokens  INTEGER NOT NULL DEFAULT 0,
    output_tokens INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (day, purpose)
);

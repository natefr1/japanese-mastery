//! Persistent messaging for 生活: conversations, messages (incl. NPC messages
//! scheduled into the future), receipts, drafts, reactions, search, plus the
//! small stores the phone needs (calls, stickers, calendar, notifications,
//! learning observations, AI usage, summaries).
//!
//! Single source of truth: the UI derives typing indicators, read receipts and
//! unread counts from these rows instead of inventing its own statuses.

use crate::{new_id, now_ms, npc, CoreError, Result};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

pub const PLAYER: &str = "player";

pub fn dm_id(character: &str) -> String {
    format!("dm-{character}")
}

// ---------------- seeding ----------------

/// Creates the initial conversations (one per character, the groups, a memo)
/// with each character's authored opening line. Runs once.
pub fn seed(conn: &Connection, dev: &str) -> Result<usize> {
    let done = conn.query_row("SELECT 1 FROM meta WHERE key='seed.social_v1'", [], |_| Ok(())).optional()?.is_some();
    if done {
        return Ok(0);
    }
    let now = now_ms();
    let mut t = now - 60 * 60_000; // openings arrive over the "last hour" of the prologue
    let mut n = 0;
    let add_conv = |id: &str, kind: &str, title: &str, avatar: &str, members: &[&str]| -> Result<()> {
        conn.execute(
            "INSERT OR IGNORE INTO conversations (id, kind, title, avatar, last_activity_at, created_at, updated_at, rev, device_id)
             VALUES (?1, ?2, ?3, ?4, ?5, ?5, ?5, 1, ?6)",
            params![id, kind, title, avatar, now, dev],
        )?;
        for m in members {
            conn.execute("INSERT OR IGNORE INTO conversation_members (conversation_id, member_id) VALUES (?1, ?2)", params![id, m])?;
        }
        Ok(())
    };
    for p in npc::profiles() {
        add_conv(&dm_id(&p.id), "direct", &p.display, &p.id, &[PLAYER, &p.id])?;
    }
    for g in npc::groups() {
        let mut m: Vec<&str> = vec![PLAYER];
        m.extend(g.members.iter().map(|s| s.as_str()));
        add_conv(&g.id, "group", &g.title, &g.avatar, &m)?;
    }
    add_conv("memo", "memo", "メモ", "memo", &[PLAYER])?;
    let mut insert = |conv: &str, from: &str, o: &npc::Opening, at: i64| -> Result<()> {
        let (kind, body, sticker) = if o.kind == "sticker" { ("sticker", String::new(), o.id.clone()) } else { ("text", o.text.clone().unwrap_or_default(), None) };
        conn.execute(
            "INSERT INTO messages (id, conversation_id, sender_id, kind, body, sticker_id, status, created_at, deliver_at, rev, device_id)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'delivered', ?7, ?7, 1, ?8)",
            params![new_id(), conv, from, kind, body, sticker, at, dev],
        )?;
        conn.execute("UPDATE conversations SET last_activity_at = MAX(last_activity_at, ?2) WHERE id = ?1", params![conv, at])?;
        n += 1;
        Ok(())
    };
    for p in npc::profiles() {
        for o in &p.opening {
            t += 37_000;
            insert(&dm_id(&p.id), &p.id, o, t)?;
        }
    }
    for g in npc::groups() {
        for o in &g.opening {
            t += 23_000;
            insert(&g.id, o.from.as_deref().unwrap_or(PLAYER), o, t)?;
        }
    }
    conn.execute("INSERT INTO meta(key, value) VALUES ('seed.social_v1', ?1)", [now.to_string()])?;
    Ok(n)
}

// ---------------- read models ----------------

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Message {
    pub id: String,
    pub conversation_id: String,
    pub sender_id: String,
    pub kind: String,
    pub body: String,
    pub sticker_id: Option<String>,
    pub meta: serde_json::Value,
    pub status: String,
    pub created_at: i64,
    pub deliver_at: i64,
    pub read_by_npc_at: Option<i64>,
    pub reply_state: Option<String>,
    pub reply_error: Option<String>,
    pub reactions: Vec<(String, String)>,
}

const MSG_COLS: &str = "id, conversation_id, sender_id, kind, body, sticker_id, meta, status, created_at, deliver_at, read_by_npc_at, reply_state, reply_error";

fn row_msg(r: &rusqlite::Row) -> rusqlite::Result<Message> {
    let meta: String = r.get(6)?;
    Ok(Message {
        id: r.get(0)?,
        conversation_id: r.get(1)?,
        sender_id: r.get(2)?,
        kind: r.get(3)?,
        body: r.get(4)?,
        sticker_id: r.get(5)?,
        meta: serde_json::from_str(&meta).unwrap_or(serde_json::Value::Null),
        status: r.get(7)?,
        created_at: r.get(8)?,
        deliver_at: r.get(9)?,
        read_by_npc_at: r.get(10)?,
        reply_state: r.get(11)?,
        reply_error: r.get(12)?,
        reactions: vec![],
    })
}

fn attach_reactions(conn: &Connection, msgs: &mut [Message]) -> Result<()> {
    if msgs.is_empty() {
        return Ok(());
    }
    let ids: Vec<String> = msgs.iter().map(|m| format!("'{}'", m.id.replace('\'', ""))).collect();
    let mut st = conn.prepare(&format!("SELECT message_id, member_id, emoji FROM message_reactions WHERE message_id IN ({})", ids.join(",")))?;
    let mut map: HashMap<String, Vec<(String, String)>> = HashMap::new();
    for row in st.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?)))? {
        let (m, who, e) = row?;
        map.entry(m).or_default().push((who, e));
    }
    for m in msgs.iter_mut() {
        m.reactions = map.remove(&m.id).unwrap_or_default();
    }
    Ok(())
}

#[derive(Debug, Clone, Serialize)]
pub struct Typing {
    pub member_id: String,
    pub until: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct ConversationView {
    pub id: String,
    pub kind: String,
    pub title: String,
    pub avatar: String,
    pub members: Vec<String>,
    pub pinned: bool,
    pub muted: bool,
    pub archived: bool,
    pub last_activity_at: i64,
    pub last_message: Option<Message>,
    pub unread: i64,
    /// Characters whose next message is being "typed" (from scheduled rows).
    pub typing: Vec<Typing>,
    /// Next moment the UI should refresh (next delivery / typing start / read receipt).
    pub next_change_at: Option<i64>,
    pub draft: Option<String>,
}

fn members(conn: &Connection, conv: &str) -> Result<Vec<String>> {
    let mut st = conn.prepare("SELECT member_id FROM conversation_members WHERE conversation_id=?1 ORDER BY member_id")?;
    let v = st.query_map([conv], |r| r.get(0))?.collect::<std::result::Result<Vec<String>, _>>()?;
    Ok(v)
}

pub fn conversation_members(conn: &Connection, conv: &str) -> Result<Vec<String>> {
    members(conn, conv)
}

fn view(conn: &Connection, id: &str, now: i64) -> Result<ConversationView> {
    let (kind, title, avatar, pinned, muted, archived, last, read_at): (String, String, String, bool, bool, bool, i64, i64) = conn
        .query_row(
            "SELECT kind, title, avatar, pinned, muted, archived, last_activity_at, player_read_at FROM conversations WHERE id=?1 AND deleted_at IS NULL",
            [id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?, r.get(6)?, r.get(7)?)),
        )
        .optional()?
        .ok_or_else(|| CoreError::NotFound(format!("conversation {id}")))?;
    let last_message = conn
        .query_row(
            &format!("SELECT {MSG_COLS} FROM messages WHERE conversation_id=?1 AND status IN ('sent','delivered') AND kind <> 'reaction' AND deliver_at <= ?2 AND deleted_at IS NULL ORDER BY deliver_at DESC, rowid DESC LIMIT 1"),
            params![id, now],
            row_msg,
        )
        .optional()?;
    let unread: i64 = conn.query_row(
        "SELECT COUNT(*) FROM messages WHERE conversation_id=?1 AND sender_id NOT IN ('player','system') AND kind <> 'reaction' AND status='delivered' AND deliver_at > ?2 AND deliver_at <= ?3 AND deleted_at IS NULL",
        params![id, read_at, now],
        |r| r.get(0),
    )?;
    let mut typing = vec![];
    let mut st = conn.prepare(
        "SELECT sender_id, MIN(deliver_at), MIN(typing_from) FROM messages WHERE conversation_id=?1 AND status='scheduled' AND kind NOT IN ('reaction','plan') AND deleted_at IS NULL GROUP BY sender_id",
    )?;
    let mut next_change: Option<i64> = None;
    let mut bump = |t: i64| {
        if t > now {
            next_change = Some(next_change.map_or(t, |c: i64| c.min(t)));
        }
    };
    for row in st.query_map([id], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?, r.get::<_, Option<i64>>(2)?)))? {
        let (who, deliver, typing_from) = row?;
        let tf = typing_from.unwrap_or(deliver);
        if tf <= now && now < deliver {
            typing.push(Typing { member_id: who, until: deliver });
        }
        bump(tf);
        bump(deliver);
    }
    let next_receipt: Option<i64> = conn.query_row(
        "SELECT MIN(read_by_npc_at) FROM messages WHERE conversation_id=?1 AND sender_id='player' AND read_by_npc_at > ?2",
        params![id, now],
        |r| r.get(0),
    )?;
    if let Some(t) = next_receipt {
        bump(t);
    }
    let draft = conn.query_row("SELECT body FROM drafts WHERE conversation_id=?1", [id], |r| r.get(0)).optional()?;
    let mut lm = last_message.into_iter().collect::<Vec<_>>();
    attach_reactions(conn, &mut lm)?;
    Ok(ConversationView {
        id: id.into(),
        kind,
        title,
        avatar,
        members: members(conn, id)?,
        pinned,
        muted,
        archived,
        last_activity_at: last,
        last_message: lm.pop(),
        unread,
        typing,
        next_change_at: next_change,
        draft,
    })
}

pub fn get_conversation(conn: &Connection, id: &str, now: i64) -> Result<ConversationView> {
    view(conn, id, now)
}

/// Inbox order: pinned first, then most recent real activity.
pub fn list_conversations(conn: &Connection, now: i64) -> Result<Vec<ConversationView>> {
    let mut st = conn.prepare("SELECT id FROM conversations WHERE deleted_at IS NULL")?;
    let ids = st.query_map([], |r| r.get::<_, String>(0))?.collect::<std::result::Result<Vec<_>, _>>()?;
    let mut v = ids.iter().map(|id| view(conn, id, now)).collect::<Result<Vec<_>>>()?;
    v.sort_by(|a, b| {
        b.pinned.cmp(&a.pinned).then_with(|| {
            let la = a.last_message.as_ref().map(|m| m.deliver_at).unwrap_or(0);
            let lb = b.last_message.as_ref().map(|m| m.deliver_at).unwrap_or(0);
            lb.cmp(&la)
        })
    });
    Ok(v)
}

/// Visible messages, oldest first. `before` pages backwards.
pub fn messages(conn: &Connection, conv: &str, now: i64, before: Option<i64>, limit: i64) -> Result<Vec<Message>> {
    let mut st = conn.prepare(&format!(
        "SELECT {MSG_COLS} FROM messages WHERE conversation_id=?1 AND status IN ('sent','delivered') AND kind <> 'reaction' AND deliver_at <= ?2 AND deleted_at IS NULL
         AND deliver_at < ?3 ORDER BY deliver_at DESC, rowid DESC LIMIT ?4"
    ))?;
    let mut v = st
        .query_map(params![conv, now, before.unwrap_or(i64::MAX), limit.clamp(1, 500)], row_msg)?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    v.reverse();
    attach_reactions(conn, &mut v)?;
    Ok(v)
}

pub fn get_message(conn: &Connection, id: &str) -> Result<Message> {
    let mut v = vec![conn
        .query_row(&format!("SELECT {MSG_COLS} FROM messages WHERE id=?1"), [id], row_msg)
        .optional()?
        .ok_or_else(|| CoreError::NotFound(format!("message {id}")))?];
    attach_reactions(conn, &mut v)?;
    Ok(v.pop().unwrap())
}

// ---------------- writes ----------------

pub const MAX_MESSAGE_CHARS: usize = 2000;

#[derive(Debug, Clone, Deserialize)]
pub struct Outgoing {
    pub conversation_id: String,
    pub kind: String, // text | sticker
    #[serde(default)]
    pub body: String,
    #[serde(default)]
    pub sticker_id: Option<String>,
}

/// Stores the player's message. `wants_reply` marks it pending for the AI engine.
pub fn send_player(conn: &Connection, dev: &str, o: &Outgoing, wants_reply: bool, now: i64) -> Result<Message> {
    view(conn, &o.conversation_id, now)?; // must exist
    let body = o.body.trim_end().to_string();
    match o.kind.as_str() {
        "text" if body.trim().is_empty() => return Err(CoreError::Invalid("empty message".into())),
        "text" if body.chars().count() > MAX_MESSAGE_CHARS => return Err(CoreError::Invalid("message too long".into())),
        "text" => {}
        "sticker" => {
            let sid = o.sticker_id.as_deref().unwrap_or("");
            if npc::sticker(sid).is_none() {
                return Err(CoreError::Invalid(format!("unknown sticker {sid}")));
            }
            let pack = sid.split('.').next().unwrap_or("");
            if !owns_pack(conn, pack)? {
                return Err(CoreError::Invalid("you don't own that sticker pack".into()));
            }
        }
        k => return Err(CoreError::Invalid(format!("unknown message kind {k}"))),
    }
    let id = new_id();
    let kind_is_memo: bool = conn.query_row("SELECT kind='memo' FROM conversations WHERE id=?1", [&o.conversation_id], |r| r.get(0))?;
    let reply_state = if wants_reply && !kind_is_memo { "pending" } else { "none" };
    conn.execute(
        "INSERT INTO messages (id, conversation_id, sender_id, kind, body, sticker_id, status, created_at, deliver_at, reply_state, rev, device_id)
         VALUES (?1, ?2, 'player', ?3, ?4, ?5, 'sent', ?6, ?6, ?7, 1, ?8)",
        params![id, o.conversation_id, o.kind, body, o.sticker_id, now, reply_state, dev],
    )?;
    conn.execute(
        "UPDATE conversations SET last_activity_at=?2, player_read_at=?2, archived=0, updated_at=?2 WHERE id=?1",
        params![o.conversation_id, now],
    )?;
    conn.execute("DELETE FROM drafts WHERE conversation_id=?1", [&o.conversation_id])?;
    if o.kind == "sticker" {
        conn.execute(
            "INSERT INTO sticker_usage (sticker_id, uses, last_used_at) VALUES (?1, 1, ?2)
             ON CONFLICT(sticker_id) DO UPDATE SET uses = uses + 1, last_used_at = excluded.last_used_at",
            params![o.sticker_id, now],
        )?;
    }
    for m in members(conn, &o.conversation_id)? {
        if m != PLAYER {
            npc::touch(conn, &m, true, false, now)?;
        }
    }
    get_message(conn, &id)
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Planned {
    pub sender_id: String,
    pub kind: String, // text | sticker
    pub body: String,
    pub sticker_id: Option<String>,
    pub typing_from: i64,
    pub deliver_at: i64,
    #[serde(default)]
    pub meta: serde_json::Value,
}

/// Queues NPC messages to appear at their planned times.
pub fn schedule(conn: &Connection, dev: &str, conv: &str, plans: &[Planned]) -> Result<Vec<String>> {
    let mut ids = vec![];
    for p in plans {
        let id = new_id();
        let meta = if p.meta.is_null() { "{}".to_string() } else { p.meta.to_string() };
        conn.execute(
            "INSERT INTO messages (id, conversation_id, sender_id, kind, body, sticker_id, meta, status, created_at, deliver_at, typing_from, rev, device_id)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'scheduled', ?8, ?8, ?9, 1, ?10)",
            params![id, conv, p.sender_id, p.kind, p.body, p.sticker_id, meta, p.deliver_at, p.typing_from, dev],
        )?;
        ids.push(id);
    }
    Ok(ids)
}

#[derive(Debug, Clone, Serialize)]
pub struct Delivered {
    pub message: Message,
    pub conversation_title: String,
    pub conversation_kind: String,
    pub muted: bool,
}

/// Makes every scheduled message whose time has come visible. Idempotent.
pub fn deliver_due(conn: &Connection, now: i64) -> Result<Vec<Delivered>> {
    let mut st = conn.prepare(&format!("SELECT {MSG_COLS} FROM messages WHERE status='scheduled' AND deliver_at <= ?1 AND deleted_at IS NULL ORDER BY deliver_at"))?;
    let due = st.query_map([now], row_msg)?.collect::<std::result::Result<Vec<_>, _>>()?;
    let mut out = vec![];
    for mut m in due {
        let n = conn.execute("UPDATE messages SET status='delivered', created_at=deliver_at WHERE id=?1 AND status='scheduled'", [&m.id])?;
        if n == 0 {
            continue;
        }
        if m.kind == "reaction" {
            // Hidden carrier row: applies a reaction at its simulated time.
            let target = m.meta.get("target").and_then(|v| v.as_str()).unwrap_or("").to_string();
            let emoji = m.meta.get("emoji").and_then(|v| v.as_str()).unwrap_or("").to_string();
            if !target.is_empty() {
                react(conn, &target, &m.sender_id, Some(&emoji))?;
            }
            continue;
        }
        m.status = "delivered".into();
        conn.execute("UPDATE conversations SET last_activity_at = MAX(last_activity_at, ?2), archived=0 WHERE id=?1", params![m.conversation_id, m.deliver_at])?;
        let _ = npc::touch(conn, &m.sender_id, false, false, m.deliver_at);
        let (title, kind, muted): (String, String, bool) =
            conn.query_row("SELECT title, kind, muted FROM conversations WHERE id=?1", [&m.conversation_id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?;
        out.push(Delivered { message: m, conversation_title: title, conversation_kind: kind, muted });
    }
    Ok(out)
}

/// Cancels not-yet-delivered NPC messages (e.g. when the player deletes history).
pub fn cancel_scheduled(conn: &Connection, conv: &str) -> Result<usize> {
    Ok(conn.execute("UPDATE messages SET status='cancelled' WHERE conversation_id=?1 AND status='scheduled'", [conv])?)
}

pub fn set_read_receipt(conn: &Connection, ids: &[String], at: i64) -> Result<()> {
    for id in ids {
        conn.execute("UPDATE messages SET read_by_npc_at = COALESCE(read_by_npc_at, ?2) WHERE id=?1 AND sender_id='player'", params![id, at])?;
    }
    Ok(())
}

pub fn set_reply_state(conn: &Connection, ids: &[String], state: &str, error: Option<&str>) -> Result<()> {
    for id in ids {
        conn.execute("UPDATE messages SET reply_state=?2, reply_error=?3 WHERE id=?1 AND sender_id='player'", params![id, state, error])?;
    }
    Ok(())
}

/// Player messages still waiting for a reply in a conversation (oldest first).
pub fn pending_player_messages(conn: &Connection, conv: &str) -> Result<Vec<Message>> {
    let mut st = conn.prepare(&format!("SELECT {MSG_COLS} FROM messages WHERE conversation_id=?1 AND sender_id='player' AND reply_state='pending' AND deleted_at IS NULL ORDER BY deliver_at"))?;
    let v = st.query_map([conv], row_msg)?.collect::<std::result::Result<Vec<_>, _>>()?;
    Ok(v)
}

/// Conversations that have player messages waiting for a reply.
pub fn conversations_with_pending(conn: &Connection) -> Result<Vec<String>> {
    let mut st = conn.prepare("SELECT DISTINCT conversation_id FROM messages WHERE sender_id='player' AND reply_state='pending' AND deleted_at IS NULL")?;
    let v = st.query_map([], |r| r.get(0))?.collect::<std::result::Result<Vec<String>, _>>()?;
    Ok(v)
}

pub fn has_scheduled(conn: &Connection, conv: &str) -> Result<bool> {
    Ok(conn.query_row("SELECT 1 FROM messages WHERE conversation_id=?1 AND status='scheduled' LIMIT 1", [conv], |_| Ok(())).optional()?.is_some())
}

pub fn mark_read(conn: &Connection, conv: &str, at: i64) -> Result<()> {
    conn.execute("UPDATE conversations SET player_read_at = MAX(player_read_at, ?2) WHERE id=?1", params![conv, at])?;
    conn.execute("UPDATE notifications SET seen=1 WHERE conversation_id=?1", [conv])?;
    Ok(())
}

pub fn set_flag(conn: &Connection, conv: &str, flag: &str, on: bool) -> Result<()> {
    let col = match flag {
        "pinned" | "muted" | "archived" => flag,
        _ => return Err(CoreError::Invalid(format!("unknown flag {flag}"))),
    };
    conn.execute(&format!("UPDATE conversations SET {col}=?2, updated_at=?3, rev=rev+1 WHERE id=?1"), params![conv, on, now_ms()])?;
    Ok(())
}

pub fn set_draft(conn: &Connection, conv: &str, body: &str) -> Result<()> {
    if body.is_empty() {
        conn.execute("DELETE FROM drafts WHERE conversation_id=?1", [conv])?;
    } else {
        let body: String = body.chars().take(MAX_MESSAGE_CHARS).collect();
        conn.execute(
            "INSERT INTO drafts (conversation_id, body, updated_at) VALUES (?1, ?2, ?3)
             ON CONFLICT(conversation_id) DO UPDATE SET body=excluded.body, updated_at=excluded.updated_at",
            params![conv, body, now_ms()],
        )?;
    }
    Ok(())
}

pub fn react(conn: &Connection, msg: &str, member: &str, emoji: Option<&str>) -> Result<()> {
    match emoji {
        Some(e) if !e.is_empty() && e.chars().count() <= 8 => {
            conn.execute(
                "INSERT INTO message_reactions (message_id, member_id, emoji, created_at) VALUES (?1, ?2, ?3, ?4)
                 ON CONFLICT(message_id, member_id) DO UPDATE SET emoji=excluded.emoji, created_at=excluded.created_at",
                params![msg, member, e, now_ms()],
            )?;
        }
        _ => {
            conn.execute("DELETE FROM message_reactions WHERE message_id=?1 AND member_id=?2", params![msg, member])?;
        }
    }
    Ok(())
}

/// Clears a conversation's history (logical delete) and anything still scheduled.
pub fn clear_history(conn: &Connection, conv: &str) -> Result<()> {
    let now = now_ms();
    cancel_scheduled(conn, conv)?;
    conn.execute("UPDATE messages SET deleted_at=?2 WHERE conversation_id=?1 AND deleted_at IS NULL", params![conv, now])?;
    conn.execute("DELETE FROM conversation_summaries WHERE conversation_id=?1", [conv])?;
    Ok(())
}

#[derive(Debug, Clone, Serialize)]
pub struct SearchHit {
    pub message: Message,
    pub conversation_title: String,
}

pub fn search(conn: &Connection, q: &str, now: i64) -> Result<Vec<SearchHit>> {
    let q = q.trim();
    if q.is_empty() {
        return Ok(vec![]);
    }
    let like = format!("%{}%", q.replace('%', "").replace('_', ""));
    let mut st = conn.prepare(&format!(
        "SELECT {}, c.title FROM messages m JOIN conversations c ON c.id = m.conversation_id
         WHERE m.body LIKE ?1 AND m.status IN ('sent','delivered') AND m.deliver_at <= ?2 AND m.deleted_at IS NULL
         ORDER BY m.deliver_at DESC LIMIT 50",
        MSG_COLS.split(", ").map(|c| format!("m.{c}")).collect::<Vec<_>>().join(", ")
    ))?;
    let v = st
        .query_map(params![like, now], |r| Ok(SearchHit { message: row_msg(r)?, conversation_title: r.get(13)? }))?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    Ok(v)
}

/// Last `n` visible messages (for prompts), oldest first.
pub fn recent(conn: &Connection, conv: &str, now: i64, n: i64) -> Result<Vec<Message>> {
    messages(conn, conv, now, None, n)
}

// ---------------- summaries ----------------

pub fn summary(conn: &Connection, conv: &str) -> Result<Option<(String, i64)>> {
    Ok(conn
        .query_row("SELECT summary, upto_message_at FROM conversation_summaries WHERE conversation_id=?1", [conv], |r| Ok((r.get(0)?, r.get(1)?)))
        .optional()?)
}

pub fn set_summary(conn: &Connection, conv: &str, text: &str, upto: i64) -> Result<()> {
    conn.execute(
        "INSERT INTO conversation_summaries (conversation_id, summary, upto_message_at, updated_at) VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(conversation_id) DO UPDATE SET summary=excluded.summary, upto_message_at=excluded.upto_message_at, updated_at=excluded.updated_at",
        params![conv, text.chars().take(1500).collect::<String>(), upto, now_ms()],
    )?;
    Ok(())
}

/// Messages newer than the summary horizon.
pub fn count_since(conn: &Connection, conv: &str, since: i64, now: i64) -> Result<i64> {
    Ok(conn.query_row(
        "SELECT COUNT(*) FROM messages WHERE conversation_id=?1 AND status IN ('sent','delivered') AND deliver_at > ?2 AND deliver_at <= ?3 AND deleted_at IS NULL",
        params![conv, since, now],
        |r| r.get(0),
    )?)
}

// ---------------- notifications ----------------

#[derive(Debug, Clone, Serialize)]
pub struct Notification {
    pub id: String,
    pub conversation_id: Option<String>,
    pub title: String,
    pub body: String,
    pub created_at: i64,
    pub seen: bool,
}

pub fn add_notification(conn: &Connection, conv: Option<&str>, title: &str, body: &str, at: i64) -> Result<()> {
    conn.execute(
        "INSERT INTO notifications (id, conversation_id, title, body, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
        params![new_id(), conv, title, body.chars().take(120).collect::<String>(), at],
    )?;
    conn.execute("DELETE FROM notifications WHERE id NOT IN (SELECT id FROM notifications ORDER BY created_at DESC LIMIT 200)", [])?;
    Ok(())
}

pub fn notifications(conn: &Connection) -> Result<Vec<Notification>> {
    let mut st = conn.prepare("SELECT id, conversation_id, title, body, created_at, seen FROM notifications ORDER BY created_at DESC LIMIT 100")?;
    let v = st
        .query_map([], |r| Ok(Notification { id: r.get(0)?, conversation_id: r.get(1)?, title: r.get(2)?, body: r.get(3)?, created_at: r.get(4)?, seen: r.get(5)? }))?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    Ok(v)
}

pub fn mark_notifications_seen(conn: &Connection) -> Result<()> {
    conn.execute("UPDATE notifications SET seen=1", [])?;
    Ok(())
}

// ---------------- calls ----------------

#[derive(Debug, Clone, Serialize)]
pub struct CallLog {
    pub id: String,
    pub character_id: String,
    pub direction: String,
    pub kind: String,
    pub status: String,
    pub duration_s: Option<i64>,
    pub created_at: i64,
}

/// Records a call attempt. Without a voice provider the status is 'unavailable';
/// the app never records a completed call that didn't happen.
pub fn log_call(conn: &Connection, dev: &str, character: &str, kind: &str, status: &str, duration: Option<i64>) -> Result<()> {
    if !matches!(kind, "voice" | "video") || !matches!(status, "unavailable" | "missed" | "completed") {
        return Err(CoreError::Invalid("bad call log".into()));
    }
    if status == "completed" && duration.unwrap_or(0) <= 0 {
        return Err(CoreError::Invalid("completed calls need a real duration".into()));
    }
    conn.execute(
        "INSERT INTO call_logs (id, character_id, conversation_id, direction, kind, status, duration_s, created_at, device_id) VALUES (?1, ?2, ?3, 'outgoing', ?4, ?5, ?6, ?7, ?8)",
        params![new_id(), character, dm_id(character), kind, status, duration, now_ms(), dev],
    )?;
    Ok(())
}

pub fn calls(conn: &Connection) -> Result<Vec<CallLog>> {
    let mut st = conn.prepare("SELECT id, character_id, direction, kind, status, duration_s, created_at FROM call_logs ORDER BY created_at DESC LIMIT 100")?;
    let v = st
        .query_map([], |r| Ok(CallLog { id: r.get(0)?, character_id: r.get(1)?, direction: r.get(2)?, kind: r.get(3)?, status: r.get(4)?, duration_s: r.get(5)?, created_at: r.get(6)? }))?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    Ok(v)
}

// ---------------- stickers ----------------

pub fn owns_pack(conn: &Connection, pack: &str) -> Result<bool> {
    Ok(conn.query_row("SELECT 1 FROM sticker_owned WHERE pack_id=?1", [pack], |_| Ok(())).optional()?.is_some())
}

#[derive(Debug, Clone, Serialize)]
pub struct StickerState {
    pub owned: Vec<String>,
    pub favorites: Vec<String>,
    pub recent: Vec<String>,
}

pub fn sticker_state(conn: &Connection) -> Result<StickerState> {
    let q = |sql: &str| -> Result<Vec<String>> {
        let mut st = conn.prepare(sql)?;
        let v = st.query_map([], |r| r.get(0))?.collect::<std::result::Result<Vec<String>, _>>()?;
        Ok(v)
    };
    Ok(StickerState {
        owned: q("SELECT pack_id FROM sticker_owned ORDER BY created_at")?,
        favorites: q("SELECT sticker_id FROM sticker_usage WHERE favorite=1 ORDER BY last_used_at DESC")?,
        recent: q("SELECT sticker_id FROM sticker_usage WHERE last_used_at IS NOT NULL ORDER BY last_used_at DESC LIMIT 16")?,
    })
}

pub fn set_favorite(conn: &Connection, sticker: &str, fav: bool) -> Result<()> {
    if npc::sticker(sticker).is_none() {
        return Err(CoreError::Invalid("unknown sticker".into()));
    }
    conn.execute(
        "INSERT INTO sticker_usage (sticker_id, favorite) VALUES (?1, ?2) ON CONFLICT(sticker_id) DO UPDATE SET favorite=excluded.favorite",
        params![sticker, fav],
    )?;
    Ok(())
}

/// Buys a cosmetic sticker pack with world currency. Cosmetic only.
pub fn buy_pack(conn: &Connection, dev: &str, pack: &str, day: &str) -> Result<()> {
    let p = npc::sticker_packs().iter().find(|p| p.id == pack).ok_or_else(|| CoreError::NotFound(format!("pack {pack}")))?;
    if owns_pack(conn, pack)? {
        return Err(CoreError::Invalid("already owned".into()));
    }
    let balance: i64 = conn.query_row("SELECT COALESCE(SUM(amount),0) FROM reward_ledger WHERE currency='yen'", [], |r| r.get(0))?;
    if balance < p.price_yen {
        return Err(CoreError::Invalid(format!("not enough ¥ (need {}, have {balance})", p.price_yen)));
    }
    let now = now_ms();
    if p.price_yen > 0 {
        conn.execute(
            "INSERT INTO reward_ledger (id, currency, amount, reason, ref, day, created_at, device_id) VALUES (?1, 'yen', ?2, 'purchase', ?3, ?4, ?5, ?6)",
            params![new_id(), -p.price_yen, format!("stickers:{pack}"), day, now, dev],
        )?;
    }
    conn.execute("INSERT INTO sticker_owned (pack_id, source, created_at) VALUES (?1, 'purchase', ?2)", params![pack, now])?;
    Ok(())
}

// ---------------- calendar ----------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CalendarEvent {
    #[serde(default)]
    pub id: String,
    pub title: String,
    #[serde(default)]
    pub starts_at: Option<i64>,
    #[serde(default)]
    pub when_text: String,
    #[serde(default)]
    pub place: String,
    #[serde(default)]
    pub participants: Vec<String>,
    #[serde(default)]
    pub source_message_id: Option<String>,
    #[serde(default = "planned")]
    pub status: String,
    #[serde(default)]
    pub created_at: i64,
}
fn planned() -> String {
    "planned".into()
}

pub fn add_event(conn: &Connection, dev: &str, e: &CalendarEvent) -> Result<String> {
    if e.title.trim().is_empty() {
        return Err(CoreError::Invalid("event needs a title".into()));
    }
    // Avoid duplicate plans from the same message.
    if let Some(src) = &e.source_message_id {
        if let Some(id) = conn.query_row("SELECT id FROM calendar_events WHERE source_message_id=?1 AND deleted_at IS NULL", [src], |r| r.get::<_, String>(0)).optional()? {
            return Ok(id);
        }
    }
    let id = new_id();
    let now = now_ms();
    conn.execute(
        "INSERT INTO calendar_events (id, title, starts_at, when_text, place, participants, source_message_id, status, created_at, updated_at, rev, device_id)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'planned', ?8, ?8, 1, ?9)",
        params![id, e.title.trim(), e.starts_at, e.when_text, e.place, serde_json::to_string(&e.participants)?, e.source_message_id, now, dev],
    )?;
    Ok(id)
}

pub fn events(conn: &Connection) -> Result<Vec<CalendarEvent>> {
    let mut st = conn.prepare(
        "SELECT id, title, starts_at, when_text, place, participants, source_message_id, status, created_at FROM calendar_events WHERE deleted_at IS NULL ORDER BY COALESCE(starts_at, created_at)",
    )?;
    let v = st
        .query_map([], |r| {
            let parts: String = r.get(5)?;
            Ok(CalendarEvent {
                id: r.get(0)?, title: r.get(1)?, starts_at: r.get(2)?, when_text: r.get(3)?, place: r.get(4)?,
                participants: serde_json::from_str(&parts).unwrap_or_default(), source_message_id: r.get(6)?, status: r.get(7)?, created_at: r.get(8)?,
            })
        })?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    Ok(v)
}

pub fn set_event_status(conn: &Connection, id: &str, status: &str) -> Result<()> {
    if !matches!(status, "planned" | "done" | "cancelled") {
        return Err(CoreError::Invalid("bad status".into()));
    }
    let now = now_ms();
    if status == "cancelled" {
        conn.execute("UPDATE calendar_events SET status=?2, deleted_at=?3, updated_at=?3, rev=rev+1 WHERE id=?1", params![id, status, now])?;
    } else {
        conn.execute("UPDATE calendar_events SET status=?2, updated_at=?3, rev=rev+1 WHERE id=?1", params![id, status, now])?;
    }
    Ok(())
}

// ---------------- learning observations ----------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Observation {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub conversation_id: String,
    #[serde(default)]
    pub message_id: Option<String>,
    pub category: String,
    #[serde(default)]
    pub original: String,
    #[serde(default)]
    pub suggestion: String,
    #[serde(default)]
    pub note: String,
    #[serde(default)]
    pub payload: serde_json::Value,
    #[serde(default)]
    pub created_at: i64,
}

pub const OBS_CATEGORIES: &[&str] = &["error", "unnatural", "natural_casual", "slang", "success", "vocab"];

pub fn add_observations(conn: &Connection, dev: &str, obs: &[Observation]) -> Result<usize> {
    let now = now_ms();
    let mut n = 0;
    for o in obs {
        if !OBS_CATEGORIES.contains(&o.category.as_str()) {
            continue;
        }
        conn.execute(
            "INSERT INTO learning_observations (id, conversation_id, message_id, category, original, suggestion, note, payload, created_at, device_id)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            params![new_id(), o.conversation_id, o.message_id, o.category, o.original, o.suggestion, o.note, o.payload.to_string(), now, dev],
        )?;
        n += 1;
    }
    Ok(n)
}

pub fn observations(conn: &Connection, conv: &str) -> Result<Vec<Observation>> {
    let mut st = conn.prepare(
        "SELECT id, conversation_id, message_id, category, original, suggestion, note, payload, created_at FROM learning_observations
         WHERE conversation_id=?1 AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 200",
    )?;
    let v = st
        .query_map([conv], |r| {
            let p: String = r.get(7)?;
            Ok(Observation {
                id: r.get(0)?, conversation_id: r.get(1)?, message_id: r.get(2)?, category: r.get(3)?, original: r.get(4)?,
                suggestion: r.get(5)?, note: r.get(6)?, payload: serde_json::from_str(&p).unwrap_or_default(), created_at: r.get(8)?,
            })
        })?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    Ok(v)
}

/// Player messages since the last review of this conversation.
pub fn unreviewed_player_messages(conn: &Connection, conv: &str, now: i64) -> Result<Vec<Message>> {
    let since: i64 = conn.query_row("SELECT COALESCE(MAX(created_at),0) FROM learning_observations WHERE conversation_id=?1", [conv], |r| r.get(0))?;
    let mut st = conn.prepare(&format!(
        "SELECT {MSG_COLS} FROM messages WHERE conversation_id=?1 AND sender_id='player' AND kind='text' AND deliver_at > ?2 AND deliver_at <= ?3 AND deleted_at IS NULL ORDER BY deliver_at LIMIT 40"
    ))?;
    let v = st.query_map(params![conv, since, now], row_msg)?.collect::<std::result::Result<Vec<_>, _>>()?;
    Ok(v)
}

// ---------------- AI usage ----------------

pub fn add_usage(conn: &Connection, day: &str, purpose: &str, input_tokens: i64, output_tokens: i64) -> Result<()> {
    conn.execute(
        "INSERT INTO ai_usage (day, purpose, requests, input_tokens, output_tokens) VALUES (?1, ?2, 1, ?3, ?4)
         ON CONFLICT(day, purpose) DO UPDATE SET requests=requests+1, input_tokens=input_tokens+excluded.input_tokens, output_tokens=output_tokens+excluded.output_tokens",
        params![day, purpose, input_tokens, output_tokens],
    )?;
    Ok(())
}

#[derive(Debug, Clone, Serialize, Default)]
pub struct Usage {
    pub requests: i64,
    pub background_requests: i64,
    pub input_tokens: i64,
    pub output_tokens: i64,
}

pub fn usage(conn: &Connection, day: &str) -> Result<Usage> {
    Ok(conn.query_row(
        "SELECT COALESCE(SUM(requests),0), COALESCE(SUM(CASE WHEN purpose IN ('initiate','group_topic') THEN requests ELSE 0 END),0),
                COALESCE(SUM(input_tokens),0), COALESCE(SUM(output_tokens),0) FROM ai_usage WHERE day=?1",
        [day],
        |r| Ok(Usage { requests: r.get(0)?, background_requests: r.get(1)?, input_tokens: r.get(2)?, output_tokens: r.get(3)? }),
    )?)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::migrations;

    fn db() -> Connection {
        let mut c = Connection::open_in_memory().unwrap();
        migrations::migrate(&mut c).unwrap();
        crate::game::ensure_characters(&c, "d").unwrap();
        npc::seed(&c, "d").unwrap();
        seed(&c, "d").unwrap();
        c
    }

    fn plan(sender: &str, body: &str, typing: i64, at: i64) -> Planned {
        Planned { sender_id: sender.into(), kind: "text".into(), body: body.into(), sticker_id: None, typing_from: typing, deliver_at: at, meta: serde_json::Value::Null }
    }

    #[test]
    fn seeding_creates_dms_groups_memo_with_openings_once() {
        let c = db();
        assert_eq!(seed(&c, "d").unwrap(), 0);
        let now = now_ms();
        let list = list_conversations(&c, now).unwrap();
        assert_eq!(list.len(), npc::profiles().len() + npc::groups().len() + 1);
        let haruto = list.iter().find(|v| v.id == "dm-haruto").unwrap();
        assert!(haruto.unread >= 2);
        assert_eq!(haruto.members, vec!["haruto".to_string(), "player".to_string()]);
        assert!(list.iter().any(|v| v.kind == "group" && v.members.len() == 4));
    }

    #[test]
    fn scheduled_messages_are_invisible_until_delivered_and_drive_typing() {
        let c = db();
        let now = now_ms();
        mark_read(&c, "dm-haruto", now).unwrap();
        schedule(&c, "d", "dm-haruto", &[plan("haruto", "まじ？", now + 1000, now + 3000)]).unwrap();
        let v = get_conversation(&c, "dm-haruto", now).unwrap();
        assert!(v.typing.is_empty());
        assert_eq!(v.next_change_at, Some(now + 1000));
        let v = get_conversation(&c, "dm-haruto", now + 1500).unwrap();
        assert_eq!(v.typing.len(), 1, "typing indicator comes from the scheduled row");
        assert!(messages(&c, "dm-haruto", now + 1500, None, 50).unwrap().iter().all(|m| m.body != "まじ？"));
        assert!(deliver_due(&c, now + 1500).unwrap().is_empty());
        let d = deliver_due(&c, now + 3000).unwrap();
        assert_eq!(d.len(), 1);
        assert!(deliver_due(&c, now + 4000).unwrap().is_empty(), "idempotent");
        let v = get_conversation(&c, "dm-haruto", now + 3000).unwrap();
        assert_eq!(v.unread, 1);
        assert_eq!(v.last_message.unwrap().body, "まじ？");
    }

    #[test]
    fn player_send_clears_draft_marks_pending_and_validates() {
        let c = db();
        let now = now_ms();
        set_draft(&c, "dm-mika", "書きかけ").unwrap();
        assert_eq!(get_conversation(&c, "dm-mika", now).unwrap().draft.as_deref(), Some("書きかけ"));
        let m = send_player(&c, "d", &Outgoing { conversation_id: "dm-mika".into(), kind: "text".into(), body: "週末ひま？\n".into(), sticker_id: None }, true, now).unwrap();
        assert_eq!(m.reply_state.as_deref(), Some("pending"));
        assert_eq!(m.body, "週末ひま？");
        assert!(get_conversation(&c, "dm-mika", now).unwrap().draft.is_none());
        assert_eq!(conversations_with_pending(&c).unwrap(), vec!["dm-mika".to_string()]);
        assert!(send_player(&c, "d", &Outgoing { conversation_id: "dm-mika".into(), kind: "text".into(), body: "   ".into(), sticker_id: None }, true, now).is_err());
        assert!(send_player(&c, "d", &Outgoing { conversation_id: "dm-mika".into(), kind: "sticker".into(), body: String::new(), sticker_id: Some("kaeru.hi".into()) }, true, now).is_err(), "kaeru isn't owned yet");
        assert!(send_player(&c, "d", &Outgoing { conversation_id: "dm-mika".into(), kind: "sticker".into(), body: String::new(), sticker_id: Some("mochi.ok".into()) }, true, now).is_ok());
        assert_eq!(sticker_state(&c).unwrap().recent, vec!["mochi.ok".to_string()]);
        let memo = send_player(&c, "d", &Outgoing { conversation_id: "memo".into(), kind: "text".into(), body: "メモ".into(), sticker_id: None }, true, now).unwrap();
        assert_eq!(memo.reply_state.as_deref(), Some("none"), "memo never asks the AI");
    }

    #[test]
    fn sticker_purchase_uses_currency_and_never_goes_negative() {
        let c = db();
        assert!(buy_pack(&c, "d", "kaeru", "2026-11-18").is_err());
        c.execute("INSERT INTO reward_ledger (id, currency, amount, reason, ref, day, created_at, device_id) VALUES ('x','yen',500,'quest','q','2026-11-18',0,'d')", []).unwrap();
        buy_pack(&c, "d", "kaeru", "2026-11-18").unwrap();
        assert!(owns_pack(&c, "kaeru").unwrap());
        assert!(buy_pack(&c, "d", "kaeru", "2026-11-18").is_err());
        let bal: i64 = c.query_row("SELECT SUM(amount) FROM reward_ledger WHERE currency='yen'", [], |r| r.get(0)).unwrap();
        assert_eq!(bal, 200);
    }

    #[test]
    fn calls_never_fake_completion() {
        let c = db();
        log_call(&c, "d", "haruto", "voice", "unavailable", None).unwrap();
        assert!(log_call(&c, "d", "haruto", "voice", "completed", None).is_err());
        assert_eq!(calls(&c).unwrap().len(), 1);
    }

    #[test]
    fn clear_history_cancels_scheduled_and_search_works() {
        let c = db();
        let now = now_ms();
        send_player(&c, "d", &Outgoing { conversation_id: "dm-ren".into(), kind: "text".into(), body: "Rustの話しよう".into(), sticker_id: None }, true, now).unwrap();
        schedule(&c, "d", "dm-ren", &[plan("ren", "いいですね", now, now + 5000)]).unwrap();
        assert_eq!(search(&c, "Rust", now).unwrap().len(), 1);
        clear_history(&c, "dm-ren").unwrap();
        assert!(deliver_due(&c, now + 10_000).unwrap().is_empty());
        assert!(messages(&c, "dm-ren", now + 10_000, None, 50).unwrap().is_empty());
        assert!(search(&c, "Rust", now).unwrap().is_empty());
    }

    #[test]
    fn calendar_dedupes_by_source_message() {
        let c = db();
        let e = CalendarEvent { id: String::new(), title: "カフェ".into(), starts_at: None, when_text: "土曜 14時".into(), place: "駅前".into(), participants: vec!["mika".into()], source_message_id: Some("m1".into()), status: "planned".into(), created_at: 0 };
        let a = add_event(&c, "d", &e).unwrap();
        let b = add_event(&c, "d", &e).unwrap();
        assert_eq!(a, b);
        assert_eq!(events(&c).unwrap().len(), 1);
    }
}

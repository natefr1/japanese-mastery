//! The AI contract for 生活 characters: prompt construction, strict response
//! parsing/validation, and realistic delivery timing. Pure functions, no I/O,
//! so behaviour is testable and provider-independent.
//!
//! Privacy: prompts contain only the character profile, the relationship stage,
//! a handful of retrieved memories, a short summary and the last few messages
//! of THIS conversation. Never the database, never other conversations.

use crate::chat::{Message, Planned, PLAYER};
use crate::npc::{self, NpcState, Profile};
use crate::{CoreError, Result};
use serde::{Deserialize, Serialize};

// ---------------- tiny deterministic RNG ----------------

#[derive(Debug, Clone)]
pub struct Rng(u64);
impl Rng {
    pub fn new(seed: u64) -> Self {
        Rng(seed.max(1))
    }
    pub fn next_f64(&mut self) -> f64 {
        // xorshift64*
        self.0 ^= self.0 >> 12;
        self.0 ^= self.0 << 25;
        self.0 ^= self.0 >> 27;
        (self.0.wrapping_mul(0x2545_F491_4F6C_DD1D) >> 11) as f64 / (1u64 << 53) as f64
    }
    pub fn range(&mut self, lo: f64, hi: f64) -> f64 {
        lo + (hi - lo) * self.next_f64()
    }
}

// ---------------- context ----------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorldTime {
    pub hour: u8,
    pub minute: u8,
    pub weekday: u8, // 0 = Sunday
}

impl WorldTime {
    pub fn label(&self) -> String {
        let wd = ["日", "月", "火", "水", "木", "金", "土"][self.weekday as usize % 7];
        let part = match self.hour {
            5..=10 => "朝",
            11..=13 => "昼",
            14..=17 => "午後",
            18..=22 => "夜",
            _ => "深夜",
        };
        format!("{wd}曜日 {part} {:02}:{:02}", self.hour, self.minute)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct PlayerInfo {
    pub name: String,
    pub status_message: String,
    /// e.g. "N4 learner, wants to text naturally" — no sensitive data.
    pub level_note: String,
}

#[derive(Debug, Clone)]
pub struct MemoryLine {
    pub id: String,
    pub fact: String,
}

#[derive(Debug, Clone, PartialEq)]
pub enum Task {
    /// Reply to the player in a direct chat.
    Reply,
    /// Start a conversation unprompted, for a concrete reason.
    Initiate { reason: String },
    /// Reply in a group (one or more members may speak).
    GroupReply,
    /// A member opens a topic in a group.
    GroupTopic { opener: String, reason: String },
}

pub struct PromptInput<'a> {
    pub task: Task,
    /// Speaking characters with their state (one for DMs, all NPC members for groups).
    pub speakers: Vec<(&'a Profile, &'a NpcState)>,
    pub group_title: Option<String>,
    pub memories: Vec<(String, Vec<MemoryLine>)>, // per character id
    pub summary: Option<String>,
    pub recent: Vec<Message>,
    pub world: WorldTime,
    pub player: PlayerInfo,
    /// Minutes to add to UTC to get local time (e.g. -360 for Houston in winter).
    pub tz_offset_min: i32,
}

#[derive(Debug, Clone, Serialize)]
pub struct Prompt {
    pub system: String,
    pub user: String,
}

fn speaker_name(id: &str, player: &PlayerInfo) -> String {
    if id == PLAYER {
        return format!("{} (player)", player.name);
    }
    npc::profile(id).map(|p| p.display.clone()).unwrap_or_else(|| id.to_string())
}

fn render_line(m: &Message, player: &PlayerInfo, tz: i32) -> String {
    let t = chrono_hm(m.deliver_at + tz as i64 * 60_000);
    let who = speaker_name(&m.sender_id, player);
    let content = match m.kind.as_str() {
        "sticker" => {
            let s = m.sticker_id.as_deref().and_then(npc::sticker);
            format!("[sticker: 「{}」 = {}]", s.map(|x| x.caption.as_str()).unwrap_or("?"), s.map(|x| x.meaning.as_str()).unwrap_or("?"))
        }
        "system" => format!("[{}]", m.body),
        _ => m.body.replace('\n', " / "),
    };
    let reacts = if m.reactions.is_empty() { String::new() } else { format!(" (reactions: {})", m.reactions.iter().map(|(w, e)| format!("{} {}", speaker_name(w, player), e)).collect::<Vec<_>>().join(", ")) };
    format!("[{t}] {who}: {content}{reacts}")
}

/// HH:MM of a (local-shifted) unix ms timestamp.
fn chrono_hm(ms: i64) -> String {
    let m = (ms / 60_000).rem_euclid(1440);
    format!("{:02}:{:02}", m / 60, m % 60)
}

fn persona_block(p: &Profile, st: &NpcState, in_group: bool, world: &WorldTime) -> String {
    let stage = npc::register_stage(p, st, in_group);
    let examples: Vec<String> = p
        .speech
        .examples
        .iter()
        .filter(|(k, _)| k.parse::<u8>().map(|s| s.abs_diff(stage) <= 1).unwrap_or(false))
        .flat_map(|(k, v)| v.iter().map(move |e| format!("  (stage {k}) {e}")))
        .collect();
    let others: Vec<String> = npc::relations_of(&p.id).iter().map(|(o, r)| format!("{} ({}, {}): {}", o.display, o.name, r.kind, r.note)).collect();
    let busy = npc::busy_with(p, world.weekday, world.hour);
    let activity = match busy {
        Some(b) => format!("Right now you are busy: {b}. Keep replies short or reply later."),
        None if npc::is_active(p, world.hour) => "Right now you're free and on your phone.".to_string(),
        None => "Right now isn't a usual time for you to be texting (you may be tired or about to sleep).".to_string(),
    };
    format!(
        "## {name} ({display}, {full}, {age})\n\
         Role: {role}\nBio: {bio}\nPersonality: {pers}\nInterests: {ints}\nDislikes: {dis}\n\
         People you know: {others}\n\
         Texting style: first person 「{fp}」; message length: {len}; usually {b0}-{b1} bubbles; laugh: {laugh}; \
         emoji in roughly {emoji}% of messages, only from {emoji_set}; sticker instead of text in roughly {stk}% of turns (packs: {packs}).\n\
         Quirks: {quirks}\nAvoid: {avoid}\n\
         Ask a question in at most ~{q}% of your turns. It's fine to just react, comment, or end the topic.\n\
         Current register with the player: stage {stage}: {reg}.\n\
         Example lines near this register:\n{ex}\n\
         Relationship (0-100): closeness {c:.0}, trust {t:.0}, shared experiences {sh}, days talked {days}.\n\
         {activity}",
        name = p.name, display = p.display, full = p.full_name, age = p.age, role = p.role, bio = p.bio,
        pers = p.personality.join(", "), ints = p.interests.join(", "), dis = p.dislikes.join(", "),
        others = if others.is_empty() { "-".into() } else { others.join("; ") },
        fp = p.speech.first_person, len = p.speech.length, b0 = p.speech.bubbles[0], b1 = p.speech.bubbles[1],
        laugh = p.speech.laugh, emoji = (p.speech.emoji_rate * 100.0).round(), emoji_set = p.speech.emoji.join(" "),
        stk = (p.speech.sticker_rate * 100.0).round(), packs = p.speech.sticker_packs.join(", "),
        quirks = p.speech.quirks.join("; "), avoid = p.speech.avoid.join("; "), q = (p.behavior.question_rate * 100.0).round(),
        stage = stage, reg = npc::register_label(stage), ex = examples.join("\n"),
        c = st.closeness, t = st.trust, sh = st.shared_experiences, days = st.meaningful_days, activity = activity,
    )
}

fn sticker_menu(packs: &[String]) -> String {
    npc::sticker_packs()
        .iter()
        .filter(|p| packs.contains(&p.id))
        .flat_map(|p| p.stickers.iter().map(|s| format!("{} 「{}」 {}", s.id, s.caption, s.meaning)))
        .collect::<Vec<_>>()
        .join("\n")
}

const RULES: &str = "\
You are role-playing real people in a Japanese everyday-life simulation. The player is a non-native learner \
who types their own Japanese. Treat them as a friend/acquaintance, not a student.
Hard rules:
- Write ONLY natural Japanese as a real Japanese person would text in this situation. Never English (unless the \
player writes English: then react like a person would, briefly, in Japanese).
- Never mention being an AI, a model, a game, or a language tutor. Never translate. Never correct the player's \
Japanese. Never praise their Japanese.
- If the player's meaning is clear despite mistakes, just respond to the meaning. If it's unclear, react like a person: \
ask what they mean, guess cautiously, or say you didn't get it. Set understood accordingly.
- Real texting: short bubbles; sometimes a single word; sometimes several bubbles; sometimes only a sticker or a \
reaction; sometimes end the conversation. Do not end every message with a question. Do not be relentlessly upbeat.
- Not every young person uses slang. Follow each person's style exactly. No exaggerated anime speech.
- Stay consistent with memories and the conversation. You may refer back to earlier things naturally.
- Plans must be concrete and realistic for this neighbourhood (café near the station, konbini, arcade, karaoke, \
ramen shop, university, park, someone's apartment).
- Relationship deltas reflect social behaviour only (kindness, effort, sharing, plans kept, rudeness). Grammar \
mistakes never lower them. Typical turn: 0. Use ±1 rarely, ±2 only for notable moments.";

const SCHEMA_DM: &str = r#"Return ONLY a JSON object, no prose, no code fences:
{
  "read_only": false,                       // true = read the message but don't reply now (natural end, busy, nothing to add)
  "messages": [                             // 0-5 items, in order
    {"type": "text", "text": "…"},          // one chat bubble each, max ~120 chars
    {"type": "sticker", "id": "mochi.ok"}   // only ids from the sticker list
  ],
  "react": null,                            // or one emoji reacting to the player's last message, e.g. "😂"
  "understood": "clear",                    // clear | partial | unclear  (how well you understood the player)
  "plan": null,                             // or {"title": "カフェ", "when": "土曜 14:00", "place": "駅前のカフェ"} ONLY when a concrete plan was just agreed
  "memories": [],                           // durable facts about the player/shared history worth remembering, English, e.g. {"fact": "Player likes horror games", "importance": 3}
  "relationship": {"closeness": 0, "trust": 0, "shared_experience": false}
}"#;

const SCHEMA_GROUP: &str = r#"Return ONLY a JSON object, no prose, no code fences:
{
  "messages": [                                  // 0-4 items total across all members, in order
    {"from": "<member id>", "type": "text", "text": "…"},
    {"from": "<member id>", "type": "sticker", "id": "tora.ok"}
  ],
  "react": null,                                 // or {"from": "<member id>", "emoji": "😂"} on the player's last message
  "understood": "clear",
  "plan": null,                                  // or {"title": …, "when": …, "place": …} when the group just agreed on a concrete plan
  "memories": [],                                // {"about": "<member id who learned it>", "fact": …, "importance": 1-5}
  "relationship": {}                             // optional per member: {"<id>": {"closeness": 0, "trust": 0}}
}
Usually only 1-2 members respond; members may respond to each other; stop at a natural point where the player can reply."#;

pub fn build(input: &PromptInput) -> Prompt {
    let group = input.group_title.is_some();
    let personas: Vec<String> = input.speakers.iter().map(|(p, s)| persona_block(p, s, group, &input.world)).collect();
    let mut packs: Vec<String> = input.speakers.iter().flat_map(|(p, _)| p.speech.sticker_packs.clone()).collect();
    packs.sort();
    packs.dedup();
    let memories: Vec<String> = input
        .memories
        .iter()
        .filter(|(_, m)| !m.is_empty())
        .map(|(who, m)| format!("What {} remembers:\n{}", speaker_name(who, &input.player), m.iter().map(|l| format!("- {}", l.fact)).collect::<Vec<_>>().join("\n")))
        .collect();
    let system = format!(
        "{RULES}\n\n{}\n\nThe player: {} (status message: 「{}」). {}\n\nSticker list (id 「caption」 meaning):\n{}\n\n{}",
        personas.join("\n\n"),
        input.player.name,
        input.player.status_message,
        input.player.level_note,
        sticker_menu(&packs),
        if group { SCHEMA_GROUP } else { SCHEMA_DM }
    );
    let transcript: Vec<String> = input.recent.iter().map(|m| render_line(m, &input.player, input.tz_offset_min)).collect();
    let task = match &input.task {
        Task::Reply => format!("Reply as {} to the player's latest message(s).", input.speakers[0].0.display),
        Task::GroupReply => format!("Write the group's next messages in 「{}」 responding to the player.", input.group_title.clone().unwrap_or_default()),
        Task::Initiate { reason } => format!(
            "{} decides to message the player unprompted. Reason: {reason}. Write a natural opener (not a greeting template). \
             If there's genuinely nothing worth saying, return empty messages.",
            input.speakers[0].0.display
        ),
        Task::GroupTopic { opener, reason } => format!(
            "{} brings up something in the group 「{}」. Reason: {reason}. 1-3 messages; others may react briefly. Leave room for the player.",
            speaker_name(opener, &input.player),
            input.group_title.clone().unwrap_or_default()
        ),
    };
    let user = format!(
        "Local time: {}.\n{}\n\n{}\n\nRecent messages (oldest first):\n{}\n\n{task}",
        input.world.label(),
        input.summary.as_ref().map(|s| format!("Earlier in this chat (summary): {s}")).unwrap_or_default(),
        memories.join("\n\n"),
        if transcript.is_empty() { "(no messages yet)".to_string() } else { transcript.join("\n") },
    );
    Prompt { system, user }
}

// ---------------- parsing ----------------

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
pub struct OutMessage {
    #[serde(default)]
    pub from: Option<String>,
    #[serde(rename = "type", default = "text_kind")]
    pub kind: String,
    #[serde(default)]
    pub text: Option<String>,
    #[serde(default)]
    pub id: Option<String>,
}
fn text_kind() -> String {
    "text".into()
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Default)]
pub struct OutPlan {
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub when: String,
    #[serde(default)]
    pub place: String,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
pub struct OutMemory {
    #[serde(default)]
    pub about: Option<String>,
    pub fact: String,
    #[serde(default = "three")]
    pub importance: i64,
}
fn three() -> i64 {
    3
}

#[derive(Debug, Clone, Deserialize, Default)]
struct RawReply {
    #[serde(default)]
    read_only: bool,
    #[serde(default)]
    messages: Vec<OutMessage>,
    #[serde(default)]
    react: serde_json::Value,
    #[serde(default)]
    understood: Option<String>,
    #[serde(default)]
    plan: Option<OutPlan>,
    #[serde(default)]
    memories: Vec<OutMemory>,
    #[serde(default)]
    relationship: serde_json::Value,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Reaction {
    pub from: String,
    pub emoji: String,
}

#[derive(Debug, Clone)]
pub struct Reply {
    pub read_only: bool,
    pub messages: Vec<OutMessage>, // validated: `from` always set
    pub react: Option<Reaction>,
    pub understood: String,
    pub plan: Option<OutPlan>,
    pub memories: Vec<OutMemory>, // validated: `about` always set
    pub relationship: Vec<(String, npc::RelDelta)>,
}

/// Extracts the JSON object from a model completion (tolerates code fences or chatter).
pub fn extract_json(raw: &str) -> Option<&str> {
    let start = raw.find('{')?;
    let end = raw.rfind('}')?;
    (end > start).then(|| &raw[start..=end])
}

pub const MAX_BUBBLES: usize = 5;
pub const MAX_GROUP_MESSAGES: usize = 4;
pub const MAX_BUBBLE_CHARS: usize = 240;

/// Parses and validates a reply. `speakers` are the characters allowed to talk.
pub fn parse_reply(raw: &str, speakers: &[&Profile], group: bool) -> Result<Reply> {
    let json = extract_json(raw).ok_or_else(|| CoreError::Invalid("AI reply had no JSON".into()))?;
    let r: RawReply = serde_json::from_str(json).map_err(|e| CoreError::Invalid(format!("AI reply JSON invalid: {e}")))?;
    let default = speakers.first().map(|p| p.id.clone()).ok_or_else(|| CoreError::Invalid("no speakers".into()))?;
    let allowed = |id: &str| speakers.iter().any(|p| p.id == id);
    let mut msgs = vec![];
    for m in r.messages {
        let from = if group { m.from.clone().unwrap_or_default() } else { default.clone() };
        if !allowed(&from) {
            continue;
        }
        let p = speakers.iter().find(|p| p.id == from).unwrap();
        match m.kind.as_str() {
            "sticker" => {
                let id = m.id.clone().unwrap_or_default();
                let pack = id.split('.').next().unwrap_or("");
                if npc::sticker(&id).is_some() && p.speech.sticker_packs.iter().any(|x| x == pack) {
                    msgs.push(OutMessage { from: Some(from), kind: "sticker".into(), text: None, id: Some(id) });
                }
            }
            _ => {
                let t = m.text.unwrap_or_default();
                let t = t.trim();
                if t.is_empty() {
                    continue;
                }
                let t: String = t.chars().take(MAX_BUBBLE_CHARS).collect();
                msgs.push(OutMessage { from: Some(from), kind: "text".into(), text: Some(t), id: None });
            }
        }
    }
    msgs.truncate(if group { MAX_GROUP_MESSAGES } else { MAX_BUBBLES });
    let react = match &r.react {
        serde_json::Value::String(e) if !e.is_empty() && e.chars().count() <= 4 => Some(Reaction { from: default.clone(), emoji: e.clone() }),
        serde_json::Value::Object(o) => {
            let from = o.get("from").and_then(|v| v.as_str()).unwrap_or(&default).to_string();
            let e = o.get("emoji").and_then(|v| v.as_str()).unwrap_or("").to_string();
            (allowed(&from) && !e.is_empty() && e.chars().count() <= 4).then_some(Reaction { from, emoji: e })
        }
        _ => None,
    };
    let understood = match r.understood.as_deref() {
        Some("partial") => "partial",
        Some("unclear") => "unclear",
        _ => "clear",
    }
    .to_string();
    let plan = r.plan.filter(|p| !p.title.trim().is_empty());
    let memories = r
        .memories
        .into_iter()
        .filter(|m| !m.fact.trim().is_empty() && m.fact.chars().count() <= 200)
        .map(|mut m| {
            let about = if group { m.about.clone().unwrap_or_default() } else { default.clone() };
            m.about = Some(about);
            m.importance = m.importance.clamp(1, 5);
            m
        })
        .filter(|m| allowed(m.about.as_deref().unwrap_or("")))
        .take(3)
        .collect();
    let mut relationship = vec![];
    if group {
        if let serde_json::Value::Object(o) = &r.relationship {
            for (k, v) in o {
                if allowed(k) {
                    if let Ok(d) = serde_json::from_value::<npc::RelDelta>(v.clone()) {
                        relationship.push((k.clone(), d));
                    }
                }
            }
        }
    } else if let Ok(d) = serde_json::from_value::<npc::RelDelta>(r.relationship.clone()) {
        relationship.push((default.clone(), d));
    }
    let read_only = r.read_only || (msgs.is_empty() && react.is_none());
    Ok(Reply { read_only, messages: msgs, react, understood, plan, memories, relationship })
}

// ---------------- delivery timing ----------------

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Pace {
    /// Near-instant (practice mode).
    Fast,
    /// Human-feeling but never frustrating (default).
    Natural,
    /// Full character latency, including slow repliers.
    Realistic,
}

pub struct Timing {
    pub read_at: i64,
    pub plans: Vec<Planned>,
}

/// Plans when messages are read, when typing starts and when each bubble lands.
/// `engaged` = the player and character were talking in the last few minutes.
pub fn plan_timing(reply: &Reply, now: i64, engaged: bool, busy: bool, pace: Pace, rng: &mut Rng) -> Timing {
    let first = reply.messages.first().and_then(|m| m.from.clone());
    let p = first.as_deref().and_then(npc::profile).or_else(|| reply.react.as_ref().and_then(|r| npc::profile(&r.from)));
    let (lo, hi) = match p {
        Some(p) if engaged => (p.behavior.reply_engaged[0] as f64, p.behavior.reply_engaged[1] as f64),
        Some(p) => (p.behavior.reply_idle[0] as f64, p.behavior.reply_idle[1] as f64),
        None => (2.0, 8.0),
    };
    let mut latency = rng.range(lo, hi);
    if busy && !engaged {
        latency *= 2.0;
    }
    latency = match pace {
        Pace::Fast => latency.min(2.5),
        Pace::Natural => latency.min(if engaged { 15.0 } else { 120.0 }),
        Pace::Realistic => latency,
    };
    let read_at = now + (latency * 0.55 * 1000.0) as i64;
    let mut t = read_at + (rng.range(0.4, 1.6) * 1000.0 * if pace == Pace::Fast { 0.3 } else { 1.0 }) as i64;
    let mut plans = vec![];
    for m in &reply.messages {
        let who = m.from.clone().unwrap_or_default();
        let cps = npc::profile(&who).map(|p| p.behavior.typing_cps).unwrap_or(7.0);
        let typing_s = match m.kind.as_str() {
            "sticker" => 0.9,
            _ => (m.text.as_deref().unwrap_or("").chars().count() as f64 / cps).clamp(0.6, 12.0),
        } * if pace == Pace::Fast { 0.25 } else { 1.0 };
        let typing_from = t;
        let deliver = t + (typing_s * 1000.0) as i64;
        plans.push(Planned {
            sender_id: who,
            kind: m.kind.clone(),
            body: m.text.clone().unwrap_or_default(),
            sticker_id: m.id.clone(),
            typing_from,
            deliver_at: deliver,
            meta: serde_json::Value::Null,
        });
        t = deliver + (rng.range(0.5, 1.8) * 1000.0 * if pace == Pace::Fast { 0.3 } else { 1.0 }) as i64;
    }
    Timing { read_at, plans }
}

// ---------------- auxiliary prompts ----------------

pub fn summary_prompt(character_names: &str, previous: Option<&str>, lines: &[String]) -> Prompt {
    Prompt {
        system: "You maintain a short memory summary of a chat in a Japanese life-simulation game. Write in English, under 120 words: \
                 facts, plans, feelings and open threads. No speculation, no style commentary."
            .into(),
        user: format!(
            "Characters: {character_names}\nPrevious summary: {}\n\nNew messages:\n{}\n\nReturn only the updated summary text.",
            previous.unwrap_or("(none)"),
            lines.join("\n")
        ),
    }
}

pub fn review_prompt(context: &[String], player_lines: &[(String, String)]) -> Prompt {
    Prompt {
        system: r#"You are a careful Japanese teacher reviewing a learner's text messages AFTER a chat. Be precise and honest.
Distinguish:
- "error": grammatically incorrect
- "unnatural": grammatical but a native wouldn't say it this way here
- "natural_casual": casual/contracted Japanese that is correct in this context (do NOT treat casual speech as wrong)
- "slang": appropriate slang/net speak used well
- "success": communicated the intended meaning well despite issues, or a notably natural line
Only include messages worth commenting on. Notes in English, one or two sentences. No flattery.
Return ONLY JSON:
{"items": [{"message_id": "...", "category": "error|unnatural|natural_casual|slang|success", "original": "...", "suggestion": "more natural version (Japanese) or empty", "note": "..."}],
 "vocab": [{"word": "...", "reading": "...", "meaning": "...", "from_message": "..."}],
 "overall": "2-3 sentence honest summary of how the communication went"}
Vocab = useful words/expressions from the OTHER people's messages the learner may not know (max 6)."#
            .into(),
        user: format!(
            "Conversation context (oldest first):\n{}\n\nLearner messages to review (id: text):\n{}",
            context.join("\n"),
            player_lines.iter().map(|(id, t)| format!("{id}: {t}")).collect::<Vec<_>>().join("\n")
        ),
    }
}

pub fn hint_prompt(context: &[String], goal: Option<&str>) -> Prompt {
    Prompt {
        system: "You help a Japanese learner keep a chat going WITHOUT writing it for them. In English, suggest what they could \
                 talk about or respond to (1-2 sentences), then list up to 3 useful Japanese words or patterns with readings and meanings. \
                 Never write a complete Japanese sentence they could copy."
            .into(),
        user: format!("Chat so far:\n{}\n{}", context.join("\n"), goal.map(|g| format!("Learner's goal: {g}")).unwrap_or_default()),
    }
}

pub fn gloss_prompt(word: &str, sentence: &str) -> Prompt {
    Prompt {
        system: "Explain a Japanese word or expression in context for a learner. Return ONLY JSON: \
                 {\"reading\": \"hiragana\", \"meaning\": \"short English meaning in this context\", \"note\": \"one sentence on nuance/register, or empty\"}"
            .into(),
        user: format!("Word: {word}\nSentence: {sentence}"),
    }
}

pub fn render_transcript(msgs: &[Message], player: &PlayerInfo, tz: i32) -> Vec<String> {
    msgs.iter().map(|m| render_line(m, player, tz)).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn msg(sender: &str, body: &str, at: i64) -> Message {
        Message {
            id: format!("m{at}"), conversation_id: "dm-haruto".into(), sender_id: sender.into(), kind: "text".into(), body: body.into(),
            sticker_id: None, meta: serde_json::Value::Null, status: "delivered".into(), created_at: at, deliver_at: at,
            read_by_npc_at: None, reply_state: None, reply_error: None, reactions: vec![],
        }
    }
    fn player() -> PlayerInfo {
        PlayerInfo { name: "ネイト".into(), status_message: "日本語勉強中".into(), level_note: "Non-native learner around N4.".into() }
    }

    #[test]
    fn prompt_contains_persona_register_memories_and_only_this_chat() {
        let p = npc::profile("ren").unwrap();
        let st = NpcState::default();
        let input = PromptInput {
            task: Task::Reply,
            speakers: vec![(p, &st)],
            group_title: None,
            memories: vec![("ren".into(), vec![MemoryLine { id: "1".into(), fact: "Player is learning Rust".into() }])],
            summary: Some("They talked about robots.".into()),
            recent: vec![msg("player", "ロボットが好きです", 1000)],
            world: WorldTime { hour: 21, minute: 5, weekday: 2 },
            player: player(),
            tz_offset_min: 0,
        };
        let pr = build(&input);
        assert!(pr.system.contains("stage 0"));
        assert!(pr.system.contains("です/ます"));
        assert!(pr.system.contains("僕"));
        assert!(pr.system.contains("mochi.ok"), "sticker menu from Ren's packs");
        assert!(!pr.system.contains("tora.ok"), "only the speaker's packs");
        assert!(pr.user.contains("Player is learning Rust"));
        assert!(pr.user.contains("ロボットが好きです"));
        assert!(pr.user.contains("火曜日 夜"));
        assert!(pr.system.contains("Never praise their Japanese"));
    }

    #[test]
    fn parses_and_validates_dm_reply() {
        let p = npc::profile("haruto").unwrap();
        let raw = "sure!\n```json\n{\"messages\":[{\"type\":\"text\",\"text\":\"まじ？\"},{\"type\":\"sticker\",\"id\":\"tora.ok\"},{\"type\":\"sticker\",\"id\":\"kaeru.hi\"},{\"type\":\"text\",\"text\":\"  \"}],\
                   \"react\":\"😂\",\"understood\":\"partial\",\"memories\":[{\"fact\":\"Player likes ramen\",\"importance\":9}],\"relationship\":{\"closeness\":1}}\n```";
        let r = parse_reply(raw, &[p], false).unwrap();
        assert_eq!(r.messages.len(), 2, "kaeru isn't one of Haruto's packs; empty text dropped");
        assert_eq!(r.messages[0].from.as_deref(), Some("haruto"));
        assert_eq!(r.react, Some(Reaction { from: "haruto".into(), emoji: "😂".into() }));
        assert_eq!(r.understood, "partial");
        assert_eq!(r.memories[0].importance, 5);
        assert_eq!(r.relationship[0].1.closeness, 1.0);
        assert!(!r.read_only);
    }

    #[test]
    fn group_reply_only_allows_members_and_caps_length() {
        let h = npc::profile("haruto").unwrap();
        let s = npc::profile("sota").unwrap();
        let mut items = vec![];
        for i in 0..8 {
            items.push(format!("{{\"from\":\"{}\",\"type\":\"text\",\"text\":\"msg{i}\"}}", if i % 2 == 0 { "haruto" } else { "sota" }));
        }
        items.push("{\"from\":\"mika\",\"type\":\"text\",\"text\":\"intruder\"}".into());
        let raw = format!("{{\"messages\":[{}],\"relationship\":{{\"sota\":{{\"closeness\":1}},\"mika\":{{\"closeness\":2}}}}}}", items.join(","));
        let r = parse_reply(&raw, &[h, s], true).unwrap();
        assert_eq!(r.messages.len(), MAX_GROUP_MESSAGES);
        assert!(r.messages.iter().all(|m| m.from.as_deref() != Some("mika")));
        assert_eq!(r.relationship.len(), 1);
    }

    #[test]
    fn empty_reply_is_read_only_and_garbage_is_rejected() {
        let p = npc::profile("yui").unwrap();
        assert!(parse_reply("{\"messages\":[]}", &[p], false).unwrap().read_only);
        assert!(parse_reply("I can't do that", &[p], false).is_err());
    }

    #[test]
    fn timing_reads_before_typing_before_delivery_and_respects_pace() {
        let p = npc::profile("yui").unwrap();
        let r = parse_reply("{\"messages\":[{\"type\":\"text\",\"text\":\"そうなんだ\"},{\"type\":\"text\",\"text\":\"私もその本読みました☺️\"}]}", &[p], false).unwrap();
        let now = 1_000_000;
        let mut rng = Rng::new(42);
        let t = plan_timing(&r, now, true, false, Pace::Natural, &mut rng);
        assert!(t.read_at > now);
        assert!(t.plans[0].typing_from >= t.read_at);
        assert!(t.plans[0].deliver_at > t.plans[0].typing_from);
        assert!(t.plans[1].typing_from > t.plans[0].deliver_at);
        assert!(t.plans[0].deliver_at - now < 25_000, "natural pace never makes an engaged chat wait long");
        let idle = plan_timing(&r, now, false, false, Pace::Realistic, &mut Rng::new(7));
        assert!(idle.read_at - now > 100_000, "Yui is a slow replier when idle");
        let fast = plan_timing(&r, now, false, false, Pace::Fast, &mut Rng::new(7));
        assert!(fast.plans[1].deliver_at - now < 6_000);
    }
}

//! AI providers for character replies. Keys live in the OS credential store
//! (Windows Credential Manager), never in settings or the frontend.
//! Nothing is sent until the player has given explicit consent, and only the
//! prompt built for one conversation is sent (never the learning database).
//! Conversation content is never written to logs.

use jm_core::prompt::Prompt;
use serde::{Deserialize, Serialize};
use std::time::Duration;

const KEYRING_SERVICE: &str = "com.natefr1.japanesemastery";
pub const CONFIG_KEY: &str = "ai.provider";
pub const CONSENT_KEY: &str = "ai.consent";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum ProviderKind {
    None,
    /// Anthropic Messages API.
    Anthropic,
    /// Any OpenAI-compatible endpoint, e.g. a local Ollama or LM Studio server.
    OpenaiCompat,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(default)]
pub struct ProviderConfig {
    pub kind: ProviderKind,
    /// Model for chat replies (fast, cheap).
    pub chat_model: String,
    /// Model for reviews / explanations (more careful).
    pub review_model: String,
    /// Base URL for OpenAI-compatible servers, e.g. http://localhost:11434/v1
    pub base_url: String,
}

impl Default for ProviderConfig {
    fn default() -> Self {
        ProviderConfig { kind: ProviderKind::None, chat_model: "claude-haiku-5-5".into(), review_model: "claude-sonnet-5-5".into(), base_url: "http://localhost:11434/v1".into() }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
pub struct Consent {
    pub granted: bool,
    pub at: i64,
    /// Which provider the consent was given for; switching provider asks again.
    pub provider: Option<ProviderKind>,
}

fn key_account(kind: &ProviderKind) -> &'static str {
    match kind {
        ProviderKind::Anthropic => "anthropic",
        ProviderKind::OpenaiCompat => "openai_compat",
        ProviderKind::None => "none",
    }
}

pub fn set_key(kind: &ProviderKind, key: &str) -> Result<(), String> {
    let e = keyring::Entry::new(KEYRING_SERVICE, key_account(kind)).map_err(|e| e.to_string())?;
    e.set_password(key.trim()).map_err(|e| format!("could not save the key to the credential store: {e}"))
}

pub fn clear_key(kind: &ProviderKind) -> Result<(), String> {
    let e = keyring::Entry::new(KEYRING_SERVICE, key_account(kind)).map_err(|e| e.to_string())?;
    match e.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

pub fn get_key(kind: &ProviderKind) -> Option<String> {
    keyring::Entry::new(KEYRING_SERVICE, key_account(kind)).ok()?.get_password().ok().filter(|k| !k.is_empty())
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Purpose {
    Chat,
    Review,
}

#[derive(Debug)]
pub struct Completion {
    pub text: String,
    pub input_tokens: i64,
    pub output_tokens: i64,
}

#[derive(Debug)]
pub enum AiError {
    /// Not configured, no key or no consent: nothing was sent.
    NotReady(String),
    /// Network unreachable / timeout: safe to retry later (offline queue).
    Offline(String),
    /// The provider refused (bad key, rate limit, bad model...).
    Provider(String),
}

impl std::fmt::Display for AiError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            AiError::NotReady(s) => write!(f, "{s}"),
            AiError::Offline(s) => write!(f, "offline: {s}"),
            AiError::Provider(s) => write!(f, "{s}"),
        }
    }
}

pub struct Ready {
    pub cfg: ProviderConfig,
    pub key: Option<String>,
}

/// Checks configuration, key and consent. Returns what's needed to make a call.
pub fn ready(cfg: &ProviderConfig, consent: &Consent) -> Result<Ready, AiError> {
    match cfg.kind {
        ProviderKind::None => return Err(AiError::NotReady("No AI provider is set up. Open Phone → Settings → AI to connect one.".into())),
        _ => {}
    }
    if !consent.granted || consent.provider.as_ref() != Some(&cfg.kind) {
        return Err(AiError::NotReady("You haven't agreed to send chat messages to this AI provider yet.".into()));
    }
    let key = get_key(&cfg.kind);
    if cfg.kind == ProviderKind::Anthropic && key.is_none() {
        return Err(AiError::NotReady("No Anthropic API key saved.".into()));
    }
    Ok(Ready { cfg: cfg.clone(), key })
}

fn client() -> reqwest::Client {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(60))
        .connect_timeout(Duration::from_secs(10))
        .build()
        .expect("http client")
}

fn classify(e: reqwest::Error) -> AiError {
    if e.is_connect() || e.is_timeout() || e.is_request() {
        AiError::Offline("couldn't reach the AI service".into())
    } else {
        AiError::Provider(format!("AI request failed: {e}"))
    }
}

/// Extracts the provider's error message without echoing request content.
fn provider_error(status: reqwest::StatusCode, body: &str) -> AiError {
    let msg = serde_json::from_str::<serde_json::Value>(body)
        .ok()
        .and_then(|v| v.pointer("/error/message").and_then(|m| m.as_str()).map(String::from))
        .unwrap_or_default();
    let hint = match status.as_u16() {
        401 | 403 => "The API key was rejected. Check it in Settings → AI.",
        404 => "Model or endpoint not found. Check the model name in Settings → AI.",
        429 => "Rate limited by the provider. Replies will retry shortly.",
        500..=599 => "The AI service had an error. Replies will retry shortly.",
        _ => "The AI service refused the request.",
    };
    let short: String = msg.chars().take(200).collect();
    if status.as_u16() == 429 || status.is_server_error() {
        AiError::Offline(format!("{hint} ({status})"))
    } else {
        AiError::Provider(if short.is_empty() { format!("{hint} ({status})") } else { format!("{hint} ({status}: {short})") })
    }
}

pub async fn complete(r: &Ready, purpose: Purpose, prompt: &Prompt, max_tokens: u32) -> Result<Completion, AiError> {
    let model = match purpose {
        Purpose::Chat => &r.cfg.chat_model,
        Purpose::Review => &r.cfg.review_model,
    };
    match r.cfg.kind {
        ProviderKind::None => Err(AiError::NotReady("No AI provider".into())),
        ProviderKind::Anthropic => {
            let body = serde_json::json!({
                "model": model,
                "max_tokens": max_tokens,
                "system": prompt.system,
                "messages": [{"role": "user", "content": prompt.user}],
            });
            let resp = client()
                .post("https://api.anthropic.com/v1/messages")
                .header("x-api-key", r.key.clone().unwrap_or_default())
                .header("anthropic-version", "2023-06-01")
                .json(&body)
                .send()
                .await
                .map_err(classify)?;
            let status = resp.status();
            let text = resp.text().await.map_err(classify)?;
            if !status.is_success() {
                return Err(provider_error(status, &text));
            }
            let v: serde_json::Value = serde_json::from_str(&text).map_err(|_| AiError::Provider("unreadable response from Anthropic".into()))?;
            let out = v["content"]
                .as_array()
                .map(|a| a.iter().filter_map(|b| b["text"].as_str()).collect::<Vec<_>>().join(""))
                .unwrap_or_default();
            Ok(Completion { text: out, input_tokens: v["usage"]["input_tokens"].as_i64().unwrap_or(0), output_tokens: v["usage"]["output_tokens"].as_i64().unwrap_or(0) })
        }
        ProviderKind::OpenaiCompat => {
            let url = format!("{}/chat/completions", r.cfg.base_url.trim_end_matches('/'));
            let body = serde_json::json!({
                "model": model,
                "max_tokens": max_tokens,
                "temperature": 0.8,
                "messages": [
                    {"role": "system", "content": prompt.system},
                    {"role": "user", "content": prompt.user}
                ],
            });
            let mut req = client().post(url).json(&body);
            if let Some(k) = &r.key {
                req = req.bearer_auth(k);
            }
            let resp = req.send().await.map_err(classify)?;
            let status = resp.status();
            let text = resp.text().await.map_err(classify)?;
            if !status.is_success() {
                return Err(provider_error(status, &text));
            }
            let v: serde_json::Value = serde_json::from_str(&text).map_err(|_| AiError::Provider("unreadable response from the AI server".into()))?;
            Ok(Completion {
                text: v["choices"][0]["message"]["content"].as_str().unwrap_or("").to_string(),
                input_tokens: v["usage"]["prompt_tokens"].as_i64().unwrap_or(0),
                output_tokens: v["usage"]["completion_tokens"].as_i64().unwrap_or(0),
            })
        }
    }
}

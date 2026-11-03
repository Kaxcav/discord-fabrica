use base64::{engine::general_purpose::STANDARD as B64, Engine};
use rand::Rng;
use reqwest::header::{HeaderMap, HeaderName, HeaderValue};
use serde_json::{json, Value};
use std::time::{SystemTime, UNIX_EPOCH};

pub const DISCORD_API: &str = "https://discord.com/api/v10";
pub const DISCORD_GW: &str = "wss://gateway.discord.gg/?v=10&encoding=json";
pub const STREAMKIT_CLIENT_ID: &str = "207646673902501888";
pub const STREAMKIT_SCOPES: &str = "rpc%20rpc.voice.write%20rpc.voice.read";
pub const DISCORD_EPOCH: u64 = 1_420_070_400_000;

pub const UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

pub fn super_props_obj() -> Value {
    json!({
        "os": "Windows",
        "browser": "Chrome",
        "device": "",
        "system_locale": "pt-BR",
        "browser_user_agent": UA,
        "browser_version": "131.0.0.0",
        "os_version": "10",
        "referrer": "",
        "referring_domain": "",
        "referrer_current": "",
        "referring_domain_current": "",
        "release_channel": "stable",
        "client_build_number": 346892,
        "client_event_source": null,
        "design_id": 0
    })
}

pub fn x_super_properties() -> String {
    B64.encode(super_props_obj().to_string().as_bytes())
}

pub fn format_token(raw: &str) -> String {
    raw.trim().trim_matches(|c| c == '"' || c == '\'').trim().to_string()
}

pub fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

pub fn generate_snowflake_nonce() -> String {
    let time = now_ms().saturating_sub(DISCORD_EPOCH);
    let rand_val: u64 = rand::thread_rng().gen_range(0..4_194_304);
    ((time << 22) | rand_val).to_string()
}

pub fn build_headers(token: &str, extra: Option<&[(&str, &str)]>) -> HeaderMap {
    let clean = format_token(token);
    let mut headers = HeaderMap::new();
    if let Ok(v) = HeaderValue::from_str(&clean) {
        headers.insert("Authorization", v);
    }
    headers.insert("User-Agent", HeaderValue::from_static(UA));
    headers.insert("Content-Type", HeaderValue::from_static("application/json"));
    headers.insert("Accept", HeaderValue::from_static("*/*"));
    headers.insert(
        "Accept-Language",
        HeaderValue::from_static("pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7"),
    );
    headers.insert("X-Discord-Locale", HeaderValue::from_static("pt-BR"));
    headers.insert(
        "X-Discord-Timezone",
        HeaderValue::from_static("America/Sao_Paulo"),
    );
    headers.insert("Origin", HeaderValue::from_static("https://discord.com"));
    headers.insert(
        "Referer",
        HeaderValue::from_static("https://discord.com/channels/@me"),
    );

    if !clean.to_lowercase().starts_with("bot ") {
        if let Ok(v) = HeaderValue::from_str(&x_super_properties()) {
            headers.insert("X-Super-Properties", v);
        }
    }

    if let Some(items) = extra {
        for (k, v) in items {
            if let (Ok(hn), Ok(hv)) = (
                HeaderName::from_bytes(k.as_bytes()),
                HeaderValue::from_str(v),
            ) {
                headers.insert(hn, hv);
            }
        }
    }

    headers
}


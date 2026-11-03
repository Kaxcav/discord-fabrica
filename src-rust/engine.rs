use base64::{engine::general_purpose::STANDARD as B64, Engine};
use chrono::Local;
use dashmap::DashMap;
use parking_lot::{Mutex, RwLock};
use rand::Rng;
use regex::Regex;
use reqwest::Method;
use serde_json::{json, Value};
use std::{
    collections::{HashMap, HashSet},
    sync::{
        atomic::{AtomicBool, AtomicI64, AtomicU64, Ordering},
        Arc,
    },
    time::Duration,
};
use tokio::{
    sync::{broadcast, mpsc},
    task::JoinHandle,
    time::sleep,
};

use crate::{
    config::{
        build_headers, format_token, generate_snowflake_nonce, now_ms, DISCORD_API,
    },
    gateway::start_gateway_loop,
    ipc::DiscordIpcBridge,
    models::*,
};

#[derive(Debug, Clone)]
pub struct ApiResponse {
    pub ok: bool,
    pub status: u16,
    pub data: Value,
    pub error: Option<String>,
}

pub struct ActiveTask {
    pub id: String,
    pub kind: String,
    pub cancelled: Arc<AtomicBool>,
    pub handle: JoinHandle<()>,
}

pub struct SelfbotEngine {
    pub session_id: String,
    pub created_at: u64,
    pub last_activity: AtomicU64,
    pub http: reqwest::Client,
    pub token: RwLock<Option<String>>,
    pub status: RwLock<String>,
    pub last_error: RwLock<Option<String>>,
    pub connected_at: AtomicU64,
    pub ping: AtomicI64,
    pub discord_session_id: RwLock<Option<String>>,
    pub last_self_voice_session_id: RwLock<Option<String>>,
    pub resume_gateway_url: RwLock<Option<String>>,
    pub seq: AtomicI64,
    pub user: RwLock<Option<UserInfo>>,
    pub guilds: RwLock<HashMap<String, GuildData>>,
    pub guild_order: RwLock<Vec<String>>,
    pub selected_guild_id: RwLock<Option<String>>,
    pub voice_states: RwLock<HashMap<String, HashMap<String, VoiceStateRecord>>>,
    pub user_voice_map: RwLock<HashMap<String, (String, String)>>,
    pub users_cache: RwLock<HashMap<String, UserInfo>>,
    pub current_voice: RwLock<CurrentVoice>,
    pub voice_config: RwLock<VoiceConfig>,
    pub features: RwLock<FeaturesState>,
    pub presence: RwLock<PresenceConfig>,
    pub stats: RwLock<Stats>,
    pub logs: RwLock<Vec<LogEntry>>,
    pub sse_tx: broadcast::Sender<String>,
    pub gw_tx: Mutex<Option<mpsc::UnboundedSender<Value>>>,
    pub gw_abort: Mutex<Option<JoinHandle<()>>>,
    pub watchdog_handle: Mutex<Option<JoinHandle<()>>>,
    pub chaotic_handle: Mutex<Option<JoinHandle<()>>>,
    pub anti_disconnect_timer: Mutex<Option<JoinHandle<()>>>,
    pub ignore_anti_disconnect_until: AtomicU64,
    pub last_auto_voice_attempt_ts: AtomicU64,
    pub in_flight_member_ops: DashMap<String, u64>,
    pub auto_reply_cooldowns: DashMap<String, u64>,
    pub active_tasks: Mutex<HashMap<String, ActiveTask>>,
    pub ipc: Arc<DiscordIpcBridge>,
}

impl SelfbotEngine {
    pub fn new(session_id: String, http: reqwest::Client) -> Arc<Self> {
        let (sse_tx, _) = broadcast::channel(512);
        let ipc = DiscordIpcBridge::new(http.clone());
        let now = now_ms();

        let engine = Arc::new(Self {
            session_id,
            created_at: now,
            last_activity: AtomicU64::new(now),
            http,
            token: RwLock::new(None),
            status: RwLock::new("disconnected".to_string()),
            last_error: RwLock::new(None),
            connected_at: AtomicU64::new(0),
            ping: AtomicI64::new(0),
            discord_session_id: RwLock::new(None),
            last_self_voice_session_id: RwLock::new(None),
            resume_gateway_url: RwLock::new(None),
            seq: AtomicI64::new(-1),
            user: RwLock::new(None),
            guilds: RwLock::new(HashMap::new()),
            guild_order: RwLock::new(Vec::new()),
            selected_guild_id: RwLock::new(None),
            voice_states: RwLock::new(HashMap::new()),
            user_voice_map: RwLock::new(HashMap::new()),
            users_cache: RwLock::new(HashMap::new()),
            current_voice: RwLock::new(CurrentVoice::default()),
            voice_config: RwLock::new(VoiceConfig::default()),
            features: RwLock::new(FeaturesState::default()),
            presence: RwLock::new(PresenceConfig::default()),
            stats: RwLock::new(Stats::default()),
            logs: RwLock::new(Vec::new()),
            sse_tx,
            gw_tx: Mutex::new(None),
            gw_abort: Mutex::new(None),
            watchdog_handle: Mutex::new(None),
            chaotic_handle: Mutex::new(None),
            anti_disconnect_timer: Mutex::new(None),
            ignore_anti_disconnect_until: AtomicU64::new(0),
            last_auto_voice_attempt_ts: AtomicU64::new(0),
            in_flight_member_ops: DashMap::new(),
            auto_reply_cooldowns: DashMap::new(),
            active_tasks: Mutex::new(HashMap::new()),
            ipc,
        });

        let eng_weak = Arc::downgrade(&engine);
        *engine.ipc.on_ipc_request_sse.lock() = Some(Arc::new(move |payload| {
            if let Some(eng) = eng_weak.upgrade() {
                eng.emit_delta("ipc_request", &payload);
            }
        }));

        engine
    }

    pub fn touch(&self) {
        self.last_activity.store(now_ms(), Ordering::Relaxed);
    }

    pub fn emit_delta(&self, event: &str, payload: &Value) {
        let msg = format!("event: {}\ndata: {}\n\n", event, payload);
        let _ = self.sse_tx.send(msg);
    }

    pub fn broadcast_state(&self) {
        let st = self.get_public_state();
        self.emit_delta("state", &st);
    }

    pub fn log(&self, kind: &str, message: impl Into<String>) -> LogEntry {
        let msg_str = message.into();
        let entry = LogEntry {
            id: format!("{}-{}", now_ms(), rand::thread_rng().gen_range(10000..99999)),
            ts: now_ms(),
            time: Local::now().format("%H:%M:%S").to_string(),
            kind: kind.to_string(),
            message: msg_str,
        };
        {
            let mut logs = self.logs.write();
            logs.insert(0, entry.clone());
            if logs.len() > 250 {
                logs.truncate(250);
            }
        }
        if let Ok(val) = serde_json::to_value(&entry) {
            self.emit_delta("log", &val);
        }
        entry
    }

    pub fn send_op(&self, op: i32, d: Value) -> bool {
        if let Some(ref tx) = *self.gw_tx.lock() {
            tx.send(json!({ "op": op, "d": d })).is_ok()
        } else {
            false
        }
    }

    pub async fn request_with_token(
        &self,
        token: &str,
        method: &str,
        endpoint: &str,
        body: Option<Value>,
        extra_headers: Option<&[(&str, &str)]>,
        retries: u8,
    ) -> ApiResponse {
        self.touch();
        let url = if endpoint.starts_with("http") {
            endpoint.to_string()
        } else {
            format!("{}{}", DISCORD_API, endpoint)
        };
        let req_method = Method::from_bytes(method.as_bytes()).unwrap_or(Method::GET);

        for attempt in 0..=retries {
            let headers = build_headers(token, extra_headers);
            let mut builder = self
                .http
                .request(req_method.clone(), &url)
                .headers(headers)
                .timeout(Duration::from_secs(10));

            if let Some(ref b) = body {
                builder = builder.json(b);
            }

            let Ok(resp) = builder.send().await else {
                if attempt < retries {
                    sleep(Duration::from_millis(200)).await;
                    continue;
                }
                return ApiResponse {
                    ok: false,
                    status: 0,
                    data: Value::Null,
                    error: Some("Erro de rede na requisição Discord".to_string()),
                };
            };

            let status = resp.status().as_u16();
            let text = resp.text().await.unwrap_or_default();
            let data: Value = serde_json::from_str(&text).unwrap_or(Value::Null);

            if status == 429 && attempt < retries {
                let retry_sec = data
                    .get("retry_after")
                    .and_then(|v| v.as_f64())
                    .unwrap_or(0.5);
                let wait_ms = ((retry_sec * 1000.0) as u64).clamp(150, 5000);
                sleep(Duration::from_millis(wait_ms)).await;
                continue;
            }

            let ok = (200..300).contains(&status);
            let error = if ok {
                None
            } else {
                data.get("message")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string())
                    .or_else(|| Some(format!("HTTP {}", status)))
            };

            return ApiResponse {
                ok,
                status,
                data,
                error,
            };
        }

        ApiResponse {
            ok: false,
            status: 0,
            data: Value::Null,
            error: Some("Falha após tentativas".to_string()),
        }
    }

    pub async fn request(
        &self,
        method: &str,
        endpoint: &str,
        body: Option<Value>,
        extra_headers: Option<&[(&str, &str)]>,
        retries: u8,
    ) -> ApiResponse {
        let Some(tok) = self.token.read().clone() else {
            return ApiResponse {
                ok: false,
                status: 401,
                data: Value::Null,
                error: Some("Token não configurado".to_string()),
            };
        };
        self.request_with_token(&tok, method, endpoint, body, extra_headers, retries)
            .await
    }

    pub fn cache_user_json(&self, u: &Value) {
        let Some(info) = UserInfo::from_json(u) else {
            return;
        };
        let mut cache = self.users_cache.write();
        if let Some(prev) = cache.get(&info.id).cloned() {
            cache.insert(
                info.id.clone(),
                UserInfo {
                    id: info.id,
                    username: if info.username.is_empty() {
                        prev.username.clone()
                    } else {
                        info.username
                    },
                    discriminator: info.discriminator.or_else(|| prev.discriminator.clone()),
                    global_name: info.global_name.or_else(|| prev.global_name.clone()),
                    avatar: info.avatar.or_else(|| prev.avatar.clone()),
                    bot: info.bot,
                    banner: info.banner.or_else(|| prev.banner.clone()),
                    accent_color: info.accent_color.or(prev.accent_color),
                },
            );
        } else {
            cache.insert(info.id.clone(), info);
        }
    }

    pub async fn resolve_user(&self, user_id: &str) -> UserInfo {
        let id = user_id.trim().to_string();
        if let Some(u) = self.users_cache.read().get(&id).cloned() {
            return u;
        }
        if self.token.read().is_none() {
            return UserInfo {
                id: id.clone(),
                username: id,
                ..Default::default()
            };
        }
        let res = self
            .request("GET", &format!("/users/{}", id), None, None, 0)
            .await;
        if res.ok {
            if let Some(u) = UserInfo::from_json(&res.data) {
                self.cache_user_json(&res.data);
                self.emit_delta(
                    "user_cached",
                    &json!({ "id": u.id, "username": u.username }),
                );
                return u;
            }
        }
        UserInfo {
            id: id.clone(),
            username: id,
            ..Default::default()
        }
    }

    pub fn get_user_label(&self, user_id: &str) -> String {
        if let Some(u) = self.users_cache.read().get(user_id) {
            if let Some(ref gn) = u.global_name {
                if !gn.is_empty() {
                    return format!("{} (@{})", gn, u.username);
                }
            }
            return format!("@{}", u.username);
        }
        user_id.to_string()
    }

    pub fn get_channel_label(&self, guild_id: Option<&str>, channel_id: Option<&str>) -> String {
        let Some(cid) = channel_id else {
            return "Desconectado".to_string();
        };
        if cid.is_empty() {
            return "Desconectado".to_string();
        }
        if let Some(gid) = guild_id {
            if let Some(g) = self.guilds.read().get(gid) {
                if let Some(ch) = g.channels.get(cid) {
                    return format!("#{}", ch.name);
                }
            }
        }
        cid.to_string()
    }

    pub fn resolve_target_guild_id(&self, user_id: &str) -> Option<String> {
        let id = user_id.trim();
        if id.is_empty() {
            return None;
        }
        if let Some((gid, _)) = self.user_voice_map.read().get(id) {
            return Some(gid.clone());
        }
        for (gid, gmap) in self.voice_states.read().iter() {
            if gmap.contains_key(id) {
                return Some(gid.clone());
            }
        }
        if let Some(sel) = self.selected_guild_id.read().clone() {
            if !sel.is_empty() {
                return Some(sel);
            }
        }
        if let Some(cur) = self.current_voice.read().guild_id.clone() {
            if !cur.is_empty() {
                return Some(cur);
            }
        }
        self.guild_order.read().first().cloned()
    }

    pub fn is_desktop_voice_session(&self) -> bool {
        if self.voice_config.read().use_ipc_for_auto_voice && self.ipc.is_connected() {
            return true;
        }
        let last_self = self.last_self_voice_session_id.read().clone();
        let gw_sess = self.discord_session_id.read().clone();
        if let (Some(s1), Some(s2)) = (last_self, gw_sess) {
            if !s1.is_empty() && !s2.is_empty() && s1 != s2 {
                return true;
            }
        }
        false
    }

    pub fn ingest_guild_object(&self, g: &Value) {
        let Some(g_id) = g.get("id").and_then(|v| v.as_str()).map(|s| s.to_string()) else {
            return;
        };
        let props = g.get("properties");
        let g_name = g
            .get("name")
            .or_else(|| props.and_then(|p| p.get("name")))
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());
        let g_icon = g
            .get("icon")
            .or_else(|| props.and_then(|p| p.get("icon")))
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());
        let g_owner = g
            .get("owner_id")
            .or_else(|| props.and_then(|p| p.get("owner_id")))
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());

        {
            let mut guilds = self.guilds.write();
            let mut order = self.guild_order.write();
            if !order.contains(&g_id) {
                order.push(g_id.clone());
            }
            let entry = guilds.entry(g_id.clone()).or_insert_with(|| GuildData {
                id: g_id.clone(),
                name: g_name
                    .clone()
                    .unwrap_or_else(|| format!("Servidor {}", g_id)),
                icon: g_icon.clone(),
                owner_id: g_owner.clone(),
                channels: HashMap::new(),
                roles: HashMap::new(),
            });

            if let Some(n) = g_name {
                entry.name = n;
            }
            if g_icon.is_some() {
                entry.icon = g_icon;
            }
            if g_owner.is_some() {
                entry.owner_id = g_owner;
            }

            if let Some(ch_arr) = g.get("channels").and_then(|v| v.as_array()) {
                for ch in ch_arr {
                    let Some(cid) = ch.get("id").and_then(|v| v.as_str()).map(|s| s.to_string())
                    else {
                        continue;
                    };
                    entry.channels.insert(
                        cid.clone(),
                        ChannelInfo {
                            id: cid.clone(),
                            name: ch
                                .get("name")
                                .and_then(|v| v.as_str())
                                .map(|s| s.to_string())
                                .unwrap_or_else(|| format!("canal-{}", cid)),
                            kind: ch.get("type").and_then(|v| v.as_i64()).unwrap_or(0) as i32,
                            parent_id: ch
                                .get("parent_id")
                                .and_then(|v| v.as_str())
                                .map(|s| s.to_string()),
                            position: ch.get("position").and_then(|v| v.as_i64()).unwrap_or(0)
                                as i32,
                            bitrate: ch
                                .get("bitrate")
                                .and_then(|v| v.as_u64())
                                .unwrap_or(64000) as u32,
                            user_limit: ch
                                .get("user_limit")
                                .and_then(|v| v.as_u64())
                                .unwrap_or(0) as u32,
                        },
                    );
                }
            }

            if let Some(r_arr) = g.get("roles").and_then(|v| v.as_array()) {
                for r in r_arr {
                    let Some(rid) = r.get("id").and_then(|v| v.as_str()).map(|s| s.to_string())
                    else {
                        continue;
                    };
                    entry.roles.insert(
                        rid.clone(),
                        RoleInfo {
                            id: rid,
                            name: r
                                .get("name")
                                .and_then(|v| v.as_str())
                                .unwrap_or("role")
                                .to_string(),
                            color: r.get("color").and_then(|v| v.as_u64()).unwrap_or(0) as u32,
                            position: r.get("position").and_then(|v| v.as_i64()).unwrap_or(0)
                                as i32,
                            permissions: r
                                .get("permissions")
                                .and_then(|v| v.as_str())
                                .unwrap_or("0")
                                .to_string(),
                        },
                    );
                }
            }
        }

        if let Some(vs_arr) = g.get("voice_states").and_then(|v| v.as_array()) {
            for vs in vs_arr {
                self.apply_voice_state_record(Some(&g_id), vs);
            }
        }

        if let Some(m_arr) = g.get("members").and_then(|v| v.as_array()) {
            for m in m_arr {
                if let Some(u) = m.get("user") {
                    self.cache_user_json(u);
                }
            }
        }
    }

    pub fn apply_voice_state_record(
        &self,
        guild_id: Option<&str>,
        vs: &Value,
    ) -> Option<VoiceStateRecord> {
        let user_id = vs.get("user_id").and_then(|v| v.as_str())?.to_string();
        let channel_id = vs
            .get("channel_id")
            .and_then(|v| v.as_str())
            .filter(|s| !s.is_empty())
            .map(|s| s.to_string());
        let g_id = guild_id
            .map(|s| s.to_string())
            .or_else(|| {
                vs.get("guild_id")
                    .and_then(|v| v.as_str())
                    .filter(|s| !s.is_empty())
                    .map(|s| s.to_string())
            });
        let session_id = vs
            .get("session_id")
            .and_then(|v| v.as_str())
            .filter(|s| !s.is_empty())
            .map(|s| s.to_string());

        let record = VoiceStateRecord {
            user_id: user_id.clone(),
            guild_id: g_id.clone(),
            channel_id: channel_id.clone(),
            session_id: session_id.clone(),
            mute: vs.get("mute").and_then(|v| v.as_bool()).unwrap_or(false),
            deaf: vs.get("deaf").and_then(|v| v.as_bool()).unwrap_or(false),
            self_mute: vs
                .get("self_mute")
                .and_then(|v| v.as_bool())
                .unwrap_or(false),
            self_deaf: vs
                .get("self_deaf")
                .and_then(|v| v.as_bool())
                .unwrap_or(false),
            self_video: vs
                .get("self_video")
                .and_then(|v| v.as_bool())
                .unwrap_or(false),
            self_stream: vs
                .get("self_stream")
                .and_then(|v| v.as_bool())
                .unwrap_or(false),
            suppress: vs
                .get("suppress")
                .and_then(|v| v.as_bool())
                .unwrap_or(false),
        };

        if let Some(ref gid) = g_id {
            let mut vs_map = self.voice_states.write();
            let g_map = vs_map.entry(gid.clone()).or_default();
            if channel_id.is_some() {
                g_map.insert(user_id.clone(), record.clone());
            } else {
                g_map.remove(&user_id);
            }
        }

        if let (Some(ref gid), Some(ref cid)) = (&g_id, &channel_id) {
            self.user_voice_map
                .write()
                .insert(user_id.clone(), (gid.clone(), cid.clone()));
        } else {
            self.user_voice_map.write().remove(&user_id);
        }

        let is_self = self
            .user
            .read()
            .as_ref()
            .map(|u| u.id == user_id)
            .unwrap_or(false);

        if is_self {
            if let Some(ref sid) = session_id {
                *self.last_self_voice_session_id.write() = Some(sid.clone());
            }

            let cur_guild = self.current_voice.read().guild_id.clone();
            if channel_id.is_none()
                && cur_guild.is_some()
                && g_id.is_some()
                && cur_guild != g_id
            {
                return Some(record);
            }

            {
                let mut cv = self.current_voice.write();
                cv.guild_id = if channel_id.is_some() {
                    g_id.clone()
                } else {
                    None
                };
                cv.channel_id = channel_id.clone();
                cv.self_mute = record.self_mute;
                cv.self_deaf = record.self_deaf;
                cv.mute = record.mute;
                cv.deaf = record.deaf;
                cv.self_video = record.self_video;
                cv.self_stream = record.self_stream;
            }

            {
                let mut vc = self.voice_config.write();
                if let Some(ref cid) = channel_id {
                    vc.channel_id = Some(cid.clone());
                    if let Some(ref gid) = g_id {
                        vc.guild_id = Some(gid.clone());
                    }
                } else {
                    vc.channel_id = None;
                    vc.guild_id = None;
                }
                vc.self_mute = record.self_mute;
                vc.self_deaf = record.self_deaf;
                vc.self_video = record.self_video;
            }

            if let (Some(ref gid), Some(ref cid)) = (&g_id, &channel_id) {
                let mut feat = self.features.write();
                if feat.anti_disconnect.enabled && feat.anti_disconnect.channel_id.is_none() {
                    feat.anti_disconnect.guild_id = Some(gid.clone());
                    feat.anti_disconnect.channel_id = Some(cid.clone());
                }
            }
        }

        Some(record)
    }

    pub fn build_presence_payload(&self) -> Value {
        let p = self.presence.read().clone();
        let mut activities = Vec::new();
        if !p.activity_name.trim().is_empty() {
            let mut act = json!({
                "name": p.activity_name.trim(),
                "type": p.activity_type,
            });
            if !p.activity_details.trim().is_empty() {
                act["details"] = Value::String(p.activity_details.trim().to_string());
            }
            if !p.activity_state.trim().is_empty() {
                act["state"] = Value::String(p.activity_state.trim().to_string());
            }
            if p.activity_type == 1 {
                let url = if p.stream_url.trim().is_empty() {
                    "https://twitch.tv/discord"
                } else {
                    p.stream_url.trim()
                };
                act["url"] = Value::String(url.to_string());
            }
            activities.push(act);
        }
        if !p.custom_status.trim().is_empty() {
            activities.push(json!({
                "type": 4,
                "name": "Custom Status",
                "state": p.custom_status.trim(),
            }));
        }
        json!({
            "status": if p.status.is_empty() { "online" } else { &p.status },
            "since": 0,
            "activities": activities,
            "afk": false,
        })
    }

    pub fn send_voice_state(&self, guild_id: Option<&str>, channel_id: Option<&str>) -> bool {
        let g_id = guild_id.filter(|s| !s.is_empty()).map(|s| s.to_string());
        let c_id = channel_id.filter(|s| !s.is_empty()).map(|s| s.to_string());

        let (self_mute, self_deaf, self_video) = {
            let mut vc = self.voice_config.write();
            vc.guild_id = g_id.clone();
            vc.channel_id = c_id.clone();
            (vc.self_mute, vc.self_deaf, vc.self_video)
        };

        {
            let mut cv = self.current_voice.write();
            cv.guild_id = g_id.clone();
            cv.channel_id = c_id.clone();
            cv.self_mute = self_mute;
            cv.self_deaf = self_deaf;
            cv.self_video = self_video;
        }

        let sent = self.send_op(
            4,
            json!({
                "guild_id": g_id,
                "channel_id": c_id,
                "self_mute": self_mute,
                "self_deaf": self_deaf,
                "self_video": self_video,
                "preferred_region": null,
            }),
        );

        if sent {
            if let Some(ref gid) = g_id {
                self.send_op(
                    14,
                    json!({
                        "guild_id": gid,
                        "typing": true,
                        "threads": false,
                        "activities": true,
                        "members": [],
                        "channels": {},
                    }),
                );
            }
        }
        sent
    }

    pub async fn patch_guild_member_voice(
        &self,
        guild_id: &str,
        user_id: &str,
        patch_body: Value,
        tag: &str,
        silent: bool,
    ) -> ApiResponse {
        if self.token.read().is_none() || guild_id.is_empty() || user_id.is_empty() {
            return ApiResponse {
                ok: false,
                status: 400,
                data: Value::Null,
                error: Some("Parâmetros inválidos".to_string()),
            };
        }

        let key = format!("{}:{}:{}", guild_id, user_id, patch_body);
        let now = now_ms();
        if let Some(last_ts) = self.in_flight_member_ops.get(&key) {
            if now.saturating_sub(*last_ts) < 180 {
                return ApiResponse {
                    ok: true,
                    status: 200,
                    data: json!({ "skipped": true }),
                    error: None,
                };
            }
        }
        self.in_flight_member_ops.insert(key.clone(), now);

        let ctx_obj = json!({
            "location": "Voice Channel",
            "location_guild_id": guild_id,
            "location_channel_id": null,
            "location_channel_type": null,
        });
        let x_ctx = B64.encode(ctx_obj.to_string().as_bytes());
        let endpoint = format!("/guilds/{}/members/{}", guild_id, user_id);
        let res = self
            .request(
                "PATCH",
                &endpoint,
                Some(patch_body),
                Some(&[("X-Context-Properties", &x_ctx)]),
                2,
            )
            .await;

        self.in_flight_member_ops.remove(&key);

        if !res.ok && res.status != 400 && !silent {
            self.log(
                "error",
                format!(
                    "[{}] Falha ao modificar {}: {} | status={}",
                    tag,
                    self.get_user_label(user_id),
                    res.error.as_deref().unwrap_or("Erro"),
                    res.status
                ),
            );
        }

        res
    }

    pub async fn auto_voice_select(
        self: &Arc<Self>,
        guild_id: Option<&str>,
        channel_id: Option<&str>,
    ) -> bool {
        let g_id = guild_id.filter(|s| !s.is_empty()).map(|s| s.to_string());
        let c_id = channel_id.filter(|s| !s.is_empty()).map(|s| s.to_string());
        self.last_auto_voice_attempt_ts
            .store(now_ms(), Ordering::Relaxed);

        let self_id = self.user.read().as_ref().map(|u| u.id.clone());
        let cur_loc = self_id
            .as_ref()
            .and_then(|uid| self.user_voice_map.read().get(uid).cloned());

        // 1. Se já está em outra call do mesmo servidor, move via REST API primeiro
        if let (Some(ref cid), Some(ref gid), Some(ref uid), Some((ref cur_g, ref cur_c))) =
            (&c_id, &g_id, &self_id, &cur_loc)
        {
            if cur_g == gid && !cur_c.is_empty() && cur_c != cid {
                let move_key = format!("{}:{}:{}", gid, uid, json!({ "channel_id": cid }));
                self.in_flight_member_ops.remove(&move_key);
                let move_res = self
                    .patch_guild_member_voice(
                        gid,
                        uid,
                        json!({ "channel_id": cid }),
                        "AUTO-VOICE",
                        true,
                    )
                    .await;
                if move_res.ok && move_res.data.get("skipped").is_none() {
                    {
                        let mut vc = self.voice_config.write();
                        vc.guild_id = Some(gid.clone());
                        vc.channel_id = Some(cid.clone());
                    }
                    {
                        let mut cv = self.current_voice.write();
                        cv.guild_id = Some(gid.clone());
                        cv.channel_id = Some(cid.clone());
                    }
                    self.log(
                        "voice",
                        format!(
                            "[AUTO-VOICE] Retornou para {} via API do servidor.",
                            self.get_channel_label(Some(gid), Some(cid))
                        ),
                    );
                    return true;
                }
            }
        }

        // 2. Move/reconecta Discord Desktop via IPC (local ou Remote PC Bridge)
        let use_ipc = self.voice_config.read().use_ipc_for_auto_voice;
        if use_ipc {
            let mut result = self
                .ipc
                .send_command(
                    "SELECT_VOICE_CHANNEL",
                    json!({ "channel_id": c_id, "force": true }),
                    4500,
                )
                .await;

            if !result.ok && self.is_desktop_voice_session() {
                sleep(Duration::from_millis(200)).await;
                if c_id.is_some() && self.current_voice.read().channel_id == c_id {
                    return true;
                }
                result = self
                    .ipc
                    .send_command(
                        "SELECT_VOICE_CHANNEL",
                        json!({ "channel_id": c_id, "force": true }),
                        4500,
                    )
                    .await;
            }

            if result.ok {
                {
                    let mut vc = self.voice_config.write();
                    vc.guild_id = g_id.clone();
                    vc.channel_id = c_id.clone();
                }
                {
                    let mut cv = self.current_voice.write();
                    cv.guild_id = g_id.clone();
                    cv.channel_id = c_id.clone();
                }
                let label = if let Some(ref cid) = c_id {
                    self.get_channel_label(g_id.as_deref(), Some(cid))
                } else {
                    "Fora de Call".to_string()
                };
                self.log("info", format!("[MODO IPC] Discord Desktop movido para {}", label));
                return true;
            }

            // NUNCA envia Gateway Op 4 quando a sessão pertence ao Discord Desktop
            if self.is_desktop_voice_session() {
                return false;
            }
        }

        self.send_voice_state(g_id.as_deref(), c_id.as_deref())
    }

    pub fn start_fake_stream(self: &Arc<Self>, guild_id: &str, channel_id: &str) {
        let Some(uid) = self.user.read().as_ref().map(|u| u.id.clone()) else {
            return;
        };
        let gid = guild_id.to_string();
        let cid = channel_id.to_string();
        self.send_op(
            18,
            json!({
                "type": "guild",
                "guild_id": gid,
                "channel_id": cid,
                "preferred_region": null,
            }),
        );
        let eng = Arc::clone(self);
        tokio::spawn(async move {
            sleep(Duration::from_millis(450)).await;
            if !eng.voice_config.read().fake_stream {
                return;
            }
            eng.send_op(
                22,
                json!({
                    "stream_key": format!("guild:{}:{}:{}", gid, cid, uid),
                    "paused": true,
                }),
            );
        });
    }

    pub fn stop_fake_stream(&self) {
        let Some(uid) = self.user.read().as_ref().map(|u| u.id.clone()) else {
            return;
        };
        let gid = self
            .current_voice
            .read()
            .guild_id
            .clone()
            .or_else(|| self.voice_config.read().guild_id.clone());
        let cid = self
            .current_voice
            .read()
            .channel_id
            .clone()
            .or_else(|| self.voice_config.read().channel_id.clone());
        if let (Some(g), Some(c)) = (gid, cid) {
            self.send_op(
                19,
                json!({
                    "stream_key": format!("guild:{}:{}:{}", g, c, uid),
                }),
            );
        }
    }

    pub async fn sync_follow_target_now(self: &Arc<Self>) -> bool {
        let (enabled, target_id, sync_ad) = {
            let f = self.features.read();
            (
                f.follow_call.enabled,
                f.follow_call.target_user_id.trim().to_string(),
                f.follow_call.sync_anti_disconnect,
            )
        };
        if !enabled || target_id.is_empty() {
            return false;
        }
        let loc = self.user_voice_map.read().get(&target_id).cloned();
        if let Some((gid, cid)) = loc {
            if !cid.is_empty() {
                if sync_ad {
                    let mut f = self.features.write();
                    if f.anti_disconnect.enabled {
                        f.anti_disconnect.guild_id = Some(gid.clone());
                        f.anti_disconnect.channel_id = Some(cid.clone());
                    }
                }
                let (cur_g, cur_c) = {
                    let cv = self.current_voice.read();
                    (cv.guild_id.clone(), cv.channel_id.clone())
                };
                if cur_c.as_deref() != Some(cid.as_str()) || cur_g.as_deref() != Some(gid.as_str())
                {
                    self.ignore_anti_disconnect_until
                        .store(now_ms() + 2500, Ordering::Relaxed);
                    self.log(
                        "stalker",
                        format!(
                            "[SEGUIR CALL] Alvo {} em {}. Entrando...",
                            self.get_user_label(&target_id),
                            self.get_channel_label(Some(&gid), Some(&cid))
                        ),
                    );
                    self.auto_voice_select(Some(&gid), Some(&cid)).await;
                    return true;
                }
            }
        }
        false
    }

    pub fn enforce_coleira_all(self: &Arc<Self>) {
        let (enabled, targets, anchor_g, anchor_c, force_mute, force_deaf) = {
            let f = self.features.read();
            let cv = self.current_voice.read();
            let sel = self.selected_guild_id.read().clone();
            (
                f.coleira.enabled,
                f.coleira.targets.iter().cloned().collect::<Vec<_>>(),
                f.coleira
                    .anchor_guild_id
                    .clone()
                    .or_else(|| cv.guild_id.clone())
                    .or(sel),
                f.coleira
                    .anchor_channel_id
                    .clone()
                    .or_else(|| cv.channel_id.clone()),
                f.coleira.force_server_mute,
                f.coleira.force_server_deaf,
            )
        };

        if !enabled || targets.is_empty() {
            return;
        }
        let (Some(ag), Some(ac)) = (anchor_g, anchor_c) else {
            return;
        };

        let g_map = self.voice_states.read().get(&ag).cloned();
        let Some(vs_map) = g_map else {
            return;
        };

        for tid in targets {
            let Some(vs) = vs_map.get(&tid) else {
                continue;
            };
            let Some(ref cur_ch) = vs.channel_id else {
                continue;
            };
            let wrong_ch = cur_ch != &ac;
            let need_mute = force_mute && !vs.mute;
            let need_deaf = force_deaf && !vs.deaf;

            if wrong_ch || need_mute || need_deaf {
                let mut patch = serde_json::Map::new();
                if wrong_ch {
                    patch.insert("channel_id".to_string(), Value::String(ac.clone()));
                }
                if need_mute {
                    patch.insert("mute".to_string(), Value::Bool(true));
                }
                if need_deaf {
                    patch.insert("deaf".to_string(), Value::Bool(true));
                }
                let eng = Arc::clone(self);
                let ag_clone = ag.clone();
                tokio::spawn(async move {
                    eng.patch_guild_member_voice(
                        &ag_clone,
                        &tid,
                        Value::Object(patch),
                        "COLEIRA",
                        false,
                    )
                    .await;
                });
            }
        }
    }

    pub async fn enforce_mute_lock(
        self: &Arc<Self>,
        guild_id: &str,
        user_id: &str,
        vs: Option<&VoiceStateRecord>,
    ) {
        let (enabled, has_target, want_mute, want_deaf, kick_fallback) = {
            let f = self.features.read();
            (
                f.mute_lock.enabled,
                f.mute_lock.targets.contains(user_id),
                f.mute_lock.mute,
                f.mute_lock.deaf,
                f.mute_lock.kick_fallback,
            )
        };
        if !enabled || !has_target || (!want_mute && !want_deaf) {
            return;
        }

        let need_mute = want_mute && vs.map(|v| !v.mute).unwrap_or(true);
        let need_deaf = want_deaf && vs.map(|v| !v.deaf).unwrap_or(true);
        if !need_mute && !need_deaf {
            return;
        }

        let label = self.get_user_label(user_id);

        if need_mute && need_deaf {
            let both_key = format!(
                "{}:{}:{}",
                guild_id,
                user_id,
                json!({ "mute": true, "deaf": true })
            );
            self.in_flight_member_ops.remove(&both_key);
            let res_both = self
                .patch_guild_member_voice(
                    guild_id,
                    user_id,
                    json!({ "mute": true, "deaf": true }),
                    "MUTE-LOCK",
                    true,
                )
                .await;

            if res_both.ok {
                self.stats.write().mute_lock_actions += 1;
                self.log(
                    "coleira",
                    format!("[MUTE-LOCK] {} travado com Server Mute & Deaf.", label),
                );
                return;
            }
            if res_both.status == 400 {
                self.log(
                    "warn",
                    format!(
                        "[MUTE-LOCK] {} não está conectado em nenhuma call no servidor.",
                        label
                    ),
                );
                return;
            }
            if res_both.status == 403 {
                let mute_key = format!("{}:{}:{}", guild_id, user_id, json!({ "mute": true }));
                self.in_flight_member_ops.remove(&mute_key);
                let res_mute = self
                    .patch_guild_member_voice(
                        guild_id,
                        user_id,
                        json!({ "mute": true }),
                        "MUTE-LOCK",
                        true,
                    )
                    .await;
                if res_mute.ok {
                    self.stats.write().mute_lock_actions += 1;
                    self.features.write().mute_lock.deaf = false;
                    self.log(
                        "coleira",
                        format!(
                            "[MUTE-LOCK] {} travado com Server Mute (Server Deaf desativado: sem permissão DEAFEN_MEMBERS).",
                            label
                        ),
                    );
                    return;
                }
                if res_mute.status == 403 && kick_fallback {
                    self.stats.write().mute_lock_actions += 1;
                    self.log(
                        "warn",
                        format!(
                            "[MUTE-LOCK] Sem permissão de Server Mute em {} (status=403). Aplicando Kick Fallback...",
                            label
                        ),
                    );
                    let kick_key =
                        format!("{}:{}:{}", guild_id, user_id, json!({ "channel_id": null }));
                    self.in_flight_member_ops.remove(&kick_key);
                    self.patch_guild_member_voice(
                        guild_id,
                        user_id,
                        json!({ "channel_id": null }),
                        "MUTE-LOCK",
                        false,
                    )
                    .await;
                    return;
                }
            }
            return;
        }

        if need_mute {
            let mute_key = format!("{}:{}:{}", guild_id, user_id, json!({ "mute": true }));
            self.in_flight_member_ops.remove(&mute_key);
            let res = self
                .patch_guild_member_voice(
                    guild_id,
                    user_id,
                    json!({ "mute": true }),
                    "MUTE-LOCK",
                    true,
                )
                .await;
            if res.ok {
                self.stats.write().mute_lock_actions += 1;
                self.log(
                    "coleira",
                    format!("[MUTE-LOCK] {} travado com Server Mute.", label),
                );
                return;
            }
            if res.status == 403 && kick_fallback {
                self.stats.write().mute_lock_actions += 1;
                self.log(
                    "warn",
                    format!(
                        "[MUTE-LOCK] Sem permissão de Server Mute em {} (status=403). Aplicando Kick Fallback...",
                        label
                    ),
                );
                let kick_key =
                    format!("{}:{}:{}", guild_id, user_id, json!({ "channel_id": null }));
                self.in_flight_member_ops.remove(&kick_key);
                self.patch_guild_member_voice(
                    guild_id,
                    user_id,
                    json!({ "channel_id": null }),
                    "MUTE-LOCK",
                    false,
                )
                .await;
            }
            return;
        }

        if need_deaf {
            let deaf_key = format!("{}:{}:{}", guild_id, user_id, json!({ "deaf": true }));
            self.in_flight_member_ops.remove(&deaf_key);
            let res = self
                .patch_guild_member_voice(
                    guild_id,
                    user_id,
                    json!({ "deaf": true }),
                    "MUTE-LOCK",
                    true,
                )
                .await;
            if res.ok {
                self.stats.write().mute_lock_actions += 1;
                self.log(
                    "coleira",
                    format!("[MUTE-LOCK] {} travado com Server Deaf.", label),
                );
                return;
            }
            if res.status == 403 && kick_fallback {
                self.stats.write().mute_lock_actions += 1;
                let kick_key =
                    format!("{}:{}:{}", guild_id, user_id, json!({ "channel_id": null }));
                self.in_flight_member_ops.remove(&kick_key);
                self.patch_guild_member_voice(
                    guild_id,
                    user_id,
                    json!({ "channel_id": null }),
                    "MUTE-LOCK",
                    false,
                )
                .await;
            }
        }
    }

    pub fn handle_voice_state_update(self: &Arc<Self>, d: &Value) {
        let prev_loc = d
            .get("user_id")
            .and_then(|v| v.as_str())
            .and_then(|uid| self.user_voice_map.read().get(uid).cloned());

        let Some(rec) = self.apply_voice_state_record(None, d) else {
            return;
        };

        let user_id = rec.user_id.clone();
        let guild_id = rec.guild_id.clone();
        let channel_id = rec.channel_id.clone();

        if !self.users_cache.read().contains_key(&user_id) {
            let eng = Arc::clone(self);
            let uid = user_id.clone();
            tokio::spawn(async move {
                let _ = eng.resolve_user(&uid).await;
            });
        }

        let is_self = self
            .user
            .read()
            .as_ref()
            .map(|u| u.id == user_id)
            .unwrap_or(false);

        if is_self {
            // Anti-Mute
            let (am_enabled, am_unmute, am_undeaf) = {
                let f = self.features.read();
                (f.anti_mute.enabled, f.anti_mute.unmute, f.anti_mute.undeaf)
            };
            if am_enabled {
                if let (Some(ref gid), Some(_)) = (&guild_id, &channel_id) {
                    let should_unmute = am_unmute && rec.mute;
                    let should_undeaf = am_undeaf && rec.deaf;
                    if should_unmute || should_undeaf {
                        self.stats.write().anti_mute_triggers += 1;
                        self.log(
                            "guard",
                            format!(
                                "[ANTI-MUTE] Punição de voz detectada na sua conta (mute={}, deaf={}). Removendo...",
                                rec.mute, rec.deaf
                            ),
                        );
                        let mut body = serde_json::Map::new();
                        if should_unmute {
                            body.insert("mute".to_string(), Value::Bool(false));
                        }
                        if should_undeaf {
                            body.insert("deaf".to_string(), Value::Bool(false));
                        }
                        let eng = Arc::clone(self);
                        let gid_c = gid.clone();
                        let uid_c = user_id.clone();
                        tokio::spawn(async move {
                            eng.patch_guild_member_voice(
                                &gid_c,
                                &uid_c,
                                Value::Object(body),
                                "ANTI-MUTE",
                                false,
                            )
                            .await;
                        });
                    }
                }
            }

            // Anti-Disconnect
            let (ad_enabled, ad_guild, ad_channel, ad_rejoin_move, ad_delay) = {
                let f = self.features.read();
                (
                    f.anti_disconnect.enabled,
                    f.anti_disconnect.guild_id.clone(),
                    f.anti_disconnect.channel_id.clone(),
                    f.anti_disconnect.rejoin_on_move,
                    f.anti_disconnect.delay_ms,
                )
            };

            if ad_enabled
                && ad_channel.is_some()
                && now_ms() > self.ignore_anti_disconnect_until.load(Ordering::Relaxed)
            {
                let lock_ch = ad_channel.unwrap();
                let lock_guild = ad_guild
                    .or_else(|| guild_id.clone())
                    .or_else(|| self.selected_guild_id.read().clone());

                if channel_id.as_deref() == Some(lock_ch.as_str()) {
                    if let Some(h) = self.anti_disconnect_timer.lock().take() {
                        h.abort();
                    }
                }

                let was_disconnected = channel_id.is_none();
                let was_moved = channel_id
                    .as_ref()
                    .map(|c| c != &lock_ch && ad_rejoin_move)
                    .unwrap_or(false);

                if was_disconnected || was_moved {
                    self.stats.write().anti_disconnect_triggers += 1;
                    let reason = if was_disconnected {
                        "Você foi desconectado da call!".to_string()
                    } else {
                        format!(
                            "Você foi movido para {}!",
                            self.get_channel_label(guild_id.as_deref(), channel_id.as_deref())
                        )
                    };
                    self.log(
                        "voice",
                        format!(
                            "[ANTI-DISCONNECT] {} Voltando para {}...",
                            reason,
                            self.get_channel_label(lock_guild.as_deref(), Some(&lock_ch))
                        ),
                    );

                    if let Some(h) = self.anti_disconnect_timer.lock().take() {
                        h.abort();
                    }

                    let eng = Arc::clone(self);
                    let handle = tokio::spawn(async move {
                        sleep(Duration::from_millis(ad_delay)).await;
                        if !eng.features.read().anti_disconnect.enabled {
                            return;
                        }
                        if eng.current_voice.read().channel_id.as_deref() == Some(lock_ch.as_str())
                        {
                            return;
                        }
                        eng.auto_voice_select(lock_guild.as_deref(), Some(&lock_ch))
                            .await;
                        if eng.voice_config.read().fake_stream {
                            if let Some(ref lg) = lock_guild {
                                eng.start_fake_stream(lg, &lock_ch);
                            }
                        }
                        eng.broadcast_state();
                    });
                    *self.anti_disconnect_timer.lock() = Some(handle);

                    self.emit_delta(
                        "voice_update",
                        &json!({ "guildId": guild_id, "userId": user_id, "channelId": channel_id }),
                    );
                    return;
                }
            }

            // Coleira follow self move
            if let (Some(ref gid), Some(ref cid)) = (&guild_id, &channel_id) {
                let mut trigger_coleira = false;
                {
                    let mut f = self.features.write();
                    let ad_ok = !f.anti_disconnect.enabled
                        || f.anti_disconnect.channel_id.as_deref() == Some(cid.as_str());
                    if f.coleira.enabled && f.coleira.follow_self_move && ad_ok {
                        let changed = f.coleira.anchor_channel_id.as_deref() != Some(cid.as_str())
                            || f.coleira.anchor_guild_id.as_deref() != Some(gid.as_str());
                        f.coleira.anchor_guild_id = Some(gid.clone());
                        f.coleira.anchor_channel_id = Some(cid.clone());
                        if changed && !f.coleira.targets.is_empty() {
                            trigger_coleira = true;
                        }
                    }
                }
                if trigger_coleira {
                    self.enforce_coleira_all();
                }
            }
        }

        // 2. Follow Call
        let (fc_enabled, fc_target, fc_delay, fc_leave, fc_sync) = {
            let f = self.features.read();
            (
                f.follow_call.enabled,
                f.follow_call.target_user_id.clone(),
                f.follow_call.delay_ms,
                f.follow_call.leave_when_target_leaves,
                f.follow_call.sync_anti_disconnect,
            )
        };
        if fc_enabled && !fc_target.is_empty() && user_id == fc_target {
            if let Some(ref cid) = channel_id {
                if fc_sync {
                    let mut f = self.features.write();
                    if f.anti_disconnect.enabled {
                        f.anti_disconnect.guild_id = guild_id.clone();
                        f.anti_disconnect.channel_id = Some(cid.clone());
                    }
                }
                let (cur_g, cur_c) = {
                    let cv = self.current_voice.read();
                    (cv.guild_id.clone(), cv.channel_id.clone())
                };
                if cur_c.as_deref() != Some(cid.as_str()) || cur_g != guild_id {
                    self.stats.write().follow_moves += 1;
                    self.ignore_anti_disconnect_until
                        .store(now_ms() + 2500, Ordering::Relaxed);
                    let eng = Arc::clone(self);
                    let gid_c = guild_id.clone();
                    let cid_c = cid.clone();
                    tokio::spawn(async move {
                        sleep(Duration::from_millis(fc_delay)).await;
                        if !eng.features.read().follow_call.enabled {
                            return;
                        }
                        eng.auto_voice_select(gid_c.as_deref(), Some(&cid_c)).await;
                    });
                }
            } else if fc_leave && self.current_voice.read().channel_id.is_some() {
                self.ignore_anti_disconnect_until
                    .store(now_ms() + 2500, Ordering::Relaxed);
                let eng = Arc::clone(self);
                tokio::spawn(async move {
                    eng.auto_voice_select(None, None).await;
                });
            }
        }

        // 3. Anti-Call (Kick Loop)
        let kick_target = {
            let f = self.features.read();
            f.anti_call.enabled && f.anti_call.targets.contains(&user_id)
        };
        if kick_target {
            if let (Some(ref gid), Some(ref cid)) = (&guild_id, &channel_id) {
                self.stats.write().anti_call_kicks += 1;
                self.log(
                    "coleira",
                    format!(
                        "[ANTI-CALL] Alvo {} entrou em {}. Desconectando...",
                        self.get_user_label(&user_id),
                        self.get_channel_label(Some(gid), Some(cid))
                    ),
                );
                let eng = Arc::clone(self);
                let gid_c = gid.clone();
                let uid_c = user_id.clone();
                tokio::spawn(async move {
                    eng.patch_guild_member_voice(
                        &gid_c,
                        &uid_c,
                        json!({ "channel_id": null }),
                        "ANTI-CALL",
                        false,
                    )
                    .await;
                });
                self.emit_delta(
                    "voice_update",
                    &json!({ "guildId": guild_id, "userId": user_id, "channelId": Value::Null }),
                );
                return;
            }
        }

        // 4. Coleira
        {
            let (col_enabled, is_col_target) = {
                let f = self.features.read();
                (f.coleira.enabled, f.coleira.targets.contains(&user_id))
            };
            if col_enabled && is_col_target {
                self.enforce_coleira_all();
            }
        }

        // 5. Mute-Lock
        {
            let (ml_enabled, is_ml_target) = {
                let f = self.features.read();
                (f.mute_lock.enabled, f.mute_lock.targets.contains(&user_id))
            };
            if ml_enabled && is_ml_target {
                if let (Some(ref gid), Some(_)) = (&guild_id, &channel_id) {
                    let eng = Arc::clone(self);
                    let gid_c = gid.clone();
                    let uid_c = user_id.clone();
                    let rec_c = rec.clone();
                    tokio::spawn(async move {
                        eng.enforce_mute_lock(&gid_c, &uid_c, Some(&rec_c)).await;
                    });
                }
            }
        }

        // 6. Guard
        {
            let (g_enabled, is_g_target, g_antimute, g_keep) = {
                let f = self.features.read();
                (
                    f.guard.enabled,
                    f.guard.targets.contains(&user_id),
                    f.guard.anti_mute,
                    f.guard.keep_in_my_call,
                )
            };
            if g_enabled && is_g_target {
                if let (Some(ref gid), Some(ref cid)) = (&guild_id, &channel_id) {
                    let need_unmute = g_antimute && rec.mute;
                    let need_undeaf = g_antimute && rec.deaf;
                    let my_ch = {
                        let cv = self.current_voice.read();
                        if cv.guild_id.as_deref() == Some(gid.as_str()) {
                            cv.channel_id.clone()
                        } else {
                            None
                        }
                    };
                    let need_pull_back = g_keep
                        && my_ch.is_some()
                        && my_ch.as_deref() != Some(cid.as_str())
                        && prev_loc.as_ref().map(|(_, pch)| pch.as_str()) == my_ch.as_deref();

                    if need_unmute || need_undeaf || need_pull_back {
                        self.stats.write().guard_actions += 1;
                        let mut patch = serde_json::Map::new();
                        if need_unmute {
                            patch.insert("mute".to_string(), Value::Bool(false));
                        }
                        if need_undeaf {
                            patch.insert("deaf".to_string(), Value::Bool(false));
                        }
                        if need_pull_back {
                            if let Some(mch) = my_ch {
                                patch.insert("channel_id".to_string(), Value::String(mch));
                            }
                        }
                        let eng = Arc::clone(self);
                        let gid_c = gid.clone();
                        let uid_c = user_id.clone();
                        tokio::spawn(async move {
                            eng.patch_guild_member_voice(
                                &gid_c,
                                &uid_c,
                                Value::Object(patch),
                                "GUARD",
                                false,
                            )
                            .await;
                        });
                    }
                }
            }
        }

        self.emit_delta(
            "voice_update",
            &json!({ "guildId": guild_id, "userId": user_id, "channelId": channel_id }),
        );
    }

    pub fn start_watchdog(self: &Arc<Self>) {
        if let Some(old) = self.watchdog_handle.lock().take() {
            old.abort();
        }
        let eng_weak = Arc::downgrade(self);
        let handle = tokio::spawn(async move {
            loop {
                sleep(Duration::from_millis(2000)).await;
                let Some(eng) = eng_weak.upgrade() else {
                    break;
                };
                if *eng.status.read() != "connected" {
                    continue;
                }

                // 1. Anti-Disconnect
                let (ad_enabled, ad_ch, ad_g, ad_rejoin) = {
                    let f = eng.features.read();
                    (
                        f.anti_disconnect.enabled,
                        f.anti_disconnect.channel_id.clone(),
                        f.anti_disconnect.guild_id.clone(),
                        f.anti_disconnect.rejoin_on_move,
                    )
                };
                if ad_enabled
                    && ad_ch.is_some()
                    && now_ms() > eng.ignore_anti_disconnect_until.load(Ordering::Relaxed)
                {
                    let target_ch = ad_ch.unwrap();
                    let target_g = ad_g.or_else(|| eng.selected_guild_id.read().clone());
                    let cur_ch = eng.current_voice.read().channel_id.clone();
                    let recent = now_ms()
                        .saturating_sub(eng.last_auto_voice_attempt_ts.load(Ordering::Relaxed))
                        < 2500;
                    if (cur_ch.is_none() || (cur_ch.as_deref() != Some(&target_ch) && ad_rejoin))
                        && !recent
                    {
                        eng.auto_voice_select(target_g.as_deref(), Some(&target_ch))
                            .await;
                    }
                }

                // 2. Follow Call
                if eng.features.read().follow_call.enabled {
                    eng.sync_follow_target_now().await;
                }

                // 3. Coleira
                if eng.features.read().coleira.enabled {
                    eng.enforce_coleira_all();
                }

                // 4. Anti-Call
                let ac_targets = {
                    let f = eng.features.read();
                    if f.anti_call.enabled {
                        f.anti_call.targets.iter().cloned().collect::<Vec<_>>()
                    } else {
                        Vec::new()
                    }
                };
                for tid in ac_targets {
                    if let Some(gid) = eng.resolve_target_guild_id(&tid) {
                        let in_voice = eng.user_voice_map.read().contains_key(&tid)
                            || eng
                                .voice_states
                                .read()
                                .get(&gid)
                                .and_then(|m| m.get(&tid))
                                .and_then(|v| v.channel_id.as_ref())
                                .is_some();
                        if in_voice {
                            eng.patch_guild_member_voice(
                                &gid,
                                &tid,
                                json!({ "channel_id": null }),
                                "ANTI-CALL",
                                false,
                            )
                            .await;
                        }
                    }
                }

                // 5. Mute-Lock
                let ml_targets = {
                    let f = eng.features.read();
                    if f.mute_lock.enabled {
                        f.mute_lock.targets.iter().cloned().collect::<Vec<_>>()
                    } else {
                        Vec::new()
                    }
                };
                for tid in ml_targets {
                    if let Some(gid) = eng.resolve_target_guild_id(&tid) {
                        let vs = eng
                            .voice_states
                            .read()
                            .get(&gid)
                            .and_then(|m| m.get(&tid))
                            .cloned();
                        eng.enforce_mute_lock(&gid, &tid, vs.as_ref()).await;
                    }
                }
            }
        });
        *self.watchdog_handle.lock() = Some(handle);
    }

    pub fn update_chaotic_mover(self: &Arc<Self>) {
        if let Some(old) = self.chaotic_handle.lock().take() {
            old.abort();
        }
        let (enabled, target_id, interval_ms) = {
            let mut f = self.features.write();
            if !f.chaotic_mover.enabled || f.chaotic_mover.target_user_id.trim().is_empty() {
                return;
            }
            let tid = f.chaotic_mover.target_user_id.trim().to_string();
            if f.chaotic_mover.guild_id.is_empty() || f.chaotic_mover.guild_id == "null" {
                let resolved = self.resolve_target_guild_id(&tid).unwrap_or_default();
                f.chaotic_mover.guild_id = resolved;
            }
            (
                f.chaotic_mover.enabled,
                tid,
                f.chaotic_mover.interval_ms.max(600),
            )
        };
        if !enabled {
            return;
        }

        let eng_weak = Arc::downgrade(self);
        let handle = tokio::spawn(async move {
            let mut idx: usize = 0;
            loop {
                sleep(Duration::from_millis(interval_ms)).await;
                let Some(eng) = eng_weak.upgrade() else {
                    break;
                };
                if *eng.status.read() != "connected" || !eng.features.read().chaotic_mover.enabled {
                    continue;
                }
                let Some(gid) = eng.resolve_target_guild_id(&target_id) else {
                    continue;
                };
                let voice_channels = {
                    let guilds = eng.guilds.read();
                    let Some(g) = guilds.get(&gid) else {
                        continue;
                    };
                    g.channels
                        .values()
                        .filter(|c| c.kind == 2 || c.kind == 13)
                        .map(|c| c.id.clone())
                        .collect::<Vec<_>>()
                };
                if voice_channels.is_empty() {
                    continue;
                }
                let next_ch = &voice_channels[idx % voice_channels.len()];
                idx = idx.wrapping_add(1);
                eng.patch_guild_member_voice(
                    &gid,
                    &target_id,
                    json!({ "channel_id": next_ch }),
                    "CHAOS",
                    true,
                )
                .await;
            }
        });
        *self.chaotic_handle.lock() = Some(handle);
    }

    pub async fn handle_message_create(self: &Arc<Self>, d: &Value) {
        let Some(content) = d.get("content").and_then(|v| v.as_str()) else {
            return;
        };
        if content.is_empty() {
            return;
        }
        let author_id = d
            .get("author")
            .and_then(|a| a.get("id"))
            .and_then(|v| v.as_str())
            .unwrap_or("");
        let my_id = self
            .user
            .read()
            .as_ref()
            .map(|u| u.id.clone())
            .unwrap_or_default();
        if author_id.is_empty() || author_id == my_id {
            return;
        }

        let channel_id = d
            .get("channel_id")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let guild_id = d
            .get("guild_id")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());
        let msg_id = d
            .get("id")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();

        // 1. Nitro Sniper
        if self.features.read().nitro_sniper.enabled && content.contains("discord.gift/") {
            let re = Regex::new(r"discord\.gift/([a-zA-Z0-9]{16,24})").unwrap();
            for cap in re.captures_iter(content) {
                if let Some(code_m) = cap.get(1) {
                    let code = code_m.as_str().to_string();
                    self.log(
                        "info",
                        format!(
                            "[NITRO SNIPER] Código detectado ({})! Agendando resgate com evasão...",
                            code
                        ),
                    );
                    let jitter = rand::thread_rng().gen_range(180..420);
                    sleep(Duration::from_millis(jitter)).await;
                    let res = self
                        .request(
                            "POST",
                            &format!("/entitlements/gift-codes/{}/redeem", code),
                            Some(json!({ "channel_id": channel_id })),
                            None,
                            0,
                        )
                        .await;
                    if res.ok {
                        self.stats.write().nitro_sniped += 1;
                        self.log(
                            "success",
                            format!("[NITRO SNIPER] Código {} resgatado com sucesso!", code),
                        );
                    } else {
                        self.log(
                            "warn",
                            format!(
                                "[NITRO SNIPER] Falha no código {}: {}",
                                code,
                                res.error.unwrap_or_default()
                            ),
                        );
                    }
                    self.broadcast_state();
                }
            }
        }

        // 2. Auto-Reply
        let ar = self.features.read().auto_reply.clone();
        if ar.enabled {
            let is_dm = guild_id.is_none();
            let is_mentioned = d
                .get("mentions")
                .and_then(|v| v.as_array())
                .map(|arr| {
                    arr.iter()
                        .any(|u| u.get("id").and_then(|id| id.as_str()) == Some(my_id.as_str()))
                })
                .unwrap_or(false);

            if ar.only_dm && !is_dm {
                return;
            }
            if ar.only_mention && !is_dm && !is_mentioned {
                return;
            }

            let mut reply_text = String::new();
            let lower = content.to_lowercase();
            for (kw, resp) in &ar.triggers {
                if !kw.is_empty() && !resp.is_empty() && lower.contains(&kw.to_lowercase()) {
                    reply_text = resp.trim().to_string();
                    break;
                }
            }
            if reply_text.is_empty() && !ar.message.trim().is_empty() {
                reply_text = ar.message.trim().to_string();
            }
            if reply_text.is_empty() {
                return;
            }

            let cooldown_ms = ar.cooldown_sec.max(1) * 1000;
            let now = now_ms();
            if let Some(last) = self.auto_reply_cooldowns.get(author_id) {
                if now.saturating_sub(*last) < cooldown_ms {
                    return;
                }
            }
            self.auto_reply_cooldowns.insert(author_id.to_string(), now);

            let eng = Arc::clone(self);
            tokio::spawn(async move {
                sleep(Duration::from_millis(500)).await;
                let _ = eng
                    .request(
                        "POST",
                        &format!("/channels/{}/typing", channel_id),
                        None,
                        None,
                        0,
                    )
                    .await;
                sleep(Duration::from_millis(1000)).await;
                let nonce = generate_snowflake_nonce();
                let _ = eng
                    .request(
                        "POST",
                        &format!("/channels/{}/messages", channel_id),
                        Some(json!({
                            "content": reply_text,
                            "message_reference": { "message_id": msg_id, "channel_id": channel_id },
                            "nonce": nonce,
                            "tts": false,
                        })),
                        None,
                        0,
                    )
                    .await;
            });
        }
    }

    pub async fn select_guild(&self, guild_id: &str) -> Option<Value> {
        let gid = guild_id.trim().to_string();
        if gid.is_empty() {
            return None;
        }
        *self.selected_guild_id.write() = Some(gid.clone());

        {
            let mut guilds = self.guilds.write();
            let mut order = self.guild_order.write();
            if !order.contains(&gid) {
                order.push(gid.clone());
            }
            guilds.entry(gid.clone()).or_insert_with(|| GuildData {
                id: gid.clone(),
                name: format!("Servidor {}", gid),
                icon: None,
                owner_id: None,
                channels: HashMap::new(),
                roles: HashMap::new(),
            });
        }

        self.send_op(
            14,
            json!({
                "guild_id": gid,
                "typing": true,
                "threads": false,
                "activities": true,
                "members": [],
                "channels": {},
            }),
        );

        let (need_guild, need_channels, need_roles) = {
            let guilds = self.guilds.read();
            if let Some(g) = guilds.get(&gid) {
                (
                    g.name.starts_with("Servidor "),
                    g.channels.is_empty(),
                    g.roles.is_empty(),
                )
            } else {
                (false, false, false)
            }
        };

        if self.token.read().is_some() {
            if need_guild {
                let r = self
                    .request("GET", &format!("/guilds/{}", gid), None, None, 0)
                    .await;
                if r.ok {
                    self.ingest_guild_object(&r.data);
                }
            }
            if need_channels {
                let r = self
                    .request("GET", &format!("/guilds/{}/channels", gid), None, None, 0)
                    .await;
                if r.ok {
                    if let Some(arr) = r.data.as_array() {
                        let mut voice_ids = Vec::new();
                        {
                            let mut guilds = self.guilds.write();
                            if let Some(g) = guilds.get_mut(&gid) {
                                g.channels.clear();
                                for ch in arr {
                                    let Some(cid) = ch
                                        .get("id")
                                        .and_then(|v| v.as_str())
                                        .map(|s| s.to_string())
                                    else {
                                        continue;
                                    };
                                    let kind =
                                        ch.get("type").and_then(|v| v.as_i64()).unwrap_or(0) as i32;
                                    if kind == 2 || kind == 13 {
                                        voice_ids.push(cid.clone());
                                    }
                                    g.channels.insert(
                                        cid.clone(),
                                        ChannelInfo {
                                            id: cid.clone(),
                                            name: ch
                                                .get("name")
                                                .and_then(|v| v.as_str())
                                                .map(|s| s.to_string())
                                                .unwrap_or_else(|| format!("canal-{}", cid)),
                                            kind,
                                            parent_id: ch
                                                .get("parent_id")
                                                .and_then(|v| v.as_str())
                                                .map(|s| s.to_string()),
                                            position: ch
                                                .get("position")
                                                .and_then(|v| v.as_i64())
                                                .unwrap_or(0)
                                                as i32,
                                            bitrate: ch
                                                .get("bitrate")
                                                .and_then(|v| v.as_u64())
                                                .unwrap_or(64000)
                                                as u32,
                                            user_limit: ch
                                                .get("user_limit")
                                                .and_then(|v| v.as_u64())
                                                .unwrap_or(0)
                                                as u32,
                                        },
                                    );
                                }
                            }
                        }
                        if !voice_ids.is_empty() {
                            let mut subs = serde_json::Map::new();
                            for vid in voice_ids {
                                subs.insert(vid, json!([[0, 99]]));
                            }
                            self.send_op(
                                14,
                                json!({
                                    "guild_id": gid,
                                    "typing": true,
                                    "threads": false,
                                    "activities": true,
                                    "members": [],
                                    "channels": subs,
                                }),
                            );
                        }
                    }
                }
            }
            if need_roles {
                let r = self
                    .request("GET", &format!("/guilds/{}/roles", gid), None, None, 0)
                    .await;
                if r.ok {
                    if let Some(arr) = r.data.as_array() {
                        let mut guilds = self.guilds.write();
                        if let Some(g) = guilds.get_mut(&gid) {
                            g.roles.clear();
                            for role in arr {
                                let Some(rid) = role
                                    .get("id")
                                    .and_then(|v| v.as_str())
                                    .map(|s| s.to_string())
                                else {
                                    continue;
                                };
                                g.roles.insert(
                                    rid.clone(),
                                    RoleInfo {
                                        id: rid,
                                        name: role
                                            .get("name")
                                            .and_then(|v| v.as_str())
                                            .unwrap_or("role")
                                            .to_string(),
                                        color: role
                                            .get("color")
                                            .and_then(|v| v.as_u64())
                                            .unwrap_or(0)
                                            as u32,
                                        position: role
                                            .get("position")
                                            .and_then(|v| v.as_i64())
                                            .unwrap_or(0)
                                            as i32,
                                        permissions: role
                                            .get("permissions")
                                            .and_then(|v| v.as_str())
                                            .unwrap_or("0")
                                            .to_string(),
                                    },
                                );
                            }
                        }
                    }
                }
            }
        }

        self.broadcast_state();
        self.get_selected_guild_payload()
    }

    pub async fn preload_user_guilds(&self) {
        let res = self
            .request("GET", "/users/@me/guilds?with_counts=true", None, None, 0)
            .await;
        if res.ok {
            if let Some(arr) = res.data.as_array() {
                for g in arr {
                    self.ingest_guild_object(g);
                }
                let sel = self.selected_guild_id.read().clone().or_else(|| {
                    self.guild_order.read().first().cloned()
                });
                if let Some(gid) = sel {
                    self.select_guild(&gid).await;
                }
                self.broadcast_state();
            }
        }
    }

    pub async fn connect(
        self: &Arc<Self>,
        raw_token: &str,
        initial_guild_id: Option<&str>,
    ) -> Result<UserInfo, String> {
        let clean = format_token(raw_token);
        if clean.is_empty() {
            return Err("Token é obrigatório".to_string());
        }

        let already_connected_user = {
            if self.token.read().as_deref() == Some(clean.as_str())
                && *self.status.read() == "connected"
            {
                self.user.read().clone()
            } else {
                None
            }
        };
        if let Some(u) = already_connected_user {
            if let Some(gid) = initial_guild_id {
                self.select_guild(gid).await;
            }
            return Ok(u);
        }

        let auth_check = self
            .request_with_token(&clean, "GET", "/users/@me", None, None, 1)
            .await;
        if !auth_check.ok {
            return Err(auth_check
                .error
                .unwrap_or_else(|| "Token inválido ou expirado".to_string()));
        }
        let Some(user) = UserInfo::from_json(&auth_check.data) else {
            return Err("Resposta de usuário inválida".to_string());
        };

        self.disconnect(false);

        *self.token.write() = Some(clean.clone());
        *self.ipc.engine_token.lock() = Some(clean);
        *self.ipc.engine_user_id.lock() = Some(user.id.clone());
        *self.user.write() = Some(user.clone());
        self.cache_user_json(&auth_check.data);

        if let Some(gid) = initial_guild_id.filter(|s| !s.trim().is_empty()) {
            *self.selected_guild_id.write() = Some(gid.trim().to_string());
        }

        *self.status.write() = "connecting".to_string();
        *self.last_error.write() = None;
        self.log(
            "info",
            format!(
                "Autenticado como {}. Conectando ao Gateway v10...",
                self.get_user_label(&user.id)
            ),
        );
        self.broadcast_state();

        start_gateway_loop(Arc::clone(self));
        self.start_watchdog();

        let ipc_clone = Arc::clone(&self.ipc);
        tokio::spawn(async move {
            let _ = ipc_clone.ensure_connected().await;
        });

        let eng_clone = Arc::clone(self);
        tokio::spawn(async move {
            eng_clone.preload_user_guilds().await;
        });

        Ok(user)
    }

    pub fn disconnect(&self, log_disconnect: bool) {
        if let Some(h) = self.gw_abort.lock().take() {
            h.abort();
        }
        *self.gw_tx.lock() = None;
        if let Some(h) = self.watchdog_handle.lock().take() {
            h.abort();
        }
        if let Some(h) = self.chaotic_handle.lock().take() {
            h.abort();
        }
        if let Some(h) = self.anti_disconnect_timer.lock().take() {
            h.abort();
        }

        *self.status.write() = "disconnected".to_string();
        *self.discord_session_id.write() = None;
        self.seq.store(-1, Ordering::Relaxed);
        self.connected_at.store(0, Ordering::Relaxed);

        if log_disconnect {
            self.log("warn", "Sessão Gateway desconectada pelo usuário.");
        }
        self.broadcast_state();
    }

    pub fn destroy(&self) {
        self.disconnect(false);
        self.ipc.destroy();
        let mut tasks = self.active_tasks.lock();
        for (_, t) in tasks.drain() {
            t.cancelled.store(true, Ordering::Relaxed);
            t.handle.abort();
        }
    }

    pub fn get_selected_guild_payload(&self) -> Option<Value> {
        let sel_id = self.selected_guild_id.read().clone()?;
        let guilds = self.guilds.read();
        let g = guilds.get(&sel_id)?;

        let mut channels: Vec<ChannelInfo> = g.channels.values().cloned().collect();
        channels.sort_by_key(|c| c.position);

        let mut roles: Vec<RoleInfo> = g.roles.values().cloned().collect();
        roles.sort_by(|a, b| b.position.cmp(&a.position));

        let vs_list = self
            .voice_states
            .read()
            .get(&g.id)
            .map(|m| m.values().cloned().collect::<Vec<_>>())
            .unwrap_or_default();

        let u_cache = self.users_cache.read();
        let enriched_vs: Vec<Value> = vs_list
            .into_iter()
            .map(|vs| {
                let u = u_cache.get(&vs.user_id);
                let username = u
                    .map(|x| x.username.clone())
                    .unwrap_or_else(|| vs.user_id.clone());
                let display_name = u
                    .and_then(|x| x.global_name.clone())
                    .unwrap_or_else(|| username.clone());
                let avatar = u.and_then(|x| x.avatar.clone());
                json!({
                    "userId": vs.user_id,
                    "guildId": vs.guild_id,
                    "channelId": vs.channel_id,
                    "mute": vs.mute,
                    "deaf": vs.deaf,
                    "selfMute": vs.self_mute,
                    "selfDeaf": vs.self_deaf,
                    "selfVideo": vs.self_video,
                    "selfStream": vs.self_stream,
                    "suppress": vs.suppress,
                    "username": username,
                    "displayName": display_name,
                    "avatar": avatar,
                })
            })
            .collect();

        Some(json!({
            "id": g.id,
            "name": g.name,
            "icon": g.icon,
            "ownerId": g.owner_id,
            "channels": channels,
            "roles": roles,
            "voiceStates": enriched_vs,
        }))
    }

    fn format_target_set(&self, set: &HashSet<String>) -> Vec<Value> {
        let u_cache = self.users_cache.read();
        let v_map = self.user_voice_map.read();
        set.iter()
            .map(|id| {
                let u = u_cache.get(id);
                let loc = v_map.get(id);
                let username = u.map(|x| x.username.clone()).unwrap_or_else(|| id.clone());
                let display_name = u
                    .and_then(|x| x.global_name.clone())
                    .unwrap_or_else(|| username.clone());
                let avatar = u.and_then(|x| x.avatar.clone());
                let (guild_id, channel_id, channel_name) = if let Some((gid, cid)) = loc {
                    (
                        Some(gid.clone()),
                        Some(cid.clone()),
                        Some(self.get_channel_label(Some(gid), Some(cid))),
                    )
                } else {
                    (None, None, None)
                };
                json!({
                    "id": id,
                    "username": username,
                    "displayName": display_name,
                    "avatar": avatar,
                    "guildId": guild_id,
                    "channelId": channel_id,
                    "channelName": channel_name,
                })
            })
            .collect()
    }

    pub fn get_public_state(&self) -> Value {
        let guilds_map = self.guilds.read();
        let order = self.guild_order.read();
        let vs_all = self.voice_states.read();

        let guilds_list: Vec<Value> = order
            .iter()
            .filter_map(|gid| guilds_map.get(gid))
            .map(|g| {
                let v_count = vs_all.get(&g.id).map(|m| m.len()).unwrap_or(0);
                json!({
                    "id": g.id,
                    "name": g.name,
                    "icon": g.icon,
                    "voiceCount": v_count,
                    "channelCount": g.channels.len(),
                })
            })
            .collect();

        let cv = self.current_voice.read().clone();
        let vc = self.voice_config.read().clone();
        let f = self.features.read().clone();
        let p = self.presence.read().clone();
        let st = self.stats.read().clone();
        let logs: Vec<LogEntry> = self.logs.read().iter().take(120).cloned().collect();

        let follow_target_id = &f.follow_call.target_user_id;
        let follow_loc = if !follow_target_id.is_empty() {
            self.user_voice_map.read().get(follow_target_id).cloned()
        } else {
            None
        };

        let follow_target_voice = follow_loc.map(|(gid, cid)| {
            json!({
                "guildId": gid,
                "channelId": cid,
                "channelName": self.get_channel_label(Some(&gid), Some(&cid)),
            })
        });

        let connected_at = {
            let v = self.connected_at.load(Ordering::Relaxed);
            if v == 0 {
                Value::Null
            } else {
                json!(v)
            }
        };

        json!({
            "status": *self.status.read(),
            "lastError": *self.last_error.read(),
            "connectedAt": connected_at,
            "ping": self.ping.load(Ordering::Relaxed),
            "user": *self.user.read(),
            "selectedGuildId": *self.selected_guild_id.read(),
            "selectedGuild": self.get_selected_guild_payload(),
            "guilds": guilds_list,
            "currentVoice": {
                "guildId": cv.guild_id,
                "channelId": cv.channel_id,
                "selfMute": cv.self_mute,
                "selfDeaf": cv.self_deaf,
                "mute": cv.mute,
                "deaf": cv.deaf,
                "selfVideo": cv.self_video,
                "selfStream": cv.self_stream,
                "channelName": self.get_channel_label(cv.guild_id.as_deref(), cv.channel_id.as_deref()),
                "guildName": cv.guild_id.as_ref().and_then(|gid| guilds_map.get(gid).map(|g| g.name.clone())).or(cv.guild_id.clone()),
            },
            "voiceConfig": {
                "guildId": vc.guild_id,
                "channelId": vc.channel_id,
                "selfMute": vc.self_mute,
                "selfDeaf": vc.self_deaf,
                "selfVideo": vc.self_video,
                "fakeStream": vc.fake_stream,
                "useIpcForAutoVoice": vc.use_ipc_for_auto_voice,
                "ipcConnected": self.ipc.is_connected(),
                "ipcMode": self.ipc.get_mode(),
            },
            "features": {
                "antiDisconnect": {
                    "enabled": f.anti_disconnect.enabled,
                    "guildId": f.anti_disconnect.guild_id,
                    "channelId": f.anti_disconnect.channel_id,
                    "rejoinOnMove": f.anti_disconnect.rejoin_on_move,
                    "delayMs": f.anti_disconnect.delay_ms,
                    "channelName": self.get_channel_label(f.anti_disconnect.guild_id.as_deref(), f.anti_disconnect.channel_id.as_deref()),
                },
                "antiMute": f.anti_mute,
                "followCall": {
                    "enabled": f.follow_call.enabled,
                    "targetUserId": f.follow_call.target_user_id,
                    "delayMs": f.follow_call.delay_ms,
                    "leaveWhenTargetLeaves": f.follow_call.leave_when_target_leaves,
                    "syncAntiDisconnect": f.follow_call.sync_anti_disconnect,
                    "targetLabel": if follow_target_id.is_empty() { String::new() } else { self.get_user_label(follow_target_id) },
                    "targetVoice": follow_target_voice,
                },
                "coleira": {
                    "enabled": f.coleira.enabled,
                    "anchorGuildId": f.coleira.anchor_guild_id,
                    "anchorChannelId": f.coleira.anchor_channel_id,
                    "anchorChannelName": self.get_channel_label(
                        f.coleira.anchor_guild_id.as_deref().or(cv.guild_id.as_deref()),
                        f.coleira.anchor_channel_id.as_deref().or(cv.channel_id.as_deref())
                    ),
                    "followSelfMove": f.coleira.follow_self_move,
                    "forceServerMute": f.coleira.force_server_mute,
                    "forceServerDeaf": f.coleira.force_server_deaf,
                    "targets": self.format_target_set(&f.coleira.targets),
                },
                "antiCall": {
                    "enabled": f.anti_call.enabled,
                    "targets": self.format_target_set(&f.anti_call.targets),
                },
                "muteLock": {
                    "enabled": f.mute_lock.enabled,
                    "mute": f.mute_lock.mute,
                    "deaf": f.mute_lock.deaf,
                    "kickFallback": f.mute_lock.kick_fallback,
                    "targets": self.format_target_set(&f.mute_lock.targets),
                },
                "guard": {
                    "enabled": f.guard.enabled,
                    "antiMute": f.guard.anti_mute,
                    "keepInMyCall": f.guard.keep_in_my_call,
                    "targets": self.format_target_set(&f.guard.targets),
                },
                "chaoticMover": f.chaotic_mover,
                "autoReply": f.auto_reply,
                "nitroSniper": f.nitro_sniper,
            },
            "presence": p,
            "stats": st,
            "logs": logs,
        })
    }
}

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{HashMap, HashSet};

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct UserInfo {
    pub id: String,
    pub username: String,
    #[serde(default)]
    pub discriminator: Option<String>,
    #[serde(default)]
    pub global_name: Option<String>,
    #[serde(default)]
    pub avatar: Option<String>,
    #[serde(default)]
    pub bot: bool,
    #[serde(default)]
    pub banner: Option<String>,
    #[serde(default)]
    pub accent_color: Option<u64>,
}

impl UserInfo {
    pub fn from_json(v: &Value) -> Option<Self> {
        let id = v.get("id").and_then(|x| x.as_str()).map(|s| s.to_string())?;
        let username = v
            .get("username")
            .and_then(|x| x.as_str())
            .unwrap_or(&id)
            .to_string();
        Some(Self {
            id,
            username,
            discriminator: v
                .get("discriminator")
                .and_then(|x| x.as_str())
                .map(|s| s.to_string()),
            global_name: v
                .get("global_name")
                .and_then(|x| x.as_str())
                .map(|s| s.to_string()),
            avatar: v
                .get("avatar")
                .and_then(|x| x.as_str())
                .map(|s| s.to_string()),
            bot: v.get("bot").and_then(|x| x.as_bool()).unwrap_or(false),
            banner: v
                .get("banner")
                .and_then(|x| x.as_str())
                .map(|s| s.to_string()),
            accent_color: v.get("accent_color").and_then(|x| x.as_u64()),
        })
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChannelInfo {
    pub id: String,
    pub name: String,
    #[serde(rename = "type")]
    pub kind: i32,
    pub parent_id: Option<String>,
    pub position: i32,
    pub bitrate: u32,
    pub user_limit: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RoleInfo {
    pub id: String,
    pub name: String,
    pub color: u32,
    pub position: i32,
    pub permissions: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GuildData {
    pub id: String,
    pub name: String,
    pub icon: Option<String>,
    #[serde(rename = "ownerId")]
    pub owner_id: Option<String>,
    pub channels: HashMap<String, ChannelInfo>,
    pub roles: HashMap<String, RoleInfo>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VoiceStateRecord {
    pub user_id: String,
    pub guild_id: Option<String>,
    pub channel_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
    pub mute: bool,
    pub deaf: bool,
    pub self_mute: bool,
    pub self_deaf: bool,
    pub self_video: bool,
    pub self_stream: bool,
    pub suppress: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CurrentVoice {
    pub guild_id: Option<String>,
    pub channel_id: Option<String>,
    pub self_mute: bool,
    pub self_deaf: bool,
    pub mute: bool,
    pub deaf: bool,
    pub self_video: bool,
    pub self_stream: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VoiceConfig {
    pub guild_id: Option<String>,
    pub channel_id: Option<String>,
    pub self_mute: bool,
    pub self_deaf: bool,
    pub self_video: bool,
    pub fake_stream: bool,
    pub use_ipc_for_auto_voice: bool,
}

impl Default for VoiceConfig {
    fn default() -> Self {
        Self {
            guild_id: None,
            channel_id: None,
            self_mute: false,
            self_deaf: false,
            self_video: false,
            fake_stream: false,
            use_ipc_for_auto_voice: true,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AntiDisconnectConfig {
    pub enabled: bool,
    pub guild_id: Option<String>,
    pub channel_id: Option<String>,
    pub rejoin_on_move: bool,
    pub delay_ms: u64,
}

impl Default for AntiDisconnectConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            guild_id: None,
            channel_id: None,
            rejoin_on_move: true,
            delay_ms: 120,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AntiMuteConfig {
    pub enabled: bool,
    pub unmute: bool,
    pub undeaf: bool,
}

impl Default for AntiMuteConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            unmute: true,
            undeaf: true,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FollowCallConfig {
    pub enabled: bool,
    pub target_user_id: String,
    pub delay_ms: u64,
    pub leave_when_target_leaves: bool,
    pub sync_anti_disconnect: bool,
}

impl Default for FollowCallConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            target_user_id: String::new(),
            delay_ms: 250,
            leave_when_target_leaves: false,
            sync_anti_disconnect: true,
        }
    }
}

#[derive(Debug, Clone)]
pub struct ColeiraConfig {
    pub enabled: bool,
    pub targets: HashSet<String>,
    pub anchor_guild_id: Option<String>,
    pub anchor_channel_id: Option<String>,
    pub follow_self_move: bool,
    pub force_server_mute: bool,
    pub force_server_deaf: bool,
}

impl Default for ColeiraConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            targets: HashSet::new(),
            anchor_guild_id: None,
            anchor_channel_id: None,
            follow_self_move: true,
            force_server_mute: false,
            force_server_deaf: false,
        }
    }
}

#[derive(Debug, Clone, Default)]
pub struct AntiCallConfig {
    pub enabled: bool,
    pub targets: HashSet<String>,
}

#[derive(Debug, Clone)]
pub struct MuteLockConfig {
    pub enabled: bool,
    pub targets: HashSet<String>,
    pub mute: bool,
    pub deaf: bool,
    pub kick_fallback: bool,
}

impl Default for MuteLockConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            targets: HashSet::new(),
            mute: true,
            deaf: false,
            kick_fallback: true,
        }
    }
}

#[derive(Debug, Clone)]
pub struct GuardConfig {
    pub enabled: bool,
    pub targets: HashSet<String>,
    pub anti_mute: bool,
    pub keep_in_my_call: bool,
}

impl Default for GuardConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            targets: HashSet::new(),
            anti_mute: true,
            keep_in_my_call: true,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChaoticMoverConfig {
    pub enabled: bool,
    pub target_user_id: String,
    pub guild_id: String,
    pub interval_ms: u64,
}

impl Default for ChaoticMoverConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            target_user_id: String::new(),
            guild_id: String::new(),
            interval_ms: 1200,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutoReplyConfig {
    pub enabled: bool,
    pub message: String,
    pub only_dm: bool,
    pub only_mention: bool,
    pub cooldown_sec: u64,
    pub triggers: HashMap<String, String>,
}

impl Default for AutoReplyConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            message: String::new(),
            only_dm: true,
            only_mention: false,
            cooldown_sec: 15,
            triggers: HashMap::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct NitroSniperConfig {
    pub enabled: bool,
}

#[derive(Debug, Clone, Default)]
pub struct FeaturesState {
    pub anti_disconnect: AntiDisconnectConfig,
    pub anti_mute: AntiMuteConfig,
    pub follow_call: FollowCallConfig,
    pub coleira: ColeiraConfig,
    pub anti_call: AntiCallConfig,
    pub mute_lock: MuteLockConfig,
    pub guard: GuardConfig,
    pub chaotic_mover: ChaoticMoverConfig,
    pub auto_reply: AutoReplyConfig,
    pub nitro_sniper: NitroSniperConfig,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PresenceConfig {
    pub status: String,
    pub activity_type: i32,
    pub activity_name: String,
    pub activity_details: String,
    pub activity_state: String,
    pub stream_url: String,
    pub custom_status: String,
}

impl Default for PresenceConfig {
    fn default() -> Self {
        Self {
            status: "online".to_string(),
            activity_type: 0,
            activity_name: String::new(),
            activity_details: String::new(),
            activity_state: String::new(),
            stream_url: String::new(),
            custom_status: String::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Stats {
    pub anti_disconnect_triggers: u64,
    pub anti_mute_triggers: u64,
    pub follow_moves: u64,
    pub coleira_pulls: u64,
    pub anti_call_kicks: u64,
    pub guard_actions: u64,
    pub mute_lock_actions: u64,
    pub nitro_sniped: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LogEntry {
    pub id: String,
    pub ts: u64,
    pub time: String,
    #[serde(rename = "type")]
    pub kind: String,
    pub message: String,
}


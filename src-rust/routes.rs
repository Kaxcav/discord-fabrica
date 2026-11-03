use axum::{
    body::Body,
    extract::{Path as AxumPath, Query, State},
    http::{HeaderMap, Request, StatusCode},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use base64::{engine::general_purpose::STANDARD as B64, Engine};
use dashmap::DashMap;
use futures_util::StreamExt;
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    env,
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    time::Duration,
};
use tokio::time::sleep;
use tokio_stream::wrappers::BroadcastStream;
use tower_http::services::{ServeDir, ServeFile};

use crate::{
    config::{generate_snowflake_nonce, now_ms},
    engine::{ActiveTask, SelfbotEngine},
    ipc::IpcCommandResult,
    platform::scan_local_tokens,
};

#[derive(Clone)]
pub struct AppState {
    pub sessions: Arc<DashMap<String, Arc<SelfbotEngine>>>,
    pub http: reqwest::Client,
    pub panel_pin: String,
}

impl AppState {
    pub fn new() -> Self {
        let http = reqwest::Client::builder()
            .pool_max_idle_per_host(16)
            .build()
            .unwrap_or_default();
        let panel_pin = env::var("PANEL_PIN").unwrap_or_default().trim().to_string();
        let sessions: Arc<DashMap<String, Arc<SelfbotEngine>>> = Arc::new(DashMap::new());

        // Limpeza automática de sessões inativas (> 2h)
        let sess_cleanup = Arc::clone(&sessions);
        tokio::spawn(async move {
            loop {
                sleep(Duration::from_secs(600)).await;
                let now = now_ms();
                let mut expired = Vec::new();
                for item in sess_cleanup.iter() {
                    if now.saturating_sub(item.value().last_activity.load(Ordering::Relaxed))
                        > 7_200_000
                    {
                        expired.push(item.key().clone());
                    }
                }
                for sid in expired {
                    if let Some((_, bot)) = sess_cleanup.remove(&sid) {
                        bot.destroy();
                    }
                }
            }
        });

        Self {
            sessions,
            http,
            panel_pin,
        }
    }

    pub fn get_or_create_session(&self, sid: &str) -> Arc<SelfbotEngine> {
        if let Some(existing) = self.sessions.get(sid) {
            existing.touch();
            return Arc::clone(existing.value());
        }
        let bot = SelfbotEngine::new(sid.to_string(), self.http.clone());
        self.sessions.insert(sid.to_string(), Arc::clone(&bot));
        bot
    }
}

fn extract_session_id(headers: &HeaderMap, query: &HashMap<String, String>) -> Option<String> {
    if let Some(h) = headers.get("x-session-id").and_then(|v| v.to_str().ok()) {
        let trimmed = h.trim();
        if !trimmed.is_empty() {
            return Some(trimmed.to_string());
        }
    }
    if let Some(q) = query.get("sessionId") {
        let trimmed = q.trim();
        if !trimmed.is_empty() {
            return Some(trimmed.to_string());
        }
    }
    None
}

async fn api_guard_middleware(
    State(state): State<AppState>,
    Query(query): Query<HashMap<String, String>>,
    req: Request<Body>,
    next: Next,
) -> Response {
    let path = req.uri().path().to_string();
    let headers = req.headers();

    // 1. Verificação de PIN
    let is_ipc_bridge_route = path.starts_with("/voice/ipc-")
        && headers.get("x-ipc-bridge").and_then(|v| v.to_str().ok()) == Some("1");
    let is_panel_route = path == "/panel/config" || path == "/panel/verify";

    if !state.panel_pin.is_empty() && !is_panel_route && !is_ipc_bridge_route {
        let provided = headers
            .get("x-panel-pin")
            .and_then(|v| v.to_str().ok())
            .map(|s| s.trim().to_string())
            .or_else(|| query.get("pin").map(|s| s.trim().to_string()))
            .unwrap_or_default();

        if provided != state.panel_pin {
            return (
                StatusCode::UNAUTHORIZED,
                Json(json!({ "error": "PIN de acesso inválido ou obrigatório" })),
            )
                .into_response();
        }
    }

    // 2. Verificação de SessionId
    if !is_panel_route && !path.starts_with("/voice/ipc-") {
        if extract_session_id(headers, &query).is_none() {
            return (
                StatusCode::UNAUTHORIZED,
                Json(json!({ "error": "Session ID obrigatório (X-Session-Id ou ?sessionId=)" })),
            )
                .into_response();
        }
    }

    next.run(req).await
}

fn resolve_bot(
    state: &AppState,
    headers: &HeaderMap,
    query: &HashMap<String, String>,
) -> Option<Arc<SelfbotEngine>> {
    let sid = extract_session_id(headers, query)?;
    Some(state.get_or_create_session(&sid))
}

fn resolve_ipc_target_bots(
    state: &AppState,
    headers: &HeaderMap,
    query: &HashMap<String, String>,
    user_id: Option<&str>,
) -> Vec<Arc<SelfbotEngine>> {
    let mut out = Vec::new();
    let mut seen = std::collections::HashSet::new();

    if let Some(bot) = resolve_bot(state, headers, query) {
        seen.insert(bot.session_id.clone());
        out.push(bot);
    }

    let uid_clean = user_id.map(|s| s.trim()).filter(|s| !s.is_empty());
    for item in state.sessions.iter() {
        let bot = item.value();
        if seen.contains(&bot.session_id) {
            continue;
        }
        if let Some(target_uid) = uid_clean {
            let matches = bot
                .user
                .read()
                .as_ref()
                .map(|u| u.id == target_uid)
                .unwrap_or(false);
            if matches {
                seen.insert(bot.session_id.clone());
                out.push(Arc::clone(bot));
            }
        } else if *bot.status.read() == "connected" || bot.token.read().is_some() {
            seen.insert(bot.session_id.clone());
            out.push(Arc::clone(bot));
        }
    }
    out
}

// ============================================================================
// Handlers
// ============================================================================

async fn get_panel_config(State(state): State<AppState>) -> impl IntoResponse {
    Json(json!({ "pinRequired": !state.panel_pin.is_empty() }))
}

async fn post_panel_verify(
    State(state): State<AppState>,
    Json(body): Json<Value>,
) -> impl IntoResponse {
    if state.panel_pin.is_empty() {
        return (StatusCode::OK, Json(json!({ "ok": true })));
    }
    let pin = body
        .get("pin")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim();
    if pin == state.panel_pin {
        (StatusCode::OK, Json(json!({ "ok": true })))
    } else {
        (
            StatusCode::UNAUTHORIZED,
            Json(json!({ "ok": false, "error": "PIN incorreto" })),
        )
    }
}

async fn get_state(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<HashMap<String, String>>,
) -> impl IntoResponse {
    let Some(bot) = resolve_bot(&state, &headers, &query) else {
        return (
            StatusCode::UNAUTHORIZED,
            Json(json!({ "error": "Sessão inválida" })),
        );
    };
    (StatusCode::OK, Json(bot.get_public_state()))
}

async fn get_events(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<HashMap<String, String>>,
) -> Response {
    let Some(bot) = resolve_bot(&state, &headers, &query) else {
        return (
            StatusCode::UNAUTHORIZED,
            Json(json!({ "error": "Sessão inválida" })),
        )
            .into_response();
    };

    let initial = format!("event: state\ndata: {}\n\n", bot.get_public_state());
    let rx = bot.sse_tx.subscribe();
    let stream = futures_util::stream::once(async move { Ok::<_, std::convert::Infallible>(initial) })
        .chain(BroadcastStream::new(rx).filter_map(|msg| async move {
            match msg {
                Ok(s) => Some(Ok::<_, std::convert::Infallible>(s)),
                Err(_) => None,
            }
        }));

    Response::builder()
        .status(StatusCode::OK)
        .header("Content-Type", "text/event-stream")
        .header("Cache-Control", "no-cache")
        .header("Connection", "keep-alive")
        .header("X-Accel-Buffering", "no")
        .body(Body::from_stream(stream))
        .unwrap()
}

async fn post_auth(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<HashMap<String, String>>,
    Json(body): Json<Value>,
) -> impl IntoResponse {
    let Some(bot) = resolve_bot(&state, &headers, &query) else {
        return (
            StatusCode::UNAUTHORIZED,
            Json(json!({ "error": "Sessão inválida" })),
        );
    };
    let token = body.get("token").and_then(|v| v.as_str()).unwrap_or("");
    let guild_id = body.get("guildId").and_then(|v| v.as_str());
    if token.trim().is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "Token é obrigatório" })),
        );
    }

    match bot.connect(token, guild_id).await {
        Ok(user) => (
            StatusCode::OK,
            Json(json!({
                "ok": true,
                "user": user,
                "state": bot.get_public_state(),
            })),
        ),
        Err(err) => {
            bot.log("error", format!("Falha de autenticação: {}", err));
            (
                StatusCode::BAD_REQUEST,
                Json(json!({
                    "error": err,
                    "state": bot.get_public_state(),
                })),
            )
        }
    }
}

async fn post_disconnect(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<HashMap<String, String>>,
) -> impl IntoResponse {
    let Some(bot) = resolve_bot(&state, &headers, &query) else {
        return (
            StatusCode::UNAUTHORIZED,
            Json(json!({ "error": "Sessão inválida" })),
        );
    };
    bot.disconnect(true);
    (
        StatusCode::OK,
        Json(json!({ "ok": true, "state": bot.get_public_state() })),
    )
}

async fn get_tokens_scan(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<HashMap<String, String>>,
) -> impl IntoResponse {
    let Some(bot) = resolve_bot(&state, &headers, &query) else {
        return (
            StatusCode::UNAUTHORIZED,
            Json(json!({ "error": "Sessão inválida" })),
        );
    };
    let tokens = scan_local_tokens(false);
    let mut validated = Vec::with_capacity(tokens.len());
    let mut valid_tokens = Vec::new();

    let futs = tokens.iter().map(|t| {
        let bot_ref = Arc::clone(&bot);
        let tok = t.clone();
        async move {
            let r = bot_ref
                .request_with_token(&tok, "GET", "/users/@me", None, None, 0)
                .await;
            (tok, r)
        }
    });

    for (t, r) in futures_util::future::join_all(futs).await {
        if r.ok {
            if let Some(id) = r.data.get("id").and_then(|v| v.as_str()) {
                let uname = r
                    .data
                    .get("global_name")
                    .and_then(|v| v.as_str())
                    .or_else(|| r.data.get("username").and_then(|v| v.as_str()))
                    .unwrap_or(id);
                let item = json!({
                    "token": t,
                    "valid": true,
                    "username": uname,
                    "id": id,
                });
                validated.push(item.clone());
                valid_tokens.push(item);
                continue;
            }
        }
        validated.push(json!({ "token": t, "valid": false }));
    }

    (
        StatusCode::OK,
        Json(json!({
            "ok": true,
            "tokens": tokens,
            "validated": validated,
            "validTokens": valid_tokens,
        })),
    )
}

async fn post_guild_select(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<HashMap<String, String>>,
    Json(body): Json<Value>,
) -> impl IntoResponse {
    let Some(bot) = resolve_bot(&state, &headers, &query) else {
        return (
            StatusCode::UNAUTHORIZED,
            Json(json!({ "error": "Sessão inválida" })),
        );
    };
    let Some(guild_id) = body.get("guildId").and_then(|v| v.as_str()) else {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "guildId obrigatório" })),
        );
    };
    let force_refresh = body
        .get("forceRefresh")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    if force_refresh {
        if let Some(g) = bot.guilds.write().get_mut(guild_id) {
            g.channels.clear();
            g.roles.clear();
        }
    }
    bot.select_guild(guild_id).await;
    (
        StatusCode::OK,
        Json(json!({ "ok": true, "state": bot.get_public_state() })),
    )
}

async fn post_voice_join(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<HashMap<String, String>>,
    Json(body): Json<Value>,
) -> impl IntoResponse {
    let Some(bot) = resolve_bot(&state, &headers, &query) else {
        return (
            StatusCode::UNAUTHORIZED,
            Json(json!({ "error": "Sessão inválida" })),
        );
    };
    let Some(channel_id) = body
        .get("channelId")
        .and_then(|v| v.as_str())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
    else {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "channelId é obrigatório para entrar na call" })),
        );
    };
    let guild_id = body
        .get("guildId")
        .and_then(|v| v.as_str())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());

    {
        let mut vc = bot.voice_config.write();
        if let Some(v) = body.get("selfMute").and_then(|x| x.as_bool()) {
            vc.self_mute = v;
        }
        if let Some(v) = body.get("selfDeaf").and_then(|x| x.as_bool()) {
            vc.self_deaf = v;
        }
        if let Some(v) = body.get("selfVideo").and_then(|x| x.as_bool()) {
            vc.self_video = v;
        }
        if let Some(v) = body.get("fakeStream").and_then(|x| x.as_bool()) {
            vc.fake_stream = v;
        }
    }

    bot.ignore_anti_disconnect_until
        .store(now_ms() + 2500, Ordering::Relaxed);

    {
        let mut f = bot.features.write();
        if let Some(lock) = body.get("lockCall").and_then(|x| x.as_bool()) {
            f.anti_disconnect.enabled = lock;
        }
        if f.anti_disconnect.enabled {
            f.anti_disconnect.guild_id = guild_id.clone();
            f.anti_disconnect.channel_id = Some(channel_id.clone());
        }
        if f.coleira.enabled && f.coleira.follow_self_move && guild_id.is_some() {
            f.coleira.anchor_guild_id = guild_id.clone();
            f.coleira.anchor_channel_id = Some(channel_id.clone());
        }
    }

    let sent = if bot.is_desktop_voice_session() {
        bot.auto_voice_select(guild_id.as_deref(), Some(&channel_id))
            .await
    } else {
        bot.send_voice_state(guild_id.as_deref(), Some(&channel_id))
    };

    if bot.voice_config.read().fake_stream {
        if let Some(ref gid) = guild_id {
            bot.start_fake_stream(gid, &channel_id);
        }
    }

    bot.broadcast_state();
    (
        StatusCode::OK,
        Json(json!({ "ok": sent, "state": bot.get_public_state() })),
    )
}

async fn post_voice_leave(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<HashMap<String, String>>,
) -> impl IntoResponse {
    let Some(bot) = resolve_bot(&state, &headers, &query) else {
        return (
            StatusCode::UNAUTHORIZED,
            Json(json!({ "error": "Sessão inválida" })),
        );
    };
    bot.ignore_anti_disconnect_until
        .store(now_ms() + 4000, Ordering::Relaxed);
    {
        let mut f = bot.features.write();
        f.anti_disconnect.enabled = false;
        f.follow_call.enabled = false;
    }
    if bot.voice_config.read().fake_stream {
        bot.stop_fake_stream();
        bot.voice_config.write().fake_stream = false;
    }
    if bot.voice_config.read().use_ipc_for_auto_voice && bot.ipc.is_connected() {
        let ipc = Arc::clone(&bot.ipc);
        tokio::spawn(async move {
            let _ = ipc
                .send_command(
                    "SELECT_VOICE_CHANNEL",
                    json!({ "channel_id": null, "force": true }),
                    3000,
                )
                .await;
        });
    }
    if !bot.is_desktop_voice_session() {
        bot.send_voice_state(None, None);
    }
    {
        let mut cv = bot.current_voice.write();
        cv.channel_id = None;
        cv.guild_id = None;
    }
    bot.log("voice", "Desconectado da call pelo painel.");
    bot.broadcast_state();
    (
        StatusCode::OK,
        Json(json!({ "ok": true, "state": bot.get_public_state() })),
    )
}

async fn post_voice_config(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<HashMap<String, String>>,
    Json(body): Json<Value>,
) -> impl IntoResponse {
    let Some(bot) = resolve_bot(&state, &headers, &query) else {
        return (
            StatusCode::UNAUTHORIZED,
            Json(json!({ "error": "Sessão inválida" })),
        );
    };
    let prev_stream = bot.voice_config.read().fake_stream;
    let mut voice_changed = false;

    {
        let mut vc = bot.voice_config.write();
        if let Some(v) = body.get("selfMute").and_then(|x| x.as_bool()) {
            vc.self_mute = v;
            voice_changed = true;
        }
        if let Some(v) = body.get("selfDeaf").and_then(|x| x.as_bool()) {
            vc.self_deaf = v;
            voice_changed = true;
        }
        if let Some(v) = body.get("selfVideo").and_then(|x| x.as_bool()) {
            vc.self_video = v;
            voice_changed = true;
        }
        if let Some(v) = body.get("fakeStream").and_then(|x| x.as_bool()) {
            vc.fake_stream = v;
            voice_changed = true;
        }
        if let Some(v) = body.get("useIpcForAutoVoice").and_then(|x| x.as_bool()) {
            vc.use_ipc_for_auto_voice = v;
        }
    }

    let (gid, cid) = {
        let cv = bot.current_voice.read();
        let vc = bot.voice_config.read();
        let g = cv
            .guild_id
            .clone()
            .or_else(|| vc.guild_id.clone())
            .or_else(|| bot.selected_guild_id.read().clone());
        let c = cv.channel_id.clone().or_else(|| vc.channel_id.clone());
        (g, c)
    };

    if let Some(ref c) = cid {
        if voice_changed && !bot.is_desktop_voice_session() {
            bot.send_voice_state(gid.as_deref(), Some(c));
            let now_stream = bot.voice_config.read().fake_stream;
            if now_stream && !prev_stream {
                if let Some(ref g) = gid {
                    bot.start_fake_stream(g, c);
                }
            } else if !now_stream && prev_stream {
                bot.stop_fake_stream();
            }
        }
    }

    let cfg = bot.voice_config.read().clone();
    bot.broadcast_state();
    (
        StatusCode::OK,
        Json(json!({ "ok": true, "config": cfg, "state": bot.get_public_state() })),
    )
}

async fn post_voice_member_action(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<HashMap<String, String>>,
    Json(body): Json<Value>,
) -> impl IntoResponse {
    let Some(bot) = resolve_bot(&state, &headers, &query) else {
        return (
            StatusCode::UNAUTHORIZED,
            Json(json!({ "error": "Sessão inválida" })),
        );
    };
    let guild_id = body
        .get("guildId")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .or_else(|| bot.selected_guild_id.read().clone())
        .or_else(|| bot.current_voice.read().guild_id.clone());
    let user_id = body
        .get("userId")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let action = body
        .get("action")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    let (Some(gid), Some(uid), Some(act)) = (guild_id, user_id, action) else {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "guildId, userId e action são obrigatórios" })),
        );
    };

    let patch = match act.as_str() {
        "kick" => json!({ "channel_id": null }),
        "pull" => {
            let target_ch = body
                .get("channelId")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string())
                .or_else(|| bot.current_voice.read().channel_id.clone());
            let Some(tch) = target_ch else {
                return (
                    StatusCode::BAD_REQUEST,
                    Json(json!({ "error": "Você precisa estar em uma call para puxar alguém" })),
                );
            };
            json!({ "channel_id": tch })
        }
        "move" => {
            let Some(tch) = body.get("channelId").and_then(|v| v.as_str()) else {
                return (
                    StatusCode::BAD_REQUEST,
                    Json(json!({ "error": "channelId obrigatório" })),
                );
            };
            json!({ "channel_id": tch })
        }
        "mute" => json!({ "mute": true }),
        "unmute" => json!({ "mute": false }),
        "deaf" => json!({ "deaf": true }),
        "undeaf" => json!({ "deaf": false }),
        _ => {
            return (
                StatusCode::BAD_REQUEST,
                Json(json!({ "error": "Ação desconhecida" })),
            )
        }
    };

    let out = bot
        .patch_guild_member_voice(&gid, &uid, patch, "AÇÃO DIRETA", false)
        .await;
    if out.ok {
        bot.log(
            "voice",
            format!(
                "Ação [{}] executada em {}.",
                act.to_uppercase(),
                bot.get_user_label(&uid)
            ),
        );
    }
    bot.broadcast_state();
    (
        StatusCode::OK,
        Json(json!({
            "ok": out.ok,
            "error": out.error,
            "state": bot.get_public_state(),
        })),
    )
}

async fn post_voice_ipc_register(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<HashMap<String, String>>,
    Json(body): Json<Value>,
) -> impl IntoResponse {
    let user = body.get("user").cloned();
    let user_id = user
        .as_ref()
        .and_then(|u| u.get("id"))
        .and_then(|v| v.as_str())
        .or_else(|| body.get("userId").and_then(|v| v.as_str()))
        .map(|s| s.to_string());
    let source = body
        .get("source")
        .and_then(|v| v.as_str())
        .unwrap_or("PC Bridge");
    let cur_vc = body.get("currentVoiceChannel");

    let bots = resolve_ipc_target_bots(&state, &headers, &query, user_id.as_deref());
    let mut access_token: Option<String> = None;
    let mut anti_disconnect: Option<Value> = None;
    let mut pending = Vec::new();

    for bot in &bots {
        let was_active = bot.ipc.is_remote_active();
        bot.ipc.remote_connected.store(true, Ordering::Relaxed);
        bot.ipc.remote_last_seen.store(now_ms(), Ordering::Relaxed);
        if let Some(ref u) = user {
            *bot.ipc.remote_desktop_user.lock() = Some(u.clone());
        }
        if let Some(vc_obj) = cur_vc {
            let ch_id = vc_obj
                .get("id")
                .and_then(|v| v.as_str())
                .filter(|s| !s.is_empty())
                .map(|s| s.to_string());
            let g_id = vc_obj
                .get("guild_id")
                .and_then(|v| v.as_str())
                .filter(|s| !s.is_empty())
                .map(|s| s.to_string());
            if let Some(cid) = ch_id {
                {
                    let mut cv = bot.current_voice.write();
                    cv.channel_id = Some(cid.clone());
                    cv.guild_id = g_id.clone();
                }
                {
                    let mut vcfg = bot.voice_config.write();
                    vcfg.channel_id = Some(cid.clone());
                    vcfg.guild_id = g_id.clone();
                }
                if let (Some(uid), Some(ref gid)) =
                    (bot.user.read().as_ref().map(|u| u.id.clone()), &g_id)
                {
                    bot.user_voice_map
                        .write()
                        .insert(uid, (gid.clone(), cid.clone()));
                }
                let mut f = bot.features.write();
                if f.anti_disconnect.enabled && f.anti_disconnect.channel_id.is_none() {
                    f.anti_disconnect.guild_id = g_id;
                    f.anti_disconnect.channel_id = Some(cid);
                }
            }
        }
        if !was_active {
            bot.log(
                "success",
                format!(
                    "[PC BRIDGE] Discord Desktop sincronizado ({})! Áudio do cliente local pronto.",
                    source
                ),
            );
            bot.broadcast_state();
        }
        if access_token.is_none() && bot.token.read().is_some() {
            access_token = bot
                .ipc
                .get_rpc_access_token(false, user_id.as_deref())
                .await;
        }
        let ad = bot.features.read().anti_disconnect.clone();
        if ad.enabled && ad.channel_id.is_some() {
            anti_disconnect = serde_json::to_value(ad).ok();
        }
        pending.extend(bot.ipc.get_pending_remote_commands());
    }

    Json(json!({
        "ok": true,
        "matchedSessions": bots.len(),
        "accessToken": access_token,
        "antiDisconnect": anti_disconnect,
        "pending": pending,
    }))
}

async fn get_voice_ipc_pending(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<HashMap<String, String>>,
) -> impl IntoResponse {
    let target_uid = query.get("userId").map(|s| s.as_str());
    let bots = resolve_ipc_target_bots(&state, &headers, &query, target_uid);
    let mut pending = Vec::new();
    let mut access_token: Option<String> = None;
    let mut anti_disconnect: Option<Value> = None;

    for bot in &bots {
        bot.ipc.remote_connected.store(true, Ordering::Relaxed);
        bot.ipc.remote_last_seen.store(now_ms(), Ordering::Relaxed);
        if access_token.is_none() && bot.token.read().is_some() {
            access_token = bot.ipc.get_rpc_access_token(false, target_uid).await;
        }
        let ad = bot.features.read().anti_disconnect.clone();
        if ad.enabled && ad.channel_id.is_some() {
            anti_disconnect = serde_json::to_value(ad).ok();
        }
        pending.extend(bot.ipc.get_pending_remote_commands());
    }

    Json(json!({
        "ok": true,
        "accessToken": access_token,
        "antiDisconnect": anti_disconnect,
        "pending": pending,
    }))
}

async fn post_voice_ipc_result(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<HashMap<String, String>>,
    Json(body): Json<Value>,
) -> impl IntoResponse {
    let Some(request_id) = body.get("requestId").and_then(|v| v.as_str()) else {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "requestId obrigatório" })),
        );
    };
    let res = IpcCommandResult {
        ok: body.get("ok").and_then(|v| v.as_bool()).unwrap_or(false),
        data: body.get("data").cloned(),
        error: body
            .get("error")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
        code: body.get("code").cloned(),
        fast_ack: None,
    };

    let mut resolved = false;
    if let Some(bot) = resolve_bot(&state, &headers, &query) {
        if bot.ipc.resolve_remote_command(request_id, res.clone()) {
            resolved = true;
        }
    }
    if !resolved {
        for item in state.sessions.iter() {
            if item
                .value()
                .ipc
                .resolve_remote_command(request_id, res.clone())
            {
                resolved = true;
                break;
            }
        }
    }

    (
        StatusCode::OK,
        Json(json!({ "ok": true, "resolved": resolved })),
    )
}

async fn get_voice_ipc_status(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<HashMap<String, String>>,
) -> impl IntoResponse {
    let Some(bot) = resolve_bot(&state, &headers, &query) else {
        return Json(json!({ "ok": true, "connected": false, "mode": "disconnected" }));
    };
    if !bot.ipc.is_connected() {
        let _ = bot.ipc.ensure_connected().await;
    }
    let desktop_user = bot.ipc.remote_desktop_user.lock().clone();
    Json(json!({
        "ok": true,
        "connected": bot.ipc.is_connected(),
        "mode": bot.ipc.get_mode(),
        "desktopUser": desktop_user,
    }))
}

async fn post_feature_anti_disconnect(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<HashMap<String, String>>,
    Json(body): Json<Value>,
) -> impl IntoResponse {
    let Some(bot) = resolve_bot(&state, &headers, &query) else {
        return (
            StatusCode::UNAUTHORIZED,
            Json(json!({ "error": "Sessão inválida" })),
        );
    };
    let explicit_ch = body
        .get("channelId")
        .and_then(|v| v.as_str())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());

    {
        let mut f = bot.features.write();
        if body.get("guildId").is_some() {
            f.anti_disconnect.guild_id = body
                .get("guildId")
                .and_then(|v| v.as_str())
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty());
        }
        if body.get("channelId").is_some() {
            f.anti_disconnect.channel_id = explicit_ch.clone();
        }
        if let Some(d) = body.get("delayMs").and_then(|v| v.as_u64()) {
            f.anti_disconnect.delay_ms = d;
        }
        if let Some(r) = body.get("rejoinOnMove").and_then(|v| v.as_bool()) {
            f.anti_disconnect.rejoin_on_move = r;
        }
        if let Some(e) = body.get("enabled").and_then(|v| v.as_bool()) {
            f.anti_disconnect.enabled = e;
        }
    }

    if bot.features.read().anti_disconnect.enabled {
        let self_loc = bot
            .user
            .read()
            .as_ref()
            .and_then(|u| bot.user_voice_map.read().get(&u.id).cloned());
        let active_ch = bot
            .current_voice
            .read()
            .channel_id
            .clone()
            .or_else(|| self_loc.as_ref().map(|(_, c)| c.clone()));
        let active_g = bot
            .current_voice
            .read()
            .guild_id
            .clone()
            .or_else(|| self_loc.as_ref().map(|(g, _)| g.clone()));

        if explicit_ch.is_none() && active_ch.is_some() {
            let mut f = bot.features.write();
            f.anti_disconnect.channel_id = active_ch;
            f.anti_disconnect.guild_id = active_g.or_else(|| bot.selected_guild_id.read().clone());
        } else if bot.features.read().anti_disconnect.channel_id.is_none() && bot.ipc.is_connected()
        {
            let ipc_res = bot
                .ipc
                .send_command("GET_SELECTED_VOICE_CHANNEL", json!({}), 2000)
                .await;
            if ipc_res.ok {
                if let Some(ref data) = ipc_res.data {
                    if let Some(cid) = data.get("id").and_then(|v| v.as_str()) {
                        let gid = data
                            .get("guild_id")
                            .and_then(|v| v.as_str())
                            .map(|s| s.to_string())
                            .or_else(|| bot.selected_guild_id.read().clone());
                        {
                            let mut f = bot.features.write();
                            f.anti_disconnect.channel_id = Some(cid.to_string());
                            f.anti_disconnect.guild_id = gid.clone();
                        }
                        {
                            let mut cv = bot.current_voice.write();
                            cv.channel_id = Some(cid.to_string());
                            cv.guild_id = gid;
                        }
                    }
                }
            }
        }
    }

    let (enabled, ad_g, ad_c, ad_delay) = {
        let f = bot.features.read();
        (
            f.anti_disconnect.enabled,
            f.anti_disconnect.guild_id.clone(),
            f.anti_disconnect.channel_id.clone(),
            f.anti_disconnect.delay_ms,
        )
    };

    if enabled {
        if let Some(ref cid) = ad_c {
            let cur_ch = bot.current_voice.read().channel_id.clone();
            if cur_ch.as_deref() != Some(cid.as_str()) {
                bot.auto_voice_select(ad_g.as_deref(), Some(cid)).await;
            }
            bot.log(
                "voice",
                format!(
                    "[ANTI-DISCONNECT] Ativado e travado em {} (delay={}ms)",
                    bot.get_channel_label(ad_g.as_deref(), Some(cid)),
                    ad_delay
                ),
            );
        } else {
            bot.log(
                "info",
                "[ANTI-DISCONNECT] Ativado em modo de espera — será travado automaticamente assim que sua call for detectada.",
            );
        }
    } else if body.get("enabled").and_then(|v| v.as_bool()) == Some(false) {
        bot.log("info", "[ANTI-DISCONNECT] Desativado.");
    }

    bot.broadcast_state();
    (
        StatusCode::OK,
        Json(json!({ "ok": true, "state": bot.get_public_state() })),
    )
}

async fn post_feature_anti_mute(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<HashMap<String, String>>,
    Json(body): Json<Value>,
) -> impl IntoResponse {
    let Some(bot) = resolve_bot(&state, &headers, &query) else {
        return (
            StatusCode::UNAUTHORIZED,
            Json(json!({ "error": "Sessão inválida" })),
        );
    };
    {
        let mut f = bot.features.write();
        if let Some(v) = body.get("enabled").and_then(|x| x.as_bool()) {
            f.anti_mute.enabled = v;
        }
        if let Some(v) = body.get("unmute").and_then(|x| x.as_bool()) {
            f.anti_mute.unmute = v;
        }
        if let Some(v) = body.get("undeaf").and_then(|x| x.as_bool()) {
            f.anti_mute.undeaf = v;
        }
    }
    bot.broadcast_state();
    (
        StatusCode::OK,
        Json(json!({ "ok": true, "state": bot.get_public_state() })),
    )
}

async fn post_feature_follow(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<HashMap<String, String>>,
    Json(body): Json<Value>,
) -> impl IntoResponse {
    let Some(bot) = resolve_bot(&state, &headers, &query) else {
        return (
            StatusCode::UNAUTHORIZED,
            Json(json!({ "error": "Sessão inválida" })),
        );
    };
    if let Some(tid) = body.get("targetUserId").and_then(|v| v.as_str()) {
        let trimmed = tid.trim().to_string();
        bot.features.write().follow_call.target_user_id = trimmed.clone();
        if !trimmed.is_empty() {
            bot.resolve_user(&trimmed).await;
        }
    }
    {
        let mut f = bot.features.write();
        if let Some(d) = body.get("delayMs").and_then(|v| v.as_u64()) {
            f.follow_call.delay_ms = d;
        }
        if let Some(v) = body.get("leaveWhenTargetLeaves").and_then(|v| v.as_bool()) {
            f.follow_call.leave_when_target_leaves = v;
        }
        if let Some(v) = body.get("syncAntiDisconnect").and_then(|v| v.as_bool()) {
            f.follow_call.sync_anti_disconnect = v;
        }
        if let Some(v) = body.get("enabled").and_then(|v| v.as_bool()) {
            f.follow_call.enabled = v;
        }
    }
    if bot.features.read().follow_call.enabled {
        bot.sync_follow_target_now().await;
    }
    bot.broadcast_state();
    (
        StatusCode::OK,
        Json(json!({ "ok": true, "state": bot.get_public_state() })),
    )
}

async fn post_feature_coleira(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<HashMap<String, String>>,
    Json(body): Json<Value>,
) -> impl IntoResponse {
    let Some(bot) = resolve_bot(&state, &headers, &query) else {
        return (
            StatusCode::UNAUTHORIZED,
            Json(json!({ "error": "Sessão inválida" })),
        );
    };
    let action = body.get("action").and_then(|v| v.as_str()).unwrap_or("");
    let target_uid = body
        .get("targetUserId")
        .and_then(|v| v.as_str())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());

    {
        let mut f = bot.features.write();
        if body.get("anchorGuildId").is_some() {
            f.coleira.anchor_guild_id = body
                .get("anchorGuildId")
                .and_then(|v| v.as_str())
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty());
        }
        if body.get("anchorChannelId").is_some() {
            f.coleira.anchor_channel_id = body
                .get("anchorChannelId")
                .and_then(|v| v.as_str())
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty());
        }
        if let Some(v) = body.get("followSelfMove").and_then(|x| x.as_bool()) {
            f.coleira.follow_self_move = v;
        }
        if let Some(v) = body.get("forceServerMute").and_then(|x| x.as_bool()) {
            f.coleira.force_server_mute = v;
        }
        if let Some(v) = body.get("forceServerDeaf").and_then(|x| x.as_bool()) {
            f.coleira.force_server_deaf = v;
        }
    }

    if action == "add" {
        if let Some(ref tid) = target_uid {
            {
                let mut f = bot.features.write();
                f.coleira.targets.insert(tid.clone());
                f.coleira.enabled = true;
            }
            bot.resolve_user(tid).await;
        }
    } else if action == "remove" {
        if let Some(ref tid) = target_uid {
            bot.features.write().coleira.targets.remove(tid);
        }
    } else if action == "clear" {
        let mut f = bot.features.write();
        f.coleira.targets.clear();
        f.coleira.enabled = false;
    }

    if let Some(e) = body.get("enabled").and_then(|v| v.as_bool()) {
        bot.features.write().coleira.enabled = e;
    }

    {
        let mut f = bot.features.write();
        if f.coleira.enabled && f.coleira.anchor_channel_id.is_none() {
            f.coleira.anchor_guild_id = bot
                .current_voice
                .read()
                .guild_id
                .clone()
                .or_else(|| bot.selected_guild_id.read().clone());
            f.coleira.anchor_channel_id = bot.current_voice.read().channel_id.clone();
        }
    }

    if bot.features.read().coleira.enabled {
        bot.enforce_coleira_all();
    }
    bot.broadcast_state();
    (
        StatusCode::OK,
        Json(json!({ "ok": true, "state": bot.get_public_state() })),
    )
}

async fn post_feature_anti_call(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<HashMap<String, String>>,
    Json(body): Json<Value>,
) -> impl IntoResponse {
    let Some(bot) = resolve_bot(&state, &headers, &query) else {
        return (
            StatusCode::UNAUTHORIZED,
            Json(json!({ "error": "Sessão inválida" })),
        );
    };
    let action = body.get("action").and_then(|v| v.as_str()).unwrap_or("");
    let target_uid = body
        .get("targetUserId")
        .and_then(|v| v.as_str())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());

    if action == "add" {
        if let Some(ref id) = target_uid {
            {
                let mut f = bot.features.write();
                f.anti_call.targets.insert(id.clone());
                f.anti_call.enabled = true;
            }
            bot.resolve_user(id).await;
            bot.log(
                "coleira",
                format!(
                    "[ANTI-CALL] {} adicionado ao Kick Loop!",
                    bot.get_user_label(id)
                ),
            );
            if let Some(gid) = bot.resolve_target_guild_id(id) {
                bot.patch_guild_member_voice(
                    &gid,
                    id,
                    json!({ "channel_id": null }),
                    "ANTI-CALL",
                    false,
                )
                .await;
            }
        }
    } else if action == "remove" {
        if let Some(ref id) = target_uid {
            bot.features.write().anti_call.targets.remove(id);
        }
    } else if action == "clear" {
        let mut f = bot.features.write();
        f.anti_call.targets.clear();
        f.anti_call.enabled = false;
    }

    if let Some(e) = body.get("enabled").and_then(|v| v.as_bool()) {
        bot.features.write().anti_call.enabled = e;
    }
    bot.broadcast_state();
    (
        StatusCode::OK,
        Json(json!({ "ok": true, "state": bot.get_public_state() })),
    )
}

async fn post_feature_mute_lock(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<HashMap<String, String>>,
    Json(body): Json<Value>,
) -> impl IntoResponse {
    let Some(bot) = resolve_bot(&state, &headers, &query) else {
        return (
            StatusCode::UNAUTHORIZED,
            Json(json!({ "error": "Sessão inválida" })),
        );
    };
    {
        let mut f = bot.features.write();
        if let Some(v) = body.get("mute").and_then(|x| x.as_bool()) {
            f.mute_lock.mute = v;
        }
        if let Some(v) = body.get("deaf").and_then(|x| x.as_bool()) {
            f.mute_lock.deaf = v;
        }
        if let Some(v) = body.get("kickFallback").and_then(|x| x.as_bool()) {
            f.mute_lock.kick_fallback = v;
        }
    }

    let action = body.get("action").and_then(|v| v.as_str()).unwrap_or("");
    let target_uid = body
        .get("targetUserId")
        .and_then(|v| v.as_str())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());

    if action == "add" {
        if let Some(ref id) = target_uid {
            {
                let mut f = bot.features.write();
                f.mute_lock.targets.insert(id.clone());
                f.mute_lock.enabled = true;
            }
            bot.resolve_user(id).await;
            bot.log(
                "coleira",
                format!(
                    "[MUTE-LOCK] {} adicionado ao Mute-Lock.",
                    bot.get_user_label(id)
                ),
            );
            if let Some(gid) = bot.resolve_target_guild_id(id) {
                let cur_vs = bot
                    .voice_states
                    .read()
                    .get(&gid)
                    .and_then(|m| m.get(id))
                    .cloned();
                bot.enforce_mute_lock(&gid, id, cur_vs.as_ref()).await;
            }
        }
    } else if action == "remove" {
        if let Some(ref id) = target_uid {
            let mut f = bot.features.write();
            f.mute_lock.targets.remove(id);
            if f.mute_lock.targets.is_empty() {
                f.mute_lock.enabled = false;
            }
        }
    } else if action == "clear" {
        let mut f = bot.features.write();
        f.mute_lock.targets.clear();
        f.mute_lock.enabled = false;
    }

    if let Some(e) = body.get("enabled").and_then(|v| v.as_bool()) {
        bot.features.write().mute_lock.enabled = e;
    }
    bot.broadcast_state();
    (
        StatusCode::OK,
        Json(json!({ "ok": true, "state": bot.get_public_state() })),
    )
}

async fn post_feature_guard(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<HashMap<String, String>>,
    Json(body): Json<Value>,
) -> impl IntoResponse {
    let Some(bot) = resolve_bot(&state, &headers, &query) else {
        return (
            StatusCode::UNAUTHORIZED,
            Json(json!({ "error": "Sessão inválida" })),
        );
    };
    {
        let mut f = bot.features.write();
        if let Some(v) = body.get("antiMute").and_then(|x| x.as_bool()) {
            f.guard.anti_mute = v;
        }
        if let Some(v) = body.get("keepInMyCall").and_then(|x| x.as_bool()) {
            f.guard.keep_in_my_call = v;
        }
    }
    let action = body.get("action").and_then(|v| v.as_str()).unwrap_or("");
    let target_uid = body
        .get("targetUserId")
        .and_then(|v| v.as_str())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());

    if action == "add" {
        if let Some(ref id) = target_uid {
            {
                let mut f = bot.features.write();
                f.guard.targets.insert(id.clone());
                f.guard.enabled = true;
            }
            bot.resolve_user(id).await;
            bot.log(
                "guard",
                format!(
                    "[GUARD] Aliado {} sob proteção ativa!",
                    bot.get_user_label(id)
                ),
            );
        }
    } else if action == "remove" {
        if let Some(ref id) = target_uid {
            bot.features.write().guard.targets.remove(id);
        }
    } else if action == "clear" {
        let mut f = bot.features.write();
        f.guard.targets.clear();
        f.guard.enabled = false;
    }
    if let Some(e) = body.get("enabled").and_then(|v| v.as_bool()) {
        bot.features.write().guard.enabled = e;
    }
    bot.broadcast_state();
    (
        StatusCode::OK,
        Json(json!({ "ok": true, "state": bot.get_public_state() })),
    )
}

async fn post_feature_chaotic_mover(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<HashMap<String, String>>,
    Json(body): Json<Value>,
) -> impl IntoResponse {
    let Some(bot) = resolve_bot(&state, &headers, &query) else {
        return (
            StatusCode::UNAUTHORIZED,
            Json(json!({ "error": "Sessão inválida" })),
        );
    };
    {
        let mut f = bot.features.write();
        if let Some(t) = body.get("targetUserId").and_then(|v| v.as_str()) {
            f.chaotic_mover.target_user_id = t.trim().to_string();
        }
        if let Some(g) = body.get("guildId").and_then(|v| v.as_str()) {
            f.chaotic_mover.guild_id = g.trim().to_string();
        }
        if let Some(i) = body.get("intervalMs").and_then(|v| v.as_u64()) {
            f.chaotic_mover.interval_ms = i.max(600);
        }
        if let Some(e) = body.get("enabled").and_then(|v| v.as_bool()) {
            f.chaotic_mover.enabled = e;
        }
    }
    bot.update_chaotic_mover();
    bot.broadcast_state();
    (
        StatusCode::OK,
        Json(json!({ "ok": true, "state": bot.get_public_state() })),
    )
}

async fn post_presence(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<HashMap<String, String>>,
    Json(body): Json<Value>,
) -> impl IntoResponse {
    let Some(bot) = resolve_bot(&state, &headers, &query) else {
        return (
            StatusCode::UNAUTHORIZED,
            Json(json!({ "error": "Sessão inválida" })),
        );
    };
    {
        let mut p = bot.presence.write();
        if let Some(s) = body.get("status").and_then(|v| v.as_str()) {
            p.status = s.to_string();
        }
        if let Some(t) = body.get("activityType").and_then(|v| v.as_i64()) {
            p.activity_type = t as i32;
        }
        if let Some(n) = body.get("activityName").and_then(|v| v.as_str()) {
            p.activity_name = n.to_string();
        }
        if let Some(d) = body.get("activityDetails").and_then(|v| v.as_str()) {
            p.activity_details = d.to_string();
        }
        if let Some(st) = body.get("activityState").and_then(|v| v.as_str()) {
            p.activity_state = st.to_string();
        }
        if let Some(u) = body.get("streamUrl").and_then(|v| v.as_str()) {
            p.stream_url = u.to_string();
        }
        if let Some(c) = body.get("customStatus").and_then(|v| v.as_str()) {
            p.custom_status = c.to_string();
        }
    }
    let payload = bot.build_presence_payload();
    let sent = bot.send_op(3, payload);
    bot.broadcast_state();
    (
        StatusCode::OK,
        Json(json!({ "ok": sent, "state": bot.get_public_state() })),
    )
}

async fn post_feature_automation(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<HashMap<String, String>>,
    Json(body): Json<Value>,
) -> impl IntoResponse {
    let Some(bot) = resolve_bot(&state, &headers, &query) else {
        return (
            StatusCode::UNAUTHORIZED,
            Json(json!({ "error": "Sessão inválida" })),
        );
    };
    {
        let mut f = bot.features.write();
        if let Some(ar) = body.get("autoReply") {
            if let Some(v) = ar.get("enabled").and_then(|x| x.as_bool()) {
                f.auto_reply.enabled = v;
            }
            if let Some(v) = ar.get("message").and_then(|x| x.as_str()) {
                f.auto_reply.message = v.to_string();
            }
            if let Some(v) = ar.get("onlyDm").and_then(|x| x.as_bool()) {
                f.auto_reply.only_dm = v;
            }
            if let Some(v) = ar.get("onlyMention").and_then(|x| x.as_bool()) {
                f.auto_reply.only_mention = v;
            }
            if let Some(v) = ar.get("cooldownSec").and_then(|x| x.as_u64()) {
                f.auto_reply.cooldown_sec = v;
            }
            if let Some(tr) = ar.get("triggers").and_then(|x| x.as_object()) {
                f.auto_reply.triggers = tr
                    .iter()
                    .filter_map(|(k, v)| v.as_str().map(|s| (k.clone(), s.to_string())))
                    .collect();
            }
        }
        if let Some(ns) = body.get("nitroSniper") {
            if let Some(v) = ns.get("enabled").and_then(|x| x.as_bool()) {
                f.nitro_sniper.enabled = v;
            }
        }
    }
    bot.broadcast_state();
    (
        StatusCode::OK,
        Json(json!({ "ok": true, "state": bot.get_public_state() })),
    )
}

// ============================================================================
// Chat & Factory Routes
// ============================================================================

async fn post_ghost_ping(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<HashMap<String, String>>,
    Json(body): Json<Value>,
) -> impl IntoResponse {
    let Some(bot) = resolve_bot(&state, &headers, &query) else {
        return (
            StatusCode::UNAUTHORIZED,
            Json(json!({ "error": "Sessão inválida" })),
        );
    };
    let channel_id = body
        .get("channelId")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim();
    let target_uid = body
        .get("targetUserId")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim();
    let custom_text = body
        .get("customText")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim();

    if bot.token.read().is_none() || channel_id.is_empty() || target_uid.is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "channelId e targetUserId são obrigatórios" })),
        );
    }

    let content = if custom_text.is_empty() {
        format!("<@{}>", target_uid)
    } else {
        format!("{} <@{}>", custom_text, target_uid)
    };
    let nonce = generate_snowflake_nonce();
    let ctx = B64.encode(
        json!({ "location": "Chat", "location_guild_id": null, "location_channel_id": channel_id })
            .to_string()
            .as_bytes(),
    );

    let send_res = bot
        .request(
            "POST",
            &format!("/channels/{}/messages", channel_id),
            Some(json!({ "content": content, "nonce": nonce, "tts": false })),
            Some(&[("X-Context-Properties", &ctx)]),
            1,
        )
        .await;

    let Some(msg_id) = send_res.data.get("id").and_then(|v| v.as_str()) else {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": send_res.error.unwrap_or_else(|| "Falha ao enviar ghost ping".to_string()) })),
        );
    };

    sleep(Duration::from_millis(180)).await;
    bot.request(
        "DELETE",
        &format!("/channels/{}/messages/{}", channel_id, msg_id),
        None,
        None,
        1,
    )
    .await;

    bot.log(
        "success",
        format!(
            "[GHOST PING] Executado em {} no canal {}.",
            bot.get_user_label(target_uid),
            channel_id
        ),
    );
    bot.broadcast_state();
    (StatusCode::OK, Json(json!({ "ok": true })))
}

async fn post_chat_purge(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<HashMap<String, String>>,
    Json(body): Json<Value>,
) -> impl IntoResponse {
    let Some(bot) = resolve_bot(&state, &headers, &query) else {
        return (
            StatusCode::UNAUTHORIZED,
            Json(json!({ "error": "Sessão inválida" })),
        );
    };
    let raw_ch = body
        .get("channelId")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim()
        .to_string();
    let limit = body
        .get("limit")
        .and_then(|v| v.as_u64())
        .unwrap_or(25)
        .clamp(1, 200) as usize;

    let my_id = bot
        .user
        .read()
        .as_ref()
        .map(|u| u.id.clone())
        .unwrap_or_default();
    if bot.token.read().is_none() || my_id.is_empty() || raw_ch.is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "Conecte o selfbot e informe o channelId" })),
        );
    }

    let task_id = format!("purge-{}", now_ms());
    let cancelled = Arc::new(AtomicBool::new(false));
    let cancel_clone = Arc::clone(&cancelled);
    let bot_clone = Arc::clone(&bot);
    let tid_clone = task_id.clone();

    let handle = tokio::spawn(async move {
        let mut channel_id = raw_ch.clone();
        let dm_res = bot_clone
            .request(
                "POST",
                "/users/@me/channels",
                Some(json!({ "recipient_id": channel_id })),
                None,
                0,
            )
            .await;
        if dm_res.ok {
            if let Some(dm_id) = dm_res.data.get("id").and_then(|v| v.as_str()) {
                channel_id = dm_id.to_string();
            }
        }

        let mut deleted = 0usize;
        let mut before_id: Option<String> = None;

        while deleted < limit && !cancel_clone.load(Ordering::Relaxed) {
            let qs = match &before_id {
                Some(b) => format!("?limit=100&before={}", b),
                None => "?limit=100".to_string(),
            };
            let msg_res = bot_clone
                .request(
                    "GET",
                    &format!("/channels/{}/messages{}", channel_id, qs),
                    None,
                    None,
                    0,
                )
                .await;
            let Some(arr) = msg_res.data.as_array() else {
                break;
            };
            if arr.is_empty() {
                break;
            }
            before_id = arr
                .last()
                .and_then(|m| m.get("id"))
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());

            for m in arr {
                if deleted >= limit || cancel_clone.load(Ordering::Relaxed) {
                    break;
                }
                let author_id = m
                    .get("author")
                    .and_then(|a| a.get("id"))
                    .and_then(|v| v.as_str())
                    .unwrap_or("");
                if author_id != my_id {
                    continue;
                }
                if let Some(mid) = m.get("id").and_then(|v| v.as_str()) {
                    let del = bot_clone
                        .request(
                            "DELETE",
                            &format!("/channels/{}/messages/{}", channel_id, mid),
                            None,
                            None,
                            0,
                        )
                        .await;
                    if del.ok {
                        deleted += 1;
                        bot_clone.emit_delta(
                            "task_progress",
                            &json!({
                                "taskId": tid_clone,
                                "phase": "deleting",
                                "progress": deleted,
                                "total": limit,
                            }),
                        );
                    }
                    sleep(Duration::from_millis(850)).await;
                }
            }
            if arr.len() < 100 {
                break;
            }
        }
        bot_clone.active_tasks.lock().remove(&tid_clone);
    });

    bot.active_tasks.lock().insert(
        task_id.clone(),
        ActiveTask {
            id: task_id.clone(),
            kind: "purge".to_string(),
            cancelled,
            handle,
        },
    );

    (
        StatusCode::OK,
        Json(json!({
            "ok": true,
            "taskId": task_id,
            "message": format!("Purge iniciado para até {} mensagens", limit),
        })),
    )
}

async fn post_limpar_dm(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<HashMap<String, String>>,
    Json(body): Json<Value>,
) -> impl IntoResponse {
    let Some(bot) = resolve_bot(&state, &headers, &query) else {
        return (
            StatusCode::UNAUTHORIZED,
            Json(json!({ "error": "Sessão inválida" })),
        );
    };
    let target_id = body
        .get("targetId")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim()
        .to_string();
    let delay_ms = body
        .get("delayMs")
        .and_then(|v| v.as_u64())
        .unwrap_or(700)
        .max(300);

    let my_id = bot
        .user
        .read()
        .as_ref()
        .map(|u| u.id.clone())
        .unwrap_or_default();
    if bot.token.read().is_none() || my_id.is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "Conecte o selfbot primeiro" })),
        );
    }
    if target_id.is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "targetId obrigatório (User ID ou Channel ID de DM)" })),
        );
    }

    let mut channel_id = target_id.clone();
    let mut username = target_id.clone();
    let mut user_id: Option<String> = None;
    let mut avatar_url: Option<String> = None;

    let dm_res = bot
        .request(
            "POST",
            "/users/@me/channels",
            Some(json!({ "recipient_id": channel_id })),
            None,
            0,
        )
        .await;
    if dm_res.ok {
        if let Some(cid) = dm_res.data.get("id").and_then(|v| v.as_str()) {
            channel_id = cid.to_string();
        }
        if let Some(rec) = dm_res
            .data
            .get("recipients")
            .and_then(|v| v.as_array())
            .and_then(|a| a.first())
        {
            username = rec
                .get("global_name")
                .and_then(|v| v.as_str())
                .or_else(|| rec.get("username").and_then(|v| v.as_str()))
                .unwrap_or(&channel_id)
                .to_string();
            user_id = rec
                .get("id")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
            if let (Some(uid), Some(av)) = (
                user_id.as_deref(),
                rec.get("avatar").and_then(|v| v.as_str()),
            ) {
                avatar_url = Some(format!(
                    "https://cdn.discordapp.com/avatars/{}/{}.png?size=128",
                    uid, av
                ));
            }
        }
    }

    let task_id = format!("limpar-dm-{}", now_ms());
    let cancelled = Arc::new(AtomicBool::new(false));
    let cancel_c = Arc::clone(&cancelled);
    let bot_c = Arc::clone(&bot);
    let tid_c = task_id.clone();
    let ch_c = channel_id.clone();
    let uname_c = username.clone();
    let av_c = avatar_url.clone();

    let handle = tokio::spawn(async move {
        let mut msg_ids = Vec::new();
        let mut before_id: Option<String> = None;

        while !cancel_c.load(Ordering::Relaxed) {
            let qs = match &before_id {
                Some(b) => format!("?limit=100&before={}", b),
                None => "?limit=100".to_string(),
            };
            let msg_res = bot_c
                .request(
                    "GET",
                    &format!("/channels/{}/messages{}", ch_c, qs),
                    None,
                    None,
                    0,
                )
                .await;
            let Some(arr) = msg_res.data.as_array() else {
                break;
            };
            if arr.is_empty() {
                break;
            }
            before_id = arr
                .last()
                .and_then(|m| m.get("id"))
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
            for m in arr {
                let aid = m
                    .get("author")
                    .and_then(|a| a.get("id"))
                    .and_then(|v| v.as_str())
                    .unwrap_or("");
                if aid == my_id {
                    if let Some(mid) = m.get("id").and_then(|v| v.as_str()) {
                        msg_ids.push(mid.to_string());
                    }
                }
            }
            if arr.len() < 100 {
                break;
            }
        }

        let total = msg_ids.len();
        let mut deleted = 0usize;
        for mid in msg_ids {
            if cancel_c.load(Ordering::Relaxed) {
                break;
            }
            bot_c
                .request(
                    "DELETE",
                    &format!("/channels/{}/messages/{}", ch_c, mid),
                    None,
                    None,
                    0,
                )
                .await;
            deleted += 1;
            let payload = json!({
                "taskId": tid_c,
                "phase": "deleting",
                "progress": deleted,
                "total": total,
                "username": uname_c,
                "avatarUrl": av_c,
                "message": format!("{}/{} mensagens deletadas", deleted, total),
            });
            bot_c.emit_delta("limpar-dm", &payload);
            bot_c.emit_delta("task_progress", &payload);
            sleep(Duration::from_millis(delay_ms)).await;
        }
        bot_c.active_tasks.lock().remove(&tid_c);
    });

    bot.active_tasks.lock().insert(
        task_id.clone(),
        ActiveTask {
            id: task_id.clone(),
            kind: "limpar-dm".to_string(),
            cancelled,
            handle,
        },
    );

    (
        StatusCode::OK,
        Json(json!({
            "ok": true,
            "taskId": task_id,
            "username": username,
            "userId": user_id,
            "channelId": channel_id,
            "avatarUrl": avatar_url,
        })),
    )
}

async fn post_chat_send(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<HashMap<String, String>>,
    Json(body): Json<Value>,
) -> impl IntoResponse {
    let Some(bot) = resolve_bot(&state, &headers, &query) else {
        return (
            StatusCode::UNAUTHORIZED,
            Json(json!({ "error": "Sessão inválida" })),
        );
    };
    let channel_id = body
        .get("channelId")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim()
        .to_string();
    let content = body
        .get("content")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let count = body
        .get("count")
        .and_then(|v| v.as_u64())
        .unwrap_or(1)
        .clamp(1, 50) as usize;
    let delay_ms = body
        .get("delayMs")
        .and_then(|v| v.as_u64())
        .unwrap_or(1200)
        .max(400);

    if bot.token.read().is_none() || channel_id.is_empty() || content.is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "channelId e content são obrigatórios" })),
        );
    }

    let bot_c = Arc::clone(&bot);
    tokio::spawn(async move {
        for i in 0..count {
            let r = bot_c
                .request(
                    "POST",
                    &format!("/channels/{}/messages", channel_id),
                    Some(json!({
                        "content": content,
                        "nonce": format!("{}{}", now_ms(), i),
                        "tts": false,
                    })),
                    None,
                    1,
                )
                .await;
            if !r.ok {
                break;
            }
            if count > 1 && i + 1 < count {
                sleep(Duration::from_millis(delay_ms)).await;
            }
        }
    });

    (
        StatusCode::OK,
        Json(json!({ "ok": true, "queued": count })),
    )
}

async fn post_batch_invites(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<HashMap<String, String>>,
    Json(body): Json<Value>,
) -> impl IntoResponse {
    let Some(bot) = resolve_bot(&state, &headers, &query) else {
        return (
            StatusCode::UNAUTHORIZED,
            Json(json!({ "error": "Sessão inválida" })),
        );
    };
    let guild_id = body
        .get("guildId")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .or_else(|| bot.selected_guild_id.read().clone())
        .unwrap_or_default();
    let max_age = body.get("maxAge").and_then(|v| v.as_u64()).unwrap_or(0);
    let max_uses = body.get("maxUses").and_then(|v| v.as_u64()).unwrap_or(0);

    let mut target_channels: Vec<String> = body
        .get("channels")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|x| x.as_str().map(|s| s.to_string()))
                .collect()
        })
        .unwrap_or_default();

    if target_channels.is_empty() && !guild_id.is_empty() {
        if let Some(g) = bot.guilds.read().get(&guild_id) {
            target_channels = g
                .channels
                .values()
                .filter(|c| c.kind == 0 || c.kind == 2)
                .take(10)
                .map(|c| c.id.clone())
                .collect();
        }
    }

    if bot.token.read().is_none() || target_channels.is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "Selecione canais válidos para criar convites" })),
        );
    }

    let queued = target_channels.len();
    let bot_c = Arc::clone(&bot);
    tokio::spawn(async move {
        for ch_id in target_channels {
            let _ = bot_c
                .request(
                    "POST",
                    &format!("/channels/{}/invites", ch_id),
                    Some(json!({
                        "max_age": max_age,
                        "max_uses": max_uses,
                        "temporary": false,
                        "unique": true,
                    })),
                    None,
                    0,
                )
                .await;
            sleep(Duration::from_millis(750)).await;
        }
        bot_c.broadcast_state();
    });

    (
        StatusCode::OK,
        Json(json!({ "queued": queued, "message": "Criando convites em lote..." })),
    )
}

async fn post_batch_roles(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<HashMap<String, String>>,
    Json(body): Json<Value>,
) -> impl IntoResponse {
    let Some(bot) = resolve_bot(&state, &headers, &query) else {
        return (
            StatusCode::UNAUTHORIZED,
            Json(json!({ "error": "Sessão inválida" })),
        );
    };
    let guild_id = body
        .get("guildId")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .or_else(|| bot.selected_guild_id.read().clone())
        .unwrap_or_default();

    let mut payloads: Vec<Value> = body
        .get("roles")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();

    if payloads.is_empty() {
        if let Some(name) = body.get("name").and_then(|v| v.as_str()) {
            let qty = body
                .get("count")
                .and_then(|v| v.as_u64())
                .unwrap_or(1)
                .clamp(1, 50);
            let color = body
                .get("color")
                .and_then(|v| {
                    v.as_u64().or_else(|| {
                        v.as_str()
                            .and_then(|s| u64::from_str_radix(s.trim_start_matches('#'), 16).ok())
                    })
                })
                .unwrap_or(0);
            let perms = body
                .get("permissions")
                .and_then(|v| v.as_str())
                .unwrap_or("0");
            let hoist = body.get("hoist").and_then(|v| v.as_bool()).unwrap_or(false);

            for i in 0..qty {
                let rname = if qty > 1 {
                    format!("{} #{}", name, i + 1)
                } else {
                    name.to_string()
                };
                payloads.push(json!({
                    "name": rname,
                    "color": color,
                    "permissions": perms,
                    "hoist": hoist,
                    "mentionable": true,
                }));
            }
        }
    }

    if bot.token.read().is_none() || guild_id.is_empty() || payloads.is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "token, guildId e cargos são obrigatórios" })),
        );
    }

    let queued = payloads.len();
    let bot_c = Arc::clone(&bot);
    tokio::spawn(async move {
        for r in payloads {
            let _ = bot_c
                .request(
                    "POST",
                    &format!("/guilds/{}/roles", guild_id),
                    Some(r),
                    None,
                    0,
                )
                .await;
            sleep(Duration::from_millis(800)).await;
        }
        bot_c.select_guild(&guild_id).await;
    });

    (
        StatusCode::OK,
        Json(json!({ "queued": queued, "message": format!("Criando {} cargo(s)...", queued) })),
    )
}

async fn post_batch_channels(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<HashMap<String, String>>,
    Json(body): Json<Value>,
) -> impl IntoResponse {
    let Some(bot) = resolve_bot(&state, &headers, &query) else {
        return (
            StatusCode::UNAUTHORIZED,
            Json(json!({ "error": "Sessão inválida" })),
        );
    };
    let guild_id = body
        .get("guildId")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .or_else(|| bot.selected_guild_id.read().clone())
        .unwrap_or_default();

    let mut payloads: Vec<Value> = body
        .get("channels")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();

    if payloads.is_empty() {
        if let Some(name) = body.get("name").and_then(|v| v.as_str()) {
            let qty = body
                .get("count")
                .and_then(|v| v.as_u64())
                .unwrap_or(1)
                .clamp(1, 50);
            let kind = body.get("type").and_then(|v| v.as_i64()).unwrap_or(0);
            let parent_id = body.get("parentId").cloned().unwrap_or(Value::Null);

            for i in 0..qty {
                let cname = if qty > 1 {
                    format!("{}-{}", name, i + 1)
                } else {
                    name.to_string()
                };
                payloads.push(json!({
                    "name": cname,
                    "type": kind,
                    "topic": "",
                    "bitrate": 64000,
                    "user_limit": 0,
                    "nsfw": false,
                    "parent_id": parent_id,
                }));
            }
        }
    }

    if bot.token.read().is_none() || guild_id.is_empty() || payloads.is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "token, guildId e canais são obrigatórios" })),
        );
    }

    let queued = payloads.len();
    let bot_c = Arc::clone(&bot);
    tokio::spawn(async move {
        for ch in payloads {
            let _ = bot_c
                .request(
                    "POST",
                    &format!("/guilds/{}/channels", guild_id),
                    Some(ch),
                    None,
                    0,
                )
                .await;
            sleep(Duration::from_millis(800)).await;
        }
        bot_c.select_guild(&guild_id).await;
    });

    (
        StatusCode::OK,
        Json(json!({ "queued": queued, "message": format!("Criando {} canal(is)...", queued) })),
    )
}

async fn post_channel_nuke(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<HashMap<String, String>>,
    Json(body): Json<Value>,
) -> impl IntoResponse {
    let Some(bot) = resolve_bot(&state, &headers, &query) else {
        return (
            StatusCode::UNAUTHORIZED,
            Json(json!({ "error": "Sessão inválida" })),
        );
    };
    let Some(channel_id) = body
        .get("channelId")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
    else {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "channelId obrigatório" })),
        );
    };

    let ch_res = bot
        .request("GET", &format!("/channels/{}", channel_id), None, None, 0)
        .await;
    let Some(guild_id) = ch_res
        .data
        .get("guild_id")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
    else {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": ch_res.error.unwrap_or_else(|| "Canal não encontrado".to_string()) })),
        );
    };

    let create_res = bot
        .request(
            "POST",
            &format!("/guilds/{}/channels", guild_id),
            Some(json!({
                "name": ch_res.data.get("name").cloned().unwrap_or(json!("canal")),
                "type": ch_res.data.get("type").cloned().unwrap_or(json!(0)),
                "topic": ch_res.data.get("topic").cloned().unwrap_or(json!("")),
                "nsfw": ch_res.data.get("nsfw").and_then(|v| v.as_bool()).unwrap_or(false),
                "bitrate": ch_res.data.get("bitrate").and_then(|v| v.as_u64()).unwrap_or(64000),
                "user_limit": ch_res.data.get("user_limit").and_then(|v| v.as_u64()).unwrap_or(0),
                "rate_limit_per_user": ch_res.data.get("rate_limit_per_user").and_then(|v| v.as_u64()).unwrap_or(0),
                "position": ch_res.data.get("position").and_then(|v| v.as_i64()).unwrap_or(0),
                "parent_id": ch_res.data.get("parent_id").cloned().unwrap_or(Value::Null),
                "permission_overwrites": ch_res.data.get("permission_overwrites").cloned().unwrap_or(json!([])),
            })),
            None,
            0,
        )
        .await;

    let Some(new_id) = create_res
        .data
        .get("id")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
    else {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": create_res.error.unwrap_or_else(|| "Falha ao clonar canal".to_string()) })),
        );
    };

    bot.request(
        "DELETE",
        &format!("/channels/{}", channel_id),
        None,
        None,
        0,
    )
    .await;
    bot.select_guild(&guild_id).await;

    (
        StatusCode::OK,
        Json(json!({
            "ok": true,
            "newChannelId": new_id,
            "state": bot.get_public_state(),
        })),
    )
}

async fn post_task_cancel(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<HashMap<String, String>>,
    AxumPath(task_id): AxumPath<String>,
) -> impl IntoResponse {
    let Some(bot) = resolve_bot(&state, &headers, &query) else {
        return (
            StatusCode::UNAUTHORIZED,
            Json(json!({ "error": "Sessão inválida" })),
        );
    };
    let removed = bot.active_tasks.lock().remove(&task_id);
    if let Some(t) = removed {
        t.cancelled.store(true, Ordering::Relaxed);
        t.handle.abort();
        bot.emit_delta(
            "task_progress",
            &json!({
                "taskId": task_id,
                "phase": "cancelled",
                "message": "Operação cancelada pelo usuário.",
            }),
        );
        (
            StatusCode::OK,
            Json(json!({
                "ok": true,
                "taskId": task_id,
                "message": "Tarefa cancelada com sucesso",
            })),
        )
    } else {
        (
            StatusCode::NOT_FOUND,
            Json(json!({
                "ok": false,
                "error": "Tarefa não encontrada ou já finalizada",
            })),
        )
    }
}

async fn get_debug_permissions(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<HashMap<String, String>>,
    AxumPath(guild_id): AxumPath<String>,
) -> impl IntoResponse {
    let Some(bot) = resolve_bot(&state, &headers, &query) else {
        return (
            StatusCode::UNAUTHORIZED,
            Json(json!({ "error": "Sessão inválida" })),
        );
    };
    let Some(uid) = bot.user.read().as_ref().map(|u| u.id.clone()) else {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "ok": false, "error": "Selfbot não conectado" })),
        );
    };

    let member_res = bot
        .request(
            "GET",
            &format!("/guilds/{}/members/{}", guild_id, uid),
            None,
            None,
            0,
        )
        .await;
    let guild_res = bot
        .request("GET", &format!("/guilds/{}", guild_id), None, None, 0)
        .await;

    if !member_res.ok {
        return (
            StatusCode::OK,
            Json(json!({ "ok": false, "error": member_res.error })),
        );
    }

    let roles = guild_res
        .data
        .get("roles")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();
    let member_roles: Vec<String> = member_res
        .data
        .get("roles")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|x| x.as_str().map(|s| s.to_string()))
                .collect()
        })
        .unwrap_or_default();

    let mut perms: u128 = 0;
    for r in &roles {
        let rid = r.get("id").and_then(|v| v.as_str()).unwrap_or("");
        if rid == guild_id || member_roles.iter().any(|mr| mr == rid) {
            if let Some(p_str) = r.get("permissions").and_then(|v| v.as_str()) {
                if let Ok(p_val) = p_str.parse::<u128>() {
                    perms |= p_val;
                }
            }
        }
    }

    let is_admin = (perms & (1 << 3)) != 0;
    let can_mute = is_admin || (perms & (1 << 22)) != 0;
    let owner_id = guild_res.data.get("owner_id").and_then(|v| v.as_str());
    let is_owner = owner_id == Some(uid.as_str());

    (
        StatusCode::OK,
        Json(json!({
            "ok": true,
            "canMute": can_mute,
            "isAdmin": is_admin,
            "isOwner": is_owner,
            "perms": perms.to_string(),
            "guildOwnerId": owner_id,
        })),
    )
}

async fn post_logs_clear(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<HashMap<String, String>>,
) -> impl IntoResponse {
    let Some(bot) = resolve_bot(&state, &headers, &query) else {
        return (
            StatusCode::UNAUTHORIZED,
            Json(json!({ "error": "Sessão inválida" })),
        );
    };
    bot.logs.write().clear();
    bot.broadcast_state();
    (StatusCode::OK, Json(json!({ "ok": true })))
}

pub fn build_app(state: AppState) -> Router {
    let api_router = Router::new()
        .route("/panel/config", get(get_panel_config))
        .route("/panel/verify", post(post_panel_verify))
        .route("/state", get(get_state))
        .route("/events", get(get_events))
        .route("/auth", post(post_auth))
        .route("/disconnect", post(post_disconnect))
        .route("/tokens/scan", get(get_tokens_scan))
        .route("/guild/select", post(post_guild_select))
        .route("/voice/join", post(post_voice_join))
        .route("/voice/leave", post(post_voice_leave))
        .route("/voice/config", post(post_voice_config))
        .route("/voice/member-action", post(post_voice_member_action))
        .route("/voice/ipc-register", post(post_voice_ipc_register))
        .route("/voice/ipc-pending", get(get_voice_ipc_pending))
        .route("/voice/ipc-result", post(post_voice_ipc_result))
        .route("/voice/ipc-status", get(get_voice_ipc_status))
        .route("/features/anti-disconnect", post(post_feature_anti_disconnect))
        .route("/features/anti-mute", post(post_feature_anti_mute))
        .route("/features/follow", post(post_feature_follow))
        .route("/features/coleira", post(post_feature_coleira))
        .route("/features/anti-call", post(post_feature_anti_call))
        .route("/features/mute-lock", post(post_feature_mute_lock))
        .route("/features/guard", post(post_feature_guard))
        .route("/features/chaotic-mover", post(post_feature_chaotic_mover))
        .route("/presence", post(post_presence))
        .route("/features/presence", post(post_presence))
        .route("/features/automation", post(post_feature_automation))
        .route("/chat/ghost-ping", post(post_ghost_ping))
        .route("/chat/purge", post(post_chat_purge))
        .route("/limpar-dm", post(post_limpar_dm))
        .route("/chat/send", post(post_chat_send))
        .route("/batch/invites", post(post_batch_invites))
        .route("/batch/roles", post(post_batch_roles))
        .route("/batch/channels", post(post_batch_channels))
        .route("/channel/nuke", post(post_channel_nuke))
        .route("/tasks/:id/cancel", post(post_task_cancel))
        .route("/debug/permissions/:guildId", get(get_debug_permissions))
        .route("/logs/clear", post(post_logs_clear))
        .layer(middleware::from_fn_with_state(
            state.clone(),
            api_guard_middleware,
        ))
        .with_state(state.clone());

    let dist_dir = PathBuf::from("dist");
    let index_html = dist_dir.join("index.html");

    let mut app = Router::new().nest("/api", api_router);
    if dist_dir.exists() && index_html.exists() {
        let serve_dir = ServeDir::new(&dist_dir).not_found_service(ServeFile::new(&index_html));
        app = app.fallback_service(serve_dir);
    }

    app
}

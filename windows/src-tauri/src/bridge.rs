use axum::{
    body::Body,
    extract::State,
    http::{HeaderValue, Method, Request, StatusCode},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::{get, options, post},
    Json, Router,
};
use crate::{
    config::now_ms,
    ipc::{DiscordIpcBridge, IpcCommandResult},
};
use parking_lot::Mutex;
use serde_json::{json, Value};
use std::{
    collections::HashSet,
    env,
    net::SocketAddr,
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc,
    },
    time::Duration,
};
use tokio::{net::TcpListener, task::JoinHandle, time::sleep};

#[derive(Clone)]
struct BridgeState {
    ipc: Arc<DiscordIpcBridge>,
    http: reqwest::Client,
    remote_url: String,
    panel_pin: String,
    started_at: u64,
    cached_voice: Arc<Mutex<Option<Value>>>,
    last_voice_fetch_ts: Arc<AtomicU64>,
    subscribed_mode: Arc<Mutex<Option<String>>>,
    remote_anti_disconnect: Arc<Mutex<Option<Value>>>,
    local_reconnect_timer: Arc<Mutex<Option<JoinHandle<()>>>>,
    last_voice_select: Arc<Mutex<(Option<String>, u64)>>,
    executed_requests: Arc<Mutex<HashSet<String>>>,
    sync_in_flight: Arc<AtomicBool>,
    last_register_ts: Arc<AtomicU64>,
}

impl BridgeState {
    async fn ensure_voice_subscription(&self) -> bool {
        if !self.ipc.ensure_connected().await {
            *self.subscribed_mode.lock() = None;
            return false;
        }
        let mode = self.ipc.get_mode();
        let need_sub = {
            let mut guard = self.subscribed_mode.lock();
            if guard.as_deref() != Some(mode.as_str()) {
                *guard = Some(mode);
                true
            } else {
                false
            }
        };
        if need_sub {
            let _ = self.ipc.subscribe("VOICE_CHANNEL_SELECT", json!({})).await;
        }
        true
    }

    async fn get_current_desktop_voice(&self, force_refresh: bool) -> Option<Value> {
        if !self.ensure_voice_subscription().await {
            return None;
        }
        let now = now_ms();
        let last_ts = self.last_voice_fetch_ts.load(Ordering::Relaxed);
        if !force_refresh && last_ts > 0 && now.saturating_sub(last_ts) < 45_000 {
            return self.cached_voice.lock().clone();
        }

        let res = self
            .ipc
            .send_command("GET_SELECTED_VOICE_CHANNEL", json!({}), 2500)
            .await;
        self.last_voice_fetch_ts.store(now_ms(), Ordering::Relaxed);
        if res.ok {
            let vc = res.data.and_then(|d| {
                let id = d.get("id").and_then(|v| v.as_str())?;
                Some(json!({
                    "id": id,
                    "name": d.get("name").cloned().unwrap_or(Value::Null),
                    "guild_id": d.get("guild_id").cloned().unwrap_or(Value::Null),
                }))
            });
            *self.cached_voice.lock() = vc.clone();
            return vc;
        }
        self.cached_voice.lock().clone()
    }

    async fn execute_ipc_command(
        &self,
        cmd: &str,
        args: Value,
        access_token: Option<String>,
    ) -> IpcCommandResult {
        if let Some(tok) = access_token {
            if !tok.is_empty() && self.ipc.access_token.lock().is_none() {
                *self.ipc.access_token.lock() = Some(tok);
                *self.ipc.token_owner.lock() = Some("local".to_string());
            }
        }
        self.ensure_voice_subscription().await;

        if cmd == "SELECT_VOICE_CHANNEL" {
            let target_ch = args
                .get("channel_id")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
            let now = now_ms();
            {
                let mut guard = self.last_voice_select.lock();
                if guard.0 == target_ch && now.saturating_sub(guard.1) < 650 {
                    return IpcCommandResult::ok(Some(json!({ "id": target_ch })));
                }
                *guard = (target_ch.clone(), now);
            }
            let guild_id = self
                .cached_voice
                .lock()
                .as_ref()
                .and_then(|c| c.get("guild_id").cloned())
                .or_else(|| {
                    self.remote_anti_disconnect
                        .lock()
                        .as_ref()
                        .and_then(|a| a.get("guildId").cloned())
                })
                .unwrap_or(Value::Null);

            *self.cached_voice.lock() = target_ch.as_ref().map(|cid| {
                json!({
                    "id": cid,
                    "guild_id": guild_id,
                    "name": Value::Null,
                })
            });
            self.last_voice_fetch_ts.store(now, Ordering::Relaxed);
        }

        self.ipc.send_command(cmd, args, 3500).await
    }
}

async fn cors_middleware(req: Request<Body>, next: Next) -> Response {
    let origin = req
        .headers()
        .get("origin")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("*")
        .to_string();

    if req.method() == Method::OPTIONS {
        let mut res = StatusCode::NO_CONTENT.into_response();
        let h = res.headers_mut();
        if let Ok(v) = HeaderValue::from_str(&origin) {
            h.insert("Access-Control-Allow-Origin", v);
        }
        h.insert(
            "Access-Control-Allow-Methods",
            HeaderValue::from_static("GET, POST, OPTIONS"),
        );
        h.insert(
            "Access-Control-Allow-Headers",
            HeaderValue::from_static("Content-Type, Authorization, X-Session-Id"),
        );
        h.insert(
            "Access-Control-Allow-Private-Network",
            HeaderValue::from_static("true"),
        );
        return res;
    }

    let mut res = next.run(req).await;
    let h = res.headers_mut();
    if let Ok(v) = HeaderValue::from_str(&origin) {
        h.insert("Access-Control-Allow-Origin", v);
    }
    h.insert(
        "Access-Control-Allow-Methods",
        HeaderValue::from_static("GET, POST, OPTIONS"),
    );
    h.insert(
        "Access-Control-Allow-Headers",
        HeaderValue::from_static("Content-Type, Authorization, X-Session-Id"),
    );
    h.insert(
        "Access-Control-Allow-Private-Network",
        HeaderValue::from_static("true"),
    );
    res
}

async fn get_status(State(st): State<BridgeState>) -> impl IntoResponse {
    let connected = st.ensure_voice_subscription().await;
    let current_vc = if connected {
        st.get_current_desktop_voice(false).await
    } else {
        None
    };
    let user = st.ipc.remote_desktop_user.lock().clone();
    Json(json!({
        "ok": true,
        "connected": connected,
        "mode": st.ipc.get_mode(),
        "user": user,
        "currentVoiceChannel": current_vc,
    }))
}

async fn post_ipc(
    State(st): State<BridgeState>,
    Json(body): Json<Value>,
) -> impl IntoResponse {
    let Some(cmd) = body.get("cmd").and_then(|v| v.as_str()) else {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "ok": false, "error": "cmd obrigatório" })),
        );
    };
    let args = body.get("args").cloned().unwrap_or_else(|| json!({}));
    let access_token = body
        .get("accessToken")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    let out = st.execute_ipc_command(cmd, args, access_token).await;
    (
        StatusCode::OK,
        Json(serde_json::to_value(out).unwrap_or_else(|_| json!({ "ok": false }))),
    )
}

async fn handle_pending_list(st: &BridgeState, pending_list: Option<&Vec<Value>>) {
    let Some(list) = pending_list else {
        return;
    };
    for item in list {
        let Some(req_id) = item.get("requestId").and_then(|v| v.as_str()) else {
            continue;
        };
        {
            let mut exec = st.executed_requests.lock();
            if exec.contains(req_id) {
                continue;
            }
            if exec.len() > 250 {
                exec.clear();
            }
            exec.insert(req_id.to_string());
        }

        let cmd = item.get("cmd").and_then(|v| v.as_str()).unwrap_or("");
        let args = item.get("args").cloned().unwrap_or_else(|| json!({}));
        let created_at = item.get("createdAt").and_then(|v| v.as_u64()).unwrap_or(0);
        let now = now_ms();

        if (created_at > 0 && now.saturating_sub(created_at) > 3_500)
            || (cmd == "SELECT_VOICE_CHANNEL" && now.saturating_sub(st.started_at) < 5_000)
        {
            continue;
        }

        let access_token = item
            .get("accessToken")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());

        let out = st.execute_ipc_command(cmd, args.clone(), access_token).await;
        println!(
            "[BRIDGE] {} ({}) -> ok={}",
            cmd, args, out.ok
        );

        let mut req = st
            .http
            .post(format!("{}/api/voice/ipc-result", st.remote_url))
            .header("x-ipc-bridge", "1")
            .timeout(Duration::from_millis(3000));
        if !st.panel_pin.is_empty() {
            req = req.header("x-panel-pin", &st.panel_pin);
        }
        let _ = req
            .json(&json!({
                "requestId": req_id,
                "ok": out.ok,
                "data": out.data,
                "error": out.error,
                "code": out.code,
            }))
            .send()
            .await;
    }
}

async fn sync_with_remote_panel(st: &BridgeState) {
    if st
        .sync_in_flight
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        return;
    }

    let connected = st.ensure_voice_subscription().await;
    if connected {
        let now = now_ms();
        let last_reg = st.last_register_ts.load(Ordering::Relaxed);
        let user = st.ipc.remote_desktop_user.lock().clone();
        let user_id = user
            .as_ref()
            .and_then(|u| u.get("id"))
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();

        if now.saturating_sub(last_reg) > 12_000 {
            st.last_register_ts.store(now, Ordering::Relaxed);
            let cur_vc = st.get_current_desktop_voice(false).await;
            let mut req = st
                .http
                .post(format!("{}/api/voice/ipc-register", st.remote_url))
                .header("x-ipc-bridge", "1")
                .timeout(Duration::from_millis(3500));
            if !st.panel_pin.is_empty() {
                req = req.header("x-panel-pin", &st.panel_pin);
            }
            if let Ok(res) = req
                .json(&json!({
                    "user": user,
                    "userId": user_id,
                    "source": st.ipc.get_mode(),
                    "currentVoiceChannel": cur_vc,
                }))
                .send()
                .await
            {
                if res.status().is_success() {
                    if let Ok(data) = res.json::<Value>().await {
                        if let Some(tok) = data.get("accessToken").and_then(|v| v.as_str()) {
                            if !tok.is_empty() && st.ipc.access_token.lock().is_none() {
                                *st.ipc.access_token.lock() = Some(tok.to_string());
                                *st.ipc.token_owner.lock() = Some("local".to_string());
                            }
                        }
                        if let Some(ad) = data.get("antiDisconnect") {
                            *st.remote_anti_disconnect.lock() = if ad.is_null() {
                                None
                            } else {
                                Some(ad.clone())
                            };
                        }
                        handle_pending_list(st, data.get("pending").and_then(|v| v.as_array()))
                            .await;
                    }
                }
            }
        } else {
            let mut req = st
                .http
                .get(format!(
                    "{}/api/voice/ipc-pending?userId={}",
                    st.remote_url, user_id
                ))
                .header("x-ipc-bridge", "1")
                .timeout(Duration::from_millis(3000));
            if !st.panel_pin.is_empty() {
                req = req.header("x-panel-pin", &st.panel_pin);
            }
            if let Ok(res) = req.send().await {
                if res.status().is_success() {
                    if let Ok(data) = res.json::<Value>().await {
                        if let Some(tok) = data.get("accessToken").and_then(|v| v.as_str()) {
                            if !tok.is_empty() && st.ipc.access_token.lock().is_none() {
                                *st.ipc.access_token.lock() = Some(tok.to_string());
                                *st.ipc.token_owner.lock() = Some("local".to_string());
                            }
                        }
                        if let Some(ad) = data.get("antiDisconnect") {
                            *st.remote_anti_disconnect.lock() = if ad.is_null() {
                                None
                            } else {
                                Some(ad.clone())
                            };
                        }
                        handle_pending_list(st, data.get("pending").and_then(|v| v.as_array()))
                            .await;
                    }
                }
            }
        }
    }

    st.sync_in_flight.store(false, Ordering::SeqCst);
}

pub async fn run_server() {
    let port: u16 = env::var("IPC_BRIDGE_PORT")
        .ok()
        .and_then(|p| p.parse().ok())
        .unwrap_or(6473);
    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    let Ok(listener) = TcpListener::bind(addr).await else {
        println!(
            "[BRIDGE] Já existe uma instância ativa em http://127.0.0.1:{}. Encerrando.",
            port
        );
        return;
    };

    let remote_url = env::var("REMOTE_PANEL_URL")
        .unwrap_or_else(|_| "https://discord-fabrica-production.up.railway.app".to_string())
        .trim_end_matches('/')
        .to_string();
    let panel_pin = env::var("PANEL_PIN").unwrap_or_default();

    let http = reqwest::Client::builder()
        .pool_max_idle_per_host(8)
        .build()
        .unwrap_or_default();
    let ipc = DiscordIpcBridge::new(http.clone());

    let state = BridgeState {
        ipc: Arc::clone(&ipc),
        http,
        remote_url,
        panel_pin,
        started_at: now_ms(),
        cached_voice: Arc::new(Mutex::new(None)),
        last_voice_fetch_ts: Arc::new(AtomicU64::new(0)),
        subscribed_mode: Arc::new(Mutex::new(None)),
        remote_anti_disconnect: Arc::new(Mutex::new(None)),
        local_reconnect_timer: Arc::new(Mutex::new(None)),
        last_voice_select: Arc::new(Mutex::new((None, 0))),
        executed_requests: Arc::new(Mutex::new(HashSet::new())),
        sync_in_flight: Arc::new(AtomicBool::new(false)),
        last_register_ts: Arc::new(AtomicU64::new(0)),
    };

    let st_dispatch = state.clone();
    *ipc.on_dispatch.lock() = Some(Arc::new(move |evt, data| {
        if evt != "VOICE_CHANNEL_SELECT" {
            return;
        }
        let ch_id = data
            .get("channel_id")
            .and_then(|v| v.as_str())
            .filter(|s| !s.is_empty())
            .map(|s| s.to_string());
        let g_id = data
            .get("guild_id")
            .and_then(|v| v.as_str())
            .filter(|s| !s.is_empty())
            .map(|s| s.to_string());

        *st_dispatch.cached_voice.lock() = ch_id.as_ref().map(|cid| {
            json!({
                "id": cid,
                "guild_id": g_id,
                "name": Value::Null,
            })
        });
        st_dispatch
            .last_voice_fetch_ts
            .store(now_ms(), Ordering::Relaxed);
        st_dispatch.last_register_ts.store(0, Ordering::Relaxed);

        if now_ms().saturating_sub(st_dispatch.started_at) < 5_000 {
            return;
        }

        let ad_opt = st_dispatch.remote_anti_disconnect.lock().clone();
        if let Some(ad) = ad_opt {
            let enabled = ad.get("enabled").and_then(|v| v.as_bool()).unwrap_or(false);
            let lock_ch = ad
                .get("channelId")
                .and_then(|v| v.as_str())
                .filter(|s| !s.is_empty())
                .map(|s| s.to_string());
            let rejoin_move = ad
                .get("rejoinOnMove")
                .and_then(|v| v.as_bool())
                .unwrap_or(true);
            let delay_ms = ad
                .get("delayMs")
                .and_then(|v| v.as_u64())
                .unwrap_or(60)
                .clamp(15, 250);

            if enabled {
                if let Some(target_ch) = lock_ch {
                    let was_disconnected = ch_id.is_none();
                    let was_moved = ch_id
                        .as_ref()
                        .map(|c| c != &target_ch && rejoin_move)
                        .unwrap_or(false);

                    if was_disconnected || was_moved {
                        if let Some(old) = st_dispatch.local_reconnect_timer.lock().take() {
                            old.abort();
                        }
                        let st_inner = st_dispatch.clone();
                        let h = tokio::spawn(async move {
                            sleep(Duration::from_millis(delay_ms)).await;
                            let cur_id = st_inner
                                .cached_voice
                                .lock()
                                .as_ref()
                                .and_then(|c| c.get("id"))
                                .and_then(|v| v.as_str())
                                .map(|s| s.to_string());
                            if cur_id.as_deref() == Some(target_ch.as_str()) {
                                return;
                            }
                            let out = st_inner
                                .execute_ipc_command(
                                    "SELECT_VOICE_CHANNEL",
                                    json!({ "channel_id": target_ch, "force": true }),
                                    None,
                                )
                                .await;
                            println!(
                                "[BRIDGE] Anti-Disconnect -> canal {} (ok={})",
                                target_ch, out.ok
                            );
                        });
                        *st_dispatch.local_reconnect_timer.lock() = Some(h);
                    }
                }
            }
        }
    }));

    println!("[BRIDGE] Ativo em http://127.0.0.1:{}", port);
    if state.ensure_voice_subscription().await {
        let uname = state
            .ipc
            .remote_desktop_user
            .lock()
            .as_ref()
            .and_then(|u| u.get("username"))
            .and_then(|v| v.as_str())
            .unwrap_or("usuário local")
            .to_string();
        println!("[BRIDGE] Discord Desktop conectado como {}", uname);
    } else {
        println!("[BRIDGE] Aguardando Discord Desktop...");
    }

    let st_loop = state.clone();
    tokio::spawn(async move {
        loop {
            sync_with_remote_panel(&st_loop).await;
            sleep(Duration::from_millis(900)).await;
        }
    });

    let app = Router::new()
        .route("/status", get(get_status))
        .route("/status", options(|| async { StatusCode::NO_CONTENT }))
        .route("/ipc", post(post_ipc))
        .route("/ipc", options(|| async { StatusCode::NO_CONTENT }))
        .route("/command", post(post_ipc))
        .route("/command", options(|| async { StatusCode::NO_CONTENT }))
        .layer(middleware::from_fn(cors_middleware))
        .with_state(state);

    axum::serve(listener, app).await.ok();
}

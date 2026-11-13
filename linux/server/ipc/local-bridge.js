import http from 'node:http';
import { DiscordIpcBridge } from './DiscordIpcBridge.js';

const BRIDGE_PORT = Number(process.env.IPC_BRIDGE_PORT) || 6473;
const REMOTE_URL = (
  process.env.REMOTE_PANEL_URL || 'https://discord-fabrica-production.up.railway.app'
).replace(/\/+$/, '');
const PANEL_PIN = process.env.PANEL_PIN || '';

const ipc = new DiscordIpcBridge(null);
const executedRequests = new Set();

let cachedVoiceChannel = null;
let lastVoiceFetchTs = 0;
let subscribedPipeKey = null;
let remoteAntiDisconnect = null;
let localReconnectTimer = null;
let lastVoiceSelect = { channelId: undefined, ts: 0 };
let syncInFlight = false;
let lastRegisterTs = 0;

function setCorsHeaders(req, res) {
  const origin = req.headers.origin || '*';
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Session-Id');
  res.setHeader('Access-Control-Allow-Private-Network', 'true');
}

async function ensureVoiceSubscription() {
  const ready = await ipc.ensureConnected();
  if (!ready) {
    subscribedPipeKey = null;
    return false;
  }
  const modeKey = ipc.getMode();
  if (subscribedPipeKey !== modeKey) {
    subscribedPipeKey = modeKey;
    await ipc.subscribe('VOICE_CHANNEL_SELECT');
  }
  return true;
}

ipc.onDispatch = (evt, data) => {
  if (evt !== 'VOICE_CHANNEL_SELECT') return;
  const channelId = data?.channel_id ? String(data.channel_id) : null;
  const guildId = data?.guild_id ? String(data.guild_id) : null;

  cachedVoiceChannel = channelId
    ? { id: channelId, guild_id: guildId, name: null }
    : null;
  lastVoiceFetchTs = Date.now();
  // Força próximo ciclo a sincronizar estado atualizado com o painel remoto
  lastRegisterTs = 0;

  if (remoteAntiDisconnect?.enabled && remoteAntiDisconnect?.channelId) {
    const lockCh = String(remoteAntiDisconnect.channelId);
    const wasDisconnected = !channelId;
    const wasMoved =
      Boolean(channelId) &&
      channelId !== lockCh &&
      remoteAntiDisconnect.rejoinOnMove !== false;

    if (wasDisconnected || wasMoved) {
      const waitMs = Math.min(250, Math.max(15, Number(remoteAntiDisconnect.delayMs) || 60));
      if (localReconnectTimer) clearTimeout(localReconnectTimer);
      localReconnectTimer = setTimeout(async () => {
        localReconnectTimer = null;
        if (!remoteAntiDisconnect?.enabled || !remoteAntiDisconnect?.channelId) return;
        const targetCh = String(remoteAntiDisconnect.channelId);
        if (cachedVoiceChannel?.id === targetCh) return;
        const out = await executeIpcCommand('SELECT_VOICE_CHANNEL', {
          channel_id: targetCh,
          force: true,
        });
        console.log(
          `[PC BRIDGE] Anti-Disconnect Local Instantâneo -> canal ${targetCh} (ok=${out.ok})`
        );
      }, waitMs);
    }
  }
};

async function getCurrentDesktopVoice(forceRefresh = false) {
  const ready = await ensureVoiceSubscription();
  if (!ready) return null;

  const now = Date.now();
  if (!forceRefresh && lastVoiceFetchTs > 0 && now - lastVoiceFetchTs < 45000) {
    return cachedVoiceChannel;
  }

  const res = await ipc.sendCommand('GET_SELECTED_VOICE_CHANNEL', {}, 2500);
  lastVoiceFetchTs = Date.now();
  if (res.ok) {
    cachedVoiceChannel = res.data?.id
      ? {
          id: String(res.data.id),
          name: res.data.name || null,
          guild_id: res.data.guild_id ? String(res.data.guild_id) : null,
        }
      : null;
  }
  return cachedVoiceChannel;
}

async function executeIpcCommand(cmd, args = {}, accessToken = null) {
  if (accessToken && !ipc.accessToken) {
    ipc.accessToken = accessToken;
    ipc.tokenOwner = 'local';
  }
  await ensureVoiceSubscription();

  if (cmd === 'SELECT_VOICE_CHANNEL') {
    const targetCh = args?.channel_id ? String(args.channel_id) : null;
    const now = Date.now();
    if (lastVoiceSelect.channelId === targetCh && now - lastVoiceSelect.ts < 650) {
      return { ok: true, deduplicated: true, data: { id: targetCh } };
    }
    lastVoiceSelect = { channelId: targetCh, ts: now };
    cachedVoiceChannel = targetCh
      ? {
          id: targetCh,
          guild_id: cachedVoiceChannel?.guild_id || remoteAntiDisconnect?.guildId || null,
          name: cachedVoiceChannel?.name || null,
        }
      : null;
    lastVoiceFetchTs = now;
  }

  return ipc.sendCommand(cmd, args, 3500);
}

const server = http.createServer(async (req, res) => {
  setCorsHeaders(req, res);

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method === 'GET' && req.url === '/status') {
    const connected = await ipc.ensureConnected();
    const currentVoiceChannel = connected ? await getCurrentDesktopVoice() : null;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        ok: true,
        connected,
        mode: ipc.getMode(),
        user: ipc.remoteDesktopUser,
        currentVoiceChannel,
      })
    );
    return;
  }

  if (req.method === 'POST' && req.url === '/ipc') {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', async () => {
      try {
        const parsed = JSON.parse(body || '{}');
        const { cmd, args, accessToken } = parsed;
        if (!cmd) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'cmd obrigatório' }));
          return;
        }
        const out = await executeIpcCommand(cmd, args || {}, accessToken || null);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(out));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: err.message }));
      }
    });
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found' }));
});

async function handlePendingList(pendingList, remoteHeaders) {
  if (!Array.isArray(pendingList) || pendingList.length === 0) return;

  for (const item of pendingList) {
    if (!item?.requestId || executedRequests.has(item.requestId)) continue;
    executedRequests.add(item.requestId);
    if (executedRequests.size > 200) {
      const first = executedRequests.values().next().value;
      executedRequests.delete(first);
    }

    const out = await executeIpcCommand(item.cmd, item.args || {}, item.accessToken || null);
    console.log(
      `[PC BRIDGE] Comando executado: ${item.cmd} (${JSON.stringify(item.args || {})}) -> ok=${out.ok}`
    );

    try {
      await fetch(`${REMOTE_URL}/api/voice/ipc-result`, {
        method: 'POST',
        headers: remoteHeaders,
        body: JSON.stringify({
          requestId: item.requestId,
          ok: Boolean(out.ok),
          data: out.data,
          error: out.error,
          code: out.code,
        }),
      });
    } catch {}
  }
}

async function syncWithRemotePanel() {
  if (syncInFlight) return;
  syncInFlight = true;
  try {
    const connected = await ensureVoiceSubscription();
    if (!connected) return;

    const remoteHeaders = {
      'Content-Type': 'application/json',
      'x-ipc-bridge': '1',
      ...(PANEL_PIN ? { 'x-panel-pin': PANEL_PIN } : {}),
    };

    const now = Date.now();
    const userId = ipc.remoteDesktopUser?.id || '';

    if (now - lastRegisterTs > 12000) {
      lastRegisterTs = now;
      const currentVoiceChannel = await getCurrentDesktopVoice();
      const res = await fetch(`${REMOTE_URL}/api/voice/ipc-register`, {
        method: 'POST',
        headers: remoteHeaders,
        body: JSON.stringify({
          user: ipc.remoteDesktopUser,
          userId,
          source: ipc.getMode(),
          currentVoiceChannel,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.accessToken && !ipc.accessToken) {
          ipc.accessToken = data.accessToken;
          ipc.tokenOwner = 'local';
        }
        if ('antiDisconnect' in data) {
          remoteAntiDisconnect = data.antiDisconnect;
        }
        await handlePendingList(data.pending, remoteHeaders);
      }
    } else {
      const res = await fetch(
        `${REMOTE_URL}/api/voice/ipc-pending?userId=${encodeURIComponent(userId)}`,
        {
          method: 'GET',
          headers: remoteHeaders,
        }
      );
      if (res.ok) {
        const data = await res.json();
        if (data.accessToken && !ipc.accessToken) {
          ipc.accessToken = data.accessToken;
          ipc.tokenOwner = 'local';
        }
        if ('antiDisconnect' in data) {
          remoteAntiDisconnect = data.antiDisconnect;
        }
        await handlePendingList(data.pending, remoteHeaders);
      }
    }
  } catch {} finally {
    syncInFlight = false;
  }
}

server.listen(BRIDGE_PORT, '127.0.0.1', async () => {
  console.log(`[PC BRIDGE] Servidor local ativo em http://127.0.0.1:${BRIDGE_PORT}`);
  const ok = await ensureVoiceSubscription();
  if (ok) {
    console.log(
      `[PC BRIDGE] Conectado ao Discord Desktop (${ipc.getMode()}) como ${ipc.remoteDesktopUser?.username || 'usuário local'}`
    );
  } else {
    console.log('[PC BRIDGE] Aguardando Discord Desktop abrir...');
  }

  await syncWithRemotePanel();
  setInterval(syncWithRemotePanel, 350);
});


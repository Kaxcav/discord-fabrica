import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import os from 'os';
import net from 'net';
import { fileURLToPath } from 'url';
import WebSocket from 'ws';
import { execSync } from 'child_process';
import crypto from 'crypto';

const STREAMKIT_CLIENT_ID = '207646673902501888';
const STREAMKIT_SCOPES = 'rpc%20rpc.voice.write%20rpc.voice.read';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '5mb' }));

const DISCORD_API = 'https://discord.com/api/v10';
const DISCORD_GW = 'wss://gateway.discord.gg/?v=10&encoding=json';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const SUPER_PROPS_OBJ = {
  os: 'Windows',
  browser: 'Chrome',
  device: '',
  system_locale: 'pt-BR',
  browser_user_agent: UA,
  browser_version: '131.0.0.0',
  os_version: '10',
  referrer: '',
  referring_domain: '',
  referrer_current: '',
  referring_domain_current: '',
  release_channel: 'stable',
  client_build_number: 346892,
  client_event_source: null,
  design_id: 0,
};

const X_SUPER_PROPERTIES = Buffer.from(JSON.stringify(SUPER_PROPS_OBJ)).toString('base64');

function formatToken(raw) {
  if (!raw) return '';
  return String(raw).trim().replace(/^["']|["']$/g, '').trim();
}

function buildHeaders(token, extra = {}) {
  const cleanToken = formatToken(token);
  const headers = {
    Authorization: cleanToken,
    'User-Agent': UA,
    'Content-Type': 'application/json',
    Accept: '*/*',
    'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
    'X-Discord-Locale': 'pt-BR',
    'X-Discord-Timezone': 'America/Sao_Paulo',
    Origin: 'https://discord.com',
    Referer: 'https://discord.com/channels/@me',
    ...extra,
  };
  if (!cleanToken.toLowerCase().startsWith('bot ')) {
    headers['X-Super-Properties'] = X_SUPER_PROPERTIES;
  }
  return headers;
}

const delay = (ms) => new Promise((res) => setTimeout(res, ms));

async function discordRequest(token, method, endpoint, body = undefined, retries = 3, extraHeaders = {}) {
  const url = endpoint.startsWith('http') ? endpoint : `${DISCORD_API}${endpoint}`;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const options = {
        method,
        headers: buildHeaders(token, extraHeaders),
      };
      if (body !== undefined && method !== 'GET' && method !== 'HEAD') {
        options.body = JSON.stringify(body);
      }

      const res = await fetch(url, options);

      if (res.status === 204) {
        return { ok: true, status: 204, data: null };
      }

      const data = await res.json().catch(() => ({}));

      if (res.status === 429 && attempt < retries) {
        const retryAfter = Number(data.retry_after || 1.5);
        const waitMs = Math.ceil(retryAfter * 1000) + Math.floor(Math.random() * 250 + 100);
        await delay(waitMs);
        continue;
      }

      return {
        ok: res.ok,
        status: res.status,
        data,
        error: !res.ok ? data.message || `HTTP ${res.status}` : null,
      };
    } catch (err) {
      if (attempt === retries) {
        return { ok: false, status: 500, data: null, error: err.message || String(err) };
      }
      await delay(500 * (attempt + 1));
    }
  }
  return { ok: false, status: 429, data: null, error: 'Rate limit excedido após retentativas' };
}

class SelfbotEngine {
  constructor() {
    this.token = '';
    this.ws = null;
    this.status = 'disconnected'; // disconnected | connecting | connected | reconnecting | error
    this.lastError = null;
    this.connectedAt = null;
    this.ping = 0;
    this.lastHeartbeatSent = 0;

    this.user = null;
    this.sessionId = null;
    this.resumeGatewayUrl = null;
    this.seq = null;

    this.heartbeatTimer = null;
    this.watchdogTimer = null;
    this.chaoticTimer = null;
    this.reconnectTimer = null;
    this.shouldReconnect = false;

    this.guilds = new Map();
    this.voiceStates = new Map(); // guildId -> Map<userId, voiceState>
    this.userVoiceMap = new Map(); // userId -> { guildId, channelId }
    this.usersCache = new Map(); // userId -> { id, username, global_name, avatar }
    this.selectedGuildId = null;

    this.currentVoice = {
      guildId: null,
      channelId: null,
      selfMute: false,
      selfDeaf: false,
      mute: false,
      deaf: false,
      selfVideo: false,
      selfStream: false,
    };

    this.voiceConfig = {
      selfMute: false,
      selfDeaf: false,
      selfVideo: false,
      fakeStream: false,
      useIpcForAutoVoice: false,
    };

    this.features = {
      antiDisconnect: {
        enabled: false,
        guildId: null,
        channelId: null,
        delayMs: 150,
        rejoinOnMove: true,
      },
      antiMute: {
        enabled: false,
        unmute: true,
        undeaf: true,
      },
      followCall: {
        enabled: false,
        targetUserId: '',
        delayMs: 250,
        leaveWhenTargetLeaves: false,
        syncAntiDisconnect: true,
      },
      coleira: {
        enabled: false,
        targets: new Set(),
        anchorGuildId: null,
        anchorChannelId: null,
        followSelfMove: true,
        forceServerMute: false,
        forceServerDeaf: false,
      },
      antiCall: {
        enabled: false,
        targets: new Set(),
      },
      muteLock: {
        enabled: false,
        targets: new Set(),
        mute: true,
        deaf: true,
      },
      guard: {
        enabled: false,
        targets: new Set(),
        antiMute: true,
        keepInMyCall: true,
      },
      chaoticMover: {
        enabled: false,
        targetUserId: '',
        guildId: '',
        intervalMs: 1200,
      },
      autoReply: {
        enabled: false,
        onlyDm: false,
        onlyMention: true,
        message: 'Estou ocupado no momento, já respondo.',
        cooldownSec: 15,
        triggers: {}, // keyword -> response
      },
      nitroSniper: {
        enabled: false,
      },
    };

    this.presence = {
      status: 'online',
      activityType: 0,
      activityName: '',
      activityDetails: '',
      activityState: '',
      streamUrl: 'https://twitch.tv/discord',
      customStatus: '',
    };

    this.stats = {
      antiDisconnectTriggers: 0,
      antiMuteTriggers: 0,
      coleiraPulls: 0,
      followMoves: 0,
      antiCallKicks: 0,
      guardActions: 0,
      nitroSniped: 0,
    };

    this.logs = [];
    this.sseClients = new Set();
    this.inFlightMemberOps = new Map();
    this.autoReplyCooldowns = new Map();
    this._ignoreAntiDisconnectUntil = 0;
    this._lastVoiceJoinAttempt = { guildId: null, channelId: null, ts: 0 };

    // Ponte IPC com o Discord Desktop local (Discord.exe) para mover sua call real no PC
    this.ipc = {
      connected: false,
      authenticated: false,
      pipeIndex: null,
      accessToken: null,
      tokenOwner: null,
      socket: null,
      pending: new Map(),
      connectPromise: null,
    };
  }

  async getRpcAccessToken(forceRefresh = false) {
    if (!this.token) return null;
    if (!forceRefresh && this.ipc.accessToken && this.ipc.tokenOwner === this.token) {
      return this.ipc.accessToken;
    }

    const res = await discordRequest(
      this.token,
      'POST',
      `/oauth2/authorize?client_id=${STREAMKIT_CLIENT_ID}&response_type=token&scope=${STREAMKIT_SCOPES}`,
      { authorize: true, permissions: '0' },
      2
    );

    const loc = res.data?.location || '';
    const match = loc.match(/access_token=([^&]+)/);
    if (!match) {
      throw new Error(res.error || 'Não foi possível autorizar RPC local para controle do Discord Desktop');
    }

    this.ipc.accessToken = match[1];
    this.ipc.tokenOwner = this.token;
    return this.ipc.accessToken;
  }

  closeIpc() {
    if (this.ipc.socket) {
      try {
        this.ipc.socket.removeAllListeners();
        this.ipc.socket.destroy();
      } catch {}
    }
    this.ipc.socket = null;
    this.ipc.connected = false;
    this.ipc.authenticated = false;
    this.ipc.pipeIndex = null;
    for (const [, p] of this.ipc.pending) {
      clearTimeout(p.timer);
      p.resolve({ ok: false, error: 'IPC fechado' });
    }
    this.ipc.pending.clear();
  }

  _writeIpcFrame(op, payload) {
    if (!this.ipc.socket || this.ipc.socket.destroyed) return false;
    const data = Buffer.from(JSON.stringify(payload), 'utf8');
    const header = Buffer.alloc(8);
    header.writeInt32LE(op, 0);
    header.writeInt32LE(data.length, 4);
    this.ipc.socket.write(Buffer.concat([header, data]));
    return true;
  }

  _sendRawIpcRequest(cmd, args = {}, timeoutMs = 4000) {
    return new Promise((resolve) => {
      if (!this.ipc.socket || this.ipc.socket.destroyed) {
        return resolve({ ok: false, error: 'Socket IPC desconectado' });
      }
      const nonce = crypto.randomUUID();
      const timer = setTimeout(() => {
        this.ipc.pending.delete(nonce);
        resolve({ ok: false, error: `Timeout IPC em ${cmd}` });
      }, timeoutMs);

      this.ipc.pending.set(nonce, { resolve, timer });
      this._writeIpcFrame(1, { cmd, args, nonce });
    });
  }

  async ensureIpcConnected() {
    if (!this.token) return false;
    if (this.ipc.socket && !this.ipc.socket.destroyed && this.ipc.authenticated) {
      return true;
    }
    if (this.ipc.connectPromise) {
      return this.ipc.connectPromise;
    }

    this.ipc.connectPromise = (async () => {
      this.closeIpc();
      for (let i = 0; i <= 9; i++) {
        const pipePath = `\\\\?\\pipe\\discord-ipc-${i}`;
        const connectedSocket = await new Promise((resolve) => {
          let settled = false;
          const sock = net.createConnection(pipePath);
          const timer = setTimeout(() => {
            if (!settled) {
              settled = true;
              sock.destroy();
              resolve(null);
            }
          }, 800);

          sock.once('connect', () => {
            if (!settled) {
              settled = true;
              clearTimeout(timer);
              resolve(sock);
            }
          });

          sock.once('error', () => {
            if (!settled) {
              settled = true;
              clearTimeout(timer);
              sock.destroy();
              resolve(null);
            }
          });
        });

        if (!connectedSocket) continue;

        this.ipc.socket = connectedSocket;
        this.ipc.connected = true;
        this.ipc.pipeIndex = i;

        let rxBuf = Buffer.alloc(0);
        let readyResolve = null;
        const readyPromise = new Promise((r) => {
          readyResolve = r;
        });

        connectedSocket.on('data', (chunk) => {
          rxBuf = Buffer.concat([rxBuf, chunk]);
          while (rxBuf.length >= 8) {
            const op = rxBuf.readInt32LE(0);
            const len = rxBuf.readInt32LE(4);
            if (rxBuf.length < 8 + len) break;
            const jsonStr = rxBuf.slice(8, 8 + len).toString('utf8');
            rxBuf = rxBuf.slice(8 + len);
            try {
              const msg = JSON.parse(jsonStr);
              if (op === 1 && msg.cmd === 'DISPATCH' && msg.evt === 'READY') {
                if (readyResolve) {
                  readyResolve(msg);
                  readyResolve = null;
                }
              } else if (msg.nonce && this.ipc.pending.has(msg.nonce)) {
                const entry = this.ipc.pending.get(msg.nonce);
                this.ipc.pending.delete(msg.nonce);
                clearTimeout(entry.timer);
                if (msg.evt === 'ERROR') {
                  entry.resolve({
                    ok: false,
                    error: msg.data?.message || 'Erro IPC',
                    code: msg.data?.code,
                  });
                } else {
                  entry.resolve({ ok: true, data: msg.data });
                }
              }
            } catch {}
          }
        });

        connectedSocket.on('close', () => {
          const wasAuth = this.ipc.authenticated;
          this.closeIpc();
          if (wasAuth) {
            this.broadcastState();
          }
        });

        connectedSocket.on('error', () => {
          this.closeIpc();
        });

        // 1. Handshake (op 0)
        this._writeIpcFrame(0, { v: 1, client_id: STREAMKIT_CLIENT_ID });
        const readyRes = await Promise.race([
          readyPromise,
          new Promise((r) => setTimeout(() => r(null), 2000)),
        ]);

        if (!readyRes) {
          this.closeIpc();
          continue;
        }

        // 2. Authenticate (op 1)
        try {
          let accessToken = await this.getRpcAccessToken(false);
          let authRes = await this._sendRawIpcRequest('AUTHENTICATE', { access_token: accessToken }, 3500);
          if (!authRes.ok) {
            accessToken = await this.getRpcAccessToken(true);
            authRes = await this._sendRawIpcRequest('AUTHENTICATE', { access_token: accessToken }, 3500);
          }

          if (authRes.ok) {
            this.ipc.authenticated = true;
            this.log(
              'success',
              `[PC BRIDGE] Discord Desktop sincronizado (discord-ipc-${i})! Seu cliente no PC entrará nas calls com áudio real.`
            );
            this.broadcastState();
            return true;
          }
        } catch {}

        this.closeIpc();
      }
      return false;
    })();

    try {
      return await this.ipc.connectPromise;
    } finally {
      this.ipc.connectPromise = null;
    }
  }

  async sendIpcCommand(cmd, args = {}, timeoutMs = 4500) {
    const ready = await this.ensureIpcConnected();
    if (!ready) {
      return { ok: false, error: 'Discord Desktop IPC não disponível' };
    }
    return this._sendRawIpcRequest(cmd, args, timeoutMs);
  }

  log(type, message, meta = {}) {
    const entry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      ts: Date.now(),
      time: new Date().toLocaleTimeString('pt-BR'),
      type, // info | success | warn | error | voice | coleira | stalker | guard
      message,
      ...meta,
    };
    this.logs.unshift(entry);
    if (this.logs.length > 250) {
      this.logs.length = 250;
    }
    this.broadcastSSE('log', entry);
    return entry;
  }

  broadcastSSE(event, payload) {
    const msg = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
    for (const res of this.sseClients) {
      try {
        res.write(msg);
      } catch {
        this.sseClients.delete(res);
      }
    }
  }

  broadcastState() {
    this.broadcastSSE('state', this.getPublicState());
  }

  cacheUser(u) {
    if (!u || !u.id) return;
    const id = String(u.id);
    const prev = this.usersCache.get(id) || {};
    this.usersCache.set(id, {
      id,
      username: u.username || prev.username || id,
      global_name: u.global_name ?? prev.global_name ?? null,
      avatar: u.avatar ?? prev.avatar ?? null,
    });
  }

  async resolveUser(userId) {
    if (!userId) return null;
    const id = String(userId).trim();
    if (this.usersCache.has(id)) return this.usersCache.get(id);
    if (!this.token) return { id, username: id, global_name: null, avatar: null };

    const res = await discordRequest(this.token, 'GET', `/users/${id}`, undefined, 1);
    if (res.ok && res.data?.id) {
      this.cacheUser(res.data);
      this.broadcastState();
      return this.usersCache.get(id);
    }
    return { id, username: id, global_name: null, avatar: null };
  }

  getUserLabel(userId) {
    const id = String(userId);
    const u = this.usersCache.get(id);
    if (!u) return id;
    return u.global_name ? `${u.global_name} (@${u.username})` : `@${u.username}`;
  }

  getChannelLabel(guildId, channelId) {
    if (!channelId) return 'Desconectado';
    const g = guildId ? this.guilds.get(String(guildId)) : null;
    const ch = g?.channels?.get(String(channelId));
    if (ch?.name) return `#${ch.name}`;
    return String(channelId);
  }

  async connect(rawToken, initialGuildId = null) {
    const cleanToken = formatToken(rawToken);
    if (!cleanToken) throw new Error('Token é obrigatório');

    // Se já estiver conectado com o mesmo token, apenas atualiza guild selecionada
    if (this.token === cleanToken && this.status === 'connected' && this.user) {
      if (initialGuildId) {
        await this.selectGuild(initialGuildId);
      }
      return this.user;
    }

    const authCheck = await discordRequest(cleanToken, 'GET', '/users/@me');
    if (!authCheck.ok || !authCheck.data?.id) {
      throw new Error(authCheck.error || 'Token inválido ou expirado');
    }

    this.disconnect(false);

    this.token = cleanToken;
    this.user = authCheck.data;
    this.cacheUser(this.user);
    if (initialGuildId) {
      this.selectedGuildId = String(initialGuildId).trim();
    }

    this.shouldReconnect = true;
    this.status = 'connecting';
    this.lastError = null;
    this.log('info', `Autenticado como ${this.getUserLabel(this.user.id)}. Conectando ao Gateway v10...`);
    this.broadcastState();

    this.openGateway( false );
    this.startWatchdog();

    // Conecta imediatamente à ponte IPC local do Discord Desktop (Discord.exe)
    this.ensureIpcConnected().catch(() => {});

    // Carrega lista básica de servidores via REST como fallback rápido
    this.preloadUserGuilds().catch(() => {});

    return this.user;
  }

  async preloadUserGuilds() {
    if (!this.token) return;
    const res = await discordRequest(this.token, 'GET', '/users/@me/guilds?with_counts=true');
    if (res.ok && Array.isArray(res.data)) {
      for (const g of res.data) {
        const id = String(g.id);
        const existing = this.guilds.get(id);
        if (!existing) {
          this.guilds.set(id, {
            id,
            name: g.name || `Servidor ${id}`,
            icon: g.icon || null,
            ownerId: g.owner ? this.user?.id : null,
            channels: new Map(),
            roles: new Map(),
          });
        } else {
          if (g.name && existing.name.startsWith('Servidor ')) existing.name = g.name;
          if (g.icon && !existing.icon) existing.icon = g.icon;
        }
      }
      if (!this.selectedGuildId && this.guilds.size > 0) {
        const firstId = this.guilds.keys().next().value;
        await this.selectGuild(firstId);
      } else if (this.selectedGuildId) {
        await this.selectGuild(this.selectedGuildId);
      }
      this.broadcastState();
    }
  }

  disconnect(logDisconnect = true) {
    this.shouldReconnect = false;
    clearInterval(this.heartbeatTimer);
    clearInterval(this.watchdogTimer);
    clearInterval(this.chaoticTimer);
    clearTimeout(this.reconnectTimer);
    this.heartbeatTimer = null;
    this.watchdogTimer = null;
    this.chaoticTimer = null;
    this.reconnectTimer = null;

    if (this.ws) {
      try {
        this.ws.removeAllListeners();
        this.ws.close(1000, 'Client disconnect');
      } catch {}
      this.ws = null;
    }

    this.status = 'disconnected';
    this.sessionId = null;
    this.seq = null;
    this.connectedAt = null;
    if (logDisconnect) {
      this.log('warn', 'Sessão Gateway desconectada pelo usuário.');
    }
    this.broadcastState();
  }

  openGateway(isResume = false) {
    if (!this.token) return;
    clearInterval(this.heartbeatTimer);
    if (this.ws) {
      try {
        this.ws.removeAllListeners();
        this.ws.close();
      } catch {}
      this.ws = null;
    }

    const gwUrl =
      isResume && this.resumeGatewayUrl
        ? `${this.resumeGatewayUrl.replace(/\/$/, '')}/?v=10&encoding=json`
        : DISCORD_GW;

    this.status = isResume ? 'reconnecting' : 'connecting';
    this.broadcastState();

    const ws = new WebSocket(gwUrl, {
      maxPayload: 128 * 1024 * 1024,
      headers: {
        'User-Agent': UA,
        Origin: 'https://discord.com',
      },
    });

    this.ws = ws;

    ws.on('open', () => {
      this.log('info', isResume ? 'WebSocket reconectado (tentando RESUME)...' : 'WebSocket conectado ao Discord Gateway.');
    });

    ws.on('message', async (raw) => {
      try {
        const packet = JSON.parse(raw.toString());
        await this.handleGatewayPacket(packet, isResume);
      } catch (err) {
        this.log('error', `Erro ao processar pacote Gateway: ${err.message}`);
      }
    });

    ws.on('close', (code, reason) => {
      clearInterval(this.heartbeatTimer);
      const reasonStr = reason ? reason.toString() : '';
      this.log('warn', `Gateway fechado (code ${code}${reasonStr ? `: ${reasonStr}` : ''})`);

      if (code === 4004) {
        this.status = 'error';
        this.lastError = 'Token inválido (4004 Authentication Failed)';
        this.shouldReconnect = false;
        this.broadcastState();
        return;
      }

      if (this.shouldReconnect) {
        const canResume = Boolean(this.sessionId && this.seq && ![4007, 4009].includes(code));
        this.scheduleReconnect(canResume, 2000 + Math.random() * 1500);
      } else {
        this.status = 'disconnected';
        this.broadcastState();
      }
    });

    ws.on('error', (err) => {
      this.log('error', `Erro WebSocket: ${err.message}`);
    });
  }

  scheduleReconnect(canResume = false, waitMs = 2500) {
    clearTimeout(this.reconnectTimer);
    this.status = 'reconnecting';
    this.broadcastState();
    this.reconnectTimer = setTimeout(() => {
      if (!this.shouldReconnect) return;
      if (!canResume) {
        this.sessionId = null;
        this.seq = null;
      }
      this.openGateway(canResume);
    }, waitMs);
  }

  sendOp(op, d) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ op, d }));
      return true;
    }
    return false;
  }

  startHeartbeat(intervalMs) {
    clearInterval(this.heartbeatTimer);
    const sendBeat = () => {
      this.lastHeartbeatSent = Date.now();
      this.sendOp(1, this.seq);
    };

    const initialJitter = Math.floor(intervalMs * (0.7 + Math.random() * 0.25));
    setTimeout(() => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
      sendBeat();
    }, Math.min(initialJitter, 5000));

    this.heartbeatTimer = setInterval(sendBeat, intervalMs);
  }

  buildPresencePayload() {
    const activities = [];
    if (this.presence.activityName && this.presence.activityName.trim()) {
      const act = {
        name: this.presence.activityName.trim(),
        type: Number(this.presence.activityType) || 0,
      };
      if (this.presence.activityDetails?.trim()) act.details = this.presence.activityDetails.trim();
      if (this.presence.activityState?.trim()) act.state = this.presence.activityState.trim();
      if (act.type === 1) {
        act.url = this.presence.streamUrl?.trim() || 'https://twitch.tv/discord';
      }
      activities.push(act);
    }
    if (this.presence.customStatus && this.presence.customStatus.trim()) {
      activities.push({
        type: 4,
        name: 'Custom Status',
        state: this.presence.customStatus.trim(),
      });
    }
    return {
      status: this.presence.status || 'online',
      since: this.presence.status === 'idle' ? Date.now() : 0,
      activities,
      afk: false,
    };
  }

  async handleGatewayPacket(packet, attemptedResume = false) {
    const { op, d, s, t } = packet;
    if (s !== null && s !== undefined) {
      this.seq = s;
    }

    switch (op) {
      case 10: {
        // HELLO
        const interval = d.heartbeat_interval || 41250;
        this.startHeartbeat(interval);

        if (attemptedResume && this.sessionId && this.seq) {
          this.sendOp(6, {
            token: this.token,
            session_id: this.sessionId,
            seq: this.seq,
          });
        } else {
          const isBot = this.token.toLowerCase().startsWith('bot ');
          if (isBot) {
            this.sendOp(2, {
              token: this.token,
              intents: 3276799,
              properties: { os: 'Windows', browser: 'Chrome', device: '' },
              presence: this.buildPresencePayload(),
            });
          } else {
            this.sendOp(2, {
              token: this.token,
              capabilities: 16381,
              properties: SUPER_PROPS_OBJ,
              presence: this.buildPresencePayload(),
              compress: false,
              client_state: {
                guild_versions: {},
                highest_last_message_id: '0',
                read_state_version: 0,
                user_guild_settings_version: -1,
                user_user_settings_version: -1,
                private_channels_version: '0',
                api_code_version: 0,
              },
            });
          }
        }
        break;
      }

      case 11: {
        // HEARTBEAT ACK
        if (this.lastHeartbeatSent > 0) {
          this.ping = Date.now() - this.lastHeartbeatSent;
        }
        break;
      }

      case 1: {
        // Server requested immediate heartbeat
        this.sendOp(1, this.seq);
        break;
      }

      case 7: {
        // RECONNECT requested by Discord
        this.log('warn', 'Discord solicitou RECONNECT (Op 7). Reconectando...');
        this.scheduleReconnect(true, 500);
        break;
      }

      case 9: {
        // INVALID SESSION
        const resumable = Boolean(d);
        this.log('warn', `Sessão inválida (Op 9, resumable=${resumable}). Reiniciando handshake...`);
        this.scheduleReconnect(resumable, 1500 + Math.random() * 2000);
        break;
      }

      case 0: {
        await this.handleDispatch(t, d);
        break;
      }
    }
  }

  ingestGuildObject(g) {
    if (!g || !g.id) return;
    const guildId = String(g.id);
    const prev = this.guilds.get(guildId) || {
      id: guildId,
      name: `Servidor ${guildId}`,
      icon: null,
      ownerId: null,
      channels: new Map(),
      roles: new Map(),
    };

    const name = g.name || g.properties?.name || prev.name;
    const icon = g.icon ?? g.properties?.icon ?? prev.icon;
    const ownerId = g.owner_id || g.properties?.owner_id || prev.ownerId;

    if (Array.isArray(g.channels)) {
      for (const ch of g.channels) {
        if (ch && ch.id) {
          prev.channels.set(String(ch.id), {
            id: String(ch.id),
            name: ch.name || `canal-${ch.id}`,
            type: ch.type ?? 0,
            parent_id: ch.parent_id ? String(ch.parent_id) : null,
            position: ch.position ?? 0,
            bitrate: ch.bitrate || 64000,
            user_limit: ch.user_limit || 0,
          });
        }
      }
    }

    if (Array.isArray(g.roles)) {
      for (const r of g.roles) {
        if (r && r.id) {
          prev.roles.set(String(r.id), {
            id: String(r.id),
            name: r.name || 'role',
            color: r.color || 0,
            position: r.position || 0,
            permissions: r.permissions || '0',
          });
        }
      }
    }

    if (Array.isArray(g.members)) {
      for (const m of g.members) {
        if (m?.user) this.cacheUser(m.user);
      }
    }

    if (Array.isArray(g.voice_states)) {
      const vsMap = this.voiceStates.get(guildId) || new Map();
      this.voiceStates.set(guildId, vsMap);
      for (const vs of g.voice_states) {
        this.applyVoiceStateRecord(guildId, vs);
      }
    }

    prev.name = name;
    prev.icon = icon;
    prev.ownerId = ownerId;
    this.guilds.set(guildId, prev);
  }

  applyVoiceStateRecord(guildId, vs) {
    if (!vs || !vs.user_id) return;
    const userId = String(vs.user_id);
    const gId = guildId ? String(guildId) : vs.guild_id ? String(vs.guild_id) : null;
    const channelId = vs.channel_id ? String(vs.channel_id) : null;

    if (vs.member?.user) {
      this.cacheUser(vs.member.user);
    }

    const cachedUser = this.usersCache.get(userId);
    const record = {
      userId,
      guildId: gId,
      channelId,
      selfMute: Boolean(vs.self_mute),
      selfDeaf: Boolean(vs.self_deaf),
      mute: Boolean(vs.mute),
      deaf: Boolean(vs.deaf),
      selfVideo: Boolean(vs.self_video),
      selfStream: Boolean(vs.self_stream),
      suppress: Boolean(vs.suppress),
      username: cachedUser?.username || vs.member?.user?.username || userId,
      displayName:
        vs.member?.nick ||
        cachedUser?.global_name ||
        vs.member?.user?.global_name ||
        cachedUser?.username ||
        userId,
      avatar: cachedUser?.avatar || vs.member?.user?.avatar || null,
    };

    if (gId) {
      let guildMap = this.voiceStates.get(gId);
      if (!guildMap) {
        guildMap = new Map();
        this.voiceStates.set(gId, guildMap);
      }
      if (channelId) {
        guildMap.set(userId, record);
        this.userVoiceMap.set(userId, { guildId: gId, channelId });
      } else {
        guildMap.delete(userId);
        if (this.userVoiceMap.get(userId)?.guildId === gId) {
          this.userVoiceMap.delete(userId);
        }
      }
    }

    if (this.user && userId === String(this.user.id)) {
      this.currentVoice = {
        guildId: gId,
        channelId,
        selfMute: record.selfMute,
        selfDeaf: record.selfDeaf,
        mute: record.mute,
        deaf: record.deaf,
        selfVideo: record.selfVideo,
        selfStream: record.selfStream,
      };
    }

    return record;
  }

  async handleDispatch(t, d) {
    switch (t) {
      case 'READY': {
        this.status = 'connected';
        this.connectedAt = this.connectedAt || Date.now();
        this.sessionId = d.session_id;
        this.resumeGatewayUrl = d.resume_gateway_url || null;
        if (d.user) {
          this.user = d.user;
          this.cacheUser(d.user);
        }
        if (Array.isArray(d.users)) {
          for (const u of d.users) this.cacheUser(u);
        }
        if (Array.isArray(d.guilds)) {
          for (const g of d.guilds) {
            this.ingestGuildObject(g);
          }
        }
        if (!this.selectedGuildId && this.guilds.size > 0) {
          this.selectedGuildId = this.guilds.keys().next().value;
        }
        this.log(
          'success',
          `Gateway READY! Sessão ativa (${this.guilds.size} servidores carregados).`
        );

        if (this.selectedGuildId) {
          this.selectGuild(this.selectedGuildId).catch(() => {});
        }

        // Se o Anti-Disconnect já estava ativo antes de um reconnect, garante permanência na call
        if (this.features.antiDisconnect.enabled && this.features.antiDisconnect.channelId) {
          this.autoVoiceSelect(
            this.features.antiDisconnect.guildId,
            this.features.antiDisconnect.channelId
          );
        }

        // Se Seguir Call estiver ativo, sincroniza na hora
        if (this.features.followCall.enabled && this.features.followCall.targetUserId) {
          this.syncFollowTargetNow();  // fire-and-forget (async)
        }

        this.broadcastState();
        break;
      }

      case 'READY_SUPPLEMENTAL': {
        if (Array.isArray(d?.guilds)) {
          for (const g of d.guilds) {
            if (g?.id && Array.isArray(g.voice_states)) {
              const gId = String(g.id);
              for (const vs of g.voice_states) {
                this.applyVoiceStateRecord(gId, vs);
              }
            }
          }
          if (this.features.followCall.enabled && this.features.followCall.targetUserId) {
            this.syncFollowTargetNow();
          }
          this.broadcastState();
        }
        break;
      }

      case 'RESUMED': {
        this.status = 'connected';
        this.log('success', 'Sessão Gateway RESUMED com sucesso.');
        this.broadcastState();
        break;
      }

      case 'GUILD_CREATE':
      case 'GUILD_UPDATE': {
        this.ingestGuildObject(d);
        this.broadcastState();
        break;
      }

      case 'CHANNEL_CREATE':
      case 'CHANNEL_UPDATE': {
        if (d?.guild_id && d?.id) {
          const g = this.guilds.get(String(d.guild_id));
          if (g) {
            g.channels.set(String(d.id), {
              id: String(d.id),
              name: d.name || `canal-${d.id}`,
              type: d.type ?? 0,
              parent_id: d.parent_id ? String(d.parent_id) : null,
              position: d.position ?? 0,
              bitrate: d.bitrate || 64000,
              user_limit: d.user_limit || 0,
            });
            this.broadcastState();
          }
        }
        break;
      }

      case 'CHANNEL_DELETE': {
        if (d?.guild_id && d?.id) {
          const g = this.guilds.get(String(d.guild_id));
          if (g) {
            g.channels.delete(String(d.id));
            this.broadcastState();
          }
        }
        break;
      }

      case 'VOICE_STATE_UPDATE': {
        await this.onVoiceStateUpdate(d);
        break;
      }

      case 'MESSAGE_CREATE': {
        await this.onMessageCreate(d);
        break;
      }
    }
  }

  async onVoiceStateUpdate(d) {
    if (!d || !d.user_id) return;
    const userId = String(d.user_id);
    const guildId = d.guild_id ? String(d.guild_id) : null;
    const channelId = d.channel_id ? String(d.channel_id) : null;

    const prevLoc = this.userVoiceMap.get(userId);
    this.applyVoiceStateRecord(guildId, d);

    if (!this.usersCache.has(userId)) {
      this.resolveUser(userId).catch(() => {});
    }

    const isSelf = Boolean(this.user && userId === String(this.user.id));

    // =========================================================================
    // 1. EVENTOS NA NOSSA PRÓPRIA CONTA (Anti-Disconnect, Anti-Mute, Coleira Move)
    // =========================================================================
    if (isSelf) {
      // 1A. Anti-Mute / Anti-Deaf Server-Side
      if (this.features.antiMute.enabled && guildId && channelId) {
        const shouldUnmute = this.features.antiMute.unmute && d.mute;
        const shouldUndeaf = this.features.antiMute.undeaf && d.deaf;
        if (shouldUnmute || shouldUndeaf) {
          this.stats.antiMuteTriggers++;
          this.log(
            'guard',
            `[ANTI-MUTE] Punição de voz detectada na sua conta (mute=${!!d.mute}, deaf=${!!d.deaf}). Removendo...`
          );
          const body = {};
          if (shouldUnmute) body.mute = false;
          if (shouldUndeaf) body.deaf = false;
          this.patchGuildMemberVoice(guildId, this.user.id, body, 'ANTI-MUTE');
        }
      }

      // 1B. Anti-Disconnect (Lock Call)
      if (
        this.features.antiDisconnect.enabled &&
        this.features.antiDisconnect.channelId &&
        Date.now() > this._ignoreAntiDisconnectUntil
      ) {
        const lockGuildId = this.features.antiDisconnect.guildId;
        const lockChannelId = this.features.antiDisconnect.channelId;
        const wasDisconnected = !channelId;
        const wasMoved =
          channelId &&
          channelId !== lockChannelId &&
          this.features.antiDisconnect.rejoinOnMove;

        if (wasDisconnected || wasMoved) {
          this.stats.antiDisconnectTriggers++;
          const reasonText = wasDisconnected
            ? 'Você foi desconectado da call!'
            : `Você foi movido para ${this.getChannelLabel(guildId, channelId)}!`;
          this.log(
            'voice',
            `[ANTI-DISCONNECT] ${reasonText} Voltando para ${this.getChannelLabel(lockGuildId, lockChannelId)}...`
          );

          const waitMs = Math.max(0, Number(this.features.antiDisconnect.delayMs) || 0);
          setTimeout(async () => {
            if (!this.features.antiDisconnect.enabled) return;
            await this.autoVoiceSelect(lockGuildId, lockChannelId);
            if (this.voiceConfig.fakeStream && lockGuildId && lockChannelId) {
              setTimeout(() => this.startFakeStream(lockGuildId, lockChannelId), 500);
            }
          }, waitMs);

          this.broadcastState();
          return;
        }
      }

      // 1C. Se mudamos de call intencionalmente com a Coleira ativa (followSelfMove), puxa todos os alvos junto!
      if (
        channelId &&
        guildId &&
        this.features.coleira.enabled &&
        this.features.coleira.followSelfMove &&
        (!this.features.antiDisconnect.enabled ||
          channelId === this.features.antiDisconnect.channelId)
      ) {
        const anchorChanged =
          this.features.coleira.anchorChannelId !== channelId ||
          this.features.coleira.anchorGuildId !== guildId;

        this.features.coleira.anchorGuildId = guildId;
        this.features.coleira.anchorChannelId = channelId;

        if (anchorChanged && this.features.coleira.targets.size > 0) {
          this.log(
            'coleira',
            `[COLEIRA] Você entrou em ${this.getChannelLabel(guildId, channelId)}. Puxando ${this.features.coleira.targets.size} alvo(s) na coleira...`
          );
          this.enforceColeiraAll();
        }
      }
    }

    // =========================================================================
    // 2. SEGUIR CALL (Stalker)
    // =========================================================================
    if (
      this.features.followCall.enabled &&
      this.features.followCall.targetUserId &&
      userId === String(this.features.followCall.targetUserId)
    ) {
      if (channelId) {
        if (this.features.followCall.syncAntiDisconnect && this.features.antiDisconnect.enabled) {
          this.features.antiDisconnect.guildId = guildId;
          this.features.antiDisconnect.channelId = channelId;
        }
        if (this.currentVoice.channelId !== channelId || this.currentVoice.guildId !== guildId) {
          this.stats.followMoves++;
          this._ignoreAntiDisconnectUntil = Date.now() + 2500;
          this.log(
            'stalker',
            `[SEGUIR CALL] Alvo ${this.getUserLabel(userId)} entrou em ${this.getChannelLabel(guildId, channelId)}. Seguindo...`
          );
          const waitMs = Math.max(0, Number(this.features.followCall.delayMs) || 0);
          setTimeout(async () => {
            if (!this.features.followCall.enabled) return;
            await this.autoVoiceSelect(guildId, channelId);
          }, waitMs);
        }
      } else if (this.features.followCall.leaveWhenTargetLeaves && this.currentVoice.channelId) {
        this._ignoreAntiDisconnectUntil = Date.now() + 2500;
        this.log('stalker', `[SEGUIR CALL] Alvo ${this.getUserLabel(userId)} saiu da call. Saindo junto...`);
        this.autoVoiceSelect(null, null);
      }
    }

    // =========================================================================
    // 3. ANTI-CALL (Kick Loop — Proibir Alvo de Entrar em Call)
    // =========================================================================
    if (this.features.antiCall.enabled && this.features.antiCall.targets.has(userId)) {
      if (channelId && guildId) {
        this.stats.antiCallKicks++;
        this.log(
          'coleira',
          `[ANTI-CALL] Alvo bloqueado ${this.getUserLabel(userId)} entrou em ${this.getChannelLabel(guildId, channelId)}. Desconectando...`
        );
        this.patchGuildMemberVoice(guildId, userId, { channel_id: null }, 'ANTI-CALL');
        this.broadcastState();
        return;
      }
    }

    // =========================================================================
    // 4. COLEIRA (Leash — Prender e Puxar Alvo para a Call Âncora)
    // =========================================================================
    if (this.features.coleira.enabled && this.features.coleira.targets.has(userId)) {
      const anchorGuildId =
        this.features.coleira.anchorGuildId || this.currentVoice.guildId || guildId;
      const anchorChannelId =
        this.features.coleira.anchorChannelId || this.currentVoice.channelId;

      if (channelId && guildId && anchorChannelId && guildId === anchorGuildId) {
        const wrongChannel = channelId !== anchorChannelId;
        const needMute = this.features.coleira.forceServerMute && !d.mute;
        const needDeaf = this.features.coleira.forceServerDeaf && !d.deaf;

        if (wrongChannel || needMute || needDeaf) {
          const patch = {};
          if (wrongChannel) patch.channel_id = anchorChannelId;
          if (needMute) patch.mute = true;
          if (needDeaf) patch.deaf = true;

          if (wrongChannel) {
            this.stats.coleiraPulls++;
            this.log(
              'coleira',
              `[COLEIRA] ${this.getUserLabel(userId)} tentou ir para ${this.getChannelLabel(guildId, channelId)} -> Puxando para ${this.getChannelLabel(anchorGuildId, anchorChannelId)}!`
            );
          }
          this.patchGuildMemberVoice(guildId, userId, patch, 'COLEIRA');
        }
      }
    }

    // =========================================================================
    // 5. MUTE-LOCK (Travar Alvo Mutado/Ensurdecido no Servidor)
    // =========================================================================
    if (this.features.muteLock.enabled && this.features.muteLock.targets.has(userId)) {
      if (channelId && guildId) {
        const needMute = this.features.muteLock.mute && !d.mute;
        const needDeaf = this.features.muteLock.deaf && !d.deaf;
        if (needMute || needDeaf) {
          const patch = {};
          if (needMute) patch.mute = true;
          if (needDeaf) patch.deaf = true;
          // Bypass debounce: MUTE-LOCK precisa remutar imediatamente mesmo que
          // a key ainda esteja no inFlightMemberOps da mutação inicial.
          const mlKey = `${guildId}:${userId}:${JSON.stringify(patch)}`;
          this.inFlightMemberOps.delete(mlKey);
          this.log(
            'coleira',
            `[MUTE-LOCK] Reaplicando server mute/deaf em ${this.getUserLabel(userId)}.`
          );
          // Retry com backoff para 403 (race condition REST vs gateway)
          (async () => {
            const delays = [0, 300, 700, 1500];
            for (const wait of delays) {
              if (wait > 0) await new Promise(r => setTimeout(r, wait));
              // Re-checa se ainda precisa remutar antes de cada tentativa
              const cur = this.voiceStates.get(guildId)?.get(userId);
              const stillNeedMute = patch.mute && cur && !cur.mute;
              const stillNeedDeaf = patch.deaf && cur && !cur.deaf;
              if (!stillNeedMute && !stillNeedDeaf) break;
              const curPatch = {};
              if (stillNeedMute) curPatch.mute = true;
              if (stillNeedDeaf) curPatch.deaf = true;
              const curKey = `${guildId}:${userId}:${JSON.stringify(curPatch)}`;
              this.inFlightMemberOps.delete(curKey);
              const r = await this.patchGuildMemberVoice(guildId, userId, curPatch, 'MUTE-LOCK');
              if (r?.ok) break;
              if (r?.status !== 403) break; // outro erro, não adianta retry
            }
          })();
        }
      }
    }

    // =========================================================================
    // 6. GUARD (Proteção de Amigos — Anti-Mute & Manter na Minha Call)
    // =========================================================================
    if (this.features.guard.enabled && this.features.guard.targets.has(userId)) {
      if (channelId && guildId) {
        const needUnmute = this.features.guard.antiMute && d.mute;
        const needUndeaf = this.features.guard.antiMute && d.deaf;
        const myCh =
          this.currentVoice.guildId === guildId ? this.currentVoice.channelId : null;
        const needPullBack =
          this.features.guard.keepInMyCall &&
          myCh &&
          channelId !== myCh &&
          prevLoc?.channelId === myCh;

        if (needUnmute || needUndeaf || needPullBack) {
          this.stats.guardActions++;
          const patch = {};
          if (needUnmute) patch.mute = false;
          if (needUndeaf) patch.deaf = false;
          if (needPullBack) patch.channel_id = myCh;

          this.log(
            'guard',
            `[GUARD] Protegendo aliado ${this.getUserLabel(userId)} (${Object.keys(patch).join(', ')}).`
          );
          this.patchGuildMemberVoice(guildId, userId, patch, 'GUARD');
        }
      }
    }

    this.broadcastState();
  }

  async patchGuildMemberVoice(guildId, userId, patchBody, tag = 'VOICE') {
    if (!this.token || !guildId || !userId) return { ok: false };
    const key = `${guildId}:${userId}:${JSON.stringify(patchBody)}`;
    const now = Date.now();
    const lastTs = this.inFlightMemberOps.get(key) || 0;
    if (now - lastTs < 180) {
      return { ok: true, skipped: true };
    }
    this.inFlightMemberOps.set(key, now);

    try {
      // X-Context-Properties simula o contexto de voice channel do cliente real
      const ctxObj = { location: 'Voice Channel', location_guild_id: guildId, location_channel_id: null, location_channel_type: null };
      const xCtx = Buffer.from(JSON.stringify(ctxObj)).toString('base64');
      const res = await discordRequest(
        this.token,
        'PATCH',
        `/guilds/${guildId}/members/${userId}`,
        patchBody,
        2,
        { 'X-Context-Properties': xCtx }
      );
      if (!res.ok && res.status !== 400) {
        this.log('error', `[${tag}] Falha ao mover/modificar ${this.getUserLabel(userId)}: ${res.error} | status=${res.status} | body=${JSON.stringify(res.data)}`);
      }
      return res;
    } finally {
      setTimeout(() => this.inFlightMemberOps.delete(key), 180);
    }
  }

  sendVoiceState(guildId, channelId) {
    const gId = guildId ? String(guildId) : null;
    const cId = channelId ? String(channelId) : null;

    this.voiceConfig.guildId = gId;
    this.voiceConfig.channelId = cId;

    const sent = this.sendOp(4, {
      guild_id: gId,
      channel_id: cId,
      self_mute: Boolean(this.voiceConfig.selfMute),
      self_deaf: Boolean(this.voiceConfig.selfDeaf),
      self_video: Boolean(this.voiceConfig.selfVideo),
      flags: 2,
    });

    if (sent && gId) {
      // Subscreve eventos da guild (Op 14) para garantir recebimento de todos os VOICE_STATE_UPDATE
      this.sendOp(14, {
        guild_id: gId,
        typing: true,
        threads: false,
        activities: true,
        members: [],
        channels: {},
      });
    }
    return sent;
  }

  async autoVoiceSelect(guildId, channelId) {
    if (this.voiceConfig.useIpcForAutoVoice) {
      const result = await this.sendIpcCommand('SELECT_VOICE_CHANNEL', {
        channel_id: channelId || null,
        force: true,
      });
      if (result.ok) {
        this.log('info', `[MODO IPC] Discord Desktop movido para ${this.getChannelLabel(guildId, channelId)}`);
        return true;
      }
      this.log('warn', `[MODO IPC] IPC falhou (${result.error || 'sem resposta'}), usando gateway direto.`);
    }
    return this.sendVoiceState(guildId, channelId);
  }

  startFakeStream(guildId, channelId) {
    if (!guildId || !channelId || !this.user) return;
    this.sendOp(18, {
      type: 'guild',
      guild_id: String(guildId),
      channel_id: String(channelId),
      preferred_region: null,
    });
    setTimeout(() => {
      if (!this.voiceConfig.fakeStream || !this.user) return;
      this.sendOp(22, {
        stream_key: `guild:${guildId}:${channelId}:${this.user.id}`,
        paused: true,
      });
    }, 450);
  }

  stopFakeStream() {
    const gId = this.currentVoice.guildId || this.voiceConfig.guildId;
    const cId = this.currentVoice.channelId || this.voiceConfig.channelId;
    if (!gId || !cId || !this.user) return;
    this.sendOp(19, {
      stream_key: `guild:${gId}:${cId}:${this.user.id}`,
    });
  }

  async syncFollowTargetNow() {
    if (!this.features.followCall.enabled || !this.features.followCall.targetUserId) return false;
    const targetId = String(this.features.followCall.targetUserId).trim();
    const loc = this.userVoiceMap.get(targetId);

    if (loc && loc.channelId) {
      if (this.features.followCall.syncAntiDisconnect && this.features.antiDisconnect.enabled) {
        this.features.antiDisconnect.guildId = loc.guildId;
        this.features.antiDisconnect.channelId = loc.channelId;
      }
      if (
        this.currentVoice.channelId !== loc.channelId ||
        this.currentVoice.guildId !== loc.guildId
      ) {
        this._ignoreAntiDisconnectUntil = Date.now() + 2500;
        this.log(
          'stalker',
          `[SEGUIR CALL] Alvo ${this.getUserLabel(targetId)} localizado em ${this.getChannelLabel(loc.guildId, loc.channelId)}. Entrando na call...`
        );
        await this.autoVoiceSelect(loc.guildId, loc.channelId);
        return true;
      }
    }
    return false;
  }

  enforceColeiraAll() {
    if (!this.features.coleira.enabled || this.features.coleira.targets.size === 0) return;
    const anchorGuildId =
      this.features.coleira.anchorGuildId ||
      this.currentVoice.guildId ||
      this.selectedGuildId;
    const anchorChannelId =
      this.features.coleira.anchorChannelId || this.currentVoice.channelId;

    if (!anchorGuildId || !anchorChannelId) return;

    const guildVoiceMap = this.voiceStates.get(String(anchorGuildId));
    if (!guildVoiceMap) return;

    for (const targetId of this.features.coleira.targets) {
      const vs = guildVoiceMap.get(String(targetId));
      if (!vs || !vs.channelId) continue;

      const wrongChannel = vs.channelId !== anchorChannelId;
      const needMute = this.features.coleira.forceServerMute && !vs.mute;
      const needDeaf = this.features.coleira.forceServerDeaf && !vs.deaf;

      if (wrongChannel || needMute || needDeaf) {
        const patch = {};
        if (wrongChannel) patch.channel_id = anchorChannelId;
        if (needMute) patch.mute = true;
        if (needDeaf) patch.deaf = true;
        this.patchGuildMemberVoice(anchorGuildId, targetId, patch, 'COLEIRA');
      }
    }
  }

  startWatchdog() {
    clearInterval(this.watchdogTimer);
    this.watchdogTimer = setInterval(() => {
      if (this.status !== 'connected') return;

      // 1. Watchdog do Anti-Disconnect
      if (
        this.features.antiDisconnect.enabled &&
        this.features.antiDisconnect.channelId &&
        Date.now() > this._ignoreAntiDisconnectUntil
      ) {
        const targetCh = this.features.antiDisconnect.channelId;
        const targetGuild = this.features.antiDisconnect.guildId;
        const curCh = this.currentVoice.channelId;
        if (!curCh || (curCh !== targetCh && this.features.antiDisconnect.rejoinOnMove)) {
          this.sendVoiceState(targetGuild, targetCh);
        }
      }

      // 2. Watchdog do Seguir Call
      if (this.features.followCall.enabled && this.features.followCall.targetUserId) {
        this.syncFollowTargetNow();
      }

      // 3. Watchdog da Coleira
      if (this.features.coleira.enabled && this.features.coleira.targets.size > 0) {
        this.enforceColeiraAll();
      }

      // 4. Watchdog do Anti-Call
      if (this.features.antiCall.enabled && this.features.antiCall.targets.size > 0) {
        for (const targetId of this.features.antiCall.targets) {
          const loc = this.userVoiceMap.get(String(targetId));
          if (loc && loc.channelId && loc.guildId) {
            this.patchGuildMemberVoice(loc.guildId, targetId, { channel_id: null }, 'ANTI-CALL');
          }
        }
      }
    }, 2000);
  }

  updateChaoticMover() {
    clearInterval(this.chaoticTimer);
    this.chaoticTimer = null;

    if (!this.features.chaoticMover.enabled || !this.features.chaoticMover.targetUserId) {
      return;
    }

    // Auto-detecta guildId do alvo se não estiver configurado
    const targetId = String(this.features.chaoticMover.targetUserId).trim();
    if (!this.features.chaoticMover.guildId || this.features.chaoticMover.guildId === 'null') {
      const loc = this.userVoiceMap.get(targetId);
      this.features.chaoticMover.guildId =
        loc?.guildId || this.selectedGuildId || this.currentVoice.guildId || '';
    }

    if (!this.features.chaoticMover.guildId || this.features.chaoticMover.guildId === 'null') {
      this.log('warn', '[CHAOS MOVER] Guild não encontrada. Selecione um servidor ou coloque o alvo em uma call primeiro.');
      return;
    }

    let idx = 0;
    const interval = Math.max(600, Number(this.features.chaoticMover.intervalMs) || 1200);

    this.chaoticTimer = setInterval(() => {
      if (this.status !== 'connected' || !this.features.chaoticMover.enabled) return;
      const gId = String(this.features.chaoticMover.guildId);

      // Re-detecta guild do alvo em tempo real (pode ter mudado de server)
      const currentLoc = this.userVoiceMap.get(targetId);
      const effectiveGuildId = currentLoc?.guildId || gId;

      const g = this.guilds.get(effectiveGuildId);
      if (!g) {
        this.log('warn', `[CHAOS MOVER] Guild ${effectiveGuildId} não está no cache.`);
        return;
      }

      const voiceChannels = Array.from(g.channels.values()).filter(
        (c) => c.type === 2 || c.type === 13
      );
      if (voiceChannels.length < 1) {
        this.log('warn', '[CHAOS MOVER] Nenhum canal de voz encontrado. Recarregue o servidor.');
        return;
      }

      // Filtra canal atual do alvo para garantir que sempre MOVE para outro
      const currentChId = currentLoc?.channelId;
      const candidates = voiceChannels.length > 1
        ? voiceChannels.filter((c) => c.id !== currentChId)
        : voiceChannels;

      const nextChannel = candidates[idx % candidates.length];
      idx++;
      this.patchGuildMemberVoice(effectiveGuildId, targetId, { channel_id: nextChannel.id }, 'CHAOS-MOVER');
    }, interval);
  }

  async onMessageCreate(d) {
    if (!d || !d.author || (this.user && d.author.id === this.user.id)) return;
    const content = d.content || '';

    // 1. Nitro Sniper
    if (this.features.nitroSniper.enabled && content.includes('discord.gift/')) {
      const matches = content.match(/discord\.gift\/([a-zA-Z0-9]{16,24})/g) || [];
      for (const m of matches) {
        const code = m.split('/')[1];
        this.log('info', `[NITRO SNIPER] Código detectado (${code})! Tentando resgatar...`);
        discordRequest(this.token, 'POST', `/entitlements/gift-codes/${code}/redeem`, {
          channel_id: d.channel_id,
          payment_source_id: null,
        }).then((res) => {
          if (res.ok) {
            this.stats.nitroSniped++;
            this.log('success', `[NITRO SNIPER] Código ${code} resgatado com sucesso!`);
          } else {
            this.log('warn', `[NITRO SNIPER] Falha no código ${code}: ${res.error}`);
          }
          this.broadcastState();
        });
      }
    }

    // 2. Auto-Reply
    if (this.features.autoReply.enabled && this.features.autoReply.message?.trim()) {
      const isDm = !d.guild_id;
      const isMentioned =
        Array.isArray(d.mentions) &&
        this.user &&
        d.mentions.some((u) => u.id === this.user.id);

      if (this.features.autoReply.onlyDm && !isDm) return;
      if (this.features.autoReply.onlyMention && !isDm && !isMentioned) return;

      const authorId = String(d.author.id);
      const cooldownMs = (Number(this.features.autoReply.cooldownSec) || 15) * 1000;
      const lastReply = this.autoReplyCooldowns.get(authorId) || 0;
      if (Date.now() - lastReply < cooldownMs) return;

      this.autoReplyCooldowns.set(authorId, Date.now());
      setTimeout(async () => {
        await discordRequest(this.token, 'POST', `/channels/${d.channel_id}/typing`);
        await delay(900 + Math.random() * 800);
        await discordRequest(this.token, 'POST', `/channels/${d.channel_id}/messages`, {
          content: this.features.autoReply.message.trim(),
          message_reference: { message_id: d.id, channel_id: d.channel_id },
          tts: false,
        });
        this.log('info', `[AUTO-REPLY] Respondido para @${d.author.username}`);
      }, 600);
    }
  }

  async selectGuild(guildId) {
    if (!guildId) return null;
    const gId = String(guildId).trim();
    this.selectedGuildId = gId;

    if (!this.guilds.has(gId)) {
      this.guilds.set(gId, {
        id: gId,
        name: `Servidor ${gId}`,
        icon: null,
        ownerId: null,
        channels: new Map(),
        roles: new Map(),
      });
    }

    const g = this.guilds.get(gId);

    // Subscreve no Gateway (Op 14) para esse servidor
    this.sendOp(14, {
      guild_id: gId,
      typing: true,
      threads: false,
      activities: true,
      members: [],
      channels: {},
    });

    // Busca informações atualizadas do servidor e canais via REST se necessário
    if (this.token) {
      const [guildRes, chRes, rolesRes] = await Promise.all([
        g.name.startsWith('Servidor ')
          ? discordRequest(this.token, 'GET', `/guilds/${gId}`, undefined, 1)
          : Promise.resolve(null),
        g.channels.size === 0
          ? discordRequest(this.token, 'GET', `/guilds/${gId}/channels`, undefined, 1)
          : Promise.resolve(null),
        g.roles.size === 0
          ? discordRequest(this.token, 'GET', `/guilds/${gId}/roles`, undefined, 1)
          : Promise.resolve(null),
      ]);

      if (guildRes?.ok && guildRes.data?.name) {
        g.name = guildRes.data.name;
        g.icon = guildRes.data.icon || g.icon;
        g.ownerId = guildRes.data.owner_id || g.ownerId;
      }

      if (chRes?.ok && Array.isArray(chRes.data)) {
        g.channels.clear();
        for (const ch of chRes.data) {
          g.channels.set(String(ch.id), {
            id: String(ch.id),
            name: ch.name || `canal-${ch.id}`,
            type: ch.type ?? 0,
            parent_id: ch.parent_id ? String(ch.parent_id) : null,
            position: ch.position ?? 0,
            bitrate: ch.bitrate || 64000,
            user_limit: ch.user_limit || 0,
          });
        }
      }

      if (rolesRes?.ok && Array.isArray(rolesRes.data)) {
        g.roles.clear();
        for (const r of rolesRes.data) {
          g.roles.set(String(r.id), {
            id: String(r.id),
            name: r.name || 'role',
            color: r.color || 0,
            position: r.position || 0,
            permissions: r.permissions || '0',
          });
        }
      }
    }

    this.broadcastState();
    return this.getSelectedGuildPayload();
  }

  getSelectedGuildPayload() {
    if (!this.selectedGuildId) return null;
    const g = this.guilds.get(String(this.selectedGuildId));
    if (!g) return null;

    const channels = Array.from(g.channels.values()).sort(
      (a, b) => (a.position ?? 0) - (b.position ?? 0)
    );
    const roles = Array.from(g.roles.values()).sort(
      (a, b) => (b.position ?? 0) - (a.position ?? 0)
    );
    const vsMap = this.voiceStates.get(String(this.selectedGuildId)) || new Map();
    const voiceStates = Array.from(vsMap.values());

    return {
      id: g.id,
      name: g.name,
      icon: g.icon,
      ownerId: g.ownerId,
      channels,
      roles,
      voiceStates,
    };
  }

  formatTargetSet(set) {
    return Array.from(set).map((id) => {
      const u = this.usersCache.get(String(id));
      const loc = this.userVoiceMap.get(String(id));
      return {
        id: String(id),
        username: u?.username || String(id),
        displayName: u?.global_name || u?.username || String(id),
        avatar: u?.avatar || null,
        guildId: loc?.guildId || null,
        channelId: loc?.channelId || null,
        channelName: loc ? this.getChannelLabel(loc.guildId, loc.channelId) : null,
      };
    });
  }

  getPublicState() {
    const guildsList = Array.from(this.guilds.values()).map((g) => {
      const vsMap = this.voiceStates.get(g.id);
      return {
        id: g.id,
        name: g.name,
        icon: g.icon,
        voiceCount: vsMap ? vsMap.size : 0,
        channelCount: g.channels.size,
      };
    });

    const followTargetId = this.features.followCall.targetUserId;
    const followTargetLoc = followTargetId ? this.userVoiceMap.get(String(followTargetId)) : null;

    return {
      status: this.status,
      lastError: this.lastError,
      connectedAt: this.connectedAt,
      ping: this.ping,
      user: this.user,
      selectedGuildId: this.selectedGuildId,
      selectedGuild: this.getSelectedGuildPayload(),
      guilds: guildsList,
      currentVoice: {
        ...this.currentVoice,
        channelName: this.getChannelLabel(this.currentVoice.guildId, this.currentVoice.channelId),
        guildName: this.currentVoice.guildId
          ? this.guilds.get(this.currentVoice.guildId)?.name || this.currentVoice.guildId
          : null,
      },
      voiceConfig: this.voiceConfig,
      features: {
        antiDisconnect: {
          ...this.features.antiDisconnect,
          channelName: this.getChannelLabel(
            this.features.antiDisconnect.guildId,
            this.features.antiDisconnect.channelId
          ),
        },
        antiMute: this.features.antiMute,
        followCall: {
          ...this.features.followCall,
          targetLabel: followTargetId ? this.getUserLabel(followTargetId) : '',
          targetVoice: followTargetLoc
            ? {
                guildId: followTargetLoc.guildId,
                channelId: followTargetLoc.channelId,
                channelName: this.getChannelLabel(
                  followTargetLoc.guildId,
                  followTargetLoc.channelId
                ),
              }
            : null,
        },
        coleira: {
          enabled: this.features.coleira.enabled,
          anchorGuildId: this.features.coleira.anchorGuildId,
          anchorChannelId: this.features.coleira.anchorChannelId,
          anchorChannelName: this.getChannelLabel(
            this.features.coleira.anchorGuildId || this.currentVoice.guildId,
            this.features.coleira.anchorChannelId || this.currentVoice.channelId
          ),
          followSelfMove: this.features.coleira.followSelfMove,
          forceServerMute: this.features.coleira.forceServerMute,
          forceServerDeaf: this.features.coleira.forceServerDeaf,
          targets: this.formatTargetSet(this.features.coleira.targets),
        },
        antiCall: {
          enabled: this.features.antiCall.enabled,
          targets: this.formatTargetSet(this.features.antiCall.targets),
        },
        muteLock: {
          enabled: this.features.muteLock.enabled,
          mute: this.features.muteLock.mute,
          deaf: this.features.muteLock.deaf,
          targets: this.formatTargetSet(this.features.muteLock.targets),
        },
        guard: {
          enabled: this.features.guard.enabled,
          antiMute: this.features.guard.antiMute,
          keepInMyCall: this.features.guard.keepInMyCall,
          targets: this.formatTargetSet(this.features.guard.targets),
        },
        chaoticMover: this.features.chaoticMover,
        autoReply: this.features.autoReply,
        nitroSniper: this.features.nitroSniper,
      },
      presence: this.presence,
      stats: this.stats,
      logs: this.logs.slice(0, 120),
    };
  }
}

const bot = new SelfbotEngine();

// ============================================================================
// PANEL PIN MIDDLEWARE
// ============================================================================

const PANEL_PIN = process.env.PANEL_PIN || null;

function requirePin(req, res, next) {
  if (!PANEL_PIN) return next();
  const pin = req.headers['x-panel-pin'] || req.body?.panelPin;
  if (pin === PANEL_PIN) return next();
  return res.status(401).json({ error: 'PIN inválido', requirePin: true });
}

app.post('/api/panel/verify', (req, res) => {
  if (!PANEL_PIN) return res.json({ ok: true, pinRequired: false });
  const { pin } = req.body || {};
  if (pin === PANEL_PIN) return res.json({ ok: true });
  return res.status(401).json({ ok: false, error: 'PIN incorreto' });
});

app.get('/api/panel/config', (_req, res) => {
  res.json({ pinRequired: Boolean(PANEL_PIN) });
});

// Proteção global: todas as rotas /api/* exceto as públicas acima
app.use((req, res, next) => {
  if (!req.path.startsWith('/api/')) return next();
  if (req.path === '/api/panel/verify' || req.path === '/api/panel/config') return next();
  return requirePin(req, res, next);
});

// ============================================================================
// API ROUTES
// ============================================================================

app.get('/api/state', (_req, res) => {
  res.json(bot.getPublicState());
});

app.get('/api/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  res.write(`event: state\ndata: ${JSON.stringify(bot.getPublicState())}\n\n`);
  bot.sseClients.add(res);

  req.on('close', () => {
    bot.sseClients.delete(res);
  });
});

// Login & Connect Gateway
app.post('/api/auth', async (req, res) => {
  const { token, guildId } = req.body || {};
  if (!token) return res.status(400).json({ error: 'Token é obrigatório' });
  try {
    const user = await bot.connect(token, guildId || null);
    res.json({ ...user, state: bot.getPublicState() });
  } catch (err) {
    res.status(401).json({ error: err.message || 'Falha na autenticação', message: err.message });
  }
});

app.post('/api/disconnect', (req, res) => {
  bot.disconnect(true);
  res.json({ ok: true, state: bot.getPublicState() });
});

app.post('/api/guild/select', async (req, res) => {
  const { guildId, forceRefresh } = req.body || {};
  if (!guildId) return res.status(400).json({ error: 'guildId obrigatório' });
  if (forceRefresh && bot.guilds.has(String(guildId))) {
    const g = bot.guilds.get(String(guildId));
    g.channels.clear();
    g.roles.clear();
  }
  await bot.selectGuild(guildId);
  res.json({ ok: true, state: bot.getPublicState() });
});

// ============================================================================
// VOICE & CALL ROUTES
// ============================================================================

app.post('/api/voice/join', (req, res) => {
  const {
    guildId,
    channelId,
    selfMute,
    selfDeaf,
    selfVideo,
    fakeStream,
    lockCall,
  } = req.body || {};

  if (!channelId) {
    return res.status(400).json({ error: 'channelId é obrigatório para entrar na call' });
  }

  if (selfMute !== undefined) bot.voiceConfig.selfMute = Boolean(selfMute);
  if (selfDeaf !== undefined) bot.voiceConfig.selfDeaf = Boolean(selfDeaf);
  if (selfVideo !== undefined) bot.voiceConfig.selfVideo = Boolean(selfVideo);
  if (fakeStream !== undefined) bot.voiceConfig.fakeStream = Boolean(fakeStream);

  const gId = guildId ? String(guildId).trim() : null;
  const cId = String(channelId).trim();

  bot._ignoreAntiDisconnectUntil = Date.now() + 2500;

  if (lockCall !== undefined) {
    bot.features.antiDisconnect.enabled = Boolean(lockCall);
  }
  if (bot.features.antiDisconnect.enabled) {
    bot.features.antiDisconnect.guildId = gId;
    bot.features.antiDisconnect.channelId = cId;
  }

  if (bot.features.coleira.enabled && bot.features.coleira.followSelfMove && gId) {
    bot.features.coleira.anchorGuildId = gId;
    bot.features.coleira.anchorChannelId = cId;
  }

  const sent = bot.sendVoiceState(gId, cId);
  if (bot.voiceConfig.fakeStream && gId && cId) {
    setTimeout(() => bot.startFakeStream(gId, cId), 600);
  }

  bot.log(
    'voice',
    `Conectando à call ${bot.getChannelLabel(gId, cId)} (mute=${bot.voiceConfig.selfMute}, deaf=${bot.voiceConfig.selfDeaf}, cam=${bot.voiceConfig.selfVideo}, live=${bot.voiceConfig.fakeStream})`
  );
  bot.broadcastState();
  res.json({ ok: sent, state: bot.getPublicState() });
});

app.post('/api/voice/leave', (req, res) => {
  bot._ignoreAntiDisconnectUntil = Date.now() + 4000;
  bot.features.antiDisconnect.enabled = false;
  bot.features.followCall.enabled = false;
  if (bot.voiceConfig.fakeStream) {
    bot.stopFakeStream();
    bot.voiceConfig.fakeStream = false;
  }
  bot.sendVoiceState(null, null);
  bot.currentVoice.channelId = null;
  bot.currentVoice.guildId = null;
  bot.log('voice', 'Desconectado da call pelo painel.');
  bot.broadcastState();
  res.json({ ok: true, state: bot.getPublicState() });
});

app.post('/api/voice/config', (req, res) => {
  const { selfMute, selfDeaf, selfVideo, fakeStream, useIpcForAutoVoice } = req.body || {};
  const prevStream = bot.voiceConfig.fakeStream;

  if (selfMute !== undefined) bot.voiceConfig.selfMute = Boolean(selfMute);
  if (selfDeaf !== undefined) bot.voiceConfig.selfDeaf = Boolean(selfDeaf);
  if (selfVideo !== undefined) bot.voiceConfig.selfVideo = Boolean(selfVideo);
  if (fakeStream !== undefined) bot.voiceConfig.fakeStream = Boolean(fakeStream);
  if (useIpcForAutoVoice !== undefined) bot.voiceConfig.useIpcForAutoVoice = Boolean(useIpcForAutoVoice);

  const gId = bot.currentVoice.guildId || bot.voiceConfig.guildId;
  const cId = bot.currentVoice.channelId || bot.voiceConfig.channelId;

  // Só reenvia estado de voz se algo que afeta o selfbot na call mudou
  // (não quando só useIpcForAutoVoice mudou — isso não exige OP 4)
  const voiceStateChanged = selfMute !== undefined || selfDeaf !== undefined || selfVideo !== undefined || fakeStream !== undefined;

  if (cId && voiceStateChanged) {
    bot.sendVoiceState(gId, cId);
    if (bot.voiceConfig.fakeStream && !prevStream && gId) {
      bot.startFakeStream(gId, cId);
      bot.log('voice', 'Fake Stream (AO VIVO) ativado na call!');
    } else if (!bot.voiceConfig.fakeStream && prevStream) {
      bot.stopFakeStream();
      bot.log('voice', 'Fake Stream (AO VIVO) desativado.');
    }
  }

  bot.broadcastState();
  res.json({ ok: true, state: bot.getPublicState() });
});

// ============================================================================
// FEATURES ROUTES (Anti-Disconnect, Anti-Mute, Seguir Call, Coleira, Anti-Call, Guard)
// ============================================================================

app.post('/api/features/anti-disconnect', async (req, res) => {
  const { enabled, guildId, channelId, delayMs, rejoinOnMove } = req.body || {};

  if (guildId !== undefined) {
    bot.features.antiDisconnect.guildId = guildId ? String(guildId).trim() : null;
  }
  if (channelId !== undefined) {
    bot.features.antiDisconnect.channelId = channelId ? String(channelId).trim() : null;
  }
  if (delayMs !== undefined) {
    bot.features.antiDisconnect.delayMs = Math.max(0, Number(delayMs) || 0);
  }
  if (rejoinOnMove !== undefined) {
    bot.features.antiDisconnect.rejoinOnMove = Boolean(rejoinOnMove);
  }
  if (enabled !== undefined) {
    bot.features.antiDisconnect.enabled = Boolean(enabled);
  }

  // Se ativou sem informar canal, trava na call atual
  if (bot.features.antiDisconnect.enabled && !bot.features.antiDisconnect.channelId) {
    bot.features.antiDisconnect.guildId = bot.currentVoice.guildId || bot.selectedGuildId;
    bot.features.antiDisconnect.channelId = bot.currentVoice.channelId;
  }

  if (bot.features.antiDisconnect.enabled && bot.features.antiDisconnect.channelId) {
    await bot.autoVoiceSelect(
      bot.features.antiDisconnect.guildId,
      bot.features.antiDisconnect.channelId
    );
    bot.log(
      'voice',
      `[ANTI-DISCONNECT] Ativado e travado em ${bot.getChannelLabel(bot.features.antiDisconnect.guildId, bot.features.antiDisconnect.channelId)} (delay=${bot.features.antiDisconnect.delayMs}ms)`
    );
  } else if (!bot.features.antiDisconnect.enabled) {
    bot.log('info', '[ANTI-DISCONNECT] Desativado.');
  }

  bot.broadcastState();
  res.json({ ok: true, state: bot.getPublicState() });
});

app.post('/api/features/anti-mute', (req, res) => {
  const { enabled, unmute, undeaf } = req.body || {};
  if (enabled !== undefined) bot.features.antiMute.enabled = Boolean(enabled);
  if (unmute !== undefined) bot.features.antiMute.unmute = Boolean(unmute);
  if (undeaf !== undefined) bot.features.antiMute.undeaf = Boolean(undeaf);

  // Se já estiver mutado/ensurdecido no servidor no momento da ativação, remove na hora
  if (
    bot.features.antiMute.enabled &&
    bot.currentVoice.guildId &&
    bot.currentVoice.channelId &&
    bot.user
  ) {
    const patch = {};
    if (bot.features.antiMute.unmute && bot.currentVoice.mute) patch.mute = false;
    if (bot.features.antiMute.undeaf && bot.currentVoice.deaf) patch.deaf = false;
    if (Object.keys(patch).length > 0) {
      bot.patchGuildMemberVoice(bot.currentVoice.guildId, bot.user.id, patch, 'ANTI-MUTE');
    }
  }

  bot.log(
    'guard',
    `[ANTI-MUTE] ${bot.features.antiMute.enabled ? 'Ativado' : 'Desativado'} (Auto-Unmute=${bot.features.antiMute.unmute}, Auto-Undeaf=${bot.features.antiMute.undeaf})`
  );
  bot.broadcastState();
  res.json({ ok: true, state: bot.getPublicState() });
});

app.post('/api/features/follow', async (req, res) => {
  const { enabled, targetUserId, delayMs, leaveWhenTargetLeaves, syncAntiDisconnect } =
    req.body || {};

  if (targetUserId !== undefined) {
    bot.features.followCall.targetUserId = String(targetUserId).trim();
    if (bot.features.followCall.targetUserId) {
      await bot.resolveUser(bot.features.followCall.targetUserId);
    }
  }
  if (delayMs !== undefined) {
    bot.features.followCall.delayMs = Math.max(0, Number(delayMs) || 0);
  }
  if (leaveWhenTargetLeaves !== undefined) {
    bot.features.followCall.leaveWhenTargetLeaves = Boolean(leaveWhenTargetLeaves);
  }
  if (syncAntiDisconnect !== undefined) {
    bot.features.followCall.syncAntiDisconnect = Boolean(syncAntiDisconnect);
  }
  if (enabled !== undefined) {
    bot.features.followCall.enabled = Boolean(enabled);
  }

  if (bot.features.followCall.enabled && bot.features.followCall.targetUserId) {
    const found = await bot.syncFollowTargetNow();
    bot.log(
      'stalker',
      `[SEGUIR CALL] Rastreando ${bot.getUserLabel(bot.features.followCall.targetUserId)}${found ? ' (alvo já estava em call, entrando agora!)' : ' (aguardando alvo entrar em call...)'}`
    );
  } else if (!bot.features.followCall.enabled) {
    bot.log('info', '[SEGUIR CALL] Desativado.');
  }

  bot.broadcastState();
  res.json({ ok: true, state: bot.getPublicState() });
});

app.post('/api/features/coleira', async (req, res) => {
  const {
    enabled,
    action,
    targetUserId,
    anchorGuildId,
    anchorChannelId,
    followSelfMove,
    forceServerMute,
    forceServerDeaf,
  } = req.body || {};

  if (anchorGuildId !== undefined) {
    bot.features.coleira.anchorGuildId = anchorGuildId ? String(anchorGuildId).trim() : null;
  }
  if (anchorChannelId !== undefined) {
    bot.features.coleira.anchorChannelId = anchorChannelId ? String(anchorChannelId).trim() : null;
  }
  if (followSelfMove !== undefined) {
    bot.features.coleira.followSelfMove = Boolean(followSelfMove);
  }
  if (forceServerMute !== undefined) {
    bot.features.coleira.forceServerMute = Boolean(forceServerMute);
  }
  if (forceServerDeaf !== undefined) {
    bot.features.coleira.forceServerDeaf = Boolean(forceServerDeaf);
  }

  if (action === 'add' && targetUserId) {
    const id = String(targetUserId).trim();
    bot.features.coleira.targets.add(id);
    bot.features.coleira.enabled = true;
    await bot.resolveUser(id);
    bot.log('coleira', `[COLEIRA] ${bot.getUserLabel(id)} foi colocado na coleira!`);
  } else if (action === 'remove' && targetUserId) {
    const id = String(targetUserId).trim();
    bot.features.coleira.targets.delete(id);
    bot.log('info', `[COLEIRA] ${bot.getUserLabel(id)} removido da coleira.`);
  } else if (action === 'clear') {
    bot.features.coleira.targets.clear();
    bot.features.coleira.enabled = false;
    bot.log('info', '[COLEIRA] Lista da coleira limpa.');
  }

  if (enabled !== undefined) {
    bot.features.coleira.enabled = Boolean(enabled);
  }

  // Se estiver sem âncora definida, usa a call atual onde o selfbot está
  if (bot.features.coleira.enabled && !bot.features.coleira.anchorChannelId) {
    bot.features.coleira.anchorGuildId = bot.currentVoice.guildId || bot.selectedGuildId;
    bot.features.coleira.anchorChannelId = bot.currentVoice.channelId;
  }

  if (bot.features.coleira.enabled) {
    bot.enforceColeiraAll();
  }

  bot.broadcastState();
  res.json({ ok: true, state: bot.getPublicState() });
});

app.post('/api/features/anti-call', async (req, res) => {
  const { enabled, action, targetUserId } = req.body || {};

  if (action === 'add' && targetUserId) {
    const id = String(targetUserId).trim();
    bot.features.antiCall.targets.add(id);
    bot.features.antiCall.enabled = true;
    await bot.resolveUser(id);
    bot.log('coleira', `[ANTI-CALL] ${bot.getUserLabel(id)} adicionado ao Kick Loop!`);

    const loc = bot.userVoiceMap.get(id);
    if (loc?.channelId && loc?.guildId) {
      bot.patchGuildMemberVoice(loc.guildId, id, { channel_id: null }, 'ANTI-CALL');
    }
  } else if (action === 'remove' && targetUserId) {
    bot.features.antiCall.targets.delete(String(targetUserId).trim());
  } else if (action === 'clear') {
    bot.features.antiCall.targets.clear();
    bot.features.antiCall.enabled = false;
  }

  if (enabled !== undefined) {
    bot.features.antiCall.enabled = Boolean(enabled);
  }

  bot.broadcastState();
  res.json({ ok: true, state: bot.getPublicState() });
});

app.post('/api/features/mute-lock', async (req, res) => {
  const { enabled, action, targetUserId, mute, deaf } = req.body || {};
  if (mute !== undefined) bot.features.muteLock.mute = Boolean(mute);
  if (deaf !== undefined) bot.features.muteLock.deaf = Boolean(deaf);

  if (action === 'add' && targetUserId) {
    const id = String(targetUserId).trim();
    bot.features.muteLock.targets.add(id);
    bot.features.muteLock.enabled = true;
    await bot.resolveUser(id);
    bot.log('coleira', `[MUTE-LOCK] ${bot.getUserLabel(id)} travado com Server Mute/Deaf.`);

    const loc = bot.userVoiceMap.get(id);
    if (loc?.channelId && loc?.guildId) {
      bot.patchGuildMemberVoice(
        loc.guildId,
        id,
        { mute: bot.features.muteLock.mute, deaf: bot.features.muteLock.deaf },
        'MUTE-LOCK'
      );
    }
  } else if (action === 'remove' && targetUserId) {
    bot.features.muteLock.targets.delete(String(targetUserId).trim());
  } else if (action === 'clear') {
    bot.features.muteLock.targets.clear();
    bot.features.muteLock.enabled = false;
  }

  if (enabled !== undefined) {
    bot.features.muteLock.enabled = Boolean(enabled);
  }

  bot.broadcastState();
  res.json({ ok: true, state: bot.getPublicState() });
});

app.post('/api/features/guard', async (req, res) => {
  const { enabled, action, targetUserId, antiMute, keepInMyCall } = req.body || {};
  if (antiMute !== undefined) bot.features.guard.antiMute = Boolean(antiMute);
  if (keepInMyCall !== undefined) bot.features.guard.keepInMyCall = Boolean(keepInMyCall);

  if (action === 'add' && targetUserId) {
    const id = String(targetUserId).trim();
    bot.features.guard.targets.add(id);
    bot.features.guard.enabled = true;
    await bot.resolveUser(id);
    bot.log('guard', `[GUARD] Aliado ${bot.getUserLabel(id)} sob proteção ativa!`);
  } else if (action === 'remove' && targetUserId) {
    bot.features.guard.targets.delete(String(targetUserId).trim());
  } else if (action === 'clear') {
    bot.features.guard.targets.clear();
    bot.features.guard.enabled = false;
  }

  if (enabled !== undefined) {
    bot.features.guard.enabled = Boolean(enabled);
  }

  bot.broadcastState();
  res.json({ ok: true, state: bot.getPublicState() });
});

app.post('/api/features/chaotic-mover', async (req, res) => {
  const { enabled, targetUserId, guildId, intervalMs } = req.body || {};
  if (targetUserId !== undefined) bot.features.chaoticMover.targetUserId = String(targetUserId).trim();
  if (guildId != null) bot.features.chaoticMover.guildId = String(guildId).trim();
  if (intervalMs !== undefined) bot.features.chaoticMover.intervalMs = Math.max(600, Number(intervalMs) || 1200);
  if (enabled !== undefined) bot.features.chaoticMover.enabled = Boolean(enabled);

  bot.updateChaoticMover();
  bot.log(
    'voice',
    `[CHAOS MOVER] ${bot.features.chaoticMover.enabled ? `Ativado no alvo ${bot.getUserLabel(bot.features.chaoticMover.targetUserId)}` : 'Desativado'}`
  );
  bot.broadcastState();
  res.json({ ok: true, state: bot.getPublicState() });
});

// Direct 1-click member actions on voice
app.post('/api/voice/member-action', async (req, res) => {
  const { guildId, userId, action, channelId } = req.body || {};
  const gId = guildId || bot.selectedGuildId || bot.currentVoice.guildId;
  if (!gId || !userId || !action) {
    return res.status(400).json({ error: 'guildId, userId e action são obrigatórios' });
  }

  let patch = {};
  switch (action) {
    case 'kick':
      patch = { channel_id: null };
      break;
    case 'pull': {
      const targetCh = channelId || bot.currentVoice.channelId;
      if (!targetCh) {
        return res.status(400).json({ error: 'Você precisa estar em uma call para puxar alguém' });
      }
      patch = { channel_id: String(targetCh) };
      break;
    }
    case 'move':
      if (!channelId) return res.status(400).json({ error: 'channelId obrigatório' });
      patch = { channel_id: String(channelId) };
      break;
    case 'mute':
      patch = { mute: true };
      break;
    case 'unmute':
      patch = { mute: false };
      break;
    case 'deaf':
      patch = { deaf: true };
      break;
    case 'undeaf':
      patch = { deaf: false };
      break;
    default:
      return res.status(400).json({ error: 'Ação desconhecida' });
  }

  const out = await bot.patchGuildMemberVoice(String(gId), String(userId), patch, 'AÇÃO DIRETA');
  if (out.ok) {
    bot.log('voice', `Ação [${action.toUpperCase()}] executada em ${bot.getUserLabel(userId)}.`);
  }
  bot.broadcastState();
  res.json({ ok: out.ok, error: out.error, state: bot.getPublicState() });
});

// ============================================================================
// PRESENCE, CHAT, PURGE, GHOST PING & AUTOMATION
// ============================================================================

app.post('/api/presence', (req, res) => {
  const {
    status,
    activityType,
    activityName,
    activityDetails,
    activityState,
    streamUrl,
    customStatus,
  } = req.body || {};

  if (status !== undefined) bot.presence.status = status;
  if (activityType !== undefined) bot.presence.activityType = Number(activityType);
  if (activityName !== undefined) bot.presence.activityName = activityName;
  if (activityDetails !== undefined) bot.presence.activityDetails = activityDetails;
  if (activityState !== undefined) bot.presence.activityState = activityState;
  if (streamUrl !== undefined) bot.presence.streamUrl = streamUrl;
  if (customStatus !== undefined) bot.presence.customStatus = customStatus;

  const sent = bot.sendOp(3, bot.buildPresencePayload());
  bot.log('info', `Presença atualizada (${bot.presence.status}${bot.presence.activityName ? ` - ${bot.presence.activityName}` : ''}).`);
  bot.broadcastState();
  res.json({ ok: sent, state: bot.getPublicState() });
});

app.post('/api/features/automation', (req, res) => {
  const { autoReply, nitroSniper } = req.body || {};
  if (autoReply && typeof autoReply === 'object') {
    bot.features.autoReply = { ...bot.features.autoReply, ...autoReply };
  }
  if (nitroSniper && typeof nitroSniper === 'object') {
    bot.features.nitroSniper = { ...bot.features.nitroSniper, ...nitroSniper };
  }
  bot.log('info', 'Configurações de automação (Auto-Reply / Nitro Sniper) atualizadas.');
  bot.broadcastState();
  res.json({ ok: true, state: bot.getPublicState() });
});

app.post('/api/chat/ghost-ping', async (req, res) => {
  const { channelId, targetUserId, customText } = req.body || {};
  if (!bot.token || !channelId || !targetUserId) {
    return res.status(400).json({ error: 'channelId e targetUserId obrigatórios' });
  }
  const content = customText ? `${customText} <@${targetUserId}>` : `<@${targetUserId}>`;
  const sendRes = await discordRequest(bot.token, 'POST', `/channels/${channelId}/messages`, {
    content,
    nonce: String(Math.floor(Math.random() * 1e17 + 1e17)),
    tts: false,
  });

  if (!sendRes.ok || !sendRes.data?.id) {
    return res.status(400).json({ error: sendRes.error || 'Falha ao enviar mensagem' });
  }

  await delay(180);
  await discordRequest(bot.token, 'DELETE', `/channels/${channelId}/messages/${sendRes.data.id}`);
  bot.log('success', `[GHOST PING] Executado em ${bot.getUserLabel(targetUserId)} no canal ${channelId}.`);
  bot.broadcastState();
  res.json({ ok: true });
});

app.post('/api/chat/purge', async (req, res) => {
  const { channelId: rawId, limit = 25 } = req.body || {};
  if (!bot.token || !bot.user || !rawId) {
    return res.status(400).json({ error: 'Conecte o selfbot e informe o channelId' });
  }

  // Resolve user ID → DM channel (mesma lógica do /api/limpar-dm)
  let channelId = String(rawId).trim();
  const dmRes = await discordRequest(bot.token, 'POST', '/users/@me/channels', { recipient_id: channelId });
  if (dmRes.ok && dmRes.data?.id) {
    channelId = dmRes.data.id;
  }

  const maxToDelete = Math.min(200, Math.max(1, Number(limit) || 25));
  res.json({ ok: true, message: `Purge iniciado para até ${maxToDelete} mensagens no canal ${channelId}` });

  (async () => {
    let deleted = 0;
    let beforeId = null;
    bot.log('info', `[PURGE] Buscando suas mensagens no canal ${channelId} para apagar (meta: ${maxToDelete})...`);

    while (deleted < maxToDelete) {
      const qs = beforeId ? `?limit=100&before=${beforeId}` : '?limit=100';
      const msgRes = await discordRequest(bot.token, 'GET', `/channels/${channelId}/messages${qs}`);
      if (!msgRes.ok) {
        bot.log('error', `[PURGE] Erro ao buscar mensagens: ${msgRes.error || JSON.stringify(msgRes.data)}`);
        break;
      }
      if (!Array.isArray(msgRes.data) || msgRes.data.length === 0) break;

      const myId = String(bot.user.id);
      const myMsgs = msgRes.data.filter((m) => String(m.author?.id) === myId);
      beforeId = msgRes.data[msgRes.data.length - 1].id;

      for (const m of myMsgs) {
        if (deleted >= maxToDelete) break;
        const delRes = await discordRequest(
          bot.token,
          'DELETE',
          `/channels/${channelId}/messages/${m.id}`
        );
        if (delRes.ok) {
          deleted++;
        }
        await delay(850 + Math.random() * 450);
      }

      if (msgRes.data.length < 100) break;
    }

    bot.log('success', `[PURGE] Concluído! ${deleted} mensagem(ns) sua(s) apagada(s) em ${channelId}.`);
    bot.broadcastState();
  })();
});

app.post('/api/chat/send', async (req, res) => {
  const { channelId, content, count = 1, delayMs = 1200 } = req.body || {};
  if (!bot.token || !channelId || !content) {
    return res.status(400).json({ error: 'channelId e content obrigatórios' });
  }
  const total = Math.min(50, Math.max(1, Number(count) || 1));
  res.json({ ok: true, queued: total });

  (async () => {
    for (let i = 0; i < total; i++) {
      const r = await discordRequest(bot.token, 'POST', `/channels/${channelId}/messages`, {
        content: String(content),
        nonce: String(Math.floor(Math.random() * 1e17 + 1e17)),
        tts: false,
      });
      if (!r.ok) {
        bot.log('error', `[CHAT] Falha ao enviar mensagem (${i + 1}/${total}): ${r.error}`);
        break;
      }
      if (total > 1 && i < total - 1) {
        await delay(Math.max(400, Number(delayMs) || 1200));
      }
    }
    bot.log('success', `[CHAT] Envio concluído (${total} msg) para ${channelId}.`);
  })();
});

// ============================================================================
// SERVER FACTORY / BATCH OPS (Corrigidos e 100% funcionais)
// ============================================================================

app.post('/api/batch/invites', async (req, res) => {
  const { token, guildId, channels = [], maxAge = 0, maxUses = 0 } = req.body || {};
  const activeToken = formatToken(token || bot.token);
  const activeGuildId = String(guildId || bot.selectedGuildId || '');

  let targetChannels = Array.isArray(channels) ? channels.filter(Boolean) : [];
  if (targetChannels.length === 0 && activeGuildId && bot.guilds.has(activeGuildId)) {
    const g = bot.guilds.get(activeGuildId);
    targetChannels = Array.from(g.channels.values())
      .filter((c) => c.type === 0 || c.type === 2)
      .slice(0, 10)
      .map((c) => c.id);
  }

  if (!activeToken || !targetChannels.length) {
    return res.status(400).json({ error: 'Selecione canais válidos para criar convites' });
  }

  res.json({ queued: targetChannels.length, message: 'Criando convites em lote...' });

  (async () => {
    const createdCodes = [];
    for (const chId of targetChannels) {
      const r = await discordRequest(activeToken, 'POST', `/channels/${chId}/invites`, {
        max_age: Number(maxAge) || 0,
        max_uses: Number(maxUses) || 0,
        temporary: false,
        unique: true,
      });
      if (r.ok && r.data?.code) {
        createdCodes.push(`https://discord.gg/${r.data.code}`);
        bot.log('success', `[CONVITE] Criado em ${bot.getChannelLabel(activeGuildId, chId)}: https://discord.gg/${r.data.code}`);
      } else {
        bot.log('error', `[CONVITE] Falha no canal ${chId}: ${r.error}`);
      }
      await delay(750 + Math.random() * 400);
    }
    bot.broadcastState();
  })();
});

app.post('/api/batch/roles', async (req, res) => {
  const { token, guildId, roles = [], name, color, count = 1, permissions = '0', hoist = false } =
    req.body || {};
  const activeToken = formatToken(token || bot.token);
  const activeGuildId = String(guildId || bot.selectedGuildId || '');

  let rolePayloads = Array.isArray(roles) && roles.length > 0 ? roles : [];
  if (rolePayloads.length === 0 && name) {
    const qty = Math.min(50, Math.max(1, Number(count) || 1));
    rolePayloads = Array.from({ length: qty }, (_, i) => ({
      name: qty > 1 ? `${name} #${i + 1}` : name,
      color: typeof color === 'string' ? parseInt(color.replace('#', ''), 16) || 0 : Number(color) || 0,
      permissions: String(permissions || '0'),
      hoist: Boolean(hoist),
      mentionable: true,
    }));
  }

  if (!activeToken || !activeGuildId || !rolePayloads.length) {
    return res.status(400).json({ error: 'token, guildId e cargos são obrigatórios' });
  }

  res.json({ queued: rolePayloads.length, message: `Criando ${rolePayloads.length} cargo(s)...` });

  (async () => {
    for (const r of rolePayloads) {
      const out = await discordRequest(activeToken, 'POST', `/guilds/${activeGuildId}/roles`, {
        name: r.name || 'Novo Cargo',
        permissions: String(r.permissions || '0'),
        color: Number(r.color) || 0,
        hoist: Boolean(r.hoist),
        mentionable: Boolean(r.mentionable),
      });
      if (out.ok && out.data?.id) {
        bot.log('success', `[CARGO] Criado cargo "${out.data.name}" (${out.data.id})`);
      } else {
        bot.log('error', `[CARGO] Falha ao criar "${r.name}": ${out.error}`);
      }
      await delay(800 + Math.random() * 400);
    }
    await bot.selectGuild(activeGuildId);
  })();
});

app.post('/api/batch/channels', async (req, res) => {
  const { token, guildId, channels = [], name, type = 0, count = 1, parentId = null } =
    req.body || {};
  const activeToken = formatToken(token || bot.token);
  const activeGuildId = String(guildId || bot.selectedGuildId || '');

  let channelPayloads = Array.isArray(channels) && channels.length > 0 ? channels : [];
  if (channelPayloads.length === 0 && name) {
    const qty = Math.min(50, Math.max(1, Number(count) || 1));
    channelPayloads = Array.from({ length: qty }, (_, i) => ({
      name: qty > 1 ? `${name}-${i + 1}` : name,
      type: Number(type) || 0,
      parent_id: parentId || null,
    }));
  }

  if (!activeToken || !activeGuildId || !channelPayloads.length) {
    return res.status(400).json({ error: 'token, guildId e canais são obrigatórios' });
  }

  res.json({ queued: channelPayloads.length, message: `Criando ${channelPayloads.length} canal(is)...` });

  (async () => {
    for (const ch of channelPayloads) {
      const out = await discordRequest(activeToken, 'POST', `/guilds/${activeGuildId}/channels`, {
        name: ch.name || 'novo-canal',
        type: Number(ch.type) || 0,
        topic: ch.topic || '',
        bitrate: ch.bitrate || 64000,
        user_limit: ch.user_limit || 0,
        nsfw: Boolean(ch.nsfw),
        parent_id: ch.parent_id || null,
      });
      if (out.ok && out.data?.id) {
        bot.log('success', `[CANAL] Criado #${out.data.name} (${out.data.id})`);
      } else {
        bot.log('error', `[CANAL] Falha ao criar "${ch.name}": ${out.error}`);
      }
      await delay(800 + Math.random() * 400);
    }
    await bot.selectGuild(activeGuildId);
  })();
});

app.post('/api/channel/nuke', async (req, res) => {
  const { channelId } = req.body || {};
  if (!bot.token || !channelId) {
    return res.status(400).json({ error: 'channelId obrigatório' });
  }

  const chRes = await discordRequest(bot.token, 'GET', `/channels/${channelId}`);
  if (!chRes.ok || !chRes.data?.guild_id) {
    return res.status(400).json({ error: chRes.error || 'Canal não encontrado' });
  }

  const ch = chRes.data;
  const createRes = await discordRequest(bot.token, 'POST', `/guilds/${ch.guild_id}/channels`, {
    name: ch.name,
    type: ch.type,
    topic: ch.topic || '',
    nsfw: Boolean(ch.nsfw),
    bitrate: ch.bitrate || 64000,
    user_limit: ch.user_limit || 0,
    rate_limit_per_user: ch.rate_limit_per_user || 0,
    position: ch.position || 0,
    parent_id: ch.parent_id || null,
    permission_overwrites: ch.permission_overwrites || [],
  });

  if (!createRes.ok || !createRes.data?.id) {
    return res.status(400).json({ error: createRes.error || 'Falha ao clonar canal' });
  }

  await discordRequest(bot.token, 'DELETE', `/channels/${channelId}`);
  bot.log('success', `[NUKE CANAL] Canal #${ch.name} recriado do zero (novo ID: ${createRes.data.id}).`);
  await bot.selectGuild(ch.guild_id);
  res.json({ ok: true, newChannelId: createRes.data.id, state: bot.getPublicState() });
});

app.get('/api/debug/permissions/:guildId', async (req, res) => {
  try {
    const { guildId } = req.params;
    // Busca o membro atual no servidor
    const memberRes = await discordRequest(bot.token, 'GET', `/guilds/${guildId}/members/${bot.user?.id}`, undefined, 1);
    const guildRes = await discordRequest(bot.token, 'GET', `/guilds/${guildId}`, undefined, 1);
    
    if (!memberRes.ok) return res.json({ ok: false, error: memberRes.error });
    
    const member = memberRes.data;
    const guild = guildRes.data;
    const roles = guild?.roles || [];
    
    // Calcula permissões
    const MUTE_MEMBERS = BigInt(1 << 22);
    const ADMINISTRATOR = BigInt(1 << 3);
    
    let perms = BigInt(0);
    for (const role of roles) {
      if (role.id === guildId) { // @everyone
        perms |= BigInt(role.permissions || '0');
      }
    }
    for (const roleId of (member.roles || [])) {
      const role = roles.find(r => r.id === roleId);
      if (role) perms |= BigInt(role.permissions || '0');
    }
    
    const isAdmin = (perms & ADMINISTRATOR) !== BigInt(0);
    const canMute = isAdmin || (perms & MUTE_MEMBERS) !== BigInt(0);
    const isOwner = guild?.owner_id === bot.user?.id;
    
    // Roles do membro com posições
    const memberRoles = (member.roles || []).map(rid => {
      const r = roles.find(r => r.id === rid);
      return r ? { id: rid, name: r.name, position: r.position, permissions: r.permissions } : { id: rid };
    }).sort((a, b) => (b.position || 0) - (a.position || 0));
    
    res.json({ ok: true, canMute, isAdmin, isOwner, perms: perms.toString(), memberRoles, guildOwnerId: guild?.owner_id });
  } catch(e) {
    res.json({ ok: false, error: e.message });
  }
});

app.post('/api/logs/clear', (req, res) => {
  bot.logs = [];
  bot.broadcastState();
  res.json({ ok: true });
});

function scanLocalTokens() {
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
          if (matches) matches.forEach(t => foundTokens.add(t));
        } catch {}
      }
    } catch {}
  }

  function getMasterKey(basePath) {
    const localStatePath = path.join(basePath, 'Local State');
    if (!fs.existsSync(localStatePath)) return null;
    try {
      const script = `Add-Type -AssemblyName System.Security; $ls = Get-Content '${localStatePath}' -Raw | ConvertFrom-Json; $enc = [Convert]::FromBase64String($ls.os_crypt.encrypted_key); $enc = $enc[5..($enc.Length-1)]; $key = [System.Security.Cryptography.ProtectedData]::Unprotect($enc, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser); [Convert]::ToBase64String($key);`;
      const out = execSync(`powershell -NoProfile -NonInteractive -Command "${script}"`, { stdio: 'pipe' }).toString().trim();
      return Buffer.from(out, 'base64');
    } catch { return null; }
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

  return Array.from(foundTokens);
}

app.get('/api/tokens/scan', async (req, res) => {
  try {
    const tokens = scanLocalTokens();
    const validated = await Promise.all(tokens.map(async (t) => {
      try {
        const r = await discordRequest(t, 'GET', '/users/@me', undefined, 0);
        if (r.ok && r.data?.id) {
          return { token: t, valid: true, username: r.data.global_name || r.data.username, id: r.data.id };
        }
      } catch {}
      return { token: t, valid: false };
    }));
    const validTokens = validated.filter(t => t.valid);
    res.json({ ok: true, tokens, validated, validTokens });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

app.post('/api/limpar-dm', async (req, res) => {
  const { targetId, delayMs = 700 } = req.body || {};
  if (!bot.token || !bot.user) {
    return res.status(400).json({ error: 'Conecte o selfbot primeiro' });
  }
  if (!targetId) {
    return res.status(400).json({ error: 'targetId obrigatório (User ID ou Channel ID de DM)' });
  }

  let channelId = String(targetId).trim();
  let username = channelId;
  let userId = null;
  let avatarUrl = null;

  // Tenta resolver como user ID → cria/busca canal DM
  const dmRes = await discordRequest(bot.token, 'POST', '/users/@me/channels', { recipient_id: channelId });
  if (dmRes.ok && dmRes.data?.id) {
    channelId = dmRes.data.id;
    const recipient = dmRes.data.recipients?.[0];
    if (recipient) {
      username = recipient.global_name || recipient.username || channelId;
      userId = recipient.id;
      if (recipient.avatar) {
        avatarUrl = `https://cdn.discordapp.com/avatars/${recipient.id}/${recipient.avatar}.png?size=128`;
      }
    }
  }

  const taskId = `limpar-dm-${Date.now()}`;
  res.json({ ok: true, taskId, username, userId, channelId, avatarUrl });

  (async () => {
    try {
      bot.log('info', `[LIMPAR-DM] Buscando mensagens com ${username}...`);
      bot.broadcastSSE('limpar-dm', { taskId, phase: 'fetching', progress: 0, total: 0, username, avatarUrl, message: 'Buscando mensagens...' });

      const messages = [];
      let beforeId = null;
      let totalScanned = 0;

      while (true) {
        const qs = beforeId ? `?limit=100&before=${beforeId}` : '?limit=100';
        const msgRes = await discordRequest(bot.token, 'GET', `/channels/${channelId}/messages${qs}`);
        if (!msgRes.ok || !Array.isArray(msgRes.data) || msgRes.data.length === 0) break;

        totalScanned += msgRes.data.length;
        const myId = String(bot.user.id);
        const myMsgs = msgRes.data.filter((m) => String(m.author?.id) === myId);
        messages.push(...myMsgs);
        beforeId = msgRes.data[msgRes.data.length - 1].id;

        bot.broadcastSSE('limpar-dm', { taskId, phase: 'fetching', progress: messages.length, total: totalScanned, username, avatarUrl, message: `${messages.length} mensagens encontradas...` });

        if (msgRes.data.length < 100) break;
        await delay(400);
      }

      if (messages.length === 0) {
        bot.log('info', `[LIMPAR-DM] Nenhuma mensagem para apagar com ${username}`);
        bot.broadcastSSE('limpar-dm', { taskId, phase: 'completed', progress: 0, total: totalScanned, username, avatarUrl, message: 'Nenhuma mensagem encontrada' });
        return;
      }

      bot.log('info', `[LIMPAR-DM] ${messages.length} mensagens encontradas com ${username}, iniciando remoção...`);
      bot.broadcastSSE('limpar-dm', { taskId, phase: 'deleting', progress: 0, total: messages.length, username, avatarUrl, message: `0/${messages.length} mensagens deletadas` });

      let deleted = 0;
      for (const m of messages) {
        await discordRequest(bot.token, 'DELETE', `/channels/${channelId}/messages/${m.id}`);
        deleted++;
        bot.broadcastSSE('limpar-dm', { taskId, phase: 'deleting', progress: deleted, total: messages.length, username, avatarUrl, message: `${deleted}/${messages.length} mensagens deletadas` });
        await delay(Math.max(300, Number(delayMs) || 700));
      }

      bot.log('success', `[LIMPAR-DM] Concluído! ${deleted} mensagens deletadas com ${username}`);
      bot.broadcastSSE('limpar-dm', { taskId, phase: 'completed', progress: deleted, total: messages.length, username, avatarUrl, message: `${deleted} mensagens deletadas` });
    } catch (err) {
      bot.log('error', `[LIMPAR-DM] Erro: ${err.message || err}`);
      bot.broadcastSSE('limpar-dm', { taskId, phase: 'error', username, avatarUrl, message: String(err.message || err) });
    }
  })();
});

const isMain =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename);

if (isMain) {
  const distPath = path.join(__dirname, 'dist');
  if (fs.existsSync(distPath)) {
    app.use(express.static(distPath));
    app.use((req, res) => {
      if (req.path.startsWith('/api/')) {
        return res.status(404).json({ error: 'Endpoint não encontrado' });
      }
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, () => {
    console.log(`[Selfbot Engine] Servidor rodando em http://localhost:${PORT}`);
  });
}

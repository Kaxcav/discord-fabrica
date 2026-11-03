import fs from 'fs';
import net from 'net';
import WebSocket from 'ws';
import {
  DISCORD_API,
  STREAMKIT_CLIENT_ID,
  STREAMKIT_SCOPES,
  buildHeaders,
  delay,
} from '../config/constants.js';
import { getIpcPipePath, isWindows, scanLocalTokens } from '../config/platform.js';

export class DiscordIpcBridge {
  constructor(engine) {
    this.engine = engine;
    this.socket = null;
    this.ws = null;
    this.connected = false;
    this.authenticated = false;
    this.pipeIndex = null;
    this.pending = new Map();
    this.connectPromise = null;
    this.accessToken = null;
    this.tokenOwner = null;

    // Suporte a Remote PC Bridge (quando o painel roda em nuvem/Railway e o Discord Desktop está no PC do usuário)
    this.remoteConnected = false;
    this.remoteLastSeen = 0;
    this.remoteDesktopUser = null;
    this.remotePending = new Map();
  }

  isRemoteActive() {
    return Boolean(this.remoteConnected && Date.now() - this.remoteLastSeen < 65000);
  }

  isConnected() {
    return Boolean((this.connected && this.authenticated) || this.isRemoteActive());
  }

  getMode() {
    if (this.connected && this.authenticated) {
      return this.ws ? `local-ws-${this.pipeIndex}` : `local-pipe-${this.pipeIndex}`;
    }
    if (this.isRemoteActive()) {
      return 'remote-bridge';
    }
    return 'disconnected';
  }

  registerRemoteBridge(info = {}) {
    const wasActive = this.isRemoteActive();
    this.remoteConnected = true;
    this.remoteLastSeen = Date.now();
    if (info.user) {
      this.remoteDesktopUser = info.user;
    }

    if (info.currentVoiceChannel && this.engine) {
      const chId = info.currentVoiceChannel.id ? String(info.currentVoiceChannel.id) : null;
      const gId = info.currentVoiceChannel.guild_id
        ? String(info.currentVoiceChannel.guild_id)
        : null;
      if (chId) {
        this.engine.currentVoice.channelId = chId;
        this.engine.currentVoice.guildId = gId;
        this.engine.voiceConfig.channelId = chId;
        this.engine.voiceConfig.guildId = gId;
        if (this.engine.user?.id && gId) {
          this.engine.userVoiceMap.set(String(this.engine.user.id), {
            guildId: gId,
            channelId: chId,
          });
        }
        if (
          this.engine.features?.antiDisconnect?.enabled &&
          !this.engine.features.antiDisconnect.channelId
        ) {
          this.engine.features.antiDisconnect.guildId = gId;
          this.engine.features.antiDisconnect.channelId = chId;
        }
      }
    }

    if (!wasActive && this.engine) {
      const sourceLabel = info.source || 'PC Bridge';
      this.engine.log(
        'success',
        `[PC BRIDGE] Discord Desktop sincronizado (${sourceLabel})! Áudio do cliente local pronto.`
      );
      this.engine.emitDelta?.('state', this.engine.getPublicState());
    }
  }

  getPendingRemoteCommands() {
    const list = [];
    for (const [requestId, entry] of this.remotePending.entries()) {
      list.push({
        requestId,
        cmd: entry.cmd,
        args: entry.args,
        accessToken: entry.accessToken,
        createdAt: entry.createdAt,
      });
    }
    return list;
  }

  resolveRemoteCommand(requestId, result = {}) {
    if (!requestId || !this.remotePending.has(requestId)) return false;
    const entry = this.remotePending.get(requestId);
    this.remotePending.delete(requestId);
    clearTimeout(entry.timer);
    this.remoteConnected = true;
    this.remoteLastSeen = Date.now();

    if (result.ok) {
      entry.resolve({ ok: true, data: result.data });
    } else {
      entry.resolve({
        ok: false,
        error: result.error || 'Erro no Remote IPC Bridge',
        code: result.code,
      });
    }
    return true;
  }

  async _authorizeWithToken(rawToken) {
    if (!rawToken) return null;
    try {
      const endpoint = `/oauth2/authorize?client_id=${STREAMKIT_CLIENT_ID}&response_type=token&scope=${STREAMKIT_SCOPES}`;
      if (this.engine && rawToken === this.engine.token) {
        const res = await this.engine.request('POST', endpoint, { authorize: true });
        if (res.ok && res.data?.location) {
          const match = res.data.location.match(/access_token=([^&]+)/);
          if (match) return match[1];
        }
      } else {
        const res = await fetch(`${DISCORD_API}${endpoint}`, {
          method: 'POST',
          headers: buildHeaders(rawToken),
          body: JSON.stringify({ authorize: true }),
        });
        if (res.ok) {
          const data = await res.json();
          const match = data?.location?.match(/access_token=([^&]+)/);
          if (match) return match[1];
        }
      }
    } catch {}
    return null;
  }

  async getRpcAccessToken(forceRefresh = false, desktopUserId = null) {
    if (!forceRefresh && this.accessToken && this.tokenOwner === (this.engine?.token || 'local')) {
      return this.accessToken;
    }

    const engineMatchesDesktop =
      !desktopUserId ||
      !this.engine?.user?.id ||
      String(this.engine.user.id) === String(desktopUserId);

    if (this.engine?.token && engineMatchesDesktop) {
      const token = await this._authorizeWithToken(this.engine.token);
      if (token) {
        this.accessToken = token;
        this.tokenOwner = this.engine.token;
        return this.accessToken;
      }
    }

    // Fallback: verifica tokens locais do Windows se o Discord Desktop estiver logado localmente
    try {
      const localTokens = scanLocalTokens();
      for (const candidate of localTokens) {
        if (candidate === this.engine?.token && engineMatchesDesktop) continue;
        const token = await this._authorizeWithToken(candidate);
        if (token) {
          this.accessToken = token;
          this.tokenOwner = this.engine?.token || 'local';
          return this.accessToken;
        }
      }
    } catch {}

    return null;
  }

  close() {
    if (this.socket) {
      try {
        this.socket.removeAllListeners();
        this.socket.destroy();
      } catch {}
    }
    if (this.ws) {
      try {
        this.ws.removeAllListeners();
        this.ws.close();
      } catch {}
    }
    this.socket = null;
    this.ws = null;
    this.connected = false;
    this.authenticated = false;
    this.pipeIndex = null;

    for (const [, p] of this.pending) {
      clearTimeout(p.timer);
      p.resolve({ ok: false, error: 'IPC fechado' });
    }
    this.pending.clear();
  }

  destroy() {
    this.close();
    for (const [, p] of this.remotePending) {
      clearTimeout(p.timer);
      p.resolve({ ok: false, error: 'IPC destruído' });
    }
    this.remotePending.clear();
  }

  _writeIpcFrame(op, payload) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(JSON.stringify(payload));
        return true;
      } catch {
        return false;
      }
    }
    if (!this.socket || this.socket.destroyed) return false;
    const data = Buffer.from(JSON.stringify(payload), 'utf8');
    const header = Buffer.alloc(8);
    header.writeInt32LE(op, 0);
    header.writeInt32LE(data.length, 4);
    this.socket.write(Buffer.concat([header, data]));
    return true;
  }

  _sendRawIpcRequest(cmd, args = {}, timeoutMs = 4000) {
    return new Promise((resolve) => {
      const hasPipe = this.socket && !this.socket.destroyed;
      const hasWs = this.ws && this.ws.readyState === WebSocket.OPEN;
      if (!hasPipe && !hasWs) {
        return resolve({ ok: false, error: 'Socket IPC desconectado' });
      }

      const nonce = Math.random().toString(36).slice(2) + Date.now().toString(36);
      const timer = setTimeout(() => {
        this.pending.delete(nonce);
        resolve({ ok: false, error: `Timeout IPC em ${cmd}` });
      }, timeoutMs);

      this.pending.set(nonce, { resolve, timer });
      this._writeIpcFrame(1, { cmd, args, nonce });
    });
  }

  _handleIncomingMessage(msg, readyCallback) {
    if (!msg) return;
    if (msg.cmd === 'DISPATCH' && msg.evt === 'READY') {
      if (msg.data?.user) {
        this.remoteDesktopUser = msg.data.user;
      }
      if (readyCallback) {
        readyCallback(msg.data?.user || true);
      }
    } else if (msg.nonce && this.pending.has(msg.nonce)) {
      const entry = this.pending.get(msg.nonce);
      this.pending.delete(msg.nonce);
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
  }

  async _tryConnectNamedPipe(i) {
    const pipePath = getIpcPipePath(i);
    if (!isWindows && !fs.existsSync(pipePath)) {
      return false;
    }
    const connectedSocket = await new Promise((resolve) => {
      let done = false;
      let sock;
      try {
        sock = net.createConnection(pipePath, () => {
          if (done) return;
          done = true;
          clearTimeout(timeout);
          resolve(sock);
        });
      } catch {
        return resolve(null);
      }

      const timeout = setTimeout(() => {
        if (done) return;
        done = true;
        try {
          sock?.destroy();
        } catch {}
        resolve(null);
      }, 350);

      sock.once('error', () => {
        if (done) return;
        done = true;
        clearTimeout(timeout);
        try {
          sock?.destroy();
        } catch {}
        resolve(null);
      });
    });

    if (!connectedSocket) return false;

    this.socket = connectedSocket;
    this.connected = true;
    this.pipeIndex = i;

    let rxBuffer = Buffer.alloc(0);
    connectedSocket.on('data', (chunk) => {
      rxBuffer = Buffer.concat([rxBuffer, chunk]);
      while (rxBuffer.length >= 8) {
        const length = rxBuffer.readInt32LE(4);
        if (rxBuffer.length < 8 + length) break;
        const op = rxBuffer.readInt32LE(0);
        const body = rxBuffer.slice(8, 8 + length);
        rxBuffer = rxBuffer.slice(8 + length);

        try {
          const msg = JSON.parse(body.toString('utf8'));
          if (op !== 2) {
            this._handleIncomingMessage(msg, (readyUser) => {
              if (connectedSocket._readyResolver) {
                connectedSocket._readyResolver(readyUser);
                connectedSocket._readyResolver = null;
              }
            });
          }
        } catch {}
      }
    });

    connectedSocket.on('close', () => {
      const wasAuth = this.authenticated;
      this.close();
      if (wasAuth) {
        this.engine?.emitDelta?.('state', this.engine.getPublicState());
      }
    });

    connectedSocket.on('error', () => {
      this.close();
    });

    // 1. Handshake
    this._writeIpcFrame(0, { v: 1, client_id: STREAMKIT_CLIENT_ID });
    const readyRes = await Promise.race([
      new Promise((resolve) => {
        connectedSocket._readyResolver = resolve;
      }),
      delay(1200).then(() => false),
    ]);

    if (!readyRes) {
      this.close();
      return false;
    }

    // 2. Authenticate
    try {
      const desktopUserId = typeof readyRes === 'object' ? readyRes?.id : null;
      let accessToken = await this.getRpcAccessToken(false, desktopUserId);
      let authRes = accessToken
        ? await this._sendRawIpcRequest('AUTHENTICATE', { access_token: accessToken }, 3500)
        : { ok: false };
      if (!authRes.ok) {
        accessToken = await this.getRpcAccessToken(true, desktopUserId);
        authRes = accessToken
          ? await this._sendRawIpcRequest('AUTHENTICATE', { access_token: accessToken }, 3500)
          : { ok: false };
      }

      if (authRes.ok) {
        this.authenticated = true;
        this.engine?.log(
          'success',
          `[PC BRIDGE] Discord Desktop sincronizado (ipc-${i})! Áudio do cliente local pronto.`
        );
        this.engine?.emitDelta?.('state', this.engine.getPublicState());
        return true;
      }
    } catch {}

    this.close();
    return false;
  }

  async _tryConnectLocalWebSocket(i) {
    const port = 6463 + i;
    const url = `ws://127.0.0.1:${port}/?v=1&client_id=${STREAMKIT_CLIENT_ID}`;

    const wsResult = await new Promise((resolve) => {
      let done = false;
      let ws;
      try {
        ws = new WebSocket(url, {
          headers: { Origin: 'http://localhost:3000' },
          handshakeTimeout: 500,
        });
      } catch {
        return resolve(null);
      }

      const timeout = setTimeout(() => {
        if (done) return;
        done = true;
        try {
          ws.close();
        } catch {}
        resolve(null);
      }, 800);

      ws.on('message', (raw) => {
        try {
          const msg = JSON.parse(raw.toString('utf8'));
          if (!done && msg.cmd === 'DISPATCH' && msg.evt === 'READY') {
            done = true;
            clearTimeout(timeout);
            if (msg.data?.user) {
              this.remoteDesktopUser = msg.data.user;
            }
            resolve({ ws, user: msg.data?.user || null });
            return;
          }
          this._handleIncomingMessage(msg);
        } catch {}
      });

      ws.once('error', () => {
        if (done) return;
        done = true;
        clearTimeout(timeout);
        resolve(null);
      });

      ws.once('close', () => {
        if (done) return;
        done = true;
        clearTimeout(timeout);
        resolve(null);
      });
    });

    if (!wsResult) return false;

    const { ws, user } = wsResult;
    this.ws = ws;
    this.connected = true;
    this.pipeIndex = i;

    ws.on('close', () => {
      const wasAuth = this.authenticated;
      this.close();
      if (wasAuth) {
        this.engine?.emitDelta?.('state', this.engine.getPublicState());
      }
    });

    ws.on('error', () => {
      this.close();
    });

    try {
      const desktopUserId = user?.id || null;
      let accessToken = await this.getRpcAccessToken(false, desktopUserId);
      let authRes = accessToken
        ? await this._sendRawIpcRequest('AUTHENTICATE', { access_token: accessToken }, 3500)
        : { ok: false };
      if (!authRes.ok) {
        accessToken = await this.getRpcAccessToken(true, desktopUserId);
        authRes = accessToken
          ? await this._sendRawIpcRequest('AUTHENTICATE', { access_token: accessToken }, 3500)
          : { ok: false };
      }

      if (authRes.ok) {
        this.authenticated = true;
        this.engine?.log(
          'success',
          `[PC BRIDGE] Discord Desktop sincronizado (ws-${port})! Áudio do cliente local pronto.`
        );
        this.engine?.emitDelta?.('state', this.engine.getPublicState());
        return true;
      }
    } catch {}

    this.close();
    return false;
  }

  async ensureConnected() {
    if (!this.engine?.token && scanLocalTokens().length === 0) return false;
    if (
      (this.socket && !this.socket.destroyed && this.authenticated) ||
      (this.ws && this.ws.readyState === WebSocket.OPEN && this.authenticated)
    ) {
      return true;
    }
    if (this.connectPromise) {
      return this.connectPromise;
    }
    if (this._lastLocalFailTs && Date.now() - this._lastLocalFailTs < 15000) {
      return false;
    }

    this.connectPromise = (async () => {
      this.close();

      // 1. Tenta Named Pipes locais (discord-ipc-0..9)
      for (let i = 0; i <= 9; i++) {
        if (await this._tryConnectNamedPipe(i)) {
          this._lastLocalFailTs = 0;
          return true;
        }
      }

      // 2. Fallback: Tenta WebSocket RPC local (127.0.0.1:6463..6472 com Origin permitido do StreamKit)
      for (let i = 0; i <= 4; i++) {
        if (await this._tryConnectLocalWebSocket(i)) {
          this._lastLocalFailTs = 0;
          return true;
        }
      }

      this._lastLocalFailTs = Date.now();
      return false;
    })();

    try {
      return await this.connectPromise;
    } finally {
      this.connectPromise = null;
    }
  }

  async sendRemoteCommand(cmd, args = {}, timeoutMs = 4500) {
    const accessToken = await this.getRpcAccessToken(false);
    return new Promise((resolve) => {
      const requestId = Math.random().toString(36).slice(2) + Date.now().toString(36);
      const timer = setTimeout(() => {
        this.remotePending.delete(requestId);
        resolve({ ok: false, error: 'Discord Desktop IPC não disponível' });
      }, timeoutMs);

      const payload = {
        requestId,
        cmd,
        args,
        accessToken,
        createdAt: Date.now(),
      };

      this.remotePending.set(requestId, {
        ...payload,
        resolve,
        timer,
      });

      this.engine?.emitDelta?.('ipc_request', payload);
    });
  }

  async sendCommand(cmd, args = {}, timeoutMs = 4500) {
    const ready = await this.ensureConnected();
    if (ready) {
      return this._sendRawIpcRequest(cmd, args, timeoutMs);
    }

    // Se estiver rodando na nuvem (Railway), despacha para o Remote PC Bridge quando ativo
    if (this.isRemoteActive()) {
      return this.sendRemoteCommand(cmd, args, Math.min(timeoutMs, 2500));
    }

    return { ok: false, error: 'Discord Desktop IPC não disponível' };
  }
}

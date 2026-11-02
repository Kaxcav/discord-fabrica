import net from 'net';
import { STREAMKIT_CLIENT_ID, STREAMKIT_SCOPES } from '../config/constants.js';
import { getIpcPipePath } from '../config/platform.js';

export class DiscordIpcBridge {
  constructor(engine) {
    this.engine = engine;
    this.socket = null;
    this.connected = false;
    this.authenticated = false;
    this.pipeIndex = null;
    this.pending = new Map();
    this.connectPromise = null;
    this.accessToken = null;
    this.tokenOwner = null;
  }

  async getRpcAccessToken(forceRefresh = false) {
    if (!this.engine.token) return null;
    if (!forceRefresh && this.accessToken && this.tokenOwner === this.engine.token) {
      return this.accessToken;
    }

    const endpoint = `/oauth2/authorize?client_id=${STREAMKIT_CLIENT_ID}&response_type=token&scope=${STREAMKIT_SCOPES}`;
    const res = await this.engine.request('POST', endpoint, { authorize: true });
    if (!res.ok || !res.data?.location) {
      return null;
    }

    const match = res.data.location.match(/access_token=([^&]+)/);
    if (!match) return null;

    this.accessToken = match[1];
    this.tokenOwner = this.engine.token;
    return this.accessToken;
  }

  close() {
    if (this.socket) {
      try {
        this.socket.removeAllListeners();
        this.socket.destroy();
      } catch {}
    }
    this.socket = null;
    this.connected = false;
    this.authenticated = false;
    this.pipeIndex = null;

    for (const [, p] of this.pending) {
      clearTimeout(p.timer);
      p.resolve({ ok: false, error: 'IPC fechado' });
    }
    this.pending.clear();
  }

  _writeIpcFrame(op, payload) {
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
      if (!this.socket || this.socket.destroyed) {
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

  async ensureConnected() {
    if (!this.engine.token) return false;
    if (this.socket && !this.socket.destroyed && this.authenticated) {
      return true;
    }
    if (this.connectPromise) {
      return this.connectPromise;
    }

    this.connectPromise = (async () => {
      this.close();

      for (let i = 0; i <= 9; i++) {
        const pipePath = getIpcPipePath(i);
        const connectedSocket = await new Promise((resolve) => {
          let done = false;
          let sock;
          try {
            sock = net.createConnection(pipePath, () => {
              if (done) return;
              done = true;
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

        if (!connectedSocket) continue;

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
              if (op === 2) {
                // Ping/Close
              } else if (msg.cmd === 'DISPATCH' && msg.evt === 'READY') {
                if (connectedSocket._readyResolver) {
                  connectedSocket._readyResolver(true);
                  connectedSocket._readyResolver = null;
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
            } catch {}
          }
        });

        connectedSocket.on('close', () => {
          const wasAuth = this.authenticated;
          this.close();
          if (wasAuth) {
            this.engine.emitDelta?.('state', this.engine.getPublicState());
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
          continue;
        }

        // 2. Authenticate
        try {
          let accessToken = await this.getRpcAccessToken(false);
          let authRes = await this._sendRawIpcRequest('AUTHENTICATE', { access_token: accessToken }, 3500);
          if (!authRes.ok) {
            accessToken = await this.getRpcAccessToken(true);
            authRes = await this._sendRawIpcRequest('AUTHENTICATE', { access_token: accessToken }, 3500);
          }

          if (authRes.ok) {
            this.authenticated = true;
            this.engine.log(
              'success',
              `[PC BRIDGE] Discord Desktop sincronizado (ipc-${i})! Áudio do cliente local pronto.`
            );
            this.engine.emitDelta?.('state', this.engine.getPublicState());
            return true;
          }
        } catch {}

        this.close();
      }

      return false;
    })();

    try {
      return await this.connectPromise;
    } finally {
      this.connectPromise = null;
    }
  }

  async sendCommand(cmd, args = {}, timeoutMs = 4500) {
    const ready = await this.ensureConnected();
    if (!ready) {
      return { ok: false, error: 'Discord Desktop IPC não disponível' };
    }
    return this._sendRawIpcRequest(cmd, args, timeoutMs);
  }
}


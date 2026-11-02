import WebSocket from 'ws';
import { DISCORD_GW, SUPER_PROPS_OBJ } from '../config/constants.js';

export class GatewayClient {
  constructor(engine) {
    this.engine = engine;
    this.ws = null;
    this.heartbeatTimer = null;
    this.reconnectTimer = null;
    this.heartbeatAckPending = false;
    this.lastHeartbeatSent = 0;
    this.reconnectAttempts = 0;
    this.shouldReconnect = false;
    this.isConnecting = false;
  }

  get sessionId() {
    return this.engine.discordSessionId;
  }

  set sessionId(val) {
    this.engine.discordSessionId = val;
  }

  get resumeGatewayUrl() {
    return this.engine.resumeGatewayUrl;
  }

  set resumeGatewayUrl(val) {
    this.engine.resumeGatewayUrl = val;
  }

  get seq() {
    return this.engine.seq;
  }

  set seq(val) {
    this.engine.seq = val;
  }

  open(isResume = false) {
    if (!this.engine.token || this.isConnecting) return;
    this.isConnecting = true;
    this.shouldReconnect = true;
    this.clearHeartbeat();

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

    this.engine.status = isResume ? 'reconnecting' : 'connecting';
    this.engine.emitDelta('state', this.engine.getPublicState());

    try {
      this.ws = new WebSocket(gwUrl);
    } catch (err) {
      this.isConnecting = false;
      this.engine.status = 'error';
      this.engine.lastError = err.message || 'Falha ao instanciar WebSocket';
      this.scheduleReconnect(false, 3000);
      return;
    }

    this.ws.on('open', () => {
      this.isConnecting = false;
      this.reconnectAttempts = 0;
      this.heartbeatAckPending = false;
      this.engine.log('info', `Socket Gateway conectado (${isResume ? 'Tentando RESUME' : 'Novo IDENTIFY'}).`);
    });

    this.ws.on('message', (raw) => {
      try {
        const packet = JSON.parse(raw.toString('utf8'));
        this.handlePacket(packet, isResume);
      } catch (err) {
        this.engine.log('error', `Erro ao parsear payload Gateway: ${err.message}`);
      }
    });

    this.ws.on('close', (code, reason) => {
      this.isConnecting = false;
      this.clearHeartbeat();
      const reasonStr = reason ? reason.toString('utf8') : '';
      this.engine.log('warn', `Gateway desconectado (código ${code}${reasonStr ? `: ${reasonStr}` : ''}).`);

      // Erros fatais de autenticação
      if (code === 4004) {
        this.engine.status = 'error';
        this.engine.lastError = 'Token inválido ou expirado (Código 4004).';
        this.shouldReconnect = false;
        this.engine.emitDelta('state', this.engine.getPublicState());
        return;
      }

      if (this.shouldReconnect) {
        const canResume = Boolean(this.sessionId && this.seq && ![4007, 4009].includes(code));
        const backoff = Math.min(30000, 2000 * Math.pow(1.5, this.reconnectAttempts) + Math.random() * 1000);
        this.reconnectAttempts++;
        this.scheduleReconnect(canResume, backoff);
      } else {
        this.engine.status = 'disconnected';
        this.engine.emitDelta('state', this.engine.getPublicState());
      }
    });

    this.ws.on('error', (err) => {
      this.isConnecting = false;
      this.engine.lastError = err.message || 'Erro de socket Gateway';
    });
  }

  scheduleReconnect(canResume = false, delayMs = 3000) {
    clearTimeout(this.reconnectTimer);
    this.engine.status = 'reconnecting';
    this.engine.emitDelta('state', this.engine.getPublicState());

    this.reconnectTimer = setTimeout(() => {
      if (!canResume) {
        this.sessionId = null;
        this.seq = null;
      }
      this.open(canResume);
    }, delayMs);
  }

  sendOp(op, d) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false;
    try {
      this.ws.send(JSON.stringify({ op, d }));
      return true;
    } catch {
      return false;
    }
  }

  startHeartbeat(intervalMs) {
    this.clearHeartbeat();
    this.heartbeatAckPending = false;

    const scheduleNextBeat = () => {
      // Jitter contínuo: interval * (0.85 + Math.random() * 0.15)
      const nextDelay = Math.floor(intervalMs * (0.85 + Math.random() * 0.15));
      this.heartbeatTimer = setTimeout(() => {
        // Se disparou batimento e o ACK anterior não chegou, socket zumbi -> terminate()
        if (this.heartbeatAckPending) {
          this.engine.log('warn', '[GATEWAY] Heartbeat ACK não recebido (zombie connection). Terminando socket...');
          try {
            this.ws?.terminate();
          } catch {}
          return;
        }

        this.heartbeatAckPending = true;
        this.lastHeartbeatSent = Date.now();
        this.sendOp(1, this.seq);
        scheduleNextBeat();
      }, nextDelay);
    };

    scheduleNextBeat();
  }

  clearHeartbeat() {
    clearTimeout(this.heartbeatTimer);
    this.heartbeatTimer = null;
    this.heartbeatAckPending = false;
  }

  handlePacket(packet, attemptedResume = false) {
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
            token: this.engine.token,
            session_id: this.sessionId,
            seq: this.seq,
          });
        } else {
          const isBot = this.engine.token.toLowerCase().startsWith('bot ');
          if (isBot) {
            this.sendOp(2, {
              token: this.engine.token,
              intents: 3276799,
              properties: { os: 'Windows', browser: 'Chrome', device: '' },
              presence: this.engine.buildPresencePayload(),
            });
          } else {
            this.sendOp(2, {
              token: this.engine.token,
              capabilities: 16381,
              properties: SUPER_PROPS_OBJ,
              presence: this.engine.buildPresencePayload(),
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
        this.heartbeatAckPending = false;
        if (this.lastHeartbeatSent > 0) {
          this.engine.ping = Date.now() - this.lastHeartbeatSent;
        }
        break;
      }

      case 1: {
        // Heartbeat request pelo servidor
        this.sendOp(1, this.seq);
        break;
      }

      case 7: {
        // RECONNECT solicitado pelo Gateway
        this.engine.log('warn', 'Gateway solicitou RECONNECT (Op 7).');
        try {
          this.ws?.close(4000, 'Op 7 Reconnect');
        } catch {}
        break;
      }

      case 9: {
        // INVALID SESSION
        const resumable = Boolean(d);
        this.engine.log('warn', `Sessão Gateway inválida (Op 9, resumable=${resumable}).`);
        if (!resumable) {
          this.sessionId = null;
          this.resumeGatewayUrl = null;
          this.seq = null;
        }
        this.scheduleReconnect(resumable, 1500 + Math.random() * 1500);
        break;
      }

      case 0: {
        // DISPATCH
        this.engine.eventBus.safeEmit('DISPATCH', { t, d, s });
        this.engine.eventBus.safeEmit(t, d);
        break;
      }

      default:
        break;
    }
  }

  close() {
    this.shouldReconnect = false;
    clearTimeout(this.reconnectTimer);
    this.clearHeartbeat();
    if (this.ws) {
      try {
        this.ws.removeAllListeners();
        this.ws.close(1000, 'Client destroyed');
      } catch {}
      this.ws = null;
    }
  }
}


import { formatToken, sanitizeUser } from '../config/constants.js';
import { EventBus } from './EventBus.js';
import { RequestQueue, Priority } from './RequestQueue.js';
import { GatewayClient } from './GatewayClient.js';
import { LRUCache } from './LRUCache.js';
import { VoiceManager } from '../features/voice/VoiceManager.js';
import { ChatManager } from '../features/chat/ChatManager.js';
import { AutomationManager } from '../features/automation/AutomationManager.js';
import { FactoryManager } from '../features/factory/FactoryManager.js';
import { DiscordIpcBridge } from '../ipc/DiscordIpcBridge.js';

export class SelfbotEngine {
  constructor(sessionId = null) {
    this.panelSessionId = sessionId;
    this.lastActivity = Date.now();

    // Gateway / Conexão
    this.discordSessionId = null;
    this.resumeGatewayUrl = null;
    this.seq = null;
    this.status = 'disconnected'; // disconnected | connecting | connected | reconnecting | error
    this.token = '';
    this.user = null;
    this.selectedGuildId = null;
    this.lastError = null;
    this.connectedAt = null;
    this.ping = 0;

    // Caches com evicção LRU (evita estouro de heap de 512MB)
    this.guilds = new Map();
    this.usersCache = new LRUCache(2500);
    this.voiceStates = new LRUCache(1000); // guildId -> Map<userId, voiceRecord>
    this.userVoiceMap = new Map(); // userId -> { guildId, channelId }

    // Estado da voz
    this.currentVoice = {
      guildId: null,
      channelId: null,
      mute: false,
      deaf: false,
      selfMute: false,
      selfDeaf: false,
      selfVideo: false,
      suppress: false,
    };

    this.voiceConfig = {
      selfMute: false,
      selfDeaf: false,
      selfVideo: false,
      stream: false,
      fakeStream: false,
      useIpcForAutoVoice: true,
    };

    // Features
    this.features = {
      antiDisconnect: {
        enabled: false,
        guildId: null,
        channelId: null,
        rejoinOnMove: true,
        delayMs: 120,
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
        triggers: {},
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

    // Módulos centrais
    this.eventBus = new EventBus();
    this.requestQueue = new RequestQueue();
    this.gateway = new GatewayClient(this);
    this.voiceManager = new VoiceManager(this);
    this.chatManager = new ChatManager(this);
    this.automationManager = new AutomationManager(this);
    this.factoryManager = new FactoryManager(this);
    this.ipcBridge = new DiscordIpcBridge(this);

    // Configura listeners de eventos do Gateway
    this._setupInternalListeners();

    // Batimento periódico SSE keepalive (a cada 15s) para evitar timeout de proxy
    this.sseKeepaliveTimer = setInterval(() => {
      this.broadcastSSEComment('keepalive');
    }, 15000);
    if (typeof this.sseKeepaliveTimer.unref === 'function') {
      this.sseKeepaliveTimer.unref();
    }
  }

  // Compatibilidade com código legado que acessa bot.ws diretamente
  get ws() {
    return this.gateway.ws;
  }
  set ws(val) {
    this.gateway.ws = val;
  }
  get heartbeatTimer() {
    return this.gateway.heartbeatTimer;
  }
  set heartbeatTimer(val) {
    this.gateway.heartbeatTimer = val;
  }
  get reconnectTimer() {
    return this.gateway.reconnectTimer;
  }
  set reconnectTimer(val) {
    this.gateway.reconnectTimer = val;
  }
  get ipc() {
    return this.ipcBridge;
  }

  touch() {
    this.lastActivity = Date.now();
  }

  sendOp(op, d) {
    return this.gateway.sendOp(op, d);
  }

  closeIpc() {
    this.ipcBridge.close();
  }

  sendVoiceState(guildId, channelId) {
    return this.voiceManager.sendVoiceState(guildId, channelId);
  }

  async autoVoiceSelect(guildId, channelId) {
    return this.voiceManager.autoVoiceSelect(guildId, channelId);
  }

  async patchGuildMemberVoice(guildId, userId, patch, tag, priority) {
    return this.voiceManager.patchGuildMemberVoice(guildId, userId, patch, tag, priority);
  }

  startFakeStream(guildId, channelId) {
    return this.voiceManager.startFakeStream(guildId, channelId);
  }

  stopFakeStream() {
    return this.voiceManager.stopFakeStream();
  }

  updateChaoticMover() {
    return this.voiceManager.updateChaoticMover();
  }

  syncFollowTargetNow() {
    return this.voiceManager.syncFollowTargetNow();
  }

  enforceColeiraAll() {
    return this.voiceManager.enforceColeiraAll();
  }

  async request(method, endpoint, body = undefined, options = {}) {
    this.touch();
    return this.requestQueue.request(this.token, method, endpoint, body, options);
  }

  _setupInternalListeners() {
    this.automationManager.setupEventListeners();

    this.eventBus.on('READY', (d) => {
      this.status = 'connected';
      this.connectedAt = this.connectedAt || Date.now();
      this.discordSessionId = d.session_id;
      this.resumeGatewayUrl = d.resume_gateway_url || null;
      if (d.user) {
        this.user = sanitizeUser(d.user);
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
      this.log('success', `Gateway READY! Sessão ativa (${this.guilds.size} servidores carregados).`);
      if (this.selectedGuildId) {
        this.selectGuild(this.selectedGuildId).catch(() => {});
      }
      this.broadcastState();
    });

    this.eventBus.on('GUILD_CREATE', (g) => {
      this.ingestGuildObject(g);
      this.emitDelta('guild_update', { id: g.id, name: g.name });
    });

    this.eventBus.on('GUILD_DELETE', (g) => {
      if (g && g.id) {
        this.guilds.delete(String(g.id));
        this.voiceStates.delete(String(g.id));
        if (this.selectedGuildId === String(g.id)) {
          this.selectedGuildId = this.guilds.keys().next().value || null;
        }
        this.broadcastState();
      }
    });

    this.eventBus.on('VOICE_STATE_UPDATE', (d) => {
      this.touch();
      if (!d || !d.user_id) return;
      const userId = String(d.user_id);
      const guildId = d.guild_id ? String(d.guild_id) : null;

      this.applyVoiceStateRecord(guildId, d);

      if (!this.usersCache.has(userId)) {
        this.resolveUser(userId).catch(() => {});
      }

      this.voiceManager.handleVoiceStateUpdate(d);
      this.emitDelta('voice_update', { userId, guildId, channelId: d.channel_id });
    });

    this.eventBus.on('VOICE_SERVER_UPDATE', (d) => {
      this.touch();
      if (this.voiceConfig.fakeStream && d.guild_id && this.currentVoice.channelId) {
        setTimeout(() => {
          this.voiceManager.startFakeStream(d.guild_id, this.currentVoice.channelId);
        }, 500);
      }
    });
  }

  ingestGuildObject(g) {
    if (!g || !g.id) return;
    const gId = String(g.id);
    let entry = this.guilds.get(gId);
    if (!entry) {
      entry = {
        id: gId,
        name: g.name || `Servidor ${gId}`,
        icon: g.icon || null,
        ownerId: g.owner_id || null,
        channels: new Map(),
        roles: new Map(),
      };
      this.guilds.set(gId, entry);
    } else {
      if (g.name) entry.name = g.name;
      if (g.icon) entry.icon = g.icon;
      if (g.owner_id) entry.ownerId = g.owner_id;
    }

    if (Array.isArray(g.channels)) {
      for (const ch of g.channels) {
        entry.channels.set(String(ch.id), {
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

    if (Array.isArray(g.roles)) {
      for (const r of g.roles) {
        entry.roles.set(String(r.id), {
          id: String(r.id),
          name: r.name || 'role',
          color: r.color || 0,
          position: r.position || 0,
          permissions: r.permissions || '0',
        });
      }
    }

    if (Array.isArray(g.voice_states)) {
      for (const vs of g.voice_states) {
        this.applyVoiceStateRecord(gId, vs);
      }
    }

    if (Array.isArray(g.members)) {
      for (const m of g.members) {
        if (m.user) this.cacheUser(m.user);
      }
    }
  }

  applyVoiceStateRecord(guildId, vs) {
    if (!vs || !vs.user_id) return;
    const userId = String(vs.user_id);
    const channelId = vs.channel_id ? String(vs.channel_id) : null;

    const record = {
      userId,
      guildId,
      channelId,
      mute: Boolean(vs.mute),
      deaf: Boolean(vs.deaf),
      selfMute: Boolean(vs.self_mute),
      selfDeaf: Boolean(vs.self_deaf),
      selfVideo: Boolean(vs.self_video),
      selfStream: Boolean(vs.self_stream),
      suppress: Boolean(vs.suppress),
    };

    if (guildId) {
      let gMap = this.voiceStates.get(guildId);
      if (!gMap) {
        gMap = new Map();
        this.voiceStates.set(guildId, gMap);
      }
      if (channelId) {
        gMap.set(userId, record);
      } else {
        gMap.delete(userId);
      }
    }

    if (channelId && guildId) {
      this.userVoiceMap.set(userId, { guildId, channelId });
    } else {
      this.userVoiceMap.delete(userId);
    }

    // Sincroniza currentVoice e voiceConfig se a atualização for da nossa própria conta
    if (this.user && userId === String(this.user.id)) {
      this.currentVoice = {
        guildId: channelId ? guildId : null,
        channelId,
        selfMute: record.selfMute,
        selfDeaf: record.selfDeaf,
        mute: record.mute,
        deaf: record.deaf,
        selfVideo: record.selfVideo,
        selfStream: record.selfStream,
      };

      if (channelId) {
        this.voiceConfig.channelId = channelId;
        if (guildId) this.voiceConfig.guildId = guildId;
      } else {
        this.voiceConfig.channelId = null;
        this.voiceConfig.guildId = null;
      }
      this.voiceConfig.selfMute = record.selfMute;
      this.voiceConfig.selfDeaf = record.selfDeaf;
      this.voiceConfig.selfVideo = record.selfVideo;
    }

    return record;
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

    const res = await this.request('GET', `/users/${id}`, undefined, { priority: Priority.BULK });
    if (res.ok && res.data?.id) {
      this.cacheUser(res.data);
      this.emitDelta('user_cached', { id, username: res.data.username });
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
      since: 0,
      activities,
      afk: false,
    };
  }

  async connect(rawToken, initialGuildId = null) {
    const cleanToken = formatToken(rawToken);
    if (!cleanToken) throw new Error('Token é obrigatório');

    if (this.token === cleanToken && this.status === 'connected' && this.user) {
      if (initialGuildId) {
        await this.selectGuild(initialGuildId);
      }
      return this.user;
    }

    const authCheck = await this.requestQueue.request(cleanToken, 'GET', '/users/@me', undefined, {
      priority: Priority.INTERACTIVE,
    });
    if (!authCheck.ok || !authCheck.data?.id) {
      throw new Error(authCheck.error || 'Token inválido ou expirado');
    }

    this.disconnect(false);

    this.token = cleanToken;
    this.user = sanitizeUser(authCheck.data);
    this.cacheUser(this.user);
    if (initialGuildId) {
      this.selectedGuildId = String(initialGuildId).trim();
    }

    this.status = 'connecting';
    this.lastError = null;
    this.log('info', `Autenticado como ${this.getUserLabel(this.user.id)}. Conectando ao Gateway v10...`);
    this.broadcastState();

    this.gateway.open(false);
    this.voiceManager.startWatchdog();

    // Conecta imediatamente à ponte IPC se estiver em ambiente Windows
    this.ipcBridge.ensureConnected().catch(() => {});

    // Preload dos servidores do usuário
    this.preloadUserGuilds().catch(() => {});

    return this.user;
  }

  async preloadUserGuilds() {
    if (!this.token) return;
    const res = await this.request('GET', '/users/@me/guilds?with_counts=true', undefined, {
      priority: Priority.INTERACTIVE,
    });
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

    // Op 14 (Guild Subscriptions)
    this.sendOp(14, {
      guild_id: gId,
      typing: true,
      threads: false,
      activities: true,
      members: [],
      channels: {},
    });

    if (this.token) {
      const [guildRes, chRes, rolesRes] = await Promise.all([
        g.name.startsWith('Servidor ')
          ? this.request('GET', `/guilds/${gId}`, undefined, { priority: Priority.INTERACTIVE })
          : Promise.resolve(null),
        g.channels.size === 0
          ? this.request('GET', `/guilds/${gId}/channels`, undefined, { priority: Priority.INTERACTIVE })
          : Promise.resolve(null),
        g.roles.size === 0
          ? this.request('GET', `/guilds/${gId}/roles`, undefined, { priority: Priority.INTERACTIVE })
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

    const voiceStatesMap = this.voiceStates.get(g.id);
    const voiceStates = voiceStatesMap ? Array.from(voiceStatesMap.values()) : [];

    const enrichedVoiceStates = voiceStates.map((vs) => {
      const u = this.usersCache.get(vs.userId);
      return {
        ...vs,
        username: u?.username || vs.userId,
        displayName: u?.global_name || u?.username || vs.userId,
        avatar: u?.avatar || null,
      };
    });

    return {
      id: g.id,
      name: g.name,
      icon: g.icon,
      ownerId: g.ownerId,
      channels,
      roles,
      voiceStates: enrichedVoiceStates,
    };
  }

  formatTargetSet(set) {
    if (!set) return [];
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

  log(type, message, meta = {}) {
    const entry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      ts: Date.now(),
      time: new Date().toLocaleTimeString('pt-BR'),
      type,
      message,
      ...meta,
    };
    this.logs.unshift(entry);
    if (this.logs.length > 250) {
      this.logs.length = 250;
    }
    this.emitDelta('log', entry);
    return entry;
  }

  emitDelta(event, payload) {
    const msg = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
    for (const res of this.sseClients) {
      try {
        res.write(msg);
      } catch {
        this.sseClients.delete(res);
      }
    }
  }

  broadcastSSE(event, payload) {
    this.emitDelta(event, payload);
  }

  broadcastState() {
    this.emitDelta('state', this.getPublicState());
  }

  broadcastSSEComment(comment) {
    const msg = `: ${comment}\n\n`;
    for (const res of this.sseClients) {
      try {
        res.write(msg);
      } catch {
        this.sseClients.delete(res);
      }
    }
  }

  disconnect(logDisconnect = true) {
    this.voiceManager.destroy();
    this.gateway.clearHeartbeat();
    this.gateway.shouldReconnect = false;
    clearTimeout(this.gateway.reconnectTimer);
    this.gateway.reconnectTimer = null;
    this.gateway.isConnecting = false;

    if (this.gateway.ws) {
      try {
        this.gateway.ws.removeAllListeners();
        this.gateway.ws.close(1000, 'Client disconnect');
      } catch {}
      this.gateway.ws = null;
    }

    this.status = 'disconnected';
    this.discordSessionId = null;
    this.seq = null;
    this.connectedAt = null;
    if (logDisconnect) {
      this.log('warn', 'Sessão Gateway desconectada pelo usuário.');
    }
    this.broadcastState();
  }

  destroy() {
    clearInterval(this.sseKeepaliveTimer);
    this.ipcBridge.destroy();
    this.automationManager.destroy();

    for (const res of this.sseClients) {
      try {
        if (typeof res.end === 'function') res.end();
      } catch {}
    }
    this.sseClients.clear();
    this.disconnect(false);
  }
}

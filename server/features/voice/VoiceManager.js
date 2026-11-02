import { Priority } from '../../core/RequestQueue.js';

export class VoiceManager {
  constructor(engine) {
    this.engine = engine;
    this.inFlightMemberOps = new Map();
    this.watchdogTimer = null;
    this.chaoticTimer = null;
    this._ignoreAntiDisconnectUntil = 0;
  }

  get features() {
    return this.engine.features;
  }

  get stats() {
    return this.engine.stats;
  }

  get currentVoice() {
    return this.engine.currentVoice;
  }

  get voiceConfig() {
    return this.engine.voiceConfig;
  }

  async patchGuildMemberVoice(guildId, userId, patchBody, tag = 'VOICE', priority = Priority.DEFENSIVE) {
    if (!this.engine.token || !guildId || !userId) return { ok: false };
    const key = `${guildId}:${userId}:${JSON.stringify(patchBody)}`;
    const now = Date.now();
    const lastTs = this.inFlightMemberOps.get(key) || 0;
    if (now - lastTs < 180) {
      return { ok: true, skipped: true };
    }
    this.inFlightMemberOps.set(key, now);

    try {
      const ctxObj = {
        location: 'Voice Channel',
        location_guild_id: guildId,
        location_channel_id: null,
        location_channel_type: null,
      };
      const xCtx = Buffer.from(JSON.stringify(ctxObj)).toString('base64');
      const res = await this.engine.request(
        'PATCH',
        `/guilds/${guildId}/members/${userId}`,
        patchBody,
        {
          priority,
          extraHeaders: { 'X-Context-Properties': xCtx },
          retries: 2,
        }
      );
      if (!res.ok && res.status !== 400) {
        this.engine.log(
          'error',
          `[${tag}] Falha ao modificar ${this.engine.getUserLabel(userId)}: ${res.error} | status=${res.status}`
        );
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
    this.currentVoice.guildId = gId;
    this.currentVoice.channelId = cId;
    this.currentVoice.selfMute = Boolean(this.voiceConfig.selfMute);
    this.currentVoice.selfDeaf = Boolean(this.voiceConfig.selfDeaf);
    this.currentVoice.selfVideo = Boolean(this.voiceConfig.selfVideo);

    const sent = this.engine.gateway.sendOp(4, {
      guild_id: gId,
      channel_id: cId,
      self_mute: Boolean(this.voiceConfig.selfMute),
      self_deaf: Boolean(this.voiceConfig.selfDeaf),
      self_video: Boolean(this.voiceConfig.selfVideo),
      preferred_region: null,
    });

    if (sent && gId) {
      this.engine.gateway.sendOp(14, {
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
      const result = await this.engine.ipc.sendCommand('SELECT_VOICE_CHANNEL', {
        channel_id: channelId || null,
        force: true,
      });
      if (result.ok) {
        this.engine.log(
          'info',
          `[MODO IPC] Discord Desktop movido para ${this.engine.getChannelLabel(guildId, channelId)}`
        );
        return true;
      }
      this.engine.log('warn', `[MODO IPC] IPC falhou (${result.error || 'sem resposta'}), usando gateway direto.`);
    }
    return this.sendVoiceState(guildId, channelId);
  }

  startFakeStream(guildId, channelId) {
    if (!guildId || !channelId || !this.engine.user) return;
    this.engine.gateway.sendOp(18, {
      type: 'guild',
      guild_id: String(guildId),
      channel_id: String(channelId),
      preferred_region: null,
    });
    setTimeout(() => {
      if (!this.voiceConfig.fakeStream || !this.engine.user) return;
      this.engine.gateway.sendOp(22, {
        stream_key: `guild:${guildId}:${channelId}:${this.engine.user.id}`,
        paused: true,
      });
    }, 450);
  }

  stopFakeStream() {
    const gId = this.currentVoice.guildId || this.voiceConfig.guildId;
    const cId = this.currentVoice.channelId || this.voiceConfig.channelId;
    if (!gId || !cId || !this.engine.user) return;
    this.engine.gateway.sendOp(19, {
      stream_key: `guild:${gId}:${cId}:${this.engine.user.id}`,
    });
  }

  async syncFollowTargetNow() {
    if (!this.features.followCall.enabled || !this.features.followCall.targetUserId) return false;
    const targetId = String(this.features.followCall.targetUserId).trim();
    const loc = this.engine.userVoiceMap.get(targetId);

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
        this.engine.log(
          'stalker',
          `[SEGUIR CALL] Alvo ${this.engine.getUserLabel(targetId)} em ${this.engine.getChannelLabel(loc.guildId, loc.channelId)}. Entrando...`
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
      this.engine.selectedGuildId;
    const anchorChannelId =
      this.features.coleira.anchorChannelId || this.currentVoice.channelId;

    if (!anchorGuildId || !anchorChannelId) return;

    const guildVoiceMap = this.engine.voiceStates.get(String(anchorGuildId));
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

  handleVoiceStateUpdate(d) {
    if (!d || !d.user_id) return;
    const userId = String(d.user_id);
    const guildId = d.guild_id ? String(d.guild_id) : null;
    const channelId = d.channel_id ? String(d.channel_id) : null;
    const isSelf = Boolean(this.engine.user && userId === String(this.engine.user.id));

    // 1. Atualizações na nossa própria conta
    if (isSelf) {
      this.currentVoice.guildId = channelId ? guildId : null;
      this.currentVoice.channelId = channelId;
      this.currentVoice.selfMute = Boolean(d.self_mute);
      this.currentVoice.selfDeaf = Boolean(d.self_deaf);
      this.currentVoice.mute = Boolean(d.mute);
      this.currentVoice.deaf = Boolean(d.deaf);
      this.currentVoice.selfVideo = Boolean(d.self_video);
      this.currentVoice.selfStream = Boolean(d.self_stream);

      if (channelId) {
        this.voiceConfig.channelId = channelId;
        if (guildId) this.voiceConfig.guildId = guildId;
      } else {
        this.voiceConfig.channelId = null;
        this.voiceConfig.guildId = null;
      }
      this.voiceConfig.selfMute = Boolean(d.self_mute);
      this.voiceConfig.selfDeaf = Boolean(d.self_deaf);
      this.voiceConfig.selfVideo = Boolean(d.self_video);

      if (this.features.antiMute.enabled && guildId && channelId) {
        const shouldUnmute = this.features.antiMute.unmute && d.mute;
        const shouldUndeaf = this.features.antiMute.undeaf && d.deaf;
        if (shouldUnmute || shouldUndeaf) {
          this.stats.antiMuteTriggers++;
          this.engine.log(
            'guard',
            `[ANTI-MUTE] Punição de voz detectada na sua conta (mute=${!!d.mute}, deaf=${!!d.deaf}). Removendo...`
          );
          const body = {};
          if (shouldUnmute) body.mute = false;
          if (shouldUndeaf) body.deaf = false;
          this.patchGuildMemberVoice(guildId, this.engine.user.id, body, 'ANTI-MUTE');
        }
      }

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
            : `Você foi movido para ${this.engine.getChannelLabel(guildId, channelId)}!`;
          this.engine.log(
            'voice',
            `[ANTI-DISCONNECT] ${reasonText} Voltando para ${this.engine.getChannelLabel(lockGuildId, lockChannelId)}...`
          );

          const waitMs = Math.max(0, Number(this.features.antiDisconnect.delayMs) || 0);
          setTimeout(async () => {
            if (!this.features.antiDisconnect.enabled) return;
            await this.autoVoiceSelect(lockGuildId, lockChannelId);
            if (this.voiceConfig.fakeStream && lockGuildId && lockChannelId) {
              setTimeout(() => this.startFakeStream(lockGuildId, lockChannelId), 500);
            }
          }, waitMs);

          this.engine.emitDelta('voice_update', { guildId, userId, channelId });
          return;
        }
      }

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
          this.engine.log(
            'coleira',
            `[COLEIRA] Você entrou em ${this.engine.getChannelLabel(guildId, channelId)}. Puxando ${this.features.coleira.targets.size} alvo(s)...`
          );
          this.enforceColeiraAll();
        }
      }
    }

    // 2. Seguir Call (Stalker)
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
          this.engine.log(
            'stalker',
            `[SEGUIR CALL] Alvo ${this.engine.getUserLabel(userId)} entrou em ${this.engine.getChannelLabel(guildId, channelId)}. Seguindo...`
          );
          const waitMs = Math.max(0, Number(this.features.followCall.delayMs) || 0);
          setTimeout(async () => {
            if (!this.features.followCall.enabled) return;
            await this.autoVoiceSelect(guildId, channelId);
          }, waitMs);
        }
      } else if (this.features.followCall.leaveWhenTargetLeaves && this.currentVoice.channelId) {
        this._ignoreAntiDisconnectUntil = Date.now() + 2500;
        this.engine.log('stalker', `[SEGUIR CALL] Alvo ${this.engine.getUserLabel(userId)} saiu da call. Saindo...`);
        this.autoVoiceSelect(null, null);
      }
    }

    // 3. Anti-Call (Kick Loop)
    if (this.features.antiCall.enabled && this.features.antiCall.targets.has(userId)) {
      if (channelId && guildId) {
        this.stats.antiCallKicks++;
        this.engine.log(
          'coleira',
          `[ANTI-CALL] Alvo ${this.engine.getUserLabel(userId)} entrou em ${this.engine.getChannelLabel(guildId, channelId)}. Desconectando...`
        );
        this.patchGuildMemberVoice(guildId, userId, { channel_id: null }, 'ANTI-CALL');
        this.engine.emitDelta('voice_update', { guildId, userId, channelId: null });
        return;
      }
    }

    // 4. Coleira
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
            this.engine.log(
              'coleira',
              `[COLEIRA] ${this.engine.getUserLabel(userId)} puxado para ${this.engine.getChannelLabel(anchorGuildId, anchorChannelId)}!`
            );
          }
          this.patchGuildMemberVoice(guildId, userId, patch, 'COLEIRA');
        }
      }
    }

    // 5. Mute-Lock
    if (this.features.muteLock.enabled && this.features.muteLock.targets.has(userId)) {
      if (channelId && guildId) {
        const needMute = this.features.muteLock.mute && !d.mute;
        const needDeaf = this.features.muteLock.deaf && !d.deaf;
        if (needMute || needDeaf) {
          const patch = {};
          if (needMute) patch.mute = true;
          if (needDeaf) patch.deaf = true;
          const mlKey = `${guildId}:${userId}:${JSON.stringify(patch)}`;
          this.inFlightMemberOps.delete(mlKey);
          this.engine.log('coleira', `[MUTE-LOCK] Reaplicando mute/deaf em ${this.engine.getUserLabel(userId)}.`);
          (async () => {
            const delays = [0, 300, 700, 1500];
            for (const wait of delays) {
              if (wait > 0) await new Promise((r) => setTimeout(r, wait));
              const cur = this.engine.voiceStates.get(guildId)?.get(userId);
              const stillNeedMute = patch.mute && cur && !cur.mute;
              const stillNeedDeaf = patch.deaf && cur && !cur.deaf;
              if (!stillNeedMute && !stillNeedDeaf) break;
              const curPatch = {};
              if (stillNeedMute) curPatch.mute = true;
              if (stillNeedDeaf) curPatch.deaf = true;
              const curKey = `${guildId}:${userId}:${JSON.stringify(curPatch)}`;
              this.inFlightMemberOps.delete(curKey);
              const r = await this.patchGuildMemberVoice(guildId, userId, curPatch, 'MUTE-LOCK');
              if (r?.ok || r?.status !== 403) break;
            }
          })();
        }
      }
    }

    // 6. Guard
    if (this.features.guard.enabled && this.features.guard.targets.has(userId)) {
      if (channelId && guildId) {
        const needUnmute = this.features.guard.antiMute && d.mute;
        const needUndeaf = this.features.guard.antiMute && d.deaf;
        const myCh =
          this.currentVoice.guildId === guildId ? this.currentVoice.channelId : null;
        const prevLoc = this.engine.userVoiceMap.get(userId);
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

          this.engine.log(
            'guard',
            `[GUARD] Protegendo aliado ${this.engine.getUserLabel(userId)} (${Object.keys(patch).join(', ')}).`
          );
          this.patchGuildMemberVoice(guildId, userId, patch, 'GUARD');
        }
      }
    }

    // Emite evento delta granular ao invés de full state dump
    this.engine.emitDelta('voice_update', { guildId, userId, channelId });
  }

  startWatchdog() {
    clearInterval(this.watchdogTimer);
    this.watchdogTimer = setInterval(() => {
      if (this.engine.status !== 'connected') return;

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

      if (this.features.followCall.enabled && this.features.followCall.targetUserId) {
        this.syncFollowTargetNow();
      }

      if (this.features.coleira.enabled && this.features.coleira.targets.size > 0) {
        this.enforceColeiraAll();
      }

      if (this.features.antiCall.enabled && this.features.antiCall.targets.size > 0) {
        for (const targetId of this.features.antiCall.targets) {
          const loc = this.engine.userVoiceMap.get(String(targetId));
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

    const targetId = String(this.features.chaoticMover.targetUserId).trim();
    if (!this.features.chaoticMover.guildId || this.features.chaoticMover.guildId === 'null') {
      const loc = this.engine.userVoiceMap.get(targetId);
      this.features.chaoticMover.guildId =
        loc?.guildId || this.engine.selectedGuildId || this.currentVoice.guildId || '';
    }

    if (!this.features.chaoticMover.guildId || this.features.chaoticMover.guildId === 'null') {
      this.engine.log('warn', '[CHAOS MOVER] Guild não encontrada para o alvo.');
      return;
    }

    let idx = 0;
    const interval = Math.max(600, Number(this.features.chaoticMover.intervalMs) || 1200);

    this.chaoticTimer = setInterval(() => {
      if (this.engine.status !== 'connected' || !this.features.chaoticMover.enabled) return;
      const gId = String(this.features.chaoticMover.guildId);

      const currentLoc = this.engine.userVoiceMap.get(targetId);
      const effectiveGuildId = currentLoc?.guildId || gId;

      const g = this.engine.guilds.get(effectiveGuildId);
      if (!g) return;

      const voiceChannels = Array.from(g.channels.values()).filter(
        (c) => c.type === 2 || c.type === 13
      );
      if (voiceChannels.length < 1) return;

      const currentChId = currentLoc?.channelId;
      const candidates = voiceChannels.length > 1
        ? voiceChannels.filter((c) => c.id !== currentChId)
        : voiceChannels;

      const nextChannel = candidates[idx % candidates.length];
      idx++;
      this.patchGuildMemberVoice(effectiveGuildId, targetId, { channel_id: nextChannel.id }, 'CHAOS-MOVER');
    }, interval);
  }

  destroy() {
    clearInterval(this.watchdogTimer);
    clearInterval(this.chaoticTimer);
    this.watchdogTimer = null;
    this.chaoticTimer = null;
    this.inFlightMemberOps.clear();
  }
}


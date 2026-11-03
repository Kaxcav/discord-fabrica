import { Router } from 'express';

const router = Router();

// Anti-Disconnect
router.post('/features/anti-disconnect', async (req, res) => {
  const bot = req.bot;
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

  if (bot.features.antiDisconnect.enabled && !bot.features.antiDisconnect.channelId) {
    const selfLoc = bot.user?.id ? bot.userVoiceMap.get(String(bot.user.id)) : null;
    bot.features.antiDisconnect.guildId =
      bot.currentVoice.guildId || selfLoc?.guildId || bot.selectedGuildId;
    bot.features.antiDisconnect.channelId =
      bot.currentVoice.channelId || selfLoc?.channelId || null;
  }

  if (bot.features.antiDisconnect.enabled && bot.features.antiDisconnect.channelId) {
    const selfLoc = bot.user?.id ? bot.userVoiceMap.get(String(bot.user.id)) : null;
    const curCh = bot.currentVoice.channelId || selfLoc?.channelId || null;
    if (curCh !== bot.features.antiDisconnect.channelId || bot.ipc.isConnected()) {
      await bot.autoVoiceSelect(
        bot.features.antiDisconnect.guildId,
        bot.features.antiDisconnect.channelId
      );
    }
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

// Anti-Mute
router.post('/features/anti-mute', (req, res) => {
  const bot = req.bot;
  const { enabled, unmute, undeaf } = req.body || {};
  if (enabled !== undefined) bot.features.antiMute.enabled = Boolean(enabled);
  if (unmute !== undefined) bot.features.antiMute.unmute = Boolean(unmute);
  if (undeaf !== undefined) bot.features.antiMute.undeaf = Boolean(undeaf);

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

// Seguir Call (Stalker)
router.post('/features/follow', async (req, res) => {
  const bot = req.bot;
  const { enabled, targetUserId, delayMs, leaveWhenTargetLeaves, syncAntiDisconnect } = req.body || {};

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

// Coleira com Âncora
router.post('/features/coleira', async (req, res) => {
  const bot = req.bot;
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

// Anti-Call (Kick Loop)
router.post('/features/anti-call', async (req, res) => {
  const bot = req.bot;
  const { enabled, action, targetUserId } = req.body || {};

  if (action === 'add' && targetUserId) {
    const id = String(targetUserId).trim();
    bot.features.antiCall.targets.add(id);
    bot.features.antiCall.enabled = true;
    await bot.resolveUser(id);
    bot.log('coleira', `[ANTI-CALL] ${bot.getUserLabel(id)} adicionado ao Kick Loop!`);

    const targetGuildId = bot.resolveTargetGuildId(id);
    if (targetGuildId) {
      bot.patchGuildMemberVoice(targetGuildId, id, { channel_id: null }, 'ANTI-CALL');
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

// Mute-Lock
router.post('/features/mute-lock', async (req, res) => {
  const bot = req.bot;
  const { enabled, action, targetUserId, mute, deaf, kickFallback } = req.body || {};
  if (mute !== undefined) bot.features.muteLock.mute = Boolean(mute);
  if (deaf !== undefined) bot.features.muteLock.deaf = Boolean(deaf);
  if (kickFallback !== undefined) bot.features.muteLock.kickFallback = Boolean(kickFallback);

  if (action === 'add' && targetUserId) {
    const id = String(targetUserId).trim();
    bot.features.muteLock.targets.add(id);
    bot.features.muteLock.enabled = true;
    await bot.resolveUser(id);
    bot.log('coleira', `[MUTE-LOCK] ${bot.getUserLabel(id)} adicionado ao Mute-Lock.`);

    const targetGuildId = bot.resolveTargetGuildId(id);
    if (targetGuildId) {
      const curVs = bot.voiceStates.get(targetGuildId)?.get(id);
      await bot.voiceManager.enforceMuteLock(targetGuildId, id, curVs);
    }
  } else if (action === 'remove' && targetUserId) {
    bot.features.muteLock.targets.delete(String(targetUserId).trim());
    if (bot.features.muteLock.targets.size === 0) {
      bot.features.muteLock.enabled = false;
    }
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

// Guard de Aliados
router.post('/features/guard', async (req, res) => {
  const bot = req.bot;
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

// Chaos Mover
router.post('/features/chaotic-mover', async (req, res) => {
  const bot = req.bot;
  const { enabled, targetUserId, guildId, intervalMs } = req.body || {};
  if (targetUserId !== undefined) bot.features.chaoticMover.targetUserId = String(targetUserId).trim();
  if (guildId != null) bot.features.chaoticMover.guildId = String(guildId).trim();
  if (intervalMs !== undefined) bot.features.chaoticMover.intervalMs = Math.max(600, Number(intervalMs) || 1200);
  if (enabled !== undefined) bot.features.chaoticMover.enabled = Boolean(enabled);

  bot.updateChaoticMover();
  bot.log(
    'voice',
    `[CHAOS MOVER] ${bot.features.chaoticMover.enabled ? 'Ativado' : 'Desativado'} (alvo: ${bot.getUserLabel(bot.features.chaoticMover.targetUserId) || 'nenhum'}, intervalo: ${bot.features.chaoticMover.intervalMs}ms)`
  );
  bot.broadcastState();
  res.json({ ok: true, state: bot.getPublicState() });
});

// Presence (suporta /api/presence e /api/features/presence)
function handlePresence(req, res) {
  const bot = req.bot;
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
}

router.post('/presence', handlePresence);
router.post('/features/presence', handlePresence);

// Automation (Auto-Reply & Nitro Sniper)
router.post('/features/automation', (req, res) => {
  const bot = req.bot;
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

export default router;


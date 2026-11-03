import { Router } from 'express';
import { sessions } from '../middleware/session.js';

const router = Router();

function resolveIpcTargetBots(req, userId = null) {
  const targets = new Set();
  if (req.bot) {
    targets.add(req.bot);
  }
  const targetUid = userId ? String(userId).trim() : null;
  for (const bot of sessions.values()) {
    if (!bot) continue;
    if (targetUid && bot.user?.id && String(bot.user.id) === targetUid) {
      targets.add(bot);
    } else if (!targetUid && (bot.status === 'connected' || bot.token)) {
      targets.add(bot);
    }
  }
  return Array.from(targets);
}

// Selecionar Servidor
router.post('/guild/select', async (req, res) => {
  const bot = req.bot;
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

// Entrar em Canal de Voz
router.post('/voice/join', async (req, res) => {
  const bot = req.bot;
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

  let sent = false;
  if (bot.voiceManager.isDesktopVoiceSession()) {
    sent = await bot.autoVoiceSelect(gId, cId);
  } else {
    sent = bot.sendVoiceState(gId, cId);
  }
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

// Desconectar da Voz
router.post('/voice/leave', (req, res) => {
  const bot = req.bot;
  bot._ignoreAntiDisconnectUntil = Date.now() + 4000;
  bot.features.antiDisconnect.enabled = false;
  bot.features.followCall.enabled = false;
  if (bot.voiceConfig.fakeStream) {
    bot.stopFakeStream();
    bot.voiceConfig.fakeStream = false;
  }
  if (bot.voiceConfig.useIpcForAutoVoice && bot.ipc.isConnected()) {
    bot.ipc.sendCommand('SELECT_VOICE_CHANNEL', { channel_id: null, force: true }).catch(() => {});
  }
  if (!bot.voiceManager.isDesktopVoiceSession()) {
    bot.sendVoiceState(null, null);
  }
  bot.currentVoice.channelId = null;
  bot.currentVoice.guildId = null;
  bot.log('voice', 'Desconectado da call pelo painel.');
  bot.broadcastState();
  res.json({ ok: true, state: bot.getPublicState() });
});

// Configuração de Voz
router.post('/voice/config', (req, res) => {
  const bot = req.bot;
  const { selfMute, selfDeaf, selfVideo, fakeStream, useIpcForAutoVoice } = req.body || {};
  const prevStream = bot.voiceConfig.fakeStream;

  if (selfMute !== undefined) bot.voiceConfig.selfMute = Boolean(selfMute);
  if (selfDeaf !== undefined) bot.voiceConfig.selfDeaf = Boolean(selfDeaf);
  if (selfVideo !== undefined) bot.voiceConfig.selfVideo = Boolean(selfVideo);
  if (fakeStream !== undefined) bot.voiceConfig.fakeStream = Boolean(fakeStream);
  if (useIpcForAutoVoice !== undefined) bot.voiceConfig.useIpcForAutoVoice = Boolean(useIpcForAutoVoice);

  // Descobre a localização atual na call (currentVoice > voiceConfig > userVoiceMap > selectedGuild)
  const userLoc = bot.user ? bot.userVoiceMap.get(String(bot.user.id)) : null;
  const gId = bot.currentVoice.guildId || bot.voiceConfig.guildId || userLoc?.guildId || bot.selectedGuildId || null;
  const cId = bot.currentVoice.channelId || bot.voiceConfig.channelId || userLoc?.channelId || null;

  const voiceStateChanged = selfMute !== undefined || selfDeaf !== undefined || selfVideo !== undefined || fakeStream !== undefined;

  if (cId && voiceStateChanged && !bot.voiceManager.isDesktopVoiceSession()) {
    bot.sendVoiceState(gId, cId);
    bot.log(
      'voice',
      `[VOZ] Estado atualizado na call ${bot.getChannelLabel(gId, cId)} (mute=${bot.voiceConfig.selfMute}, deaf=${bot.voiceConfig.selfDeaf}, cam=${bot.voiceConfig.selfVideo}, live=${bot.voiceConfig.fakeStream})`
    );
    if (bot.voiceConfig.fakeStream && !prevStream && gId) {
      bot.startFakeStream(gId, cId);
    } else if (!bot.voiceConfig.fakeStream && prevStream) {
      bot.stopFakeStream();
    }
  } else if (!cId && voiceStateChanged) {
    bot.log(
      'voice',
      `[VOZ PRE-CONFIG] Configurações alteradas (mute=${bot.voiceConfig.selfMute}, deaf=${bot.voiceConfig.selfDeaf}, cam=${bot.voiceConfig.selfVideo}). Serão aplicadas ao entrar em call.`
    );
  }

  bot.broadcastState();
  res.json({ ok: true, config: bot.voiceConfig, state: bot.getPublicState() });
});

// Ações diretas de membro na call (Mute, Deaf, Kick, Move, Pull)
router.post('/voice/member-action', async (req, res) => {
  const bot = req.bot;
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
// Rotas de Sincronização do Remote PC Bridge (IPC Local <-> Painel Nuvem)
// ============================================================================
router.post('/voice/ipc-register', async (req, res) => {
  const { user, userId, source, currentVoiceChannel } = req.body || {};
  const targetUid = user?.id || userId || null;
  const bots = resolveIpcTargetBots(req, targetUid);

  let accessToken = null;
  let antiDisconnect = null;
  const pending = [];

  for (const bot of bots) {
    bot.ipc.registerRemoteBridge({
      user: user || (targetUid ? { id: String(targetUid) } : null),
      source: source || 'PC Bridge',
      currentVoiceChannel,
    });
    if (!accessToken && bot.token) {
      accessToken = await bot.ipc.getRpcAccessToken(false, targetUid);
    }
    if (bot.features?.antiDisconnect?.enabled && bot.features.antiDisconnect.channelId) {
      antiDisconnect = { ...bot.features.antiDisconnect };
    }
    pending.push(...bot.ipc.getPendingRemoteCommands());
  }

  res.json({
    ok: true,
    matchedSessions: bots.length,
    accessToken,
    antiDisconnect,
    pending,
  });
});

router.get('/voice/ipc-pending', async (req, res) => {
  const targetUid = req.query?.userId || null;
  const bots = resolveIpcTargetBots(req, targetUid);
  const pending = [];
  let accessToken = null;
  let antiDisconnect = null;

  for (const bot of bots) {
    bot.ipc.remoteConnected = true;
    bot.ipc.remoteLastSeen = Date.now();
    if (!accessToken && bot.token) {
      accessToken = await bot.ipc.getRpcAccessToken(false, targetUid);
    }
    if (bot.features?.antiDisconnect?.enabled && bot.features.antiDisconnect.channelId) {
      antiDisconnect = { ...bot.features.antiDisconnect };
    }
    pending.push(...bot.ipc.getPendingRemoteCommands());
  }

  res.json({ ok: true, accessToken, antiDisconnect, pending });
});

router.post('/voice/ipc-result', (req, res) => {
  const { requestId, ok, data, error, code } = req.body || {};
  if (!requestId) {
    return res.status(400).json({ error: 'requestId obrigatório' });
  }

  let resolved = false;
  if (req.bot && req.bot.ipc.resolveRemoteCommand(requestId, { ok, data, error, code })) {
    resolved = true;
  } else {
    for (const bot of sessions.values()) {
      if (bot.ipc.resolveRemoteCommand(requestId, { ok, data, error, code })) {
        resolved = true;
        break;
      }
    }
  }

  res.json({ ok: true, resolved });
});

router.get('/voice/ipc-status', (req, res) => {
  const bot = req.bot;
  if (!bot) {
    return res.json({ ok: true, connected: false, mode: 'disconnected' });
  }
  res.json({
    ok: true,
    connected: bot.ipc.isConnected(),
    mode: bot.ipc.getMode(),
    desktopUser: bot.ipc.remoteDesktopUser,
  });
});

export default router;


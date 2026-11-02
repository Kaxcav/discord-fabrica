import { Router } from 'express';

const router = Router();

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
router.post('/voice/join', (req, res) => {
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
  bot.sendVoiceState(null, null);
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

  const gId = bot.currentVoice.guildId || bot.voiceConfig.guildId;
  const cId = bot.currentVoice.channelId || bot.voiceConfig.channelId;

  const voiceStateChanged = selfMute !== undefined || selfDeaf !== undefined || selfVideo !== undefined || fakeStream !== undefined;

  if (cId && voiceStateChanged) {
    bot.sendVoiceState(gId, cId);
    if (bot.voiceConfig.fakeStream && !prevStream && gId) {
      bot.startFakeStream(gId, cId);
    } else if (!bot.voiceConfig.fakeStream && prevStream) {
      bot.stopFakeStream();
    }
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

export default router;

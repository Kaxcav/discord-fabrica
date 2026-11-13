import { Router } from 'express';

const router = Router();

// Ghost Ping
router.post('/chat/ghost-ping', async (req, res) => {
  const bot = req.bot;
  const { channelId, targetUserId, customText } = req.body || {};
  if (!bot.token || !channelId || !targetUserId) {
    return res.status(400).json({ error: 'channelId e targetUserId são obrigatórios' });
  }

  const result = await bot.chatManager.sendGhostPing(channelId, targetUserId, customText);
  if (!result.ok) {
    return res.status(400).json({ error: result.error });
  }

  bot.broadcastState();
  res.json({ ok: true });
});

// Purge no canal/DM
router.post('/chat/purge', async (req, res) => {
  const bot = req.bot;
  const { channelId, limit = 25 } = req.body || {};
  if (!bot.token || !bot.user || !channelId) {
    return res.status(400).json({ error: 'Conecte o selfbot e informe o channelId' });
  }

  try {
    const result = bot.chatManager.startPurge(channelId, limit);
    res.json({
      ok: true,
      taskId: result.taskId,
      message: `Purge iniciado para até ${result.maxToDelete} mensagens`,
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Limpar DM
router.post('/limpar-dm', async (req, res) => {
  const bot = req.bot;
  const { targetId, delayMs = 700 } = req.body || {};
  if (!bot.token || !bot.user) {
    return res.status(400).json({ error: 'Conecte o selfbot primeiro' });
  }
  if (!targetId) {
    return res.status(400).json({ error: 'targetId obrigatório (User ID ou Channel ID de DM)' });
  }

  try {
    const result = await bot.chatManager.startLimparDm(targetId, delayMs);
    res.json({
      ok: true,
      taskId: result.taskId,
      username: result.username,
      userId: result.userId,
      channelId: result.channelId,
      avatarUrl: result.avatarUrl,
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Enviar Mensagem / Repetidor Controlado
router.post('/chat/send', async (req, res) => {
  const bot = req.bot;
  const { channelId, content, count = 1, delayMs = 1200 } = req.body || {};
  if (!bot.token || !channelId || !content) {
    return res.status(400).json({ error: 'channelId e content são obrigatórios' });
  }

  const total = Math.min(50, Math.max(1, Number(count) || 1));
  res.json({ ok: true, queued: total });

  (async () => {
    for (let i = 0; i < total; i++) {
      const r = await bot.request(
        'POST',
        `/channels/${channelId}/messages`,
        {
          content: String(content),
          nonce: String(Date.now() * 1000 + i),
          tts: false,
        }
      );
      if (!r.ok) {
        bot.log('error', `[CHAT] Falha ao enviar mensagem (${i + 1}/${total}): ${r.error || 'Erro'}`);
        break;
      }
      if (total > 1 && i < total - 1) {
        await new Promise((resolve) => setTimeout(resolve, Math.max(400, Number(delayMs) || 1200)));
      }
    }
    bot.log('success', `[CHAT] Envio concluído (${total} msg) para ${channelId}.`);
  })();
});

export default router;

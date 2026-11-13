import { Router } from 'express';

const router = Router();

// Criar Convites em Lote
router.post('/batch/invites', async (req, res) => {
  const bot = req.bot;
  try {
    const result = await bot.factoryManager.createBatchInvites(req.body || {});
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Criar Cargos em Lote
router.post('/batch/roles', async (req, res) => {
  const bot = req.bot;
  try {
    const result = await bot.factoryManager.createBatchRoles(req.body || {});
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Criar Canais em Lote
router.post('/batch/channels', async (req, res) => {
  const bot = req.bot;
  try {
    const result = await bot.factoryManager.createBatchChannels(req.body || {});
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Nuke de Canal (Deletar e recriar com mesmos cargos/permissões)
router.post('/channel/nuke', async (req, res) => {
  const bot = req.bot;
  const { channelId } = req.body || {};
  try {
    const result = await bot.factoryManager.nukeChannel(channelId);
    res.json({ ok: true, newChannelId: result.newChannelId, state: bot.getPublicState() });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

export default router;


import { Router } from 'express';
import { PANEL_PIN } from '../middleware/pin.js';
import { scanLocalTokens } from '../config/platform.js';

const router = Router();

// Configuração do painel
router.get('/panel/config', (req, res) => {
  res.json({ pinRequired: Boolean(PANEL_PIN) });
});

// Verificação de PIN
router.post('/panel/verify', (req, res) => {
  const { pin } = req.body || {};
  if (!PANEL_PIN) {
    return res.json({ ok: true });
  }
  if (String(pin).trim() === PANEL_PIN) {
    return res.json({ ok: true });
  }
  res.status(401).json({ ok: false, error: 'PIN incorreto' });
});

// Estado público da sessão
router.get('/state', (req, res) => {
  const bot = req.bot;
  res.json(bot.getPublicState());
});

// SSE delta streams por sessão
router.get('/events', (req, res) => {
  const bot = req.bot;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  bot.sseClients.add(res);

  // Envia estado inicial completo para sincronizar cliente
  res.write(`event: state\ndata: ${JSON.stringify(bot.getPublicState())}\n\n`);

  req.on('close', () => {
    bot.sseClients.delete(res);
  });
});

// Autenticação e conexão ao Discord
router.post('/auth', async (req, res) => {
  const bot = req.bot;
  const { token, guildId } = req.body || {};
  if (!token) return res.status(400).json({ error: 'Token é obrigatório' });

  try {
    const user = await bot.connect(token, guildId || null);
    res.json({ ok: true, user, state: bot.getPublicState() });
  } catch (error) {
    bot.log('error', `Falha de autenticação: ${error.message}`);
    res.status(400).json({ error: error.message, state: bot.getPublicState() });
  }
});

// Desconexão
router.post('/disconnect', (req, res) => {
  const bot = req.bot;
  bot.disconnect(true);
  res.json({ ok: true, state: bot.getPublicState() });
});

// Scanner de tokens locais
router.get('/tokens/scan', async (req, res) => {
  try {
    const tokens = scanLocalTokens();
    const validated = await Promise.all(
      tokens.map(async (t) => {
        try {
          const r = await req.bot.requestQueue.request(t, 'GET', '/users/@me', undefined, { retries: 0 });
          if (r.ok && r.data?.id) {
            return {
              token: t,
              valid: true,
              username: r.data.global_name || r.data.username,
              id: r.data.id,
            };
          }
        } catch {}
        return { token: t, valid: false };
      })
    );
    const validTokens = validated.filter((t) => t.valid);
    res.json({ ok: true, tokens, validated, validTokens });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

export default router;

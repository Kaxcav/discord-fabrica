import { Router } from 'express';
import { Priority } from '../core/RequestQueue.js';

const router = Router();

// Diagnóstico de Permissões do Selfbot no Servidor
router.get('/debug/permissions/:guildId', async (req, res) => {
  const bot = req.bot;
  try {
    const { guildId } = req.params;
    if (!bot.token || !bot.user?.id) {
      return res.status(400).json({ ok: false, error: 'Selfbot não conectado' });
    }

    const [memberRes, guildRes] = await Promise.all([
      bot.request('GET', `/guilds/${guildId}/members/${bot.user.id}`, undefined, { priority: Priority.INTERACTIVE }),
      bot.request('GET', `/guilds/${guildId}`, undefined, { priority: Priority.INTERACTIVE }),
    ]);

    if (!memberRes.ok) return res.json({ ok: false, error: memberRes.error });

    const member = memberRes.data;
    const guild = guildRes.data;
    const roles = guild?.roles || [];

    const MUTE_MEMBERS = BigInt(1 << 22);
    const ADMINISTRATOR = BigInt(1 << 3);

    let perms = BigInt(0);
    for (const role of roles) {
      if (role.id === guildId) {
        perms |= BigInt(role.permissions || '0');
      }
    }
    for (const roleId of member.roles || []) {
      const role = roles.find((r) => r.id === roleId);
      if (role) perms |= BigInt(role.permissions || '0');
    }

    const isAdmin = (perms & ADMINISTRATOR) !== BigInt(0);
    const canMute = isAdmin || (perms & MUTE_MEMBERS) !== BigInt(0);
    const isOwner = guild?.owner_id === bot.user?.id;

    const memberRoles = (member.roles || [])
      .map((rid) => {
        const r = roles.find((role) => role.id === rid);
        return r ? { id: rid, name: r.name, position: r.position, permissions: r.permissions } : { id: rid };
      })
      .sort((a, b) => (b.position || 0) - (a.position || 0));

    res.json({
      ok: true,
      canMute,
      isAdmin,
      isOwner,
      perms: perms.toString(),
      memberRoles,
      guildOwnerId: guild?.owner_id,
    });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

// Limpar Logs da Sessão
router.post('/logs/clear', (req, res) => {
  const bot = req.bot;
  bot.logs = [];
  bot.broadcastState();
  res.json({ ok: true });
});

export default router;

import { delay } from '../../config/constants.js';
import { Priority } from '../../core/RequestQueue.js';

export class FactoryManager {
  constructor(engine) {
    this.engine = engine;
  }

  async createBatchInvites(params = {}) {
    const { token, guildId, channels = [], maxAge = 0, maxUses = 0 } = params;
    const activeToken = token || this.engine.token;
    const activeGuildId = String(guildId || this.engine.selectedGuildId || '');

    let targetChannels = Array.isArray(channels) ? channels.filter(Boolean) : [];
    if (targetChannels.length === 0 && activeGuildId && this.engine.guilds.has(activeGuildId)) {
      const g = this.engine.guilds.get(activeGuildId);
      targetChannels = Array.from(g.channels.values())
        .filter((c) => c.type === 0 || c.type === 2)
        .slice(0, 10)
        .map((c) => c.id);
    }

    if (!activeToken || !targetChannels.length) {
      throw new Error('Selecione canais válidos para criar convites');
    }

    const createdCodes = [];
    (async () => {
      for (const chId of targetChannels) {
        const r = await this.engine.request(
          'POST',
          `/channels/${chId}/invites`,
          {
            max_age: Number(maxAge) || 0,
            max_uses: Number(maxUses) || 0,
            temporary: false,
            unique: true,
          },
          { priority: Priority.BULK }
        );

        if (r.ok && r.data?.code) {
          createdCodes.push(`https://discord.gg/${r.data.code}`);
          this.engine.log(
            'success',
            `[CONVITE] Criado em ${this.engine.getChannelLabel(activeGuildId, chId)}: https://discord.gg/${r.data.code}`
          );
        } else {
          this.engine.log('error', `[CONVITE] Falha no canal ${chId}: ${r.error || 'Erro desconhecido'}`);
        }
        await delay(750 + Math.random() * 400);
      }
      this.engine.broadcastState();
    })();

    return { queued: targetChannels.length, message: 'Criando convites em lote...' };
  }

  async createBatchRoles(params = {}) {
    const { token, guildId, roles = [], name, color, count = 1, permissions = '0', hoist = false } = params;
    const activeToken = token || this.engine.token;
    const activeGuildId = String(guildId || this.engine.selectedGuildId || '');

    let rolePayloads = Array.isArray(roles) && roles.length > 0 ? roles : [];
    if (rolePayloads.length === 0 && name) {
      const qty = Math.min(50, Math.max(1, Number(count) || 1));
      rolePayloads = Array.from({ length: qty }, (_, i) => ({
        name: qty > 1 ? `${name} #${i + 1}` : name,
        color: typeof color === 'string' ? parseInt(color.replace('#', ''), 16) || 0 : Number(color) || 0,
        permissions: String(permissions || '0'),
        hoist: Boolean(hoist),
        mentionable: true,
      }));
    }

    if (!activeToken || !activeGuildId || !rolePayloads.length) {
      throw new Error('token, guildId e cargos são obrigatórios');
    }

    (async () => {
      for (const r of rolePayloads) {
        const out = await this.engine.request(
          'POST',
          `/guilds/${activeGuildId}/roles`,
          {
            name: r.name || 'Novo Cargo',
            permissions: String(r.permissions || '0'),
            color: Number(r.color) || 0,
            hoist: Boolean(r.hoist),
            mentionable: Boolean(r.mentionable),
          },
          { priority: Priority.BULK }
        );

        if (out.ok && out.data?.id) {
          this.engine.log('success', `[CARGO] Criado cargo "${out.data.name}" (${out.data.id})`);
        } else {
          this.engine.log('error', `[CARGO] Falha ao criar "${r.name}": ${out.error || 'Erro desconhecido'}`);
        }
        await delay(800 + Math.random() * 400);
      }
      await this.engine.selectGuild(activeGuildId);
    })();

    return { queued: rolePayloads.length, message: `Criando ${rolePayloads.length} cargo(s)...` };
  }

  async createBatchChannels(params = {}) {
    const { token, guildId, channels = [], name, type = 0, count = 1, parentId = null } = params;
    const activeToken = token || this.engine.token;
    const activeGuildId = String(guildId || this.engine.selectedGuildId || '');

    let channelPayloads = Array.isArray(channels) && channels.length > 0 ? channels : [];
    if (channelPayloads.length === 0 && name) {
      const qty = Math.min(50, Math.max(1, Number(count) || 1));
      channelPayloads = Array.from({ length: qty }, (_, i) => ({
        name: qty > 1 ? `${name}-${i + 1}` : name,
        type: Number(type) || 0,
        parent_id: parentId || null,
      }));
    }

    if (!activeToken || !activeGuildId || !channelPayloads.length) {
      throw new Error('token, guildId e canais são obrigatórios');
    }

    (async () => {
      for (const ch of channelPayloads) {
        const out = await this.engine.request(
          'POST',
          `/guilds/${activeGuildId}/channels`,
          {
            name: ch.name || 'novo-canal',
            type: Number(ch.type) || 0,
            topic: ch.topic || '',
            bitrate: ch.bitrate || 64000,
            user_limit: ch.user_limit || 0,
            nsfw: Boolean(ch.nsfw),
            parent_id: ch.parent_id || null,
          },
          { priority: Priority.BULK }
        );

        if (out.ok && out.data?.id) {
          this.engine.log('success', `[CANAL] Criado canal #${out.data.name} (${out.data.id})`);
        } else {
          this.engine.log('error', `[CANAL] Falha ao criar "${ch.name}": ${out.error || 'Erro desconhecido'}`);
        }
        await delay(800 + Math.random() * 400);
      }
      await this.engine.selectGuild(activeGuildId);
    })();

    return { queued: channelPayloads.length, message: `Criando ${channelPayloads.length} canal(is)...` };
  }

  async nukeChannel(channelId) {
    if (!this.engine.token || !channelId) {
      throw new Error('channelId obrigatório');
    }

    const chRes = await this.engine.request('GET', `/channels/${channelId}`, undefined, {
      priority: Priority.INTERACTIVE,
    });
    if (!chRes.ok || !chRes.data?.guild_id) {
      throw new Error(chRes.error || 'Canal não encontrado');
    }

    const ch = chRes.data;
    const createRes = await this.engine.request(
      'POST',
      `/guilds/${ch.guild_id}/channels`,
      {
        name: ch.name,
        type: ch.type,
        topic: ch.topic || '',
        nsfw: Boolean(ch.nsfw),
        bitrate: ch.bitrate || 64000,
        user_limit: ch.user_limit || 0,
        rate_limit_per_user: ch.rate_limit_per_user || 0,
        position: ch.position || 0,
        parent_id: ch.parent_id || null,
        permission_overwrites: ch.permission_overwrites || [],
      },
      { priority: Priority.INTERACTIVE }
    );

    if (!createRes.ok || !createRes.data?.id) {
      throw new Error(createRes.error || 'Falha ao clonar canal');
    }

    await this.engine.request('DELETE', `/channels/${channelId}`, undefined, {
      priority: Priority.INTERACTIVE,
    });

    this.engine.log('success', `[NUKE CANAL] Canal #${ch.name} recriado do zero (novo ID: ${createRes.data.id}).`);
    await this.engine.selectGuild(ch.guild_id);
    return { ok: true, newChannelId: createRes.data.id };
  }
}

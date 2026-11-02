import { generateSnowflakeNonce, delay } from '../../config/constants.js';
import { Priority } from '../../core/RequestQueue.js';

export class AutomationManager {
  constructor(engine) {
    this.engine = engine;
    this.autoReplyCooldowns = new Map();
  }

  get features() {
    return this.engine.features;
  }

  get stats() {
    return this.engine.stats;
  }

  setupEventListeners() {
    this.engine.eventBus.on('MESSAGE_CREATE', (message) => {
      this.handleMessageCreate(message).catch((err) => {
        this.engine.log('error', `[AUTOMATION] Erro ao processar mensagem: ${err.message || err}`);
      });
    });
  }

  async handleMessageCreate(d) {
    if (!d || !d.content || !this.engine.token || !this.engine.user) return;
    const authorId = String(d.author?.id || '');
    const myId = String(this.engine.user.id || '');

    // Ignora mensagens enviadas pelo próprio selfbot
    if (authorId === myId) return;

    const content = d.content || '';

    // 1. Nitro Sniper com delay humanizado anti-honeypot (180ms - 420ms)
    if (this.features.nitroSniper?.enabled && content.includes('discord.gift/')) {
      const matches = content.match(/discord\.gift\/([a-zA-Z0-9]{16,24})/g) || [];
      for (const m of matches) {
        const code = m.split('/')[1];
        this.engine.log('info', `[NITRO SNIPER] Código detectado (${code})! Agendando resgate com evasão...`);

        // Anti-honeypot delay humanizado
        const humanJitter = Math.floor(180 + Math.random() * 240);
        await delay(humanJitter);

        const res = await this.engine.request(
          'POST',
          `/entitlements/gift-codes/${code}/redeem`,
          { channel_id: d.channel_id },
          { priority: Priority.DEFENSIVE }
        );

        if (res.ok) {
          this.stats.nitroSniped = (this.stats.nitroSniped || 0) + 1;
          this.engine.log('success', `[NITRO SNIPER] Código ${code} resgatado com sucesso!`);
          this.engine.emitDelta('stats', { nitroSniped: this.stats.nitroSniped });
        } else {
          this.engine.log('warn', `[NITRO SNIPER] Falha no código ${code}: ${res.error || 'Erro desconhecido'}`);
        }
        this.engine.broadcastState();
      }
    }

    // 2. Auto-Reply
    if (this.features.autoReply?.enabled) {
      const isDm = !d.guild_id;
      const isMentioned =
        Array.isArray(d.mentions) &&
        d.mentions.some((u) => u.id === myId);

      if (this.features.autoReply.onlyDm && !isDm) return;
      if (this.features.autoReply.onlyMention && !isDm && !isMentioned) return;

      let replyText = '';

      // Verifica triggers customizados se houver
      if (this.features.autoReply.triggers && typeof this.features.autoReply.triggers === 'object') {
        const lowerContent = content.toLowerCase();
        for (const [kw, resp] of Object.entries(this.features.autoReply.triggers)) {
          if (kw && resp && lowerContent.includes(kw.toLowerCase())) {
            replyText = String(resp).trim();
            break;
          }
        }
      }

      // Se nenhum trigger específico combinou, usa a mensagem global se configurada
      if (!replyText && this.features.autoReply.message?.trim()) {
        replyText = this.features.autoReply.message.trim();
      }

      if (!replyText) return;

      const cooldownMs = (Number(this.features.autoReply.cooldownSec) || 15) * 1000;
      const lastReply = this.autoReplyCooldowns.get(authorId) || 0;
      if (Date.now() - lastReply < cooldownMs) return;

      this.autoReplyCooldowns.set(authorId, Date.now());

      setTimeout(async () => {
        try {
          // Simula digitação humana
          await this.engine.request('POST', `/channels/${d.channel_id}/typing`, undefined, {
            priority: Priority.INTERACTIVE,
          });

          await delay(900 + Math.random() * 800);

          const nonce = generateSnowflakeNonce();
          const ctxObj = { location: isDm ? 'DM' : 'Chat', location_guild_id: d.guild_id || null, location_channel_id: d.channel_id };
          const xCtx = Buffer.from(JSON.stringify(ctxObj)).toString('base64');

          await this.engine.request(
            'POST',
            `/channels/${d.channel_id}/messages`,
            {
              content: replyText,
              message_reference: { message_id: d.id, channel_id: d.channel_id },
              nonce,
              tts: false,
            },
            {
              priority: Priority.INTERACTIVE,
              extraHeaders: { 'X-Context-Properties': xCtx },
            }
          );

          this.engine.log('info', `[AUTO-REPLY] Respondido para ${d.author?.username || authorId}: "${replyText}"`);
        } catch (err) {
          this.engine.log('error', `[AUTO-REPLY] Erro ao responder: ${err.message || err}`);
        }
      }, 500);
    }
  }

  destroy() {
    this.autoReplyCooldowns.clear();
  }
}

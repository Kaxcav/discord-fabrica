import { generateSnowflakeNonce, delay } from '../../config/constants.js';
import { Priority } from '../../core/RequestQueue.js';

export class ChatManager {
  constructor(engine) {
    this.engine = engine;
    this.activeTasks = new Map(); // taskId -> { id, type, controller, startedAt }
  }

  cancelTask(taskId) {
    const task = this.activeTasks.get(taskId);
    if (!task) return false;
    task.controller.abort();
    this.activeTasks.delete(taskId);
    this.engine.log('warn', `[TASK] Tarefa ${taskId} (${task.type}) cancelada pelo usuário.`);
    this.engine.emitDelta('task_progress', {
      taskId,
      phase: 'cancelled',
      message: 'Operação cancelada pelo usuário.',
    });
    return true;
  }

  async sendGhostPing(channelId, targetUserId, customText = '') {
    if (!this.engine.token || !channelId || !targetUserId) {
      return { ok: false, error: 'channelId e targetUserId obrigatórios' };
    }

    const content = customText ? `${customText} <@${targetUserId}>` : `<@${targetUserId}>`;
    const nonce = generateSnowflakeNonce();
    const ctxObj = { location: 'Chat', location_guild_id: null, location_channel_id: channelId };
    const xCtx = Buffer.from(JSON.stringify(ctxObj)).toString('base64');

    const sendRes = await this.engine.request(
      'POST',
      `/channels/${channelId}/messages`,
      { content, nonce, tts: false },
      {
        priority: Priority.INTERACTIVE,
        extraHeaders: { 'X-Context-Properties': xCtx },
      }
    );

    if (!sendRes.ok || !sendRes.data?.id) {
      return { ok: false, error: sendRes.error || 'Falha ao enviar ghost ping' };
    }

    await delay(180);
    await this.engine.request(
      'DELETE',
      `/channels/${channelId}/messages/${sendRes.data.id}`,
      undefined,
      { priority: Priority.INTERACTIVE }
    );

    this.engine.log(
      'success',
      `[GHOST PING] Executado em ${this.engine.getUserLabel(targetUserId)} no canal ${channelId}.`
    );
    return { ok: true };
  }

  startPurge(rawChannelId, limit = 25) {
    if (!this.engine.token || !this.engine.user || !rawIdSafe(rawChannelId)) {
      throw new Error('Conecte o selfbot e informe o channelId');
    }

    const taskId = `purge-${Date.now()}`;
    const controller = new AbortController();
    this.activeTasks.set(taskId, { id: taskId, type: 'purge', controller, startedAt: Date.now() });

    const maxToDelete = Math.min(200, Math.max(1, Number(limit) || 25));

    (async () => {
      try {
        let channelId = String(rawChannelId).trim();
        const dmRes = await this.engine.request('POST', '/users/@me/channels', { recipient_id: channelId });
        if (dmRes.ok && dmRes.data?.id) {
          channelId = dmRes.data.id;
        }

        let deleted = 0;
        let beforeId = null;
        this.engine.log('info', `[PURGE] Buscando suas mensagens em ${channelId} (meta: ${maxToDelete})...`);

        while (deleted < maxToDelete && !controller.signal.aborted) {
          const qs = beforeId ? `?limit=100&before=${beforeId}` : '?limit=100';
          const msgRes = await this.engine.request('GET', `/channels/${channelId}/messages${qs}`, undefined, {
            priority: Priority.BULK,
            signal: controller.signal,
          });

          if (!msgRes.ok || !Array.isArray(msgRes.data) || msgRes.data.length === 0) break;

          const myId = String(this.engine.user.id);
          const myMsgs = msgRes.data.filter((m) => String(m.author?.id) === myId);
          beforeId = msgRes.data[msgRes.data.length - 1].id;

          for (const m of myMsgs) {
            if (deleted >= maxToDelete || controller.signal.aborted) break;
            const delRes = await this.engine.request(
              'DELETE',
              `/channels/${channelId}/messages/${m.id}`,
              undefined,
              { priority: Priority.BULK, signal: controller.signal }
            );
            if (delRes.ok) {
              deleted++;
              this.engine.emitDelta('task_progress', {
                taskId,
                phase: 'deleting',
                progress: deleted,
                total: maxToDelete,
              });
            }
            await delay(850 + Math.random() * 400);
          }

          if (msgRes.data.length < 100) break;
        }

        if (controller.signal.aborted) {
          this.engine.log('warn', `[PURGE] Interrompido. ${deleted} mensagem(ns) apagada(s).`);
        } else {
          this.engine.log('success', `[PURGE] Concluído! ${deleted} mensagem(ns) sua(s) apagada(s) em ${channelId}.`);
        }
      } catch (err) {
        if (err.name !== 'AbortError') {
          this.engine.log('error', `[PURGE] Erro: ${err.message || err}`);
        }
      } finally {
        this.activeTasks.delete(taskId);
      }
    })();

    return { ok: true, taskId, maxToDelete };
  }

  async startLimparDm(targetId, delayMs = 700) {
    if (!this.engine.token || !this.engine.user) {
      throw new Error('Conecte o selfbot primeiro');
    }
    if (!targetId) {
      throw new Error('targetId obrigatório (User ID ou Channel ID de DM)');
    }

    let channelId = String(targetId).trim();
    let username = channelId;
    let userId = null;
    let avatarUrl = null;

    const dmRes = await this.engine.request('POST', '/users/@me/channels', { recipient_id: channelId });
    if (dmRes.ok && dmRes.data?.id) {
      channelId = dmRes.data.id;
      const recipient = dmRes.data.recipients?.[0];
      if (recipient) {
        username = recipient.global_name || recipient.username || channelId;
        userId = recipient.id;
        if (recipient.avatar) {
          avatarUrl = `https://cdn.discordapp.com/avatars/${recipient.id}/${recipient.avatar}.png?size=128`;
        }
      }
    }

    const taskId = `limpar-dm-${Date.now()}`;
    const controller = new AbortController();
    this.activeTasks.set(taskId, { id: taskId, type: 'limpar-dm', controller, startedAt: Date.now() });

    (async () => {
      try {
        this.engine.log('info', `[LIMPAR-DM] Buscando mensagens com ${username}...`);
        const emitProgress = (payload) => {
          this.engine.broadcastSSE('limpar-dm', payload);
          this.engine.emitDelta('task_progress', payload);
        };

        emitProgress({
          taskId,
          phase: 'fetching',
          progress: 0,
          total: 0,
          username,
          avatarUrl,
          message: 'Buscando mensagens...',
        });

        const messages = [];
        let beforeId = null;
        let totalScanned = 0;

        while (!controller.signal.aborted) {
          const qs = beforeId ? `?limit=100&before=${beforeId}` : '?limit=100';
          const msgRes = await this.engine.request(
            'GET',
            `/channels/${channelId}/messages${qs}`,
            undefined,
            { priority: Priority.BULK, signal: controller.signal }
          );

          if (!msgRes.ok || !Array.isArray(msgRes.data) || msgRes.data.length === 0) break;

          totalScanned += msgRes.data.length;
          const myId = String(this.engine.user.id);
          const myMsgs = msgRes.data.filter((m) => String(m.author?.id) === myId);
          messages.push(...myMsgs);
          beforeId = msgRes.data[msgRes.data.length - 1].id;

          emitProgress({
            taskId,
            phase: 'fetching',
            progress: messages.length,
            total: totalScanned,
            username,
            avatarUrl,
            message: `${messages.length} mensagens encontradas...`,
          });

          if (msgRes.data.length < 100) break;
          await delay(400);
        }

        if (controller.signal.aborted) {
          emitProgress({ taskId, phase: 'cancelled', progress: 0, total: totalScanned, username, avatarUrl, message: 'Cancelado pelo usuário' });
          return;
        }

        if (messages.length === 0) {
          this.engine.log('info', `[LIMPAR-DM] Nenhuma mensagem para apagar com ${username}`);
          emitProgress({
            taskId,
            phase: 'completed',
            progress: 0,
            total: totalScanned,
            username,
            avatarUrl,
            message: 'Nenhuma mensagem encontrada',
          });
          return;
        }

        this.engine.log('info', `[LIMPAR-DM] ${messages.length} mensagens encontradas com ${username}, iniciando remoção...`);
        emitProgress({
          taskId,
          phase: 'deleting',
          progress: 0,
          total: messages.length,
          username,
          avatarUrl,
          message: `0/${messages.length} mensagens deletadas`,
        });

        let deleted = 0;
        for (const m of messages) {
          if (controller.signal.aborted) break;
          await this.engine.request('DELETE', `/channels/${channelId}/messages/${m.id}`, undefined, {
            priority: Priority.BULK,
            signal: controller.signal,
          });
          deleted++;
          emitProgress({
            taskId,
            phase: 'deleting',
            progress: deleted,
            total: messages.length,
            username,
            avatarUrl,
            message: `${deleted}/${messages.length} mensagens deletadas`,
          });
          await delay(Math.max(300, Number(delayMs) || 700));
        }

        if (controller.signal.aborted) {
          this.engine.log('warn', `[LIMPAR-DM] Cancelado. ${deleted} mensagens deletadas com ${username}`);
          emitProgress({ taskId, phase: 'cancelled', progress: deleted, total: messages.length, username, avatarUrl, message: `Cancelado: ${deleted} deletadas` });
        } else {
          this.engine.log('success', `[LIMPAR-DM] Concluído! ${deleted} mensagens deletadas com ${username}`);
          emitProgress({
            taskId,
            phase: 'completed',
            progress: deleted,
            total: messages.length,
            username,
            avatarUrl,
            message: `${deleted} mensagens deletadas`,
          });
        }
      } catch (err) {
        if (err.name !== 'AbortError') {
          this.engine.log('error', `[LIMPAR-DM] Erro: ${err.message || err}`);
          this.engine.broadcastSSE('limpar-dm', {
            taskId,
            phase: 'error',
            username,
            avatarUrl,
            message: String(err.message || err),
          });
        }
      } finally {
        this.activeTasks.delete(taskId);
      }
    })();

    return { ok: true, taskId, username, userId, channelId, avatarUrl };
  }

  destroy() {
    for (const [, task] of this.activeTasks) {
      try {
        task.controller.abort();
      } catch {}
    }
    this.activeTasks.clear();
  }
}

function rawIdSafe(id) {
  return typeof id === 'string' && id.trim().length > 0;
}

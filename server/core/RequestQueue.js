import { DISCORD_API, buildHeaders, delay } from '../config/constants.js';

export const Priority = {
  DEFENSIVE: 1,
  INTERACTIVE: 2,
  BULK: 3,
};

export class RequestQueue {
  constructor() {
    this.queue = [];
    this.isProcessing = false;
    this.routeBuckets = new Map(); // routeKey -> { resetAfter: 0, remaining: 1, limit: 5 }
    this.globalResetUntil = 0;
  }

  getRouteKey(endpoint, method) {
    const cleanEndpoint = endpoint.split('?')[0];
    // Agrupa sub-rotas com IDs comuns para rate-limit bucket
    const normalized = cleanEndpoint
      .replace(/\/channels\/\d+/g, '/channels/:id')
      .replace(/\/guilds\/\d+/g, '/guilds/:id')
      .replace(/\/messages\/\d+/g, '/messages/:id');
    return `${method}:${normalized}`;
  }

  async request(token, method, endpoint, body = undefined, options = {}) {
    const { priority = Priority.INTERACTIVE, signal = null, extraHeaders = {}, retries = 3 } = options;

    if (signal?.aborted) {
      const err = new Error('Operação cancelada');
      err.name = 'AbortError';
      throw err;
    }

    const routeKey = this.getRouteKey(endpoint, method);

    return new Promise((resolve, reject) => {
      const item = {
        token,
        method,
        endpoint,
        body,
        priority,
        signal,
        extraHeaders,
        retries,
        attempt: 0,
        routeKey,
        resolve,
        reject,
      };

      if (signal) {
        signal.addEventListener('abort', () => {
          const idx = this.queue.indexOf(item);
          if (idx !== -1) {
            this.queue.splice(idx, 1);
            const err = new Error('Operação cancelada');
            err.name = 'AbortError';
            reject(err);
          }
        });
      }

      this.enqueue(item);
    });
  }

  enqueue(item) {
    // Insere ordenado por prioridade (1 antes de 2 antes de 3)
    let insertIndex = this.queue.length;
    for (let i = 0; i < this.queue.length; i++) {
      if (this.queue[i].priority > item.priority) {
        insertIndex = i;
        break;
      }
    }
    this.queue.splice(insertIndex, 0, item);
    this.processNext();
  }

  async processNext() {
    if (this.isProcessing || this.queue.length === 0) return;
    this.isProcessing = true;

    while (this.queue.length > 0) {
      const now = Date.now();
      if (now < this.globalResetUntil) {
        await delay(this.globalResetUntil - now + 50);
      }

      const item = this.queue.shift();
      if (!item) break;

      if (item.signal?.aborted) {
        const err = new Error('Operação cancelada');
        err.name = 'AbortError';
        item.reject(err);
        continue;
      }

      const bucket = this.routeBuckets.get(item.routeKey);
      if (bucket && bucket.remaining <= 0 && now < bucket.resetUntil) {
        const waitTime = bucket.resetUntil - now;
        await delay(Math.min(waitTime + 50, 2500));
      }

      try {
        const result = await this.executeHttp(item);
        if (result.status === 429 && item.attempt < item.retries) {
          item.attempt++;
          const retryAfterSec = Number(result.data?.retry_after || 1.5);
          const waitMs = Math.ceil(retryAfterSec * 1000) + Math.floor(Math.random() * 200 + 100);

          if (result.data?.global) {
            this.globalResetUntil = Date.now() + waitMs;
          } else {
            this.routeBuckets.set(item.routeKey, {
              remaining: 0,
              resetUntil: Date.now() + waitMs,
            });
          }

          // Recoloca na fila com prioridade para tentar novamente
          this.enqueue(item);
          await delay(waitMs);
          continue;
        }

        item.resolve(result);
      } catch (err) {
        if (item.attempt < item.retries) {
          item.attempt++;
          await delay(500 * item.attempt);
          this.enqueue(item);
          continue;
        }
        item.resolve({ ok: false, status: 500, data: null, error: err.message || String(err) });
      }

      // Leaky bucket jitter entre requisições
      await delay(Math.floor(Math.random() * 60 + 40));
    }

    this.isProcessing = false;
  }

  async executeHttp(item) {
    const { token, method, endpoint, body, extraHeaders } = item;
    const url = endpoint.startsWith('http') ? endpoint : `${DISCORD_API}${endpoint}`;

    const options = {
      method,
      headers: buildHeaders(token, extraHeaders),
    };
    if (body !== undefined && method !== 'GET' && method !== 'HEAD') {
      options.body = JSON.stringify(body);
    }

    const res = await fetch(url, options);

    // Atualiza headers de rate limit do Discord
    const limitHeader = res.headers.get('x-ratelimit-limit');
    const remainingHeader = res.headers.get('x-ratelimit-remaining');
    const resetAfterHeader = res.headers.get('x-ratelimit-reset-after');

    if (resetAfterHeader) {
      const resetMs = Math.ceil(parseFloat(resetAfterHeader) * 1000);
      this.routeBuckets.set(item.routeKey, {
        limit: limitHeader ? parseInt(limitHeader, 10) : 5,
        remaining: remainingHeader ? parseInt(remainingHeader, 10) : 1,
        resetUntil: Date.now() + resetMs,
      });
    }

    if (res.status === 204) {
      return { ok: true, status: 204, data: null };
    }

    const data = await res.json().catch(() => ({}));

    return {
      ok: res.ok,
      status: res.status,
      data,
      error: !res.ok ? data.message || `HTTP ${res.status}` : null,
    };
  }
}

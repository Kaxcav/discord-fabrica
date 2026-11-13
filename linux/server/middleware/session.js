import { SelfbotEngine } from '../core/SelfbotEngine.js';

export const sessions = new Map();
export const SESSION_TTL_MS = 2 * 60 * 60 * 1000; // 2 horas
export const SESSION_CLEANUP_INTERVAL_MS = 30 * 60 * 1000; // 30 minutos
export const MAX_SESSIONS = 20;

const SESSION_ID_REGEX = /^[a-zA-Z0-9_-]{8,64}$/;

export function resolveSession(req, res, next) {
  // Rotas de configuração e verificação de painel não usam sessão
  const fullPath = req.baseUrl ? `${req.baseUrl}${req.path}` : req.path;
  if (
    fullPath === '/api/panel/verify' ||
    fullPath === '/api/panel/config' ||
    req.path === '/panel/verify' ||
    req.path === '/panel/config'
  ) {
    return next();
  }

  const rawSessionId = req.headers['x-session-id'] || req.query?.sid;
  const sessionId = typeof rawSessionId === 'string' ? rawSessionId.trim() : null;

  // Ponte IPC local pode sincronizar com sessões ativas sem criar sessão órfã
  if (
    req.headers['x-ipc-bridge'] === '1' &&
    (fullPath.startsWith('/api/voice/ipc-') || req.path.startsWith('/voice/ipc-'))
  ) {
    if (sessionId && sessions.has(sessionId)) {
      const bot = sessions.get(sessionId);
      bot.touch();
      req.session = { id: sessionId };
      req.bot = bot;
    } else {
      req.session = { id: sessionId || 'ipc-bridge' };
      req.bot = null;
    }
    return next();
  }

  if (!sessionId || !SESSION_ID_REGEX.test(sessionId)) {
    return res.status(401).json({ error: 'sessionId required' });
  }

  if (!sessions.has(sessionId)) {
    // Proteção contra DoS de Sessão: Máximo de 20 instâncias simultâneas
    if (sessions.size >= MAX_SESSIONS) {
      return res.status(429).json({
        error: 'Limite máximo de sessões concorrentes atingido. Tente novamente mais tarde.',
      });
    }

    const newEngine = new SelfbotEngine(sessionId);
    sessions.set(sessionId, newEngine);
  }

  const bot = sessions.get(sessionId);
  bot.touch();

  req.session = { id: sessionId };
  req.bot = bot;

  next();
}

let cleanupTimer = null;
export function startSessionCleanup() {
  if (cleanupTimer) clearInterval(cleanupTimer);
  cleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [sid, bot] of sessions.entries()) {
      if (now - (bot.lastActivity || 0) > SESSION_TTL_MS) {
        try {
          bot.destroy();
        } catch {}
        sessions.delete(sid);
      }
    }
  }, SESSION_CLEANUP_INTERVAL_MS);
  if (typeof cleanupTimer.unref === 'function') {
    cleanupTimer.unref();
  }
}

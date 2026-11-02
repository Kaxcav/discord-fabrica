import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { securityMiddleware } from './middleware/security.js';
import { pinMiddleware } from './middleware/pin.js';
import { resolveSession, sessions, startSessionCleanup } from './middleware/session.js';
import apiRouter from './routes/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const app = express();
export { sessions };

const PORT = Number(process.env.PORT) || 3001;

// Middlewares globais
app.use(securityMiddleware);
app.use(express.json({ limit: '10mb' }));

// Proteção por PIN (se configurado) — apenas rotas /api
app.use('/api', pinMiddleware);

// Middleware de sessões multi-usuário para rotas /api
app.use('/api', resolveSession);

// Rotas da API
app.use('/api', apiRouter);

// Inicia rotina de limpeza de sessões inativas (TTL 2h)
startSessionCleanup();

// Servir frontend em produção (dist)
const distPath = path.join(__dirname, '..', 'dist');
if (fs.existsSync(distPath)) {
  app.use(express.static(distPath));
  app.use((req, res) => {
    if (req.path.startsWith('/api/')) {
      return res.status(404).json({ error: 'Endpoint não encontrado' });
    }
    res.sendFile(path.join(distPath, 'index.html'));
  });
}

// Graceful shutdown
function handleShutdown(signal) {
  console.log(`\n[Servidor] Recebido sinal ${signal}. Encerrando sessões e liberando recursos...`);
  for (const [sid, bot] of sessions.entries()) {
    try {
      bot.destroy();
    } catch {}
    sessions.delete(sid);
  }
}

process.on('SIGTERM', () => handleShutdown('SIGTERM'));
process.on('SIGINT', () => handleShutdown('SIGINT'));

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename);

let server = null;
if (isMain) {
  server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`[Selfbot Engine v2] Servidor rodando em http://0.0.0.0:${PORT}`);
  });
}

export { server };
export default app;


import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, sessions } from './server/index.js';
import { SelfbotEngine } from './server/core/SelfbotEngine.js';
import { resolveSession } from './server/middleware/session.js';

export { app, sessions, SelfbotEngine, resolveSession };

const __filename = fileURLToPath(import.meta.url);
const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename);

if (isMain) {
  const PORT = Number(process.env.PORT) || 3001;
  app.listen(PORT, () => {
    console.log(`[Selfbot Engine] Servidor rodando em http://localhost:${PORT}`);
  });
}

export default app;

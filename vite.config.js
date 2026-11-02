import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { app } from './server.js';

function selfbotBackendPlugin() {
  return {
    name: 'selfbot-backend-middleware',
    configureServer(server) {
      server.middlewares.use(app);
    },
  };
}

export default defineConfig({
  plugins: [tailwindcss(), react(), selfbotBackendPlugin()],
});

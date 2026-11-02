# Discord Fábrica

Painel web para selfbot do Discord. Controle presença, voz, mensagens e DMs pelo navegador.

## Funcionalidades

- **Radar** — Monitora eventos de voz em tempo real
- **Call Ops** — Controla entrada/saída de voz, anti-mute, anti-deaf
- **Presence & Chat** — Altera status, activity, envia mensagens
- **Fábrica Lote** — Automações em massa (factory loop)
- **Limpar DM** — Apaga todas as suas mensagens de uma DM

## Deploy no Railway (recomendado)

1. Fork este repositório
2. Acesse [railway.app](https://railway.app) e crie um novo projeto a partir do GitHub
3. Railway detecta automaticamente e roda `npm install && npm run build` + `node server.js`
4. Abra a URL gerada pelo Railway no navegador
5. Cole seu token do Discord na tela de login

## Rodar localmente

```bash
npm install
npm run build
node server.js
```

Acesse `http://localhost:3000`

> **Dev mode** (hot reload do frontend): `npm run dev` (abre na porta 5173, mas as APIs ficam na 3000)

## Variáveis de ambiente

Nenhuma obrigatória. O servidor usa `PORT` se definido (Railway define automaticamente).

## Aviso

Este projeto usa selfbot (conta de usuário normal, não bot oficial). Viola os Termos de Serviço do Discord. Use por sua conta e risco.

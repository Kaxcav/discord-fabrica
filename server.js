import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Queue worker for rate-limited requests
const queue = [];
let isProcessing = false;

const processQueue = async () => {
  if (isProcessing || queue.length === 0) return;
  isProcessing = true;

  const { execute, resolve, reject, retryCount = 0 } = queue[0];

  try {
    const result = await execute();
    resolve(result);
    queue.shift(); // Remove on success
    
    // Default delay to avoid hitting limits
    setTimeout(() => {
      isProcessing = false;
      processQueue();
    }, 1500);
  } catch (error) {
    if (error.status === 429 && retryCount < 3) {
      const retryAfter = error.retryAfter ? (error.retryAfter * 1000) : 5000;
      console.log(`Rate limited! Retrying after ${retryAfter}ms`);
      queue[0].retryCount = retryCount + 1;
      
      setTimeout(() => {
        isProcessing = false;
        processQueue();
      }, retryAfter);
    } else {
      reject(error);
      queue.shift();
      isProcessing = false;
      processQueue();
    }
  }
};

const enqueueRequest = (execute) => {
  return new Promise((resolve, reject) => {
    queue.push({ execute, resolve, reject, retryCount: 0 });
    processQueue();
  });
};

const fetchDiscord = async (url, method, token, body = null) => {
  const options = {
    method,
    headers: {
      Authorization: token.trim(),
      'Content-Type': 'application/json'
    }
  };
  if (body) options.body = JSON.stringify(body);

  const res = await fetch(`https://discord.com/api/v10${url}`, options);
  
  if (!res.ok) {
    const errorBody = await res.json().catch(() => ({}));
    const err = new Error(errorBody.message || `Discord API ${res.status}`);
    err.status = res.status;
    if (res.status === 429) {
      err.retryAfter = errorBody.retry_after;
    }
    throw err;
  }
  
  return res.status === 204 ? null : res.json();
};

// API Routes
app.post('/api/auth', async (req, res) => {
  try {
    const { token } = req.body;
    if (!token) return res.status(400).json({ error: 'Token missing' });
    
    const user = await fetchDiscord('/users/@me', 'GET', token);
    res.json(user);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

app.post('/api/batch/invites', async (req, res) => {
  const { token, guildId, channels } = req.body;
  if (!channels || channels.length === 0) return res.json({ success: true, count: 0 });
  
  res.json({ message: 'Processamento de convites iniciado em background' });
  
  for (const channelId of channels) {
    enqueueRequest(() => fetchDiscord(`/channels/${channelId}/invites`, 'POST', token, {
      max_age: 0,
      max_uses: 0
    })).catch(console.error);
  }
});

app.post('/api/batch/roles', async (req, res) => {
  const { token, guildId, roles } = req.body;
  if (!roles || roles.length === 0) return res.json({ success: true, count: 0 });
  
  res.json({ message: 'Processamento de cargos iniciado em background' });
  
  for (const role of roles) {
    enqueueRequest(() => fetchDiscord(`/guilds/${guildId}/roles`, 'POST', token, role)).catch(console.error);
  }
});

app.post('/api/batch/channels', async (req, res) => {
  const { token, guildId, channels } = req.body;
  if (!channels || channels.length === 0) return res.json({ success: true, count: 0 });
  
  res.json({ message: 'Processamento de canais iniciado em background' });
  
  for (const channel of channels) {
    enqueueRequest(() => fetchDiscord(`/guilds/${guildId}/channels`, 'POST', token, channel)).catch(console.error);
  }
});

// Serve React static files
app.use(express.static(path.join(__dirname, 'dist')));
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});

import crypto from 'crypto';

export const DISCORD_API = 'https://discord.com/api/v10';
export const DISCORD_GW = 'wss://gateway.discord.gg/?v=10&encoding=json';
export const STREAMKIT_CLIENT_ID = '207646673902501888';
export const STREAMKIT_SCOPES = 'rpc%20rpc.voice.write%20rpc.voice.read';
export const DISCORD_EPOCH = 1420070400000n;

export const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

export const SUPER_PROPS_OBJ = {
  os: 'Windows',
  browser: 'Chrome',
  device: '',
  system_locale: 'pt-BR',
  browser_user_agent: UA,
  browser_version: '131.0.0.0',
  os_version: '10',
  referrer: '',
  referring_domain: '',
  referrer_current: '',
  referring_domain_current: '',
  release_channel: 'stable',
  client_build_number: 346892,
  client_event_source: null,
  design_id: 0,
};

export const X_SUPER_PROPERTIES = Buffer.from(JSON.stringify(SUPER_PROPS_OBJ)).toString('base64');

export function formatToken(raw) {
  if (!raw) return '';
  return String(raw).trim().replace(/^["']|["']$/g, '').trim();
}

export function generateSnowflakeNonce() {
  const time = BigInt(Date.now()) - DISCORD_EPOCH;
  const rand = BigInt(Math.floor(Math.random() * 4194304));
  return ((time << 22n) | rand).toString();
}

export function buildHeaders(token, extra = {}) {
  const cleanToken = formatToken(token);
  const headers = {
    Authorization: cleanToken,
    'User-Agent': UA,
    'Content-Type': 'application/json',
    Accept: '*/*',
    'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
    'X-Discord-Locale': 'pt-BR',
    'X-Discord-Timezone': 'America/Sao_Paulo',
    Origin: 'https://discord.com',
    Referer: 'https://discord.com/channels/@me',
    ...extra,
  };
  if (!cleanToken.toLowerCase().startsWith('bot ')) {
    headers['X-Super-Properties'] = X_SUPER_PROPERTIES;
  }
  return headers;
}

export function sanitizeUser(user) {
  if (!user || typeof user !== 'object') return null;
  const { id, username, discriminator, global_name, avatar, bot, banner, accent_color } = user;
  return {
    id: String(id),
    username,
    discriminator,
    global_name,
    avatar,
    bot: Boolean(bot),
    banner: banner || null,
    accent_color: accent_color || null,
  };
}

export const delay = (ms) => new Promise((res) => setTimeout(res, ms));


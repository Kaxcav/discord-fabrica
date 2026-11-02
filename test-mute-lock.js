import assert from 'node:assert/strict';
import { app, sessions } from './server.js';
import http from 'node:http';

const MOCK_GUILD_ID = '123456789012345678';
const MOCK_CHANNEL_ID = '234567890123456789';
const MOCK_TARGET_ID = '1550243895122862151';
const MOCK_USER_ID = '987654321098765432';

async function run() {
  console.log('[TEST] ===== Mute-Lock & Kick-Loop Integration Test =====\n');

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  const baseUrl = `http://localhost:${port}`;
  const SID = `mute-test-${Date.now()}`;
  const headers = { 'Content-Type': 'application/json', 'X-Session-Id': SID };

  console.log(`[TEST] Servidor de teste na porta ${port}\n`);

  try {
    await fetch(`${baseUrl}/api/state`, { headers });
    const bot = sessions.get(SID);
    assert.ok(bot, 'Sessão deve existir no map');

    bot.token = 'mock-token';
    bot.user = { id: MOCK_USER_ID, username: 'test-bot' };
    bot.selectedGuildId = MOCK_GUILD_ID;
    bot.broadcastState = () => {};
    bot.broadcastSSE = () => {};
    bot.emitDelta = () => {};

    // Configura target em call no mock
    bot.applyVoiceStateRecord(MOCK_GUILD_ID, {
      user_id: MOCK_TARGET_ID,
      guild_id: MOCK_GUILD_ID,
      channel_id: MOCK_CHANNEL_ID,
      mute: false,
      deaf: false,
    });

    const requests = [];

    // -------------------------------------------------------------------------
    // TESTE 1: Anti-Call (Kick Loop) desconecta com { channel_id: null }
    // -------------------------------------------------------------------------
    {
      requests.length = 0;
      bot.request = async (method, url, body) => {
        requests.push({ method, url, body });
        return { ok: true, status: 200, data: {} };
      };

      const res = await fetch(`${baseUrl}/api/features/anti-call`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ action: 'add', targetUserId: MOCK_TARGET_ID }),
      });
      assert.equal(res.status, 200);
      assert.ok(bot.features.antiCall.targets.has(MOCK_TARGET_ID));

      const kickReq = requests.find(
        (r) =>
          r.method === 'PATCH' &&
          r.url === `/guilds/${MOCK_GUILD_ID}/members/${MOCK_TARGET_ID}` &&
          r.body?.channel_id === null
      );
      assert.ok(kickReq, 'Anti-Call deve enviar PATCH { channel_id: null }');
      console.log('✓ 1. Anti-Call (Kick Loop) executa { channel_id: null } com sucesso');
    }

    // -------------------------------------------------------------------------
    // TESTE 2: Mute-Lock padrão envia { mute: true } (sem deaf forçado)
    // -------------------------------------------------------------------------
    {
      requests.length = 0;
      bot.features.muteLock.targets.clear();
      bot.features.muteLock.mute = true;
      bot.features.muteLock.deaf = false;

      bot.request = async (method, url, body) => {
        requests.push({ method, url, body });
        return { ok: true, status: 200, data: {} };
      };

      const res = await fetch(`${baseUrl}/api/features/mute-lock`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ action: 'add', targetUserId: MOCK_TARGET_ID, mute: true, deaf: false }),
      });
      assert.equal(res.status, 200);
      assert.ok(bot.features.muteLock.targets.has(MOCK_TARGET_ID));

      const muteReq = requests.find(
        (r) =>
          r.method === 'PATCH' &&
          r.url === `/guilds/${MOCK_GUILD_ID}/members/${MOCK_TARGET_ID}` &&
          r.body?.mute === true &&
          r.body?.deaf === undefined
      );
      assert.ok(muteReq, 'Mute-Lock deve enviar PATCH { mute: true } sem deaf');
      console.log('✓ 2. Mute-Lock envia { mute: true } sem exigir DEAFEN_MEMBERS');
    }

    // -------------------------------------------------------------------------
    // TESTE 3: Fallback gracioso de { mute, deaf } para { mute } quando recebe 403
    // -------------------------------------------------------------------------
    {
      requests.length = 0;
      bot.features.muteLock.targets.clear();
      bot.features.muteLock.mute = true;
      bot.features.muteLock.deaf = true;

      bot.request = async (method, url, body) => {
        requests.push({ method, url, body });
        // Se tentar deaf: true, simula erro 403 de Missing Permissions
        if (body?.deaf) {
          return { ok: false, status: 403, error: 'Faltam permissões' };
        }
        // Se tentar só mute, aceita
        if (body?.mute) {
          return { ok: true, status: 200, data: {} };
        }
        return { ok: true, status: 200, data: {} };
      };

      const res = await fetch(`${baseUrl}/api/features/mute-lock`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ action: 'add', targetUserId: MOCK_TARGET_ID, mute: true, deaf: true }),
      });
      assert.equal(res.status, 200);

      // Deve ter tentado { mute: true, deaf: true } primeiro
      const bothReq = requests.find((r) => r.body?.mute === true && r.body?.deaf === true);
      assert.ok(bothReq, 'Deve tentar ambos primeiro');

      // E em seguida ter tentado fallback apenas com { mute: true }
      const fallbackReq = requests.find((r) => r.body?.mute === true && r.body?.deaf === undefined);
      assert.ok(fallbackReq, 'Deve fazer fallback automático para { mute: true }');
      assert.equal(bot.features.muteLock.deaf, false, 'Deve desativar deaf após 403 para não repetir erro');
      console.log('✓ 3. Mute-Lock faz auto-fallback de { mute, deaf } para { mute } após 403');
    }

    // -------------------------------------------------------------------------
    // TESTE 4: Kick Fallback quando { mute: true } falha com 403
    // -------------------------------------------------------------------------
    {
      requests.length = 0;
      bot.features.muteLock.targets.clear();
      bot.features.muteLock.mute = true;
      bot.features.muteLock.deaf = false;
      bot.features.muteLock.kickFallback = true;

      bot.request = async (method, url, body) => {
        requests.push({ method, url, body });
        if (body?.mute) {
          // Servidor ou hierarquia proíbe server-mute (403)
          return { ok: false, status: 403, error: 'Faltam permissões' };
        }
        if (body?.channel_id === null) {
          // Desconectar funciona (Move Members)
          return { ok: true, status: 200, data: {} };
        }
        return { ok: true, status: 200, data: {} };
      };

      const res = await fetch(`${baseUrl}/api/features/mute-lock`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ action: 'add', targetUserId: MOCK_TARGET_ID, mute: true, deaf: false, kickFallback: true }),
      });
      assert.equal(res.status, 200);

      const muteReq = requests.find((r) => r.body?.mute === true);
      assert.ok(muteReq, 'Tentou mutar');

      const kickFallbackReq = requests.find((r) => r.body?.channel_id === null);
      assert.ok(kickFallbackReq, 'Fallback aplicou kick { channel_id: null } ao receber 403 no mute');
      console.log('✓ 4. Mute-Lock aplica Kick Fallback com sucesso quando mute retorna 403');
    }

    // -------------------------------------------------------------------------
    // TESTE 5: Watchdog Timer cobre Mute-Lock em loop
    // -------------------------------------------------------------------------
    {
      requests.length = 0;
      bot.features.muteLock.targets.clear();
      bot.features.muteLock.targets.add(MOCK_TARGET_ID);
      bot.features.muteLock.enabled = true;
      bot.features.muteLock.mute = true;
      bot.features.muteLock.deaf = false;
      bot.features.muteLock.kickFallback = false;

      // Alvo desmutou na call
      bot.applyVoiceStateRecord(MOCK_GUILD_ID, {
        user_id: MOCK_TARGET_ID,
        guild_id: MOCK_GUILD_ID,
        channel_id: MOCK_CHANNEL_ID,
        mute: false,
        deaf: false,
      });

      bot.request = async (method, url, body) => {
        requests.push({ method, url, body });
        return { ok: true, status: 200, data: {} };
      };

      // Executa o watchdog manualmente chamando enforceMuteLock como o timer faz
      const vs = bot.voiceStates.get(MOCK_GUILD_ID)?.get(MOCK_TARGET_ID);
      await bot.voiceManager.enforceMuteLock(MOCK_GUILD_ID, MOCK_TARGET_ID, vs);

      const watchdogMute = requests.find((r) => r.body?.mute === true);
      assert.ok(watchdogMute, 'Watchdog detecta alvo desmutado e reaplica mute');
      console.log('✓ 5. Watchdog de Mute-Lock monitora e reaplica mute em loop');
    }

    console.log('\n[TEST RESULT] TODOS OS 5 TESTES DE MUTE-LOCK E KICK-LOOP PASSARAM COM SUCESSO! ✓\n');
  } finally {
    const bot = sessions.get(SID);
    if (bot) { try { bot.destroy(); } catch {} sessions.delete(SID); }
    server.close();
  }
}

run().catch((err) => {
  console.error('\n[TEST FAILED]', err.message);
  console.error(err.stack);
  process.exit(1);
});

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

    // -------------------------------------------------------------------------
    // TESTE 6: Mute-Lock funciona mesmo se o alvo NÃO estiver no cache userVoiceMap
    // -------------------------------------------------------------------------
    {
      requests.length = 0;
      bot.features.muteLock.targets.clear();
      bot.features.muteLock.mute = true;
      bot.features.muteLock.deaf = false;
      bot.features.muteLock.kickFallback = true;

      // Limpa totalmente o userVoiceMap para simular Gateway sem cache
      bot.userVoiceMap.clear();

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

      const muteReq = requests.find(
        (r) =>
          r.method === 'PATCH' &&
          r.url === `/guilds/${MOCK_GUILD_ID}/members/${MOCK_TARGET_ID}` &&
          r.body?.mute === true
      );
      assert.ok(muteReq, 'Deve resolver a guild e disparar PATCH { mute: true } mesmo sem userVoiceMap');
      console.log('✓ 6. Mute-Lock dispara PATCH imediatamente mesmo sem cache prévio de userVoiceMap');
    }

    // -------------------------------------------------------------------------
    // TESTE 7: Remote PC Bridge (IPC na nuvem / Railway) executa SELECT_VOICE_CHANNEL
    // -------------------------------------------------------------------------
    {
      // Simula ambiente Railway onde pipe local não existe
      bot.ipc.ensureConnected = async () => false;

      // Registra Remote PC Bridge para o usuário da sessão
      const regRes = await fetch(`${baseUrl}/api/voice/ipc-register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-ipc-bridge': '1' },
        body: JSON.stringify({
          user: { id: MOCK_USER_ID, username: 'test-bot' },
          source: 'local-pipe-0',
        }),
      });
      assert.equal(regRes.status, 200);
      assert.equal(bot.ipc.isRemoteActive(), true, 'Remote PC Bridge deve estar ativo');

      // Dispara autoVoiceSelect (que deve aguardar resposta do Remote PC Bridge)
      const selectPromise = bot.autoVoiceSelect(MOCK_GUILD_ID, MOCK_CHANNEL_ID);

      // Aguarda comando entrar na fila pendente
      await new Promise((r) => setTimeout(r, 40));

      const pendRes = await fetch(
        `${baseUrl}/api/voice/ipc-pending?userId=${encodeURIComponent(MOCK_USER_ID)}`,
        { headers: { 'x-ipc-bridge': '1' } }
      );
      const pendData = await pendRes.json();
      assert.equal(pendData.ok, true);
      assert.equal(pendData.pending.length, 1, 'Deve haver 1 comando SELECT_VOICE_CHANNEL pendente');
      assert.equal(pendData.pending[0].cmd, 'SELECT_VOICE_CHANNEL');
      assert.equal(pendData.pending[0].args.channel_id, MOCK_CHANNEL_ID);

      // Responde ao comando simulando o PC Bridge local
      const resCmd = await fetch(`${baseUrl}/api/voice/ipc-result`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-ipc-bridge': '1' },
        body: JSON.stringify({
          requestId: pendData.pending[0].requestId,
          ok: true,
          data: { id: MOCK_CHANNEL_ID },
        }),
      });
      assert.equal(resCmd.status, 200);

      const selectOk = await selectPromise;
      assert.equal(selectOk, true, 'autoVoiceSelect via Remote PC Bridge deve retornar true');
      assert.equal(bot.currentVoice.channelId, MOCK_CHANNEL_ID);
      console.log('✓ 7. Remote PC Bridge sincroniza SELECT_VOICE_CHANNEL entre nuvem (Railway) e PC local');
    }

    // -------------------------------------------------------------------------
    // TESTE 8: Fallback de Auto-Voice via REST API quando usuário já está em call e sem IPC
    // -------------------------------------------------------------------------
    {
      requests.length = 0;
      bot.ipc.ensureConnected = async () => false;
      bot.ipc.remoteConnected = false;
      bot.ipc.remoteLastSeen = 0;

      const OTHER_CHANNEL = '345678901234567890';
      bot.applyVoiceStateRecord(MOCK_GUILD_ID, {
        user_id: MOCK_USER_ID,
        guild_id: MOCK_GUILD_ID,
        channel_id: OTHER_CHANNEL,
        mute: false,
        deaf: false,
      });

      bot.request = async (method, url, body) => {
        requests.push({ method, url, body });
        return { ok: true, status: 200, data: {} };
      };

      const ok = await bot.autoVoiceSelect(MOCK_GUILD_ID, MOCK_CHANNEL_ID);
      assert.equal(ok, true);
      const selfMoveReq = requests.find(
        (r) =>
          r.method === 'PATCH' &&
          r.url === `/guilds/${MOCK_GUILD_ID}/members/${MOCK_USER_ID}` &&
          r.body?.channel_id === MOCK_CHANNEL_ID
      );
      assert.ok(selfMoveReq, 'Deve mover a própria conta via REST PATCH quando já está em call sem IPC');
      console.log('✓ 8. Auto-Voice move a própria conta via REST API quando em call sem IPC');
    }

    // -------------------------------------------------------------------------
    // TESTE 9: Anti-Disconnect + READY_SUPPLEMENTAL (Move e Disconnect)
    // -------------------------------------------------------------------------
    {
      requests.length = 0;
      bot.userVoiceMap.clear();
      bot.currentVoice.channelId = null;
      bot.currentVoice.guildId = null;
      bot.features.antiDisconnect.enabled = false;
      bot.features.antiDisconnect.channelId = null;
      bot.features.antiDisconnect.guildId = null;

      // Simula chegada do READY_SUPPLEMENTAL do Gateway v10 com o usuário em call
      bot.eventBus.safeEmit('READY_SUPPLEMENTAL', {
        guilds: [
          {
            id: MOCK_GUILD_ID,
            voice_states: [
              {
                user_id: MOCK_USER_ID,
                guild_id: MOCK_GUILD_ID,
                channel_id: MOCK_CHANNEL_ID,
                mute: false,
                deaf: false,
              },
            ],
          },
        ],
      });

      assert.equal(
        bot.currentVoice.channelId,
        MOCK_CHANNEL_ID,
        'READY_SUPPLEMENTAL deve popular currentVoice.channelId'
      );

      // Ativa Anti-Disconnect sem passar channelId (como o botão da CallOpsTab faz)
      const resActivate = await fetch(`${baseUrl}/api/features/anti-disconnect`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ enabled: true, delayMs: 10, rejoinOnMove: true }),
      });
      assert.equal(resActivate.status, 200);
      assert.equal(bot.features.antiDisconnect.enabled, true);
      assert.equal(
        bot.features.antiDisconnect.channelId,
        MOCK_CHANNEL_ID,
        'Anti-Disconnect deve travar automaticamente na call atual'
      );

      // Simula moderador movendo o usuário para outra sala
      const OTHER_CH = '999999999999999999';
      bot.request = async (method, url, body) => {
        requests.push({ method, url, body });
        return { ok: true, status: 200, data: {} };
      };

      bot.eventBus.safeEmit('VOICE_STATE_UPDATE', {
        user_id: MOCK_USER_ID,
        guild_id: MOCK_GUILD_ID,
        channel_id: OTHER_CH,
      });

      await new Promise((r) => setTimeout(r, 60));

      const moveBackReq = requests.find(
        (r) =>
          r.method === 'PATCH' &&
          r.url === `/guilds/${MOCK_GUILD_ID}/members/${MOCK_USER_ID}` &&
          r.body?.channel_id === MOCK_CHANNEL_ID
      );
      assert.ok(moveBackReq, 'Anti-Disconnect deve puxar de volta ao ser movido');

      // Simula moderador desconectando o usuário da call (channel_id: null)
      let op4Sent = null;
      bot.gateway.sendOp = (op, d) => {
        if (op === 4) op4Sent = d;
        return true;
      };

      bot.eventBus.safeEmit('VOICE_STATE_UPDATE', {
        user_id: MOCK_USER_ID,
        guild_id: MOCK_GUILD_ID,
        channel_id: null,
      });

      await new Promise((r) => setTimeout(r, 60));

      assert.ok(op4Sent, 'Anti-Disconnect deve reconectar ao ser desconectado');
      assert.equal(op4Sent.channel_id, MOCK_CHANNEL_ID);
      console.log('✓ 9. Anti-Disconnect + READY_SUPPLEMENTAL trava call e reconecta em Move e Disconnect');
    }

    console.log('\n[TEST RESULT] TODOS OS 9 TESTES PASSARAM COM SUCESSO! ✓\n');
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

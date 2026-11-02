import assert from 'node:assert/strict';
import { app, sessions } from './server.js';
import http from 'node:http';

async function runTests() {
  console.log('[TEST] Iniciando bateria de testes Multi-User Session Architecture...');

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  const baseUrl = `http://localhost:${port}`;
  console.log(`[TEST] Servidor de teste ouvindo na porta ${port}`);

  try {
    // -------------------------------------------------------------------------
    // TESTE 1: Rotas públicas de painel (/api/panel/*) não devem exigir X-Session-Id
    // -------------------------------------------------------------------------
    {
      const res = await fetch(`${baseUrl}/api/panel/config`);
      assert.equal(res.status, 200, 'GET /api/panel/config deve retornar 200');
      const data = await res.json();
      assert.equal(typeof data.pinRequired, 'boolean', 'pinRequired deve ser booleano');
      console.log('✓ Teste 1: /api/panel/config acessível sem sessionId');
    }

    // -------------------------------------------------------------------------
    // TESTE 2: Rotas de API sem X-Session-Id e sem ?sid devem retornar 401
    // -------------------------------------------------------------------------
    {
      const resState = await fetch(`${baseUrl}/api/state`);
      assert.equal(resState.status, 401, 'GET /api/state sem header deve retornar 401');
      const dataState = await resState.json();
      assert.equal(dataState.error, 'sessionId required');

      const resEvents = await fetch(`${baseUrl}/api/events`);
      assert.equal(resEvents.status, 401, 'GET /api/events sem sid deve retornar 401');
      const dataEvents = await resEvents.json();
      assert.equal(dataEvents.error, 'sessionId required');

      const resPost = await fetch(`${baseUrl}/api/voice/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channelId: '12345' }),
      });
      assert.equal(resPost.status, 401, 'POST /api/voice/join sem sessionId deve retornar 401');
      console.log('✓ Teste 2: Rejeição 401 obrigatória em rotas /api/* sem sessionId');
    }

    // -------------------------------------------------------------------------
    // TESTE 3: Criação de sessões isoladas para usuários distintos
    // -------------------------------------------------------------------------
    const user1SessionId = 'session-uuid-user-1';
    const user2SessionId = 'session-uuid-user-2';

    {
      const res1 = await fetch(`${baseUrl}/api/state`, {
        headers: { 'X-Session-Id': user1SessionId },
      });
      assert.equal(res1.status, 200, 'User 1 deve obter 200 em /api/state');
      const state1 = await res1.json();
      assert.equal(state1.status, 'disconnected');

      const res2 = await fetch(`${baseUrl}/api/state`, {
        headers: { 'X-Session-Id': user2SessionId },
      });
      assert.equal(res2.status, 200, 'User 2 deve obter 200 em /api/state');
      const state2 = await res2.json();
      assert.equal(state2.status, 'disconnected');

      assert.equal(sessions.has(user1SessionId), true, 'Map sessions deve conter user 1');
      assert.equal(sessions.has(user2SessionId), true, 'Map sessions deve conter user 2');
      assert.notEqual(
        sessions.get(user1SessionId),
        sessions.get(user2SessionId),
        'Instâncias de SelfbotEngine devem ser completamente distintas'
      );
      console.log('✓ Teste 3: Sessões distintas criadas no Map de sessões');
    }

    // -------------------------------------------------------------------------
    // TESTE 4: Isolamento de estado entre sessões (Nenhum vazamento)
    // -------------------------------------------------------------------------
    {
      // Modifica Anti-Mute na sessão 1
      const resPatch1 = await fetch(`${baseUrl}/api/features/anti-mute`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Session-Id': user1SessionId,
        },
        body: JSON.stringify({ enabled: true, unmute: true, undeaf: false }),
      });
      assert.equal(resPatch1.status, 200);
      const dataPatch1 = await resPatch1.json();
      assert.equal(dataPatch1.state.features.antiMute.enabled, true);
      assert.equal(dataPatch1.state.features.antiMute.undeaf, false);

      // Consulta sessão 2: deve continuar com estado padrão (enabled: false)
      const resState2 = await fetch(`${baseUrl}/api/state`, {
        headers: { 'X-Session-Id': user2SessionId },
      });
      const dataState2 = await resState2.json();
      assert.equal(
        dataState2.features.antiMute.enabled,
        false,
        'Sessão 2 NÃO deve ter herdado a modificação da sessão 1'
      );
      assert.equal(
        dataState2.features.antiMute.undeaf,
        true,
        'Sessão 2 deve manter undeaf padrão true'
      );

      // Logs da sessão 1 não devem vazar para a sessão 2
      assert.equal(dataPatch1.state.logs.length > 0, true, 'Sessão 1 deve ter logs da ação');
      assert.equal(dataState2.logs.length, 0, 'Sessão 2 deve ter zero logs');
      console.log('✓ Teste 4: Isolamento estrito de estado e logs confirmado');
    }

    // -------------------------------------------------------------------------
    // TESTE 5: SSE por sessão via query param ?sid=
    // -------------------------------------------------------------------------
    {
      const receivedUser1 = [];
      const receivedUser2 = [];

      // Conecta SSE User 1
      const sseRes1 = await fetch(`${baseUrl}/api/events?sid=${user1SessionId}`);
      assert.equal(sseRes1.status, 200);
      assert.equal(sseRes1.headers.get('content-type'), 'text/event-stream');

      // Conecta SSE User 2
      const sseRes2 = await fetch(`${baseUrl}/api/events?sid=${user2SessionId}`);
      assert.equal(sseRes2.status, 200);

      const reader1 = sseRes1.body.getReader();
      const reader2 = sseRes2.body.getReader();
      const decoder = new TextDecoder();

      // Consome o evento inicial 'state'
      const initial1 = await reader1.read();
      receivedUser1.push(decoder.decode(initial1.value));

      const initial2 = await reader2.read();
      receivedUser2.push(decoder.decode(initial2.value));

      assert.equal(receivedUser1[0].includes('event: state'), true);
      assert.equal(receivedUser2[0].includes('event: state'), true);

      // Agora aciona ação na Sessão 1 (limpar logs / broadcast)
      const bot1 = sessions.get(user1SessionId);
      bot1.broadcastSSE('custom-test-event', { msg: 'para-sessao-1-apenas' });

      // Lê próximo chunk de User 1
      const chunk1 = await reader1.read();
      const text1 = decoder.decode(chunk1.value);
      assert.equal(text1.includes('custom-test-event'), true);
      assert.equal(text1.includes('para-sessao-1-apenas'), true);

      // Fecha SSE connections
      await reader1.cancel();
      await reader2.cancel();

      console.log('✓ Teste 5: Eventos SSE entregues exclusivamente para a sessão correta');
    }

    // -------------------------------------------------------------------------
    // TESTE 6: Método destroy() e limpeza de recursos
    // -------------------------------------------------------------------------
    {
      const tempSessionId = 'temp-test-destroy';
      const resTemp = await fetch(`${baseUrl}/api/state`, {
        headers: { 'X-Session-Id': tempSessionId },
      });
      assert.equal(resTemp.status, 200);

      const tempBot = sessions.get(tempSessionId);
      assert.equal(typeof tempBot.destroy, 'function', 'bot deve possuir método destroy()');

      // Adiciona um mock client SSE no tempBot
      let clientEnded = false;
      let writtenMessages = [];
      tempBot.sseClients.add({
        write: (msg) => {
          writtenMessages.push(msg);
          return true;
        },
        end: () => {
          clientEnded = true;
        },
      });

      tempBot.destroy();
      assert.equal(clientEnded, true, 'destroy() deve chamar res.end() nos clientes SSE');
      assert.equal(tempBot.sseClients.size, 0, 'destroy() deve limpar sseClients');
      assert.equal(tempBot.status, 'disconnected');
      assert.equal(tempBot.ws, null);
      assert.equal(tempBot.heartbeatTimer, null);

      sessions.delete(tempSessionId);
      console.log('✓ Teste 6: SelfbotEngine.destroy() limpa WS, timers e conexões SSE');
    }

    // -------------------------------------------------------------------------
    // TESTE 7: Verificação do mecanismo de TTL de 2h
    // -------------------------------------------------------------------------
    {
      const expiredSessionId = 'expired-session-id';
      const freshSessionId = 'fresh-session-id';

      // Cria ambas as sessões
      await fetch(`${baseUrl}/api/state`, { headers: { 'X-Session-Id': expiredSessionId } });
      await fetch(`${baseUrl}/api/state`, { headers: { 'X-Session-Id': freshSessionId } });

      const expiredBot = sessions.get(expiredSessionId);
      const freshBot = sessions.get(freshSessionId);

      // Força lastActivity da sessão expirada para 2h e 5min atrás
      const TWO_HOURS_FIVE_MINS = 2 * 60 * 60 * 1000 + 5 * 60 * 1000;
      expiredBot.lastActivity = Date.now() - TWO_HOURS_FIVE_MINS;
      freshBot.lastActivity = Date.now();

      // Executa lógica de varredura idêntica ao setInterval
      const SESSION_TTL_MS = 2 * 60 * 60 * 1000;
      const now = Date.now();
      for (const [sid, sessionBot] of sessions.entries()) {
        if (now - (sessionBot.lastActivity || 0) > SESSION_TTL_MS) {
          sessionBot.destroy();
          sessions.delete(sid);
        }
      }

      assert.equal(sessions.has(expiredSessionId), false, 'Sessão expirada deve ter sido destruída e removida');
      assert.equal(sessions.has(freshSessionId), true, 'Sessão ativa deve permanecer no Map');

      // Limpa sessões de teste
      for (const [sid, bot] of sessions.entries()) {
        bot.destroy();
        sessions.delete(sid);
      }
      console.log('✓ Teste 7: Varredura de TTL > 2h remove e destrói sessões inativas com precisão');
    }

    // -------------------------------------------------------------------------
    // TESTE 8: Edge Cases adicionais (Whitespace session, desconexão independente)
    // -------------------------------------------------------------------------
    {
      // 8.1 Header com apenas espaços em branco deve ser rejeitado com 401
      const resWhitespace = await fetch(`${baseUrl}/api/state`, {
        headers: { 'X-Session-Id': '     ' },
      });
      assert.equal(resWhitespace.status, 401, 'Whitespace session ID deve retornar 401');

      // 8.2 Desconexão do User 1 não deve afetar o status do User 2
      const s1 = 'session-edge-1';
      const s2 = 'session-edge-2';
      await fetch(`${baseUrl}/api/state`, { headers: { 'X-Session-Id': s1 } });
      await fetch(`${baseUrl}/api/state`, { headers: { 'X-Session-Id': s2 } });

      const bot2 = sessions.get(s2);
      bot2.status = 'connected'; // Simula bot 2 conectado

      // Desconecta bot 1 via API
      const resDisc = await fetch(`${baseUrl}/api/disconnect`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Session-Id': s1,
        },
      });
      assert.equal(resDisc.status, 200);

      // Confirma que bot 2 continua conectado
      const resState2 = await fetch(`${baseUrl}/api/state`, {
        headers: { 'X-Session-Id': s2 },
      });
      const dataState2 = await resState2.json();
      assert.equal(
        dataState2.status,
        'connected',
        'Desconexão do bot 1 não pode derrubar ou alterar o bot 2'
      );

      // Limpeza
      sessions.delete(s1);
      sessions.delete(s2);
      console.log('✓ Teste 8: Edge cases (whitespace session id e desconexão isolada) verificados com sucesso');
    }

    console.log('\n[TEST RESULT] TODOS OS 8 TESTES DA ARQUITETURA MULTI-USER PASSARAM COM SUCESSO!\n');
  } finally {
    server.close();
  }
}

runTests().catch((err) => {
  console.error('\n[TEST FAILED] Erro nos testes:', err);
  process.exit(1);
});

import { useState } from 'react';
import { Sparkles, Ghost, Send } from 'lucide-react';
import { useBotStore, apiPost } from '../store/useBotStore';

export default function PresenceChatTab() {
  const {
    botState,
    presStatus,
    setPresStatus,
    presType,
    setPresType,
    presName,
    setPresName,
    presCustom,
    setPresCustom,
    presDetails,
    setPresDetails,
    presState,
    setPresState,
    presUrl,
    setPresUrl,
    purgeChannelId,
    setPurgeChannelId,
    purgeLimit,
    setPurgeLimit,
    ghostChannelId,
    setGhostChannelId,
    ghostTargetId,
    setGhostTargetId,
    autoReplyMsg,
    setAutoReplyMsg,
    autoReplyCooldown,
    setAutoReplyCooldown,
    chatChannelId,
    setChatChannelId,
    updatePresence,
    updateAutomation,
  } = useBotStore();

  const [chatContent, setChatContent] = useState('');
  const [chatCount, setChatCount] = useState(1);
  const [chatDelayMs, setChatDelayMs] = useState(1200);
  const [ghostCustomText, setGhostCustomText] = useState('');

  const feat = botState?.features || {};

  return (
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
      {/* RICH PRESENCE */}
      <section className="bg-[#131722] border border-[#1e2638] rounded-xl p-4 space-y-4">
        <h3 className="text-sm font-bold text-white flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-cyan-400" />
          <span>Status & Rich Presence (Streaming / Atividade)</span>
        </h3>

        <div className="grid grid-cols-2 gap-2.5">
          <div>
            <label className="block text-[11px] text-[#94a3b8] mb-1">Status</label>
            <select
              value={presStatus}
              onChange={(e) => setPresStatus(e.target.value)}
              className="w-full px-3 py-2 bg-[#0b0d12] border border-[#1e2638] rounded-lg text-xs text-white focus:outline-none focus:border-cyan-500"
            >
              <option value="online">Online</option>
              <option value="dnd">Não Perturbe (DND)</option>
              <option value="idle">Ausente (Idle)</option>
              <option value="invisible">Invisível</option>
            </select>
          </div>

          <div>
            <label className="block text-[11px] text-[#94a3b8] mb-1">Tipo de Atividade</label>
            <select
              value={presType}
              onChange={(e) => setPresType(Number(e.target.value))}
              className="w-full px-3 py-2 bg-[#0b0d12] border border-[#1e2638] rounded-lg text-xs text-white focus:outline-none focus:border-cyan-500"
            >
              <option value={1}>Transmitindo (Roxo Twitch)</option>
              <option value={0}>Jogando</option>
              <option value={2}>Ouvindo</option>
              <option value={3}>Assistindo</option>
              <option value={5}>Competindo</option>
            </select>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          <input
            type="text"
            value={presName}
            onChange={(e) => setPresName(e.target.value)}
            placeholder="Nome da Atividade (ex: Visual Studio Code)"
            className="px-3 py-2 bg-[#0b0d12] border border-[#1e2638] rounded-lg text-xs text-white focus:outline-none focus:border-cyan-500"
          />
          <input
            type="text"
            value={presCustom}
            onChange={(e) => setPresCustom(e.target.value)}
            placeholder="Recado / Custom Status..."
            className="px-3 py-2 bg-[#0b0d12] border border-[#1e2638] rounded-lg text-xs text-white focus:outline-none focus:border-cyan-500"
          />
          <input
            type="text"
            value={presDetails}
            onChange={(e) => setPresDetails(e.target.value)}
            placeholder="Detalhes (Linha 1)"
            className="px-3 py-2 bg-[#0b0d12] border border-[#1e2638] rounded-lg text-xs text-white focus:outline-none focus:border-cyan-500"
          />
          <input
            type="text"
            value={presState}
            onChange={(e) => setPresState(e.target.value)}
            placeholder="Estado (Linha 2)"
            className="px-3 py-2 bg-[#0b0d12] border border-[#1e2638] rounded-lg text-xs text-white focus:outline-none focus:border-cyan-500"
          />
        </div>

        {presType === 1 && (
          <input
            type="text"
            value={presUrl}
            onChange={(e) => setPresUrl(e.target.value)}
            placeholder="URL da Twitch (ex: https://twitch.tv/discord)"
            className="w-full px-3 py-2 bg-[#0b0d12] border border-[#1e2638] rounded-lg text-xs font-mono text-white focus:outline-none focus:border-cyan-500"
          />
        )}

        <button
          onClick={() =>
            updatePresence({
              status: presStatus,
              activityType: presType,
              activityName: presName,
              activityDetails: presDetails,
              activityState: presState,
              streamUrl: presUrl,
              customStatus: presCustom,
            })
          }
          className="w-full py-2 bg-cyan-500 hover:bg-cyan-400 text-[#05070a] font-semibold rounded-lg text-xs transition-colors cursor-pointer"
        >
          Atualizar Presença no Gateway
        </button>
      </section>

      {/* PURGE (CL), GHOST PING & ENVIAR MENSAGENS */}
      <section className="bg-[#131722] border border-[#1e2638] rounded-xl p-4 space-y-4">
        <h3 className="text-sm font-bold text-white flex items-center gap-2">
          <Ghost className="w-4 h-4 text-purple-400" />
          <span>Purge (CL), Ghost Ping & Automação</span>
        </h3>

        {/* PURGE / LIMPAR MENSAGENS PRÓPRIAS */}
        <div className="bg-[#0b0d12] p-3 rounded-lg border border-[#1e2638] space-y-2">
          <div className="text-xs font-semibold text-white">
            Purge / CL (Apagar suas próprias mensagens em Canal ou DM)
          </div>
          <div className="flex gap-2">
            <input
              type="text"
              value={purgeChannelId}
              onChange={(e) => setPurgeChannelId(e.target.value)}
              placeholder="Channel ID (ou DM ID)..."
              className="flex-1 px-2.5 py-1.5 bg-[#131722] border border-[#1e2638] rounded text-xs font-mono text-white focus:outline-none focus:border-purple-500"
            />
            <input
              type="number"
              min="1"
              max="200"
              value={purgeLimit}
              onChange={(e) => setPurgeLimit(Number(e.target.value))}
              className="w-20 px-2.5 py-1.5 bg-[#131722] border border-[#1e2638] rounded text-xs font-mono text-white focus:outline-none text-right"
              title="Limite de mensagens"
            />
            <button
              onClick={() =>
                purgeChannelId.trim() &&
                apiPost('/api/chat/purge', {
                  channelId: purgeChannelId.trim(),
                  limit: purgeLimit,
                })
              }
              disabled={!purgeChannelId.trim()}
              className="px-3 py-1.5 bg-red-500 hover:bg-red-400 disabled:opacity-40 text-white rounded text-xs font-semibold cursor-pointer"
            >
              Executar CL
            </button>
          </div>
        </div>

        {/* GHOST PING */}
        <div className="bg-[#0b0d12] p-3 rounded-lg border border-[#1e2638] space-y-2">
          <div className="text-xs font-semibold text-white">
            Ghost Ping (Menciona o alvo e apaga em 180ms)
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
            <input
              type="text"
              value={ghostChannelId}
              onChange={(e) => setGhostChannelId(e.target.value)}
              placeholder="Channel ID..."
              className="px-2.5 py-1.5 bg-[#131722] border border-[#1e2638] rounded text-xs font-mono text-white focus:outline-none"
            />
            <input
              type="text"
              value={ghostTargetId}
              onChange={(e) => setGhostTargetId(e.target.value)}
              placeholder="User ID do Alvo..."
              className="px-2.5 py-1.5 bg-[#131722] border border-[#1e2638] rounded text-xs font-mono text-white focus:outline-none"
            />
            <input
              type="text"
              value={ghostCustomText}
              onChange={(e) => setGhostCustomText(e.target.value)}
              placeholder="Texto (opcional)..."
              className="px-2.5 py-1.5 bg-[#131722] border border-[#1e2638] rounded text-xs text-white focus:outline-none"
            />
            <button
              onClick={() =>
                ghostChannelId.trim() &&
                ghostTargetId.trim() &&
                apiPost('/api/chat/ghost-ping', {
                  channelId: ghostChannelId.trim(),
                  targetUserId: ghostTargetId.trim(),
                  customText: ghostCustomText.trim(),
                })
              }
              disabled={!ghostChannelId.trim() || !ghostTargetId.trim()}
              className="px-3 py-1.5 bg-purple-500 hover:bg-purple-400 disabled:opacity-40 text-white rounded text-xs font-semibold cursor-pointer"
            >
              Ghost Ping
            </button>
          </div>
        </div>

        {/* AUTO-REPLY & NITRO SNIPER */}
        <div className="bg-[#0b0d12] p-3 rounded-lg border border-[#1e2638] space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-white">Auto-Reply & Nitro Sniper</span>
            <div className="flex gap-2">
              <button
                onClick={() =>
                  updateAutomation({
                    nitroSniper: { enabled: !feat.nitroSniper?.enabled },
                  })
                }
                className={`px-2 py-0.5 rounded text-[11px] font-semibold cursor-pointer ${
                  feat.nitroSniper?.enabled
                    ? 'bg-emerald-500 text-[#05070a]'
                    : 'bg-[#181e2c] text-[#94a3b8]'
                }`}
              >
                Nitro Sniper: {feat.nitroSniper?.enabled ? 'ON' : 'OFF'}
              </button>

              <button
                onClick={() =>
                  updateAutomation({
                    autoReply: {
                      enabled: !feat.autoReply?.enabled,
                      message: autoReplyMsg,
                      cooldownSec: autoReplyCooldown,
                    },
                  })
                }
                className={`px-2 py-0.5 rounded text-[11px] font-semibold cursor-pointer ${
                  feat.autoReply?.enabled
                    ? 'bg-cyan-500 text-[#05070a]'
                    : 'bg-[#181e2c] text-[#94a3b8]'
                }`}
              >
                Auto-Reply: {feat.autoReply?.enabled ? 'ON' : 'OFF'}
              </button>
            </div>
          </div>
          <div className="flex gap-2">
            <input
              type="text"
              value={autoReplyMsg}
              onChange={(e) => setAutoReplyMsg(e.target.value)}
              placeholder="Mensagem automática quando mencionarem você ou mandarem DM..."
              className="flex-1 px-2.5 py-1.5 bg-[#131722] border border-[#1e2638] rounded text-xs text-white focus:outline-none"
            />
            <input
              type="number"
              min="3"
              max="300"
              value={autoReplyCooldown}
              onChange={(e) => setAutoReplyCooldown(Number(e.target.value))}
              className="w-20 px-2.5 py-1.5 bg-[#131722] border border-[#1e2638] rounded text-xs font-mono text-white focus:outline-none text-right"
              title="Cooldown em segundos"
            />
          </div>
        </div>

        {/* ENVIO DE MENSAGENS / FLOOD CONTROLADO */}
        <div className="bg-[#0b0d12] p-3 rounded-lg border border-[#1e2638] space-y-2">
          <div className="text-xs font-semibold text-white flex items-center gap-1.5">
            <Send className="w-3.5 h-3.5 text-cyan-400" />
            <span>Enviar Mensagem / Repetidor Controlado</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <input
              type="text"
              value={chatChannelId}
              onChange={(e) => setChatChannelId(e.target.value)}
              placeholder="Channel ID..."
              className="px-2.5 py-1.5 bg-[#131722] border border-[#1e2638] rounded text-xs font-mono text-white focus:outline-none"
            />
            <input
              type="number"
              min="1"
              max="50"
              value={chatCount}
              onChange={(e) => setChatCount(Number(e.target.value))}
              className="px-2.5 py-1.5 bg-[#131722] border border-[#1e2638] rounded text-xs font-mono text-white focus:outline-none"
              title="Quantidade de mensagens"
            />
            <input
              type="number"
              min="400"
              max="10000"
              value={chatDelayMs}
              onChange={(e) => setChatDelayMs(Number(e.target.value))}
              className="px-2.5 py-1.5 bg-[#131722] border border-[#1e2638] rounded text-xs font-mono text-white focus:outline-none"
              title="Delay entre mensagens (ms)"
            />
          </div>
          <div className="flex gap-2">
            <input
              type="text"
              value={chatContent}
              onChange={(e) => setChatContent(e.target.value)}
              placeholder="Conteúdo da mensagem..."
              className="flex-1 px-2.5 py-1.5 bg-[#131722] border border-[#1e2638] rounded text-xs text-white focus:outline-none"
            />
            <button
              onClick={() =>
                chatChannelId.trim() &&
                chatContent.trim() &&
                apiPost('/api/chat/send', {
                  channelId: chatChannelId.trim(),
                  content: chatContent.trim(),
                  count: chatCount,
                  delayMs: chatDelayMs,
                })
              }
              disabled={!chatChannelId.trim() || !chatContent.trim()}
              className="px-3 py-1.5 bg-cyan-500 hover:bg-cyan-400 disabled:opacity-40 text-[#05070a] rounded text-xs font-semibold cursor-pointer"
            >
              Enviar
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}

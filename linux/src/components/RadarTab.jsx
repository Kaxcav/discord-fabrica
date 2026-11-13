import {
  PhoneCall,
  Volume2,
  Lock,
  Server,
  MicOff,
  VolumeX,
  Video,
} from 'lucide-react';
import { useBotStore, getAvatarUrl } from '../store/useBotStore';

export default function RadarTab() {
  const {
    botState,
    manualGuildId,
    setManualGuildId,
    manualChannelId,
    setManualChannelId,
    joinVoice,
    memberDirectAction,
    updateFollowCall,
    updateAntiCall,
    updateGuard,
    openVoiceMemberModal,
  } = useBotStore();

  const selectedGuild = botState?.selectedGuild;
  const currentVoice = botState?.currentVoice || {};
  const feat = botState?.features || {};

  const voiceChannels = (selectedGuild?.channels || []).filter(
    (c) => c.type === 2 || c.type === 13
  );

  const voiceStates = selectedGuild?.voiceStates || [];
  const membersByVoiceChannel = new Map();
  for (const vs of voiceStates) {
    if (!vs.channelId) continue;
    if (!membersByVoiceChannel.has(vs.channelId)) {
      membersByVoiceChannel.set(vs.channelId, []);
    }
    membersByVoiceChannel.get(vs.channelId).push(vs);
  }

  return (
    <div className="space-y-6">
      {/* Conectar em call por ID ou Seleção Rápida */}
      <section className="bg-[#131722] border border-[#1e2638] rounded-xl p-4">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <div>
            <h2 className="text-sm font-bold text-white flex items-center gap-2">
              <PhoneCall className="w-4 h-4 text-cyan-400" />
              <span>Conectar em Call (Servidor ou DM/Grupo)</span>
            </h2>
            <p className="text-xs text-[#94a3b8]">
              Clique em uma sala abaixo ou cole qualquer ID de canal de voz (deixe Server ID vazio para Call Privada/DM).
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
          <input
            type="text"
            value={manualGuildId}
            onChange={(e) => setManualGuildId(e.target.value)}
            placeholder={`Server ID (Padrão: ${botState?.selectedGuildId || 'DM'})`}
            className="px-3 py-2 bg-[#0b0d12] border border-[#1e2638] rounded-lg text-xs font-mono text-white placeholder-[#475569] focus:outline-none focus:border-cyan-500"
          />
          <input
            type="text"
            value={manualChannelId}
            onChange={(e) => setManualChannelId(e.target.value)}
            placeholder="Channel ID da Call (Obrigatório)"
            className="px-3 py-2 bg-[#0b0d12] border border-[#1e2638] rounded-lg text-xs font-mono text-white placeholder-[#475569] focus:outline-none focus:border-cyan-500"
          />
          <div className="flex gap-2">
            <button
              onClick={() =>
                manualChannelId.trim() &&
                joinVoice(
                  manualGuildId.trim() || botState?.selectedGuildId,
                  manualChannelId.trim(),
                  false
                )
              }
              disabled={!manualChannelId.trim()}
              className="flex-1 px-3 py-2 bg-cyan-500 hover:bg-cyan-400 disabled:opacity-40 text-[#05070a] font-semibold rounded-lg text-xs transition-colors cursor-pointer"
            >
              Entrar na Call
            </button>
            <button
              onClick={() =>
                manualChannelId.trim() &&
                joinVoice(
                  manualGuildId.trim() || botState?.selectedGuildId,
                  manualChannelId.trim(),
                  true
                )
              }
              disabled={!manualChannelId.trim()}
              className="flex-1 px-3 py-2 bg-purple-500/20 hover:bg-purple-500/30 disabled:opacity-40 text-purple-300 border border-purple-500/40 font-semibold rounded-lg text-xs transition-colors cursor-pointer"
              title="Entrar e já travar Anti-Disconnect nesta call"
            >
              Entrar + Travar
            </button>
          </div>
        </div>
      </section>

      {/* BANNER DE CALL ATIVA */}
      {currentVoice.channelId && (
        <section className="bg-cyan-950/30 border border-cyan-500/40 rounded-xl p-3.5 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse" />
            <div>
              <div className="text-xs font-semibold text-white flex items-center gap-2">
                <span>Conectado em:</span>
                <span className="text-cyan-400 font-mono">{currentVoice.channelName || currentVoice.channelId}</span>
                {currentVoice.guildName && (
                  <span className="text-[#64748b]">({currentVoice.guildName})</span>
                )}
              </div>
              <div className="text-[11px] text-[#94a3b8] flex items-center gap-2 mt-0.5">
                <span>Mute: <strong className={botState?.voiceConfig?.selfMute ? 'text-amber-400' : 'text-slate-400'}>{botState?.voiceConfig?.selfMute ? 'Fake Mute ATIVO' : 'Aberto'}</strong></span>
                <span>•</span>
                <span>Deaf: <strong className={botState?.voiceConfig?.selfDeaf ? 'text-amber-400' : 'text-slate-400'}>{botState?.voiceConfig?.selfDeaf ? 'Fake Deaf ATIVO' : 'Normal'}</strong></span>
                <span>•</span>
                <span>Cam: <strong className={botState?.voiceConfig?.selfVideo ? 'text-purple-400' : 'text-slate-400'}>{botState?.voiceConfig?.selfVideo ? 'Ligada' : 'Desligada'}</strong></span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => useBotStore.getState().updateVoiceConfig({ selfMute: !botState?.voiceConfig?.selfMute })}
              className={`px-2.5 py-1.5 rounded-lg text-xs font-medium border cursor-pointer transition-colors ${
                botState?.voiceConfig?.selfMute
                  ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                  : 'bg-[#181e2c] text-[#94a3b8] border-[#252f45] hover:text-white'
              }`}
            >
              {botState?.voiceConfig?.selfMute ? 'Desmutar (Fake)' : 'Fake Mute'}
            </button>
            <button
              onClick={() => useBotStore.getState().leaveVoice()}
              className="px-2.5 py-1.5 rounded-lg text-xs font-medium bg-red-500/15 hover:bg-red-500/25 text-red-400 border border-red-500/30 transition-colors cursor-pointer"
            >
              Desconectar
            </button>
          </div>
        </section>
      )}

      {/* Lista de canais de voz do servidor e membros em call */}
      <section className="bg-[#131722] border border-[#1e2638] rounded-xl p-4">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
          <div>
            <h2 className="text-sm font-bold text-white flex items-center gap-2">
              <Server className="w-4 h-4 text-cyan-400" />
              <span>Canais de Voz — {selectedGuild?.name || 'Selecione um Servidor'}</span>
            </h2>
            <p className="text-xs text-[#94a3b8]">
              Visualize quem está nas calls em tempo real. Clique em qualquer usuário para abrir o menu completo.
            </p>
          </div>
        </div>

        {voiceChannels.length === 0 ? (
          <div className="text-center py-8 text-xs text-[#64748b] bg-[#0b0d12] rounded-lg border border-[#1e2638]">
            Nenhum canal de voz carregado neste servidor. Clique em "Atualizar" na barra lateral.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {voiceChannels.map((ch) => {
              const members = membersByVoiceChannel.get(ch.id) || [];
              const isMyChannel = currentVoice.channelId === ch.id;
              const isLockedChannel =
                feat.antiDisconnect?.enabled && feat.antiDisconnect?.channelId === ch.id;

              return (
                <div
                  key={ch.id}
                  className={`rounded-xl border p-3.5 transition-colors ${
                    isMyChannel
                      ? 'bg-cyan-950/20 border-cyan-500/50'
                      : 'bg-[#0b0d12] border-[#1e2638]'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2 mb-2.5">
                    <div className="flex items-center gap-2 min-w-0">
                      <Volume2
                        className={`w-4 h-4 shrink-0 ${
                          isMyChannel ? 'text-cyan-400' : 'text-[#64748b]'
                        }`}
                      />
                      <span className="font-semibold text-xs text-white truncate">{ch.name}</span>
                      <span className="text-[10px] font-mono text-[#64748b]">
                        ({members.length}
                        {ch.user_limit ? `/${ch.user_limit}` : ''})
                      </span>
                      {isLockedChannel && (
                        <span className="px-1.5 py-0.5 rounded bg-cyan-500/15 border border-cyan-500/30 text-cyan-300 text-[10px] flex items-center gap-1 font-mono">
                          <Lock className="w-2.5 h-2.5" />
                          <span>TRAVADO</span>
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      {!isMyChannel ? (
                        <button
                          onClick={() => joinVoice(botState?.selectedGuildId, ch.id, false)}
                          className="px-2.5 py-1 rounded-md text-[11px] font-semibold bg-cyan-500 hover:bg-cyan-400 text-[#05070a] transition-colors cursor-pointer"
                        >
                          Entrar
                        </button>
                      ) : (
                        <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-cyan-500/20 text-cyan-300 border border-cyan-500/30">
                          Sua Call
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Membros dentro da call */}
                  {members.length === 0 ? (
                    <div className="text-[11px] text-[#475569] italic py-1">Sala vazia</div>
                  ) : (
                    <div className="space-y-1.5 mt-2">
                      {members.map((m) => {
                        const isSelf = botState?.user && String(m.userId) === String(botState.user.id);
                        const isFollowed = feat.followCall?.enabled && feat.followCall.targetUserId === m.userId;
                        const inAntiCall = feat.antiCall?.targets?.some?.((t) => t.id === m.userId);
                        const inGuard = feat.guard?.targets?.some?.((t) => t.id === m.userId);

                        return (
                          <div
                            key={m.userId}
                            className={`flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg border transition-colors ${
                              isSelf
                                ? 'bg-cyan-500/10 border-cyan-500/30'
                                : 'bg-[#121622] hover:bg-[#161c2b] border-[#1e2638]'
                            }`}
                          >
                            <button
                              type="button"
                              onClick={() => openVoiceMemberModal(m, botState?.selectedGuildId)}
                              className="flex items-center gap-2 min-w-0 flex-1 text-left cursor-pointer"
                              title="Clique para abrir detalhes e ações"
                            >
                              {getAvatarUrl(m.userId, m.avatar) ? (
                                <img
                                  src={getAvatarUrl(m.userId, m.avatar)}
                                  alt=""
                                  className="w-5 h-5 rounded-full shrink-0"
                                />
                              ) : (
                                <div className="w-5 h-5 rounded-full bg-cyan-500/20 flex items-center justify-center text-[10px] text-cyan-300 shrink-0 font-bold">
                                  {(m.displayName || m.username || 'U')[0]}
                                </div>
                              )}
                              <span className="text-xs text-[#cbd5e1] font-medium truncate">
                                {m.displayName || m.username}
                              </span>
                              {isSelf && (
                                <span className="text-[9px] px-1 rounded bg-cyan-500/20 text-cyan-300 border border-cyan-500/30">
                                  VOCÊ
                                </span>
                              )}
                            </button>

                            <div className="flex items-center gap-1 shrink-0">
                              {m.mute && <MicOff className="w-3 h-3 text-red-400" title="Mutado" />}
                              {m.deaf && <VolumeX className="w-3 h-3 text-red-400" title="Ensurdecido" />}
                              {m.selfVideo && <Video className="w-3 h-3 text-purple-400" title="Câmera" />}

                              {!isSelf && (
                                <div className="flex items-center gap-1 ml-1">
                                  <button
                                    onClick={() =>
                                      updateFollowCall({
                                        enabled: !isFollowed,
                                        targetUserId: m.userId,
                                      })
                                    }
                                    className={`px-1.5 py-0.5 rounded text-[10px] font-semibold border cursor-pointer ${
                                      isFollowed
                                        ? 'bg-amber-500 text-[#05070a] border-amber-400'
                                        : 'bg-[#181e2c] text-amber-300 border-amber-500/30 hover:bg-amber-500/20'
                                    }`}
                                    title="Seguir Call deste usuário"
                                  >
                                    {isFollowed ? 'Seguindo' : 'Seguir'}
                                  </button>

                                  <button
                                    onClick={() => memberDirectAction(m.userId, 'pull')}
                                    className="px-1.5 py-0.5 rounded text-[10px] bg-[#181e2c] hover:bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 cursor-pointer"
                                    title="Puxar para minha call agora"
                                  >
                                    Puxar
                                  </button>

                                  <button
                                    onClick={() => memberDirectAction(m.userId, 'kick')}
                                    className="px-1.5 py-0.5 rounded text-[10px] bg-[#181e2c] hover:bg-red-500/20 text-red-300 border border-red-500/30 cursor-pointer"
                                    title="Desconectar da call (Kick)"
                                  >
                                    Kick
                                  </button>

                                  <button
                                    onClick={() =>
                                      updateAntiCall({
                                        action: inAntiCall ? 'remove' : 'add',
                                        targetUserId: m.userId,
                                      })
                                    }
                                    className={`px-1.5 py-0.5 rounded text-[10px] font-semibold border cursor-pointer ${
                                      inAntiCall
                                        ? 'bg-red-600 text-white border-red-400'
                                        : 'bg-[#181e2c] text-red-400 border-red-500/30 hover:bg-red-500/20'
                                    }`}
                                    title="Anti-Call Loop (desconecta toda vez que entrar)"
                                  >
                                    Anti-Call
                                  </button>

                                  <button
                                    onClick={() =>
                                      updateGuard({
                                        action: inGuard ? 'remove' : 'add',
                                        targetUserId: m.userId,
                                      })
                                    }
                                    className={`px-1.5 py-0.5 rounded text-[10px] font-semibold border cursor-pointer ${
                                      inGuard
                                        ? 'bg-emerald-500 text-[#05070a] border-emerald-400'
                                        : 'bg-[#181e2c] text-emerald-300 border-emerald-500/30 hover:bg-emerald-500/20'
                                    }`}
                                    title="Proteger Amigo (Anti-Mute e Anti-Move)"
                                  >
                                    Guard
                                  </button>
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

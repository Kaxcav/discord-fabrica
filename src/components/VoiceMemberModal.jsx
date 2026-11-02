import {
  X,
  Mic,
  MicOff,
  Volume2,
  VolumeX,
  UserCheck,
  UserX,
  Radio,
  Shield,
  Shuffle,
  Compass,
  ArrowRightCircle,
  Copy,
  Check,
  Flame,
} from 'lucide-react';
import { useBotStore, getAvatarUrl } from '../store/useBotStore';

export default function VoiceMemberModal() {
  const {
    voiceMemberModal,
    closeVoiceMemberModal,
    botState,
    memberDirectAction,
    updateFollowCall,
    updateColeira,
    updateAntiCall,
    updateMuteLock,
    updateGuard,
    setChaosTargetId,
    setActiveTab,
    setGhostTargetId,
    setLimparDmTarget,
    copiedText,
    copyToClipboard,
  } = useBotStore();

  if (!voiceMemberModal.isOpen || !voiceMemberModal.member) return null;

  const m = voiceMemberModal.member;
  const feat = botState?.features || {};
  const currentVoice = botState?.currentVoice || {};

  const isSelf = botState?.user && String(m.userId) === String(botState.user.id);
  const isFollowed = feat.followCall?.enabled && feat.followCall.targetUserId === m.userId;
  const inColeira = feat.coleira?.targets?.some?.((t) => t.id === m.userId);
  const inAntiCall = feat.antiCall?.targets?.some?.((t) => t.id === m.userId);
  const inMuteLock = feat.muteLock?.targets?.some?.((t) => t.id === m.userId);
  const inGuard = feat.guard?.targets?.some?.((t) => t.id === m.userId);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm"
      onClick={closeVoiceMemberModal}
    >
      <div
        className="w-full max-w-md bg-[#11151f] border border-[#1e2638] rounded-xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header com avatar e info do membro */}
        <div className="p-4 bg-gradient-to-r from-[#141a27] to-[#10141f] border-b border-[#1e2638] flex items-center justify-between">
          <div className="flex items-center gap-3">
            {getAvatarUrl(m.userId, m.avatar) ? (
              <img
                src={getAvatarUrl(m.userId, m.avatar)}
                alt=""
                className="w-11 h-11 rounded-full border border-cyan-500/40"
              />
            ) : (
              <div className="w-11 h-11 rounded-full bg-cyan-500/20 border border-cyan-500/40 flex items-center justify-center text-cyan-300 font-bold">
                {(m.displayName || m.username || 'U')[0].toUpperCase()}
              </div>
            )}
            <div>
              <div className="flex items-center gap-2">
                <span className="font-semibold text-white text-base">
                  {m.displayName || m.username}
                </span>
                {isSelf && (
                  <span className="text-[10px] uppercase font-bold px-1.5 py-0.5 rounded bg-cyan-500/20 text-cyan-300 border border-cyan-500/30">
                    Você
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2 text-xs font-mono text-[#64748b]">
                <span>@{m.username}</span>
                <span>•</span>
                <button
                  type="button"
                  onClick={() => copyToClipboard(m.userId)}
                  className="hover:text-cyan-400 flex items-center gap-1 cursor-pointer"
                  title="Copiar ID"
                >
                  <span>{m.userId}</span>
                  {copiedText === m.userId ? (
                    <Check className="w-3 h-3 text-emerald-400" />
                  ) : (
                    <Copy className="w-3 h-3 opacity-60" />
                  )}
                </button>
              </div>
            </div>
          </div>

          <button
            onClick={closeVoiceMemberModal}
            className="p-1 rounded-lg text-[#64748b] hover:text-white hover:bg-white/5 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Badges de estado de voz */}
        <div className="px-4 py-2 bg-[#0b0e14] border-b border-[#1e2638] flex flex-wrap gap-2 text-xs">
          <span
            className={`px-2 py-0.5 rounded flex items-center gap-1 border ${
              m.mute
                ? 'bg-red-500/10 text-red-400 border-red-500/20'
                : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
            }`}
          >
            {m.mute ? <MicOff className="w-3 h-3" /> : <Mic className="w-3 h-3" />}
            {m.mute ? 'Mutado' : 'Microfone Ativo'}
          </span>

          <span
            className={`px-2 py-0.5 rounded flex items-center gap-1 border ${
              m.deaf
                ? 'bg-red-500/10 text-red-400 border-red-500/20'
                : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
            }`}
          >
            {m.deaf ? <VolumeX className="w-3 h-3" /> : <Volume2 className="w-3 h-3" />}
            {m.deaf ? 'Ensurdecido' : 'Áudio Normal'}
          </span>

          {m.selfVideo && (
            <span className="px-2 py-0.5 rounded bg-purple-500/10 text-purple-400 border border-purple-500/20 flex items-center gap-1">
              <span>Câmera Ligada</span>
            </span>
          )}
        </div>

        {/* Ações Diretas */}
        <div className="p-4 space-y-4 max-h-[60vh] overflow-y-auto">
          <div>
            <h4 className="text-[11px] font-bold uppercase tracking-wider text-[#64748b] mb-2">
              Ações Rápidas de Call
            </h4>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <button
                onClick={() => memberDirectAction(m.userId, 'pull')}
                disabled={!currentVoice.channelId}
                className="p-2 rounded-lg bg-[#181f2e] hover:bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 flex items-center gap-2 disabled:opacity-40 cursor-pointer"
              >
                <ArrowRightCircle className="w-4 h-4 text-cyan-400" />
                <span>Puxar p/ Minha Call</span>
              </button>

              <button
                onClick={() => memberDirectAction(m.userId, 'kick')}
                className="p-2 rounded-lg bg-[#181f2e] hover:bg-red-500/20 text-red-300 border border-red-500/30 flex items-center gap-2 cursor-pointer"
              >
                <UserX className="w-4 h-4 text-red-400" />
                <span>Desconectar (Kick)</span>
              </button>

              <button
                onClick={() => memberDirectAction(m.userId, m.mute ? 'unmute' : 'mute')}
                className="p-2 rounded-lg bg-[#181f2e] hover:bg-amber-500/20 text-amber-300 border border-amber-500/30 flex items-center gap-2 cursor-pointer"
              >
                {m.mute ? <Mic className="w-4 h-4" /> : <MicOff className="w-4 h-4" />}
                <span>{m.mute ? 'Desmutar Server' : 'Mutar Server'}</span>
              </button>

              <button
                onClick={() => memberDirectAction(m.userId, m.deaf ? 'undeaf' : 'deaf')}
                className="p-2 rounded-lg bg-[#181f2e] hover:bg-amber-500/20 text-amber-300 border border-amber-500/30 flex items-center gap-2 cursor-pointer"
              >
                {m.deaf ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
                <span>{m.deaf ? 'Desensurdecer' : 'Ensurdecer'}</span>
              </button>
            </div>
          </div>

          <div>
            <h4 className="text-[11px] font-bold uppercase tracking-wider text-[#64748b] mb-2">
              Automações & Features Avançadas
            </h4>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <button
                onClick={() =>
                  updateFollowCall({
                    enabled: !isFollowed,
                    targetUserId: m.userId,
                  })
                }
                className={`p-2 rounded-lg border flex items-center gap-2 cursor-pointer ${
                  isFollowed
                    ? 'bg-amber-500 text-[#05070a] border-amber-400 font-semibold'
                    : 'bg-[#181f2e] text-amber-300 border-amber-500/30 hover:bg-amber-500/20'
                }`}
              >
                <Compass className="w-4 h-4" />
                <span>{isFollowed ? 'Seguindo Alvo' : 'Seguir Call'}</span>
              </button>

              <button
                onClick={() =>
                  updateColeira({
                    action: inColeira ? 'remove' : 'add',
                    targetUserId: m.userId,
                  })
                }
                className={`p-2 rounded-lg border flex items-center gap-2 cursor-pointer ${
                  inColeira
                    ? 'bg-cyan-500 text-[#05070a] border-cyan-400 font-semibold'
                    : 'bg-[#181f2e] text-cyan-300 border-cyan-500/30 hover:bg-cyan-500/20'
                }`}
              >
                <Radio className="w-4 h-4" />
                <span>{inColeira ? 'Na Coleira' : 'Pôr na Coleira'}</span>
              </button>

              <button
                onClick={() =>
                  updateAntiCall({
                    action: inAntiCall ? 'remove' : 'add',
                    targetUserId: m.userId,
                  })
                }
                className={`p-2 rounded-lg border flex items-center gap-2 cursor-pointer ${
                  inAntiCall
                    ? 'bg-red-600 text-white border-red-400 font-semibold'
                    : 'bg-[#181f2e] text-red-400 border-red-500/30 hover:bg-red-500/20'
                }`}
              >
                <Flame className="w-4 h-4" />
                <span>{inAntiCall ? 'No Anti-Call' : 'Anti-Call Loop'}</span>
              </button>

              <button
                onClick={() =>
                  updateGuard({
                    action: inGuard ? 'remove' : 'add',
                    targetUserId: m.userId,
                  })
                }
                className={`p-2 rounded-lg border flex items-center gap-2 cursor-pointer ${
                  inGuard
                    ? 'bg-emerald-500 text-[#05070a] border-emerald-400 font-semibold'
                    : 'bg-[#181f2e] text-emerald-300 border-emerald-500/30 hover:bg-emerald-500/20'
                }`}
              >
                <Shield className="w-4 h-4" />
                <span>{inGuard ? 'Amigo Protegido' : 'Guard (Aliado)'}</span>
              </button>

              <button
                onClick={() =>
                  updateMuteLock({
                    action: inMuteLock ? 'remove' : 'add',
                    targetUserId: m.userId,
                    mute: true,
                    deaf: true,
                  })
                }
                className={`p-2 rounded-lg border flex items-center gap-2 cursor-pointer ${
                  inMuteLock
                    ? 'bg-purple-600 text-white border-purple-400 font-semibold'
                    : 'bg-[#181f2e] text-purple-300 border-purple-500/30 hover:bg-purple-500/20'
                }`}
              >
                <VolumeX className="w-4 h-4" />
                <span>{inMuteLock ? 'Mute-Lock Ativo' : 'Travar Mute/Deaf'}</span>
              </button>
            </div>
          </div>

          <div>
            <h4 className="text-[11px] font-bold uppercase tracking-wider text-[#64748b] mb-2">
              Atalhos de Operação
            </h4>
            <div className="flex flex-wrap gap-2 text-xs">
              <button
                onClick={() => {
                  setChaosTargetId(m.userId);
                  setActiveTab('call_ops');
                  closeVoiceMemberModal();
                }}
                className="px-2.5 py-1.5 rounded-lg bg-[#181f2e] hover:bg-white/10 text-[#94a3b8] hover:text-white border border-[#2a3449] flex items-center gap-1.5 cursor-pointer"
              >
                <Shuffle className="w-3.5 h-3.5 text-purple-400" />
                <span>Usar no Chaos Mover</span>
              </button>

              <button
                onClick={() => {
                  setGhostTargetId(m.userId);
                  setActiveTab('presence_chat');
                  closeVoiceMemberModal();
                }}
                className="px-2.5 py-1.5 rounded-lg bg-[#181f2e] hover:bg-white/10 text-[#94a3b8] hover:text-white border border-[#2a3449] flex items-center gap-1.5 cursor-pointer"
              >
                <UserCheck className="w-3.5 h-3.5 text-yellow-400" />
                <span>Ghost Ping Neste Usuário</span>
              </button>

              <button
                onClick={() => {
                  setLimparDmTarget(m.userId);
                  setActiveTab('limpar_dm');
                  closeVoiceMemberModal();
                }}
                className="px-2.5 py-1.5 rounded-lg bg-[#181f2e] hover:bg-white/10 text-[#94a3b8] hover:text-white border border-[#2a3449] flex items-center gap-1.5 cursor-pointer"
              >
                <UserX className="w-3.5 h-3.5 text-rose-400" />
                <span>Limpar DM com Ele</span>
              </button>
            </div>
          </div>
        </div>

        <div className="p-3 bg-[#0c1017] border-t border-[#1e2638] flex justify-end">
          <button
            onClick={closeVoiceMemberModal}
            className="px-4 py-1.5 bg-[#181f2e] hover:bg-[#222b3d] text-white rounded-lg text-xs font-semibold border border-[#2a3449] cursor-pointer"
          >
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
}

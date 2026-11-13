import {
  Radio,
  Crosshair,
  Shield,
  Shuffle,
  Mic,
  MicOff,
  Headphones,
  Video,
  VideoOff,
} from 'lucide-react';
import { useBotStore } from '../store/useBotStore';

export default function CallOpsTab() {
  const {
    botState,
    coleiraInputId,
    setColeiraInputId,
    followInputId,
    setFollowInputId,
    followDelayMs,
    setFollowDelayMs,
    antiDcDelayMs,
    setAntiDcDelayMs,
    antiCallInputId,
    setAntiCallInputId,
    muteLockInputId,
    setMuteLockInputId,
    muteLockServerMute,
    setMuteLockServerMute,
    muteLockServerDeaf,
    setMuteLockServerDeaf,
    muteLockKickFallback,
    setMuteLockKickFallback,
    guardInputId,
    setGuardInputId,
    chaosTargetId,
    setChaosTargetId,
    chaosIntervalMs,
    setChaosIntervalMs,
    updateVoiceConfig,
    updateColeira,
    updateFollowCall,
    updateAntiDisconnect,
    updateAntiMute,
    updateAntiCall,
    updateMuteLock,
    updateGuard,
    updateChaoticMover,
  } = useBotStore();

  const cv = botState?.currentVoice || {};
  const vc = botState?.voiceConfig || {};
  const feat = botState?.features || {};

  return (
    <div className="space-y-6">
      {/* CARD 0: CONTROLES DE VOZ & FAKE AUDIO SPOOFING */}
      <section className="bg-[#131722] border border-[#1e2638] rounded-xl p-4 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Mic className="w-4 h-4 text-cyan-400" />
            <h3 className="text-sm font-bold text-white">
              Fake Voice & Audio Spoofing (Gateway Op 4)
            </h3>
          </div>
          <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
            {cv.channelId ? `Call: ${cv.channelName || cv.channelId}` : 'Fora de Call'}
          </span>
        </div>

        <p className="text-xs text-[#94a3b8]">
          Manipulação direta do estado de voz na Gateway do Discord. Alterne entre aparecer mutado ou ensurdecido para todos no servidor sem perder a transmissão de áudio.
        </p>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
          <button
            onClick={() => updateVoiceConfig({ selfMute: !vc.selfMute })}
            className={`p-3 rounded-lg border flex flex-col items-center justify-center gap-1.5 transition-all cursor-pointer ${
              vc.selfMute
                ? 'bg-amber-500/20 text-amber-300 border-amber-500/50 shadow-lg shadow-amber-950/30'
                : 'bg-[#181e2c] text-[#94a3b8] border-[#252f45] hover:border-slate-600 hover:text-white'
            }`}
          >
            {vc.selfMute ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
            <span className="text-xs font-semibold">{vc.selfMute ? 'Fake Mute ATIVO' : 'Fake Mute'}</span>
            <span className="text-[10px] text-[#64748b]">{vc.selfMute ? 'Aparece mutado' : 'Microfone normal'}</span>
          </button>

          <button
            onClick={() => updateVoiceConfig({ selfDeaf: !vc.selfDeaf })}
            className={`p-3 rounded-lg border flex flex-col items-center justify-center gap-1.5 transition-all cursor-pointer ${
              vc.selfDeaf
                ? 'bg-amber-500/20 text-amber-300 border-amber-500/50 shadow-lg shadow-amber-950/30'
                : 'bg-[#181e2c] text-[#94a3b8] border-[#252f45] hover:border-slate-600 hover:text-white'
            }`}
          >
            <Headphones className="w-5 h-5" />
            <span className="text-xs font-semibold">{vc.selfDeaf ? 'Fake Deaf ATIVO' : 'Fake Deaf'}</span>
            <span className="text-[10px] text-[#64748b]">{vc.selfDeaf ? 'Aparece surdo' : 'Áudio normal'}</span>
          </button>

          <button
            onClick={() => updateVoiceConfig({ selfVideo: !vc.selfVideo })}
            className={`p-3 rounded-lg border flex flex-col items-center justify-center gap-1.5 transition-all cursor-pointer ${
              vc.selfVideo
                ? 'bg-purple-500/20 text-purple-300 border-purple-500/50 shadow-lg shadow-purple-950/30'
                : 'bg-[#181e2c] text-[#94a3b8] border-[#252f45] hover:border-slate-600 hover:text-white'
            }`}
          >
            {vc.selfVideo ? <Video className="w-5 h-5" /> : <VideoOff className="w-5 h-5" />}
            <span className="text-xs font-semibold">{vc.selfVideo ? 'Fake Cam ATIVA' : 'Fake Cam'}</span>
            <span className="text-[10px] text-[#64748b]">{vc.selfVideo ? 'Ícone de vídeo ligado' : 'Câmera desligada'}</span>
          </button>

          <button
            onClick={() => updateVoiceConfig({ fakeStream: !vc.fakeStream })}
            className={`p-3 rounded-lg border flex flex-col items-center justify-center gap-1.5 transition-all cursor-pointer ${
              vc.fakeStream
                ? 'bg-red-500/20 text-red-300 border-red-500/50 shadow-lg shadow-red-950/30'
                : 'bg-[#181e2c] text-[#94a3b8] border-[#252f45] hover:border-slate-600 hover:text-white'
            }`}
          >
            <Radio className="w-5 h-5" />
            <span className="text-xs font-semibold">{vc.fakeStream ? 'Fake Live ATIVA' : 'Fake Live'}</span>
            <span className="text-[10px] text-[#64748b]">{vc.fakeStream ? 'Tag AO VIVO' : 'Sem transmissão'}</span>
          </button>
        </div>
      </section>
      {/* CARD 1: COLEIRA COM ÂNCORA */}
      <section className="bg-[#131722] border border-[#1e2638] rounded-xl p-4 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Radio className="w-4 h-4 text-purple-400" />
            <h3 className="text-sm font-bold text-white">
              Coleira com Âncora (Arrasto Automático para sua Sala)
            </h3>
          </div>
          <button
            onClick={() => updateColeira({ enabled: !feat.coleira?.enabled })}
            className={`px-3 py-1 rounded-lg text-xs font-semibold cursor-pointer ${
              feat.coleira?.enabled
                ? 'bg-purple-500 text-white'
                : 'bg-[#181e2c] text-[#94a3b8] border border-[#252f45]'
            }`}
          >
            {feat.coleira?.enabled ? 'COLEIRA ATIVA' : 'DESATIVADA'}
          </button>
        </div>

        <p className="text-xs text-[#94a3b8]">
          Se o alvo tentar mudar de sala, o selfbot puxa ele de volta instantaneamente. Quando você muda de sala, todos na coleira são puxados junto com você!
        </p>

        <div className="flex gap-2">
          <input
            type="text"
            value={coleiraInputId}
            onChange={(e) => setColeiraInputId(e.target.value)}
            placeholder="User ID para colocar na coleira..."
            className="flex-1 px-3 py-2 bg-[#0b0d12] border border-[#1e2638] rounded-lg text-xs font-mono text-white placeholder-[#475569] focus:outline-none focus:border-purple-500"
          />
          <button
            onClick={() => {
              if (!coleiraInputId.trim()) return;
              updateColeira({
                action: 'add',
                targetUserId: coleiraInputId.trim(),
              });
              setColeiraInputId('');
            }}
            disabled={!coleiraInputId.trim()}
            className="px-3.5 py-2 bg-purple-500 hover:bg-purple-400 disabled:opacity-40 text-white font-semibold rounded-lg text-xs cursor-pointer"
          >
            Adicionar
          </button>
        </div>

        <div className="flex flex-wrap gap-4 text-xs">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={Boolean(feat.coleira?.followSelfMove)}
              onChange={(e) => updateColeira({ followSelfMove: e.target.checked })}
              className="accent-purple-500"
            />
            <span>Puxar quando eu trocar de call</span>
          </label>

          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={Boolean(feat.coleira?.forceServerMute)}
              onChange={(e) => updateColeira({ forceServerMute: e.target.checked })}
              className="accent-purple-500"
            />
            <span>Forçar Server Mute</span>
          </label>

          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={Boolean(feat.coleira?.forceServerDeaf)}
              onChange={(e) => updateColeira({ forceServerDeaf: e.target.checked })}
              className="accent-purple-500"
            />
            <span>Forçar Server Deaf</span>
          </label>
        </div>

        <div className="space-y-1.5">
          <div className="text-[11px] font-semibold uppercase text-[#64748b]">
            Alvos na Coleira ({feat.coleira?.targets?.length || 0}) — Sala Âncora:{' '}
            <span className="text-purple-400">
              {feat.coleira?.anchorChannelName || 'Sua Call Atual'}
            </span>
          </div>
          {(feat.coleira?.targets || []).length === 0 ? (
            <div className="text-xs text-[#475569] bg-[#0b0d12] p-2.5 rounded-lg border border-[#1e2638]">
              Nenhum usuário na coleira. Adicione pelo ID acima ou pelo Radar de Calls.
            </div>
          ) : (
            <div className="space-y-1.5">
              {feat.coleira.targets.map((t) => (
                <div
                  key={t.id}
                  className="flex items-center justify-between bg-[#0b0d12] px-3 py-2 rounded-lg border border-[#1e2638]"
                >
                  <div className="text-xs">
                    <span className="font-semibold text-white">{t.displayName}</span>
                    <span className="ml-2 font-mono text-[#64748b]">{t.id}</span>
                    {t.channelName && (
                      <span className="ml-2 text-purple-400">({t.channelName})</span>
                    )}
                  </div>
                  <button
                    onClick={() => updateColeira({ action: 'remove', targetUserId: t.id })}
                    className="text-red-400 hover:text-red-300 text-xs cursor-pointer"
                  >
                    Remover
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* CARD 2: SEGUIR CALL (STALKER) */}
      <section className="bg-[#131722] border border-[#1e2638] rounded-xl p-4 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Crosshair className="w-4 h-4 text-amber-400" />
            <h3 className="text-sm font-bold text-white">
              Seguir Call (Rastrear & Entrar Automaticamente)
            </h3>
          </div>
          <button
            onClick={() =>
              updateFollowCall({
                enabled: !feat.followCall?.enabled,
                targetUserId: followInputId.trim() || feat.followCall?.targetUserId,
                delayMs: followDelayMs,
              })
            }
            className={`px-3 py-1 rounded-lg text-xs font-semibold cursor-pointer ${
              feat.followCall?.enabled
                ? 'bg-amber-500 text-[#05070a]'
                : 'bg-[#181e2c] text-[#94a3b8] border border-[#252f45]'
            }`}
          >
            {feat.followCall?.enabled ? 'SEGUINDO ALVO' : 'DESATIVADO'}
          </button>
        </div>

        <p className="text-xs text-[#94a3b8]">
          Localiza em qual call o alvo está em qualquer servidor comum e entra automaticamente sempre que ele entrar ou mudar de canal de voz.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <input
            type="text"
            value={followInputId}
            onChange={(e) => setFollowInputId(e.target.value)}
            placeholder="User ID do Alvo..."
            className="sm:col-span-2 px-3 py-2 bg-[#0b0d12] border border-[#1e2638] rounded-lg text-xs font-mono text-white placeholder-[#475569] focus:outline-none focus:border-amber-500"
          />
          <div className="flex items-center gap-1.5 bg-[#0b0d12] border border-[#1e2638] rounded-lg px-2.5 py-1.5">
            <span className="text-[11px] text-[#64748b]">Delay(ms):</span>
            <input
              type="number"
              min="0"
              max="5000"
              value={followDelayMs}
              onChange={(e) => setFollowDelayMs(Number(e.target.value))}
              className="w-full bg-transparent text-xs font-mono text-white focus:outline-none text-right"
            />
          </div>
        </div>

        <div className="flex flex-wrap gap-4 text-xs">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={Boolean(feat.followCall?.syncAntiDisconnect)}
              onChange={(e) => updateFollowCall({ syncAntiDisconnect: e.target.checked })}
              className="accent-amber-500"
            />
            <span>Atualizar trava Anti-Disconnect ao seguir</span>
          </label>

          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={Boolean(feat.followCall?.leaveWhenTargetLeaves)}
              onChange={(e) => updateFollowCall({ leaveWhenTargetLeaves: e.target.checked })}
              className="accent-amber-500"
            />
            <span>Sair da call quando o alvo sair</span>
          </label>
        </div>

        <div className="flex items-center justify-between bg-[#0b0d12] p-3 rounded-lg border border-[#1e2638] text-xs">
          <div>
            <span className="text-[#64748b]">Alvo Atual: </span>
            <strong className="text-white">{feat.followCall?.targetLabel || 'Nenhum'}</strong>
            {feat.followCall?.targetVoice && (
              <span className="ml-2 text-amber-400">
                • Em Call: {feat.followCall.targetVoice.channelName}
              </span>
            )}
          </div>
          <button
            onClick={() =>
              updateFollowCall({
                enabled: true,
                targetUserId: followInputId.trim() || feat.followCall?.targetUserId,
                delayMs: followDelayMs,
              })
            }
            className="px-3 py-1 bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 rounded-md font-medium cursor-pointer"
          >
            Aplicar e Sincronizar
          </button>
        </div>
      </section>

      {/* CARD 3: ANTI-DISCONNECT & ANTI-MUTE SERVER-SIDE */}
      <section className="bg-[#131722] border border-[#1e2638] rounded-xl p-4 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Shield className="w-4 h-4 text-cyan-400" />
            <h3 className="text-sm font-bold text-white">
              Anti-Disconnect (Trava Call) & Anti-Mute
            </h3>
          </div>
          <span
            className={`px-2.5 py-0.5 rounded text-xs font-semibold ${
              feat.antiDisconnect?.enabled
                ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40'
                : 'bg-[#181e2c] text-[#64748b]'
            }`}
          >
            {feat.antiDisconnect?.enabled
              ? `Travado em ${feat.antiDisconnect.channelName}`
              : 'Destravado'}
          </span>
        </div>

        <p className="text-xs text-[#94a3b8]">
          Impede que moderadores te desconectem ou te movam de sala (reconecta em milissegundos) e remove Server Mute / Server Deaf automaticamente da sua conta.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="bg-[#0b0d12] p-3 rounded-lg border border-[#1e2638] space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-white">Anti-Disconnect</span>
              <button
                onClick={() =>
                  updateAntiDisconnect({
                    enabled: !feat.antiDisconnect?.enabled,
                    delayMs: antiDcDelayMs,
                  })
                }
                className={`px-2.5 py-1 rounded text-xs font-semibold cursor-pointer ${
                  feat.antiDisconnect?.enabled
                    ? 'bg-cyan-500 text-[#05070a]'
                    : 'bg-[#181e2c] text-[#94a3b8]'
                }`}
              >
                {feat.antiDisconnect?.enabled ? 'ATIVO' : 'ATIVAR'}
              </button>
            </div>

            <div className="flex items-center justify-between text-xs">
              <span className="text-[#94a3b8]">Delay de Reconexão (ms):</span>
              <input
                type="number"
                min="0"
                max="3000"
                value={antiDcDelayMs}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  setAntiDcDelayMs(v);
                  updateAntiDisconnect({ delayMs: v });
                }}
                className="w-20 px-2 py-1 bg-[#131722] border border-[#1e2638] rounded text-right font-mono text-white focus:outline-none"
              />
            </div>

            <label className="flex items-center gap-2 text-xs cursor-pointer">
              <input
                type="checkbox"
                checked={Boolean(feat.antiDisconnect?.rejoinOnMove)}
                onChange={(e) => updateAntiDisconnect({ rejoinOnMove: e.target.checked })}
                className="accent-cyan-500"
              />
              <span>Voltar se me moverem para outra sala</span>
            </label>
          </div>

          <div className="bg-[#0b0d12] p-3 rounded-lg border border-[#1e2638] space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-white">Anti-Mute / Anti-Deaf</span>
              <button
                onClick={() => updateAntiMute({ enabled: !feat.antiMute?.enabled })}
                className={`px-2.5 py-1 rounded text-xs font-semibold cursor-pointer ${
                  feat.antiMute?.enabled
                    ? 'bg-emerald-500 text-[#05070a]'
                    : 'bg-[#181e2c] text-[#94a3b8]'
                }`}
              >
                {feat.antiMute?.enabled ? 'ATIVO' : 'ATIVAR'}
              </button>
            </div>

            <label className="flex items-center gap-2 text-xs cursor-pointer">
              <input
                type="checkbox"
                checked={Boolean(feat.antiMute?.unmute)}
                onChange={(e) => updateAntiMute({ unmute: e.target.checked })}
                className="accent-emerald-500"
              />
              <span>Auto-remover Server Mute</span>
            </label>

            <label className="flex items-center gap-2 text-xs cursor-pointer">
              <input
                type="checkbox"
                checked={Boolean(feat.antiMute?.undeaf)}
                onChange={(e) => updateAntiMute({ undeaf: e.target.checked })}
                className="accent-emerald-500"
              />
              <span>Auto-remover Server Deaf</span>
            </label>
          </div>
        </div>
      </section>

      {/* CARD 4: ANTI-CALL, MUTE-LOCK, GUARD & CHAOS MOVER */}
      <section className="bg-[#131722] border border-[#1e2638] rounded-xl p-4 space-y-4">
        <h3 className="text-sm font-bold text-white flex items-center gap-2">
          <Shuffle className="w-4 h-4 text-red-400" />
          <span>Anti-Call (Kick Loop), Guard de Amigos & Chaos Mover</span>
        </h3>

        {/* ANTI-CALL KICK LOOP */}
        <div className="bg-[#0b0d12] p-3 rounded-lg border border-[#1e2638] space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="font-semibold text-red-400">
              Anti-Call (Desconecta o alvo sempre que entrar em call)
            </span>
            <span className="font-mono text-[#64748b]">
              {feat.antiCall?.targets?.length || 0} alvo(s)
            </span>
          </div>
          <div className="flex gap-2">
            <input
              type="text"
              value={antiCallInputId}
              onChange={(e) => setAntiCallInputId(e.target.value)}
              placeholder="User ID para bloquear de entrar em call..."
              className="flex-1 px-2.5 py-1.5 bg-[#131722] border border-[#1e2638] rounded text-xs font-mono text-white placeholder-[#475569] focus:outline-none"
            />
            <button
              onClick={() => {
                if (!antiCallInputId.trim()) return;
                updateAntiCall({ action: 'add', targetUserId: antiCallInputId.trim() });
                setAntiCallInputId('');
              }}
              disabled={!antiCallInputId.trim()}
              className="px-3 py-1.5 bg-red-500 hover:bg-red-400 disabled:opacity-40 text-white rounded text-xs font-semibold cursor-pointer"
            >
              Bloquear
            </button>
          </div>
          {feat.antiCall?.targets?.length > 0 && (
            <div className="flex flex-wrap gap-1.5 pt-1">
              {feat.antiCall.targets.map((t) => (
                <span
                  key={t.id}
                  className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-red-500/15 text-red-300 border border-red-500/30 text-[11px]"
                >
                  <span>{t.displayName}</span>
                  <button
                    onClick={() => updateAntiCall({ action: 'remove', targetUserId: t.id })}
                    className="hover:text-white cursor-pointer"
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>

        {/* GUARD DE ALIADOS */}
        <div className="bg-[#0b0d12] p-3 rounded-lg border border-[#1e2638] space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="font-semibold text-emerald-400">
              Guard (Proteger Amigos contra Server Mute & Move)
            </span>
            <span className="font-mono text-[#64748b]">
              {feat.guard?.targets?.length || 0} protegido(s)
            </span>
          </div>
          <div className="flex gap-2">
            <input
              type="text"
              value={guardInputId}
              onChange={(e) => setGuardInputId(e.target.value)}
              placeholder="User ID do amigo para proteger..."
              className="flex-1 px-2.5 py-1.5 bg-[#131722] border border-[#1e2638] rounded text-xs font-mono text-white placeholder-[#475569] focus:outline-none"
            />
            <button
              onClick={() => {
                if (!guardInputId.trim()) return;
                updateGuard({ action: 'add', targetUserId: guardInputId.trim() });
                setGuardInputId('');
              }}
              disabled={!guardInputId.trim()}
              className="px-3 py-1.5 bg-emerald-500 hover:bg-emerald-400 disabled:opacity-40 text-[#05070a] rounded text-xs font-semibold cursor-pointer"
            >
              Proteger
            </button>
          </div>
          {feat.guard?.targets?.length > 0 && (
            <div className="flex flex-wrap gap-1.5 pt-1">
              {feat.guard.targets.map((t) => (
                <span
                  key={t.id}
                  className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 text-[11px]"
                >
                  <span>{t.displayName}</span>
                  <button
                    onClick={() => updateGuard({ action: 'remove', targetUserId: t.id })}
                    className="hover:text-white cursor-pointer"
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>

        {/* MUTE-LOCK EM ALVO */}
        <div className="bg-[#0b0d12] p-3 rounded-lg border border-[#1e2638] space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="font-semibold text-purple-400">
              Mute-Lock (Travar Alvo com Server Mute em Loop)
            </span>
            <span className="font-mono text-[#64748b]">
              {feat.muteLock?.targets?.length || 0} travado(s)
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-4 text-xs text-[#94a3b8] pt-1">
            <label className="flex items-center gap-1.5 cursor-pointer hover:text-white">
              <input
                type="checkbox"
                checked={muteLockServerMute}
                onChange={(e) => {
                  setMuteLockServerMute(e.target.checked);
                  updateMuteLock({ mute: e.target.checked });
                }}
                className="rounded border-[#1e2638] bg-[#131722] text-purple-500 focus:ring-0"
              />
              <span>Server Mute</span>
            </label>
            <label className="flex items-center gap-1.5 cursor-pointer hover:text-white">
              <input
                type="checkbox"
                checked={muteLockServerDeaf}
                onChange={(e) => {
                  setMuteLockServerDeaf(e.target.checked);
                  updateMuteLock({ deaf: e.target.checked });
                }}
                className="rounded border-[#1e2638] bg-[#131722] text-purple-500 focus:ring-0"
              />
              <span>Server Deaf</span>
            </label>
            <label
              className="flex items-center gap-1.5 cursor-pointer hover:text-white"
              title="Se faltar permissão MUTE_MEMBERS ou hierarquia bloquear (403), desconecta o alvo da call como fallback"
            >
              <input
                type="checkbox"
                checked={muteLockKickFallback}
                onChange={(e) => {
                  setMuteLockKickFallback(e.target.checked);
                  updateMuteLock({ kickFallback: e.target.checked });
                }}
                className="rounded border-[#1e2638] bg-[#131722] text-purple-500 focus:ring-0"
              />
              <span>Kick Fallback (se 403)</span>
            </label>
          </div>

          <div className="flex gap-2">
            <input
              type="text"
              value={muteLockInputId}
              onChange={(e) => setMuteLockInputId(e.target.value)}
              placeholder="User ID para travar mutado..."
              className="flex-1 px-2.5 py-1.5 bg-[#131722] border border-[#1e2638] rounded text-xs font-mono text-white placeholder-[#475569] focus:outline-none"
            />
            <button
              onClick={() => {
                if (!muteLockInputId.trim()) return;
                updateMuteLock({
                  action: 'add',
                  targetUserId: muteLockInputId.trim(),
                  mute: muteLockServerMute,
                  deaf: muteLockServerDeaf,
                  kickFallback: muteLockKickFallback,
                });
                setMuteLockInputId('');
              }}
              disabled={!muteLockInputId.trim()}
              className="px-3 py-1.5 bg-purple-500 hover:bg-purple-400 disabled:opacity-40 text-white rounded text-xs font-semibold cursor-pointer"
            >
              Travar Mute
            </button>
          </div>
          {feat.muteLock?.targets?.length > 0 && (
            <div className="flex flex-wrap gap-1.5 pt-1">
              {feat.muteLock.targets.map((t) => (
                <span
                  key={t.id}
                  className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-purple-500/15 text-purple-300 border border-purple-500/30 text-[11px]"
                >
                  <span>{t.displayName}</span>
                  <button
                    onClick={() => updateMuteLock({ action: 'remove', targetUserId: t.id })}
                    className="hover:text-white cursor-pointer"
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>

        {/* CHAOS MOVER */}
        <div className="bg-[#0b0d12] p-3 rounded-lg border border-[#1e2638] space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="font-semibold text-amber-400">
              Chaos Mover (Teleportar Alvo entre Todas as Calls)
            </span>
            <button
              onClick={() =>
                updateChaoticMover({
                  enabled: !feat.chaoticMover?.enabled,
                  targetUserId: chaosTargetId.trim() || feat.chaoticMover?.targetUserId,
                  guildId: botState?.selectedGuildId,
                  intervalMs: chaosIntervalMs,
                })
              }
              className={`px-2.5 py-0.5 rounded text-[11px] font-semibold cursor-pointer ${
                feat.chaoticMover?.enabled
                  ? 'bg-amber-500 text-[#05070a]'
                  : 'bg-[#181e2c] text-[#94a3b8]'
              }`}
            >
              {feat.chaoticMover?.enabled ? 'PARAR CHAOS' : 'INICIAR CHAOS'}
            </button>
          </div>
          <div className="flex gap-2">
            <input
              type="text"
              value={chaosTargetId}
              onChange={(e) => setChaosTargetId(e.target.value)}
              placeholder="User ID do alvo..."
              className="flex-1 px-2.5 py-1.5 bg-[#131722] border border-[#1e2638] rounded text-xs font-mono text-white placeholder-[#475569] focus:outline-none"
            />
            <input
              type="number"
              min="600"
              max="10000"
              value={chaosIntervalMs}
              onChange={(e) => setChaosIntervalMs(Number(e.target.value))}
              className="w-24 px-2 py-1.5 bg-[#131722] border border-[#1e2638] rounded text-xs font-mono text-white focus:outline-none text-right"
              title="Intervalo em ms"
            />
          </div>
        </div>
      </section>
    </div>
  );
}

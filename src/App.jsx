import { useEffect } from 'react';
import {
  Zap,
  Lock,
  Unlock,
  Radio,
  Mic,
  MicOff,
  Headphones,
  Video,
  VideoOff,
  PhoneOff,
  LogOut,
  AlertCircle,
  PhoneCall,
  ShieldAlert,
  Sparkles,
  Layers,
  Trash2,
  RefreshCw,
  Terminal,
  Monitor,
  ShieldCheck,
} from 'lucide-react';
import { SESSION_ID } from './session.js';
import {
  useBotStore,
  getAvatarUrl,
  getGuildIconUrl,
  getStoredPin,
  apiPost,
} from './store/useBotStore.js';
import RadarTab from './components/RadarTab.jsx';
import CallOpsTab from './components/CallOpsTab.jsx';
import PresenceChatTab from './components/PresenceChatTab.jsx';
import FactoryTab from './components/FactoryTab.jsx';
import LimparDmTab from './components/LimparDmTab.jsx';
import VoiceMemberModal from './components/VoiceMemberModal.jsx';
import ConfirmActionModal from './components/ConfirmActionModal.jsx';

export default function App() {
  const {
    pinRequired,
    pinInput,
    setPinInput,
    pinError,
    setPinError,
    botState,
    setBotState,
    patchBotState,
    addLog,
    token,
    setToken,
    initialGuildId,
    setInitialGuildId,
    loading,
    setLoading,
    error,
    setError,
    activeTab,
    setActiveTab,
    guildSearch,
    setGuildSearch,
    tokenList,
    setTokenList,
    setLimparDmTask,
    rehydrateState,
    checkPinStatus,
    selectGuild,
    leaveVoice,
    updateVoiceConfig,
    updateAntiDisconnect,
    updateAntiMute,
    clearLogs,
  } = useBotStore();

  // Verifica PIN inicial
  useEffect(() => {
    checkPinStatus();
  }, [checkPinStatus]);

  // Conexão SSE e rehidratação periódica
  useEffect(() => {
    if (pinRequired !== false) return;

    rehydrateState();

    const pin = getStoredPin();
    const pinParam = pin ? `&pin=${encodeURIComponent(pin)}` : '';
    const es = new EventSource(`/api/events?sid=${encodeURIComponent(SESSION_ID)}${pinParam}`);

    es.onopen = () => {
      rehydrateState();
    };

    es.addEventListener('state', (e) => {
      try {
        const parsed = JSON.parse(e.data);
        setBotState(parsed);
      } catch {}
    });

    es.addEventListener('log', (e) => {
      try {
        const logEntry = JSON.parse(e.data);
        addLog(logEntry);
      } catch {}
    });

    es.addEventListener('voice_update', () => {
      rehydrateState();
    });

    es.addEventListener('limpar-dm', (e) => {
      try {
        const d = JSON.parse(e.data);
        setLimparDmTask(d);
      } catch {}
    });

    es.addEventListener('task_progress', (e) => {
      try {
        const d = JSON.parse(e.data);
        if (!d.taskId?.startsWith('limpar-dm-')) return;
        setLimparDmTask((prev) => ({ ...prev, ...d }));
      } catch {}
    });

    return () => es.close();
  }, [pinRequired, rehydrateState, setBotState, addLog, setLimparDmTask]);

  const isConnected =
    botState?.status === 'connected' ||
    botState?.status === 'connecting' ||
    botState?.status === 'reconnecting';

  const handlePinSubmit = async () => {
    try {
      const res = await fetch('/api/panel/verify', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Session-Id': SESSION_ID,
        },
        body: JSON.stringify({ pin: pinInput.trim() }),
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        sessionStorage.setItem('panel_pin', pinInput.trim());
        useBotStore.setState({ pinRequired: false, pinError: '' });
      } else {
        setPinError(data.error || 'PIN incorreto');
      }
    } catch {
      setPinError('Erro ao verificar PIN');
    }
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const res = await apiPost('/api/auth', {
        token: token.trim(),
        guildId: initialGuildId.trim() || null,
      });

      if (res.state) setBotState(res.state);

      localStorage.setItem(`sb_token_${SESSION_ID}`, token.trim());
      if (initialGuildId.trim()) {
        localStorage.setItem(`sb_guild_${SESSION_ID}`, initialGuildId.trim());
      }
    } catch (err) {
      setError(err.message || 'Falha ao conectar selfbot');
    } finally {
      setLoading(false);
    }
  };

  const handleDisconnect = async () => {
    try {
      await apiPost('/api/disconnect');
      patchBotState({ status: 'disconnected', user: null });
    } catch (err) {
      setError(err.message);
    }
  };

  const handleScanTokens = async () => {
    try {
      setLoading(true);
      setTokenList([]);
      const pin = getStoredPin();
      const res = await fetch('/api/tokens/scan', {
        headers: {
          'X-Session-Id': SESSION_ID,
          ...(pin ? { 'x-panel-pin': pin } : {}),
        },
      });
      const data = await res.json();
      const valid = data.validTokens || [];
      if (valid.length === 1) {
        setToken(valid[0].token);
        setError(`Token de ${valid[0].username} preenchido!`);
      } else if (valid.length > 1) {
        setTokenList(valid);
        setError(`${valid.length} contas encontradas — selecione abaixo.`);
      } else if (data.tokens?.length > 0) {
        setToken(data.tokens[0]);
        setError('Token encontrado (não foi possível validar qual conta).');
      } else {
        setError('Nenhum token encontrado.');
      }
    } catch (err) {
      setError('Erro ao vasculhar tokens: ' + String(err));
    } finally {
      setLoading(false);
    }
  };

  // TELA DE PIN
  if (pinRequired === true) {
    return (
      <div className="min-h-screen bg-[#0b0d12] text-[#e2e8f0] flex items-center justify-center p-4">
        <div className="w-full max-w-sm bg-[#131722] rounded-xl border border-[#1e2638] shadow-2xl p-6">
          <div className="flex items-center gap-3 mb-5">
            <Lock className="w-5 h-5 text-cyan-400" />
            <h1 className="text-base font-bold text-white">Acesso Restrito</h1>
          </div>
          <p className="text-xs text-[#64748b] mb-4">
            Digite o PIN configurado na variável <code className="text-cyan-400">PANEL_PIN</code>.
          </p>
          <input
            type="password"
            value={pinInput}
            onChange={(e) => setPinInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handlePinSubmit()}
            placeholder="••••••"
            className="w-full px-3 py-2 bg-[#0b0d12] border border-[#1e2638] rounded-lg text-sm text-white placeholder-[#475569] focus:outline-none focus:border-cyan-500 mb-3"
            autoFocus
          />
          {pinError && <p className="text-xs text-red-400 mb-3">{pinError}</p>}
          <button
            onClick={handlePinSubmit}
            disabled={!pinInput.trim()}
            className="w-full py-2 bg-cyan-500 hover:bg-cyan-400 disabled:opacity-40 text-[#05070a] font-semibold rounded-lg text-sm transition-colors cursor-pointer"
          >
            Entrar
          </button>
        </div>
      </div>
    );
  }

  // TELA DE LOGIN
  if (!isConnected || !botState?.user) {
    return (
      <div className="min-h-screen bg-[#0b0d12] text-[#e2e8f0] flex items-center justify-center p-4">
        <div className="w-full max-w-md bg-[#131722] rounded-xl border border-[#1e2638] shadow-2xl overflow-hidden">
          <div className="p-6 border-b border-[#1e2638] bg-gradient-to-r from-[#131722] to-[#192030]">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-cyan-500/15 border border-cyan-500/30 flex items-center justify-center text-cyan-400">
                <Zap className="w-5 h-5" />
              </div>
              <div>
                <h1 className="text-xl font-bold text-white tracking-tight">
                  KAXCAV SELFBOT PRO
                </h1>
                <p className="text-xs text-[#94a3b8]">
                  Gateway v10 • Seguir Call • Coleira • Anti-Disconnect • Anti-Mute
                </p>
              </div>
            </div>
          </div>

          <form onSubmit={handleLogin} className="p-6 space-y-4">
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-[#94a3b8] mb-2 flex items-center justify-between">
                <span>Token da Conta (User Token)</span>
              </label>
              <div className="flex gap-2">
                <input
                  type="password"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  placeholder="MTIzNDU2Nzg5MDEyMzQ1Njc4..."
                  className="flex-1 px-3.5 py-2.5 bg-[#0b0d12] border border-[#1e2638] rounded-lg text-white placeholder-[#475569] focus:outline-none focus:ring-2 focus:ring-cyan-500 font-mono text-sm"
                  required
                  disabled={loading}
                />
                <button
                  type="button"
                  disabled={loading}
                  onClick={handleScanTokens}
                  className="px-4 py-2 bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-400 font-semibold rounded-lg border border-cyan-500/30 transition-colors text-xs flex items-center gap-2 cursor-pointer"
                  title="Vasculhar PC por Tokens (Local Storage/Browsers)"
                >
                  <Zap className="w-4 h-4" />
                  <span>Achar Token</span>
                </button>
              </div>

              {tokenList.length > 1 && (
                <div className="flex flex-col gap-1 mt-2">
                  {tokenList.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => {
                        setToken(t.token);
                        setTokenList([]);
                        setError(`Conta ${t.username} selecionada.`);
                      }}
                      className="text-left px-3 py-2 rounded-lg bg-white/5 hover:bg-cyan-500/20 border border-white/10 text-sm text-cyan-300 transition-colors cursor-pointer"
                    >
                      <span className="font-semibold">{t.username}</span>
                      <span className="text-white/30 ml-2 text-xs">{t.id}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-[#94a3b8] mb-2">
                Server ID Inicial (Opcional — carrega todos automaticamente)
              </label>
              <input
                type="text"
                value={initialGuildId}
                onChange={(e) => setInitialGuildId(e.target.value)}
                placeholder="Ex: 123456789012345678 (ou deixe em branco)"
                className="w-full px-3.5 py-2.5 bg-[#0b0d12] border border-[#1e2638] rounded-lg text-white placeholder-[#475569] focus:outline-none focus:ring-2 focus:ring-cyan-500 font-mono text-sm"
                disabled={loading}
              />
            </div>

            {(error || botState?.lastError) && (
              <div className="flex items-center gap-2 text-red-400 text-xs bg-red-950/50 border border-red-800/60 rounded-lg px-3.5 py-2.5">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{error || botState?.lastError}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 bg-cyan-500 hover:bg-cyan-400 disabled:bg-cyan-800 text-[#05070a] font-semibold rounded-lg transition-colors text-sm cursor-pointer"
            >
              {loading ? 'Conectando ao Gateway v10...' : 'Iniciar Selfbot'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  const cv = botState.currentVoice || {};
  const vc = botState.voiceConfig || {};
  const feat = botState.features || {};
  const stats = botState.stats || {};

  const filteredGuilds = (botState.guilds || []).filter((g) => {
    if (!guildSearch.trim()) return true;
    const term = guildSearch.toLowerCase();
    return g.name.toLowerCase().includes(term) || g.id.includes(term);
  });

  return (
    <div className="min-h-screen bg-[#0b0d12] text-[#e2e8f0] flex flex-col">
      {/* HEADER BAR */}
      <header className="bg-[#11151f] border-b border-[#1e2638] px-4 py-2.5 flex flex-wrap items-center justify-between gap-3 shrink-0">
        <div className="flex items-center gap-3">
          <div className="relative">
            {getAvatarUrl(botState.user.id, botState.user.avatar) ? (
              <img
                src={getAvatarUrl(botState.user.id, botState.user.avatar)}
                alt=""
                className="w-9 h-9 rounded-full border border-cyan-500/40"
              />
            ) : (
              <div className="w-9 h-9 rounded-full bg-cyan-500/20 border border-cyan-500/40 flex items-center justify-center text-cyan-300 font-bold text-sm">
                {(botState.user.username || 'U')[0].toUpperCase()}
              </div>
            )}
            <span
              className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-[#11151f] ${
                botState.status === 'connected' ? 'bg-emerald-400' : 'bg-amber-400'
              }`}
            />
          </div>

          <div>
            <div className="flex items-center gap-2">
              <span className="font-semibold text-white text-sm">
                {botState.user.global_name || botState.user.username}
              </span>
              <span className="text-xs font-mono text-[#64748b]">
                @{botState.user.username}
              </span>
              <span className="text-[11px] font-mono px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                {botState.ping ? `${botState.ping}ms` : 'GW ON'}
              </span>
            </div>
            <div className="text-[11px] text-[#94a3b8] flex items-center gap-1.5 mt-0.5">
              <span>Call:</span>
              <span className="font-medium text-cyan-400">
                {cv.channelName || 'Desconectado'}
              </span>
              {cv.guildName && (
                <span className="text-[#64748b]">({cv.guildName})</span>
              )}
            </div>
          </div>
        </div>

        {/* CONTROLES RÁPIDOS DE VOZ NO TOPO */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => updateVoiceConfig({ selfMute: !vc.selfMute })}
            className={`px-2.5 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 border transition-colors cursor-pointer ${
              vc.selfMute
                ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                : 'bg-[#181e2c] text-[#94a3b8] border-[#252f45] hover:text-white'
            }`}
            title="Alternar Fake Mute (aparece mutado para todos na call)"
          >
            {vc.selfMute ? <MicOff className="w-3.5 h-3.5" /> : <Mic className="w-3.5 h-3.5" />}
            <span>{vc.selfMute ? 'Fake Mute ON' : 'Mic Aberto'}</span>
          </button>

          <button
            onClick={() => updateVoiceConfig({ selfDeaf: !vc.selfDeaf })}
            className={`px-2.5 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 border transition-colors cursor-pointer ${
              vc.selfDeaf
                ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                : 'bg-[#181e2c] text-[#94a3b8] border-[#252f45] hover:text-white'
            }`}
            title="Alternar Fake Deaf (aparece ensurdecido na call)"
          >
            <Headphones className="w-3.5 h-3.5" />
            <span>{vc.selfDeaf ? 'Fake Deaf ON' : 'Fones ON'}</span>
          </button>

          <button
            onClick={() => updateVoiceConfig({ selfVideo: !vc.selfVideo })}
            className={`px-2.5 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 border transition-colors cursor-pointer ${
              vc.selfVideo
                ? 'bg-purple-500/20 text-purple-300 border-purple-500/40'
                : 'bg-[#181e2c] text-[#94a3b8] border-[#252f45] hover:text-white'
            }`}
            title="Alternar Fake Câmera (ícone de vídeo na call)"
          >
            {vc.selfVideo ? <Video className="w-3.5 h-3.5" /> : <VideoOff className="w-3.5 h-3.5" />}
            <span>{vc.selfVideo ? 'Fake Cam ON' : 'Fake Cam'}</span>
          </button>

          <button
            onClick={() => updateVoiceConfig({ fakeStream: !vc.fakeStream })}
            className={`px-2.5 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 border transition-colors cursor-pointer ${
              vc.fakeStream
                ? 'bg-red-500/20 text-red-300 border-red-500/40'
                : 'bg-[#181e2c] text-[#94a3b8] border-[#252f45] hover:text-white'
            }`}
            title="Alternar Fake Live (tag AO VIVO no canal)"
          >
            <Radio className="w-3.5 h-3.5" />
            <span>{vc.fakeStream ? 'Fake Live ON' : 'Fake Live'}</span>
          </button>

          <button
            onClick={() => updateVoiceConfig({ useIpcForAutoVoice: !vc.useIpcForAutoVoice })}
            className={`px-2.5 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 border transition-colors cursor-pointer ${
              vc.useIpcForAutoVoice
                ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                : 'bg-[#181e2c] text-[#94a3b8] border-[#252f45] hover:text-white'
            }`}
            title="Modo IPC: Controla Discord Desktop no PC"
          >
            <Monitor className="w-3.5 h-3.5" />
            <span>{vc.useIpcForAutoVoice ? 'Modo IPC ON' : 'Modo IPC'}</span>
          </button>

          <button
            onClick={() =>
              updateAntiDisconnect({
                enabled: !feat.antiDisconnect?.enabled,
                guildId: cv.guildId || botState.selectedGuildId,
                channelId: cv.channelId || feat.antiDisconnect?.channelId,
              })
            }
            className={`px-2.5 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 border transition-colors cursor-pointer ${
              feat.antiDisconnect?.enabled
                ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/50'
                : 'bg-[#181e2c] text-[#94a3b8] border-[#252f45] hover:text-white'
            }`}
          >
            {feat.antiDisconnect?.enabled ? (
              <Lock className="w-3.5 h-3.5" />
            ) : (
              <Unlock className="w-3.5 h-3.5" />
            )}
            <span>Anti-Disconnect</span>
          </button>

          <button
            onClick={() => updateAntiMute({ enabled: !feat.antiMute?.enabled })}
            className={`px-2.5 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 border transition-colors cursor-pointer ${
              feat.antiMute?.enabled
                ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/50'
                : 'bg-[#181e2c] text-[#94a3b8] border-[#252f45] hover:text-white'
            }`}
          >
            <ShieldCheck className="w-3.5 h-3.5" />
            <span>Anti-Mute</span>
          </button>

          {cv.channelId && (
            <button
              onClick={leaveVoice}
              className="px-2.5 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 bg-red-500/20 hover:bg-red-500/30 text-red-300 border border-red-500/40 cursor-pointer"
            >
              <PhoneOff className="w-3.5 h-3.5" />
              <span>Sair Call</span>
            </button>
          )}

          <button
            onClick={handleDisconnect}
            className="p-1.5 rounded-lg bg-[#181e2c] hover:bg-red-950/60 text-[#94a3b8] hover:text-red-300 border border-[#252f45] cursor-pointer"
            title="Desconectar Selfbot"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* BARRA DE TELEMETRIA / CONTADORES */}
      <div className="bg-[#0e121b] border-b border-[#1e2638] px-4 py-1.5 flex flex-wrap items-center justify-between gap-2 text-xs">
        <div className="flex flex-wrap items-center gap-4">
          <span className="text-[#94a3b8]">
            Anti-Disconnect:{' '}
            <strong className="text-cyan-400 font-mono">
              {stats.antiDisconnectTriggers || 0}
            </strong>
          </span>
          <span className="text-[#94a3b8]">
            Coleira Puxadas:{' '}
            <strong className="text-purple-400 font-mono">
              {stats.coleiraPulls || 0}
            </strong>
          </span>
          <span className="text-[#94a3b8]">
            Seguir Call:{' '}
            <strong className="text-amber-400 font-mono">
              {stats.followMoves || 0}
            </strong>
          </span>
          <span className="text-[#94a3b8]">
            Anti-Mute:{' '}
            <strong className="text-emerald-400 font-mono">
              {stats.antiMuteTriggers || 0}
            </strong>
          </span>
          <span className="text-[#94a3b8]">
            Anti-Call Kicks:{' '}
            <strong className="text-red-400 font-mono">
              {stats.antiCallKicks || 0}
            </strong>
          </span>
          <span className="text-[#94a3b8]">
            Guard Aliados:{' '}
            <strong className="text-blue-400 font-mono">
              {stats.guardActions || 0}
            </strong>
          </span>
          <span className="text-[#94a3b8]">
            Nitro Sniped:{' '}
            <strong className="text-emerald-400 font-mono">
              {stats.nitroSniped || 0}
            </strong>
          </span>
        </div>

        {error && (
          <div className="flex items-center gap-2 text-red-400">
            <AlertCircle className="w-3.5 h-3.5" />
            <span>{error}</span>
            <button onClick={() => setError('')} className="underline ml-1 cursor-pointer">
              fechar
            </button>
          </div>
        )}
      </div>

      {/* CORPO PRINCIPAL */}
      <div className="flex-1 flex flex-col lg:flex-row overflow-hidden">
        {/* SIDEBAR DE SERVIDORES & NAVEGAÇÃO */}
        <aside className="w-full lg:w-72 bg-[#11151f] border-b lg:border-b-0 lg:border-r border-[#1e2638] flex flex-col shrink-0">
          {/* ABAS DE MÓDULOS */}
          <div className="p-3 border-b border-[#1e2638] grid grid-cols-2 gap-1.5">
            <button
              onClick={() => setActiveTab('radar')}
              className={`px-3 py-2 rounded-lg text-xs font-medium flex items-center gap-2 transition-colors cursor-pointer ${
                activeTab === 'radar'
                  ? 'bg-cyan-500 text-[#05070a] font-semibold'
                  : 'bg-[#181e2c] text-[#94a3b8] hover:text-white'
              }`}
            >
              <PhoneCall className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate">Radar Calls</span>
            </button>

            <button
              onClick={() => setActiveTab('call_ops')}
              className={`px-3 py-2 rounded-lg text-xs font-medium flex items-center gap-2 transition-colors cursor-pointer ${
                activeTab === 'call_ops'
                  ? 'bg-cyan-500 text-[#05070a] font-semibold'
                  : 'bg-[#181e2c] text-[#94a3b8] hover:text-white'
              }`}
            >
              <ShieldAlert className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate">Coleira & Call</span>
            </button>

            <button
              onClick={() => setActiveTab('presence_chat')}
              className={`px-3 py-2 rounded-lg text-xs font-medium flex items-center gap-2 transition-colors cursor-pointer ${
                activeTab === 'presence_chat'
                  ? 'bg-cyan-500 text-[#05070a] font-semibold'
                  : 'bg-[#181e2c] text-[#94a3b8] hover:text-white'
              }`}
            >
              <Sparkles className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate">Status & Chat</span>
            </button>

            <button
              onClick={() => setActiveTab('factory')}
              className={`px-3 py-2 rounded-lg text-xs font-medium flex items-center gap-2 transition-colors cursor-pointer ${
                activeTab === 'factory'
                  ? 'bg-cyan-500 text-[#05070a] font-semibold'
                  : 'bg-[#181e2c] text-[#94a3b8] hover:text-white'
              }`}
            >
              <Layers className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate">Fábrica Lote</span>
            </button>

            <button
              onClick={() => setActiveTab('limpar_dm')}
              className={`col-span-2 px-3 py-2 rounded-lg text-xs font-medium flex items-center gap-2 transition-colors cursor-pointer ${
                activeTab === 'limpar_dm'
                  ? 'bg-red-500 text-white font-semibold'
                  : 'bg-[#181e2c] text-[#94a3b8] hover:text-white'
              }`}
            >
              <Trash2 className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate">Limpar DM</span>
            </button>
          </div>

          {/* SELETOR DE SERVIDOR */}
          <div className="p-3 border-b border-[#1e2638] space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-[#94a3b8]">
                Servidores ({botState.guilds?.length || 0})
              </span>
              {botState.selectedGuildId && (
                <button
                  onClick={() => selectGuild(botState.selectedGuildId, true)}
                  className="text-xs text-cyan-400 hover:text-cyan-300 flex items-center gap-1 cursor-pointer"
                  title="Recarregar canais do servidor"
                >
                  <RefreshCw className="w-3 h-3" />
                  <span>Atualizar</span>
                </button>
              )}
            </div>

            <input
              type="text"
              value={guildSearch}
              onChange={(e) => setGuildSearch(e.target.value)}
              placeholder="Filtrar servidor ou colar ID..."
              className="w-full px-2.5 py-1.5 bg-[#0b0d12] border border-[#1e2638] rounded-md text-xs text-white placeholder-[#475569] focus:outline-none focus:border-cyan-500"
            />
          </div>

          <div className="flex-1 overflow-y-auto p-2 space-y-1 max-h-60 lg:max-h-none">
            {filteredGuilds.map((g) => {
              const selected = g.id === botState.selectedGuildId;
              const iconUrl = getGuildIconUrl(g.id, g.icon);
              return (
                <button
                  key={g.id}
                  onClick={() => selectGuild(g.id)}
                  className={`w-full px-2.5 py-2 rounded-lg text-left flex items-center justify-between gap-2 transition-colors cursor-pointer ${
                    selected
                      ? 'bg-cyan-500/15 border border-cyan-500/40 text-white'
                      : 'hover:bg-[#181e2c] text-[#cbd5e1] border border-transparent'
                  }`}
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    {iconUrl ? (
                      <img src={iconUrl} alt="" className="w-7 h-7 rounded-md shrink-0" />
                    ) : (
                      <div className="w-7 h-7 rounded-md bg-[#1e2638] flex items-center justify-center text-xs font-bold text-cyan-400 shrink-0">
                        {(g.name || 'S')[0]}
                      </div>
                    )}
                    <div className="truncate">
                      <div className="text-xs font-medium truncate">{g.name}</div>
                      <div className="text-[10px] font-mono text-[#64748b]">{g.id}</div>
                    </div>
                  </div>
                  {g.voiceCount > 0 && (
                    <span className="px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 shrink-0">
                      {g.voiceCount} em call
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </aside>

        {/* ÁREA CENTRAL DE CONTEÚDO */}
        <main className="flex-1 overflow-y-auto p-4 lg:p-6 space-y-6">
          {activeTab === 'radar' && <RadarTab />}
          {activeTab === 'call_ops' && <CallOpsTab />}
          {activeTab === 'presence_chat' && <PresenceChatTab />}
          {activeTab === 'factory' && <FactoryTab />}
          {activeTab === 'limpar_dm' && <LimparDmTab />}

          {/* CONSOLE DE LOGS EM TEMPO REAL */}
          <section className="bg-[#11151f] border border-[#1e2638] rounded-xl overflow-hidden">
            <div className="px-4 py-2.5 border-b border-[#1e2638] flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Terminal className="w-4 h-4 text-cyan-400" />
                <span className="text-xs font-bold text-white">
                  Console de Eventos em Tempo Real (Gateway & Voice)
                </span>
              </div>
              <button
                onClick={clearLogs}
                className="text-xs text-[#64748b] hover:text-white flex items-center gap-1 cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Limpar</span>
              </button>
            </div>

            <div className="p-3 h-52 overflow-y-auto font-mono text-xs space-y-1 bg-[#080a0f]">
              {(botState.logs || []).length === 0 ? (
                <div className="text-[#475569]">Aguardando eventos...</div>
              ) : (
                botState.logs.map((l) => {
                  const colorMap = {
                    success: 'text-emerald-400',
                    error: 'text-red-400',
                    warn: 'text-amber-400',
                    voice: 'text-cyan-400',
                    coleira: 'text-purple-400',
                    stalker: 'text-amber-300',
                    guard: 'text-emerald-300',
                    info: 'text-[#cbd5e1]',
                  };
                  return (
                    <div key={l.id} className="leading-relaxed">
                      <span className="text-[#475569]">[{l.time}]</span>{' '}
                      <span className={colorMap[l.type] || 'text-[#cbd5e1]'}>
                        {l.message}
                      </span>
                    </div>
                  );
                })
              )}
            </div>
          </section>
        </main>
      </div>

      {/* MODALS */}
      <VoiceMemberModal />
      <ConfirmActionModal />
    </div>
  );
}

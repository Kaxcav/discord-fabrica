import { useState, useEffect, useMemo } from 'react';
import {
  PhoneCall,
  PhoneOff,
  Mic,
  MicOff,
  Headphones,
  Video,
  VideoOff,
  Radio,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Lock,
  Unlock,
  Users,
  Crosshair,
  Link2,
  Zap,
  RefreshCw,
  Trash2,
  Send,
  Ghost,
  Sparkles,
  Layers,
  Terminal,
  LogOut,
  Volume2,
  VolumeX,
  AlertCircle,
  Hash,
  Server,
  Shuffle,
  Monitor,
} from 'lucide-react';
import { SESSION_ID } from './session.js';

function getStoredPin() {
  return sessionStorage.getItem('panel_pin') || '';
}

async function apiPost(endpoint, body = {}) {
  const pin = getStoredPin();
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Session-Id': SESSION_ID,
      ...(pin ? { 'x-panel-pin': pin } : {}),
    },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || data.message || `Erro HTTP ${res.status}`);
  }
  return data;
}

function getAvatarUrl(userId, avatarHash) {
  if (!userId || !avatarHash) return null;
  const ext = String(avatarHash).startsWith('a_') ? 'gif' : 'png';
  return `https://cdn.discordapp.com/avatars/${userId}/${avatarHash}.${ext}?size=64`;
}

function getGuildIconUrl(guildId, iconHash) {
  if (!guildId || !iconHash) return null;
  const ext = String(iconHash).startsWith('a_') ? 'gif' : 'png';
  return `https://cdn.discordapp.com/icons/${guildId}/${iconHash}.${ext}?size=64`;
}

export default function App() {
  const [pinRequired, setPinRequired] = useState(null); // null=loading, false=no pin, true=need pin
  const [pinInput, setPinInput] = useState('');
  const [pinError, setPinError] = useState('');
  const [_panelPin, setPanelPin] = useState(() => sessionStorage.getItem('panel_pin') || '');

  const [botState, setBotState] = useState(null);
  const [token, setToken] = useState(
    () => localStorage.getItem(`sb_token_${SESSION_ID}`) || localStorage.getItem('sb_token') || ''
  );
  const [initialGuildId, setInitialGuildId] = useState(
    () => localStorage.getItem(`sb_guild_${SESSION_ID}`) || localStorage.getItem('sb_guild') || ''
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState('radar'); // radar | call_ops | presence_chat | factory | limpar_dm
  const [guildSearch, setGuildSearch] = useState('');
  const [tokenList, setTokenList] = useState([]);
  // limpar-dm state
  const [limparDmTarget, setLimparDmTarget] = useState('');
  const [limparDmDelay, setLimparDmDelay] = useState(700);
  const [limparDmTask, setLimparDmTask] = useState(null);
  // task: { taskId, username, avatarUrl, phase, progress, total, message }
  const [copiedText, setCopiedText] = useState('');

  // Inputs para Call Manual / Controles
  const [manualGuildId, setManualGuildId] = useState('');
  const [manualChannelId, setManualChannelId] = useState('');
  const [followInputId, setFollowInputId] = useState('');
  const [followDelayMs, setFollowDelayMs] = useState(250);
  const [antiDcDelayMs, setAntiDcDelayMs] = useState(150);
  const [coleiraInputId, setColeiraInputId] = useState('');
  const [antiCallInputId, setAntiCallInputId] = useState('');
  const [muteLockInputId, setMuteLockInputId] = useState('');
  const [guardInputId, setGuardInputId] = useState('');
  const [chaosTargetId, setChaosTargetId] = useState('');
  const [chaosIntervalMs, setChaosIntervalMs] = useState(1200);

  // Inputs para Presença & Chat
  const [presStatus, setPresStatus] = useState('online');
  const [presType, setPresType] = useState(1);
  const [presName, setPresName] = useState('Discord Selfbot');
  const [presDetails, setPresDetails] = useState('');
  const [presState, setPresState] = useState('');
  const [presUrl, setPresUrl] = useState('https://twitch.tv/discord');
  const [presCustom, setPresCustom] = useState('');

  const [chatChannelId, setChatChannelId] = useState('');
  const [chatContent, setChatContent] = useState('');
  const [chatCount, setChatCount] = useState(1);
  const [chatDelayMs, setChatDelayMs] = useState(1200);
  const [purgeChannelId, setPurgeChannelId] = useState('');
  const [purgeLimit, setPurgeLimit] = useState(30);
  const [ghostChannelId, setGhostChannelId] = useState('');
  const [ghostTargetId, setGhostTargetId] = useState('');
  const [autoReplyMsg, setAutoReplyMsg] = useState('Estou ocupado no momento, já respondo.');
  const [autoReplyCooldown, setAutoReplyCooldown] = useState(15);

  // Inputs para Fábrica em Lote
  const [batchChName, setBatchChName] = useState('geral');
  const [batchChType, setBatchChType] = useState(0);
  const [batchChCount, setBatchChCount] = useState(3);
  const [batchRoleName, setBatchRoleName] = useState('Membro VIP');
  const [batchRoleColor, setBatchRoleColor] = useState('#06b6d4');
  const [batchRoleCount, setBatchRoleCount] = useState(3);
  const [nukeChannelId, setNukeChannelId] = useState('');

  useEffect(() => {
    // Verifica se precisa de PIN
    fetch('/api/panel/config', {
      headers: { 'X-Session-Id': SESSION_ID },
    })
      .then((r) => r.json())
      .then((d) => {
        if (!d.pinRequired) {
          setPinRequired(false);
        } else {
          const stored = sessionStorage.getItem('panel_pin');
          if (stored) {
            fetch('/api/panel/verify', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'X-Session-Id': SESSION_ID,
              },
              body: JSON.stringify({ pin: stored }),
            }).then((r) => {
              if (r.ok) setPinRequired(false);
              else { sessionStorage.removeItem('panel_pin'); setPinRequired(true); }
            }).catch(() => setPinRequired(true));
          } else {
            setPinRequired(true);
          }
        }
      })
      .catch(() => setPinRequired(false));
  }, []);

  useEffect(() => {
    if (pinRequired !== false) return;

    const pin = getStoredPin();
    const headers = {
      'X-Session-Id': SESSION_ID,
      ...(pin ? { 'x-panel-pin': pin } : {}),
    };

    const rehydrateState = () => {
      fetch('/api/state', { headers })
        .then((r) => r.json())
        .then((data) => {
          if (data && data.status) {
            setBotState(data);
            if (data?.features?.followCall?.targetUserId) {
              setFollowInputId(data.features.followCall.targetUserId);
            }
          }
        })
        .catch(() => {});
    };

    rehydrateState();

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
        setBotState((prev) => {
          if (!prev) return prev;
          const exists = prev.logs?.some((l) => l.id === logEntry.id);
          if (exists) return prev;
          return {
            ...prev,
            logs: [logEntry, ...(prev.logs || [])].slice(0, 120),
          };
        });
      } catch {}
    });
    es.addEventListener('limpar-dm', (e) => {
      try {
        const d = JSON.parse(e.data);
        setLimparDmTask(d);
      } catch {}
    });

    return () => es.close();
  }, [pinRequired]);

  const isConnected =
    botState?.status === 'connected' ||
    botState?.status === 'connecting' ||
    botState?.status === 'reconnecting';

  async function handleLogin(e) {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const clean = token.trim();
      localStorage.setItem(`sb_token_${SESSION_ID}`, clean);
      localStorage.setItem('sb_token', clean);
      if (initialGuildId.trim()) {
        localStorage.setItem(`sb_guild_${SESSION_ID}`, initialGuildId.trim());
        localStorage.setItem('sb_guild', initialGuildId.trim());
      }
      const res = await apiPost('/api/auth', {
        token: clean,
        guildId: initialGuildId.trim() || null,
      });
      if (res.state) setBotState(res.state);
    } catch (err) {
      setError(err.message || 'Falha ao autenticar token');
    } finally {
      setLoading(false);
    }
  }

  async function handleDisconnect() {
    try {
      const res = await apiPost('/api/disconnect');
      if (res.state) setBotState(res.state);
    } catch {}
  }

  async function handleSelectGuild(guildId, forceRefresh = false) {
    if (!guildId) return;
    localStorage.setItem(`sb_guild_${SESSION_ID}`, guildId);
    localStorage.setItem('sb_guild', guildId);
    try {
      const res = await apiPost('/api/guild/select', { guildId, forceRefresh });
      if (res.state) setBotState(res.state);
    } catch (err) {
      setError(err.message);
    }
  }

  async function handlePinSubmit() {
    if (!pinInput.trim()) return;
    try {
      const res = await fetch('/api/panel/verify', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Session-Id': SESSION_ID,
        },
        body: JSON.stringify({ pin: pinInput.trim() }),
      });
      if (res.ok) {
        sessionStorage.setItem('panel_pin', pinInput.trim());
        setPanelPin(pinInput.trim());
        setPinRequired(false);
        setPinError('');
      } else {
        setPinError('PIN incorreto. Tente novamente.');
        setPinInput('');
      }
    } catch {
      setPinError('Erro ao verificar PIN.');
    }
  }

  function copyToClipboard(text) {
    navigator.clipboard.writeText(String(text));
    setCopiedText(String(text));
    setTimeout(() => setCopiedText(''), 1800);
  }

  // ===========================================================================
  // AÇÕES DE CALL E PROTEÇÃO
  // ===========================================================================

  async function joinCall(guildId, channelId, lockCall = undefined) {
    try {
      const res = await apiPost('/api/voice/join', {
        guildId: guildId || botState?.selectedGuildId || null,
        channelId,
        lockCall,
      });
      if (res.state) setBotState(res.state);
    } catch (err) {
      setError(err.message);
    }
  }

  async function leaveCall() {
    try {
      const res = await apiPost('/api/voice/leave');
      if (res.state) setBotState(res.state);
    } catch (err) {
      setError(err.message);
    }
  }

  async function toggleVoiceFlag(flagKey) {
    if (!botState?.voiceConfig) return;
    const current = Boolean(botState.voiceConfig[flagKey]);
    try {
      const res = await apiPost('/api/voice/config', {
        [flagKey]: !current,
      });
      if (res.state) setBotState(res.state);
    } catch (err) {
      setError(err.message);
    }
  }

  async function updateAntiDisconnect(patch) {
    try {
      const res = await apiPost('/api/features/anti-disconnect', patch);
      if (res.state) setBotState(res.state);
    } catch (err) {
      setError(err.message);
    }
  }

  async function updateAntiMute(patch) {
    try {
      const res = await apiPost('/api/features/anti-mute', patch);
      if (res.state) setBotState(res.state);
    } catch (err) {
      setError(err.message);
    }
  }

  async function updateFollowCall(patch) {
    try {
      const res = await apiPost('/api/features/follow', patch);
      if (res.state) setBotState(res.state);
    } catch (err) {
      setError(err.message);
    }
  }

  async function updateColeira(patch) {
    try {
      const res = await apiPost('/api/features/coleira', patch);
      if (res.state) setBotState(res.state);
    } catch (err) {
      setError(err.message);
    }
  }

  async function updateAntiCall(patch) {
    try {
      const res = await apiPost('/api/features/anti-call', patch);
      if (res.state) setBotState(res.state);
    } catch (err) {
      setError(err.message);
    }
  }

  async function updateMuteLock(patch) {
    try {
      const res = await apiPost('/api/features/mute-lock', patch);
      if (res.state) setBotState(res.state);
    } catch (err) {
      setError(err.message);
    }
  }

  async function updateGuard(patch) {
    try {
      const res = await apiPost('/api/features/guard', patch);
      if (res.state) setBotState(res.state);
    } catch (err) {
      setError(err.message);
    }
  }

  async function updateChaosMover(patch) {
    try {
      const res = await apiPost('/api/features/chaotic-mover', patch);
      if (res.state) setBotState(res.state);
    } catch (err) {
      setError(err.message);
    }
  }

  async function memberDirectAction(userId, action, channelId = undefined) {
    try {
      const res = await apiPost('/api/voice/member-action', {
        guildId: botState?.selectedGuildId,
        userId,
        action,
        channelId,
      });
      if (res.state) setBotState(res.state);
    } catch (err) {
      setError(err.message);
    }
  }

  // ===========================================================================
  // DADOS DERIVADOS DO SERVIDOR SELECIONADO
  // ===========================================================================

  const selectedGuild = botState?.selectedGuild;
  const voiceChannels = useMemo(() => {
    if (!selectedGuild?.channels) return [];
    return selectedGuild.channels.filter((c) => c.type === 2 || c.type === 13);
  }, [selectedGuild]);

  const textChannels = useMemo(() => {
    if (!selectedGuild?.channels) return [];
    return selectedGuild.channels.filter((c) => c.type === 0 || c.type === 5);
  }, [selectedGuild]);

  const membersByVoiceChannel = useMemo(() => {
    const map = new Map();
    if (!selectedGuild?.voiceStates) return map;
    for (const vs of selectedGuild.voiceStates) {
      if (!vs.channelId) continue;
      const list = map.get(vs.channelId) || [];
      list.push(vs);
      map.set(vs.channelId, list);
    }
    return map;
  }, [selectedGuild]);

  const filteredGuilds = useMemo(() => {
    const list = botState?.guilds || [];
    if (!guildSearch.trim()) return list;
    const q = guildSearch.toLowerCase();
    return list.filter(
      (g) => g.name?.toLowerCase().includes(q) || g.id?.includes(q)
    );
  }, [botState?.guilds, guildSearch]);

  const coleiraTargetIds = useMemo(
    () => new Set((botState?.features?.coleira?.targets || []).map((t) => t.id)),
    [botState?.features?.coleira?.targets]
  );

  const antiCallTargetIds = useMemo(
    () => new Set((botState?.features?.antiCall?.targets || []).map((t) => t.id)),
    [botState?.features?.antiCall?.targets]
  );

  const guardTargetIds = useMemo(
    () => new Set((botState?.features?.guard?.targets || []).map((t) => t.id)),
    [botState?.features?.guard?.targets]
  );

  // ===========================================================================
  // TELA DE PIN
  // ===========================================================================

  if (pinRequired === null) {
    return (
      <div className="min-h-screen bg-[#0b0d12] flex items-center justify-center">
        <div className="w-4 h-4 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (pinRequired === true) {
    return (
      <div className="min-h-screen bg-[#0b0d12] text-[#e2e8f0] flex items-center justify-center p-4">
        <div className="w-full max-w-sm bg-[#131722] rounded-xl border border-[#1e2638] shadow-2xl p-6">
          <div className="flex items-center gap-3 mb-5">
            <Lock className="w-5 h-5 text-cyan-400" />
            <h1 className="text-base font-bold text-white">Acesso Restrito</h1>
          </div>
          <p className="text-xs text-[#64748b] mb-4">Digite o PIN configurado na variável <code className="text-cyan-400">PANEL_PIN</code> do Railway.</p>
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
            className="w-full py-2 bg-cyan-500 hover:bg-cyan-400 disabled:opacity-40 text-white font-semibold rounded-lg text-sm transition-colors cursor-pointer"
          >
            Entrar
          </button>
        </div>
      </div>
    );
  }

  // ===========================================================================
  // TELA DE LOGIN
  // ===========================================================================

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
                  onClick={async () => {
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
                  }}
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
                      onClick={() => { setToken(t.token); setTokenList([]); setError(`Conta ${t.username} selecionada.`); }}
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
            <div className="text-[11px] text-[#94a3b8] flex items-center gap-2">
              <span>ID: {botState.user.id}</span>
              {cv.channelId ? (
                <span className="text-cyan-400 font-medium">
                  • Em Call: {cv.channelName} ({cv.guildName || 'DM'})
                </span>
              ) : (
                <span className="text-[#64748b]">• Fora de Call</span>
              )}
            </div>
          </div>
        </div>

        {/* CONTROLES RÁPIDOS DE CALL NO HEADER */}
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            onClick={() => toggleVoiceFlag('selfMute')}
            className={`px-2.5 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 border transition-colors cursor-pointer ${
              vc.selfMute
                ? 'bg-amber-500/15 text-amber-300 border-amber-500/40'
                : 'bg-[#181e2c] text-[#94a3b8] border-[#252f45] hover:text-white'
            }`}
            title="Alternar Fake Mute"
          >
            {vc.selfMute ? <MicOff className="w-3.5 h-3.5" /> : <Mic className="w-3.5 h-3.5" />}
            <span>{vc.selfMute ? 'Fake Mute ON' : 'Mic Aberto'}</span>
          </button>

          <button
            onClick={() => toggleVoiceFlag('selfDeaf')}
            className={`px-2.5 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 border transition-colors cursor-pointer ${
              vc.selfDeaf
                ? 'bg-amber-500/15 text-amber-300 border-amber-500/40'
                : 'bg-[#181e2c] text-[#94a3b8] border-[#252f45] hover:text-white'
            }`}
            title="Alternar Fake Deaf (aparece ensurdecido)"
          >
            <Headphones className="w-3.5 h-3.5" />
            <span>{vc.selfDeaf ? 'Fake Deaf ON' : 'Fones ON'}</span>
          </button>

          <button
            onClick={() => toggleVoiceFlag('selfVideo')}
            className={`px-2.5 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 border transition-colors cursor-pointer ${
              vc.selfVideo
                ? 'bg-purple-500/15 text-purple-300 border-purple-500/40'
                : 'bg-[#181e2c] text-[#94a3b8] border-[#252f45] hover:text-white'
            }`}
            title="Alternar Fake Câmera"
          >
            {vc.selfVideo ? <Video className="w-3.5 h-3.5" /> : <VideoOff className="w-3.5 h-3.5" />}
            <span>Fake Cam</span>
          </button>

          <button
            onClick={() => toggleVoiceFlag('fakeStream')}
            className={`px-2.5 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 border transition-colors cursor-pointer ${
              vc.fakeStream
                ? 'bg-red-500/20 text-red-300 border-red-500/40'
                : 'bg-[#181e2c] text-[#94a3b8] border-[#252f45] hover:text-white'
            }`}
            title="Alternar Fake Stream (Tag AO VIVO na Call)"
          >
            <Radio className="w-3.5 h-3.5" />
            <span>Fake Live</span>
          </button>

          <button
            onClick={() => toggleVoiceFlag('useIpcForAutoVoice')}
            className={`px-2.5 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 border transition-colors cursor-pointer ${
              vc.useIpcForAutoVoice
                ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                : 'bg-[#181e2c] text-[#94a3b8] border-[#252f45] hover:text-white'
            }`}
            title="Modo IPC: Anti-Disconnect e Seguir Call controlam seu Discord Desktop em vez de criar sessão paralela — evita ser kickado da call"
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
            onClick={() =>
              updateAntiMute({
                enabled: !feat.antiMute?.enabled,
              })
            }
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
              onClick={leaveCall}
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
            <strong className="text-cyan-400 font-mono">{stats.antiDisconnectTriggers || 0}</strong>
          </span>
          <span className="text-[#94a3b8]">
            Coleira Puxadas:{' '}
            <strong className="text-purple-400 font-mono">{stats.coleiraPulls || 0}</strong>
          </span>
          <span className="text-[#94a3b8]">
            Seguir Call:{' '}
            <strong className="text-amber-400 font-mono">{stats.followMoves || 0}</strong>
          </span>
          <span className="text-[#94a3b8]">
            Anti-Mute:{' '}
            <strong className="text-emerald-400 font-mono">{stats.antiMuteTriggers || 0}</strong>
          </span>
          <span className="text-[#94a3b8]">
            Anti-Call Kicks:{' '}
            <strong className="text-red-400 font-mono">{stats.antiCallKicks || 0}</strong>
          </span>
          <span className="text-[#94a3b8]">
            Guard Aliados:{' '}
            <strong className="text-blue-400 font-mono">{stats.guardActions || 0}</strong>
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
                  onClick={() => handleSelectGuild(botState.selectedGuildId, true)}
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
                  onClick={() => handleSelectGuild(g.id)}
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
          {/* =============================================================== */}
          {/* ABA 1: RADAR DE CALLS AO VIVO & AÇÕES EM 1 CLIQUE */}
          {/* =============================================================== */}
          {activeTab === 'radar' && (
            <div className="space-y-6">
              {/* ENTRAR EM QUALQUER CALL POR ID OU SELEÇÃO RÁPIDA */}
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
                    placeholder={`Server ID (Padrão: ${botState.selectedGuildId || 'DM'})`}
                    className="px-3 py-2 bg-[#0b0d12] border border-[#1e2638] rounded-lg text-xs font-mono text-white placeholder-[#475569]"
                  />
                  <input
                    type="text"
                    value={manualChannelId}
                    onChange={(e) => setManualChannelId(e.target.value)}
                    placeholder="Channel ID da Call (Obrigatório)"
                    className="px-3 py-2 bg-[#0b0d12] border border-[#1e2638] rounded-lg text-xs font-mono text-white placeholder-[#475569]"
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={() =>
                        manualChannelId.trim() &&
                        joinCall(
                          manualGuildId.trim() || botState.selectedGuildId,
                          manualChannelId.trim(),
                          false
                        )
                      }
                      className="flex-1 px-3 py-2 bg-cyan-500 hover:bg-cyan-400 text-[#05070a] font-semibold rounded-lg text-xs cursor-pointer"
                    >
                      Entrar na Call
                    </button>
                    <button
                      onClick={() =>
                        manualChannelId.trim() &&
                        joinCall(
                          manualGuildId.trim() || botState.selectedGuildId,
                          manualChannelId.trim(),
                          true
                        )
                      }
                      className="flex-1 px-3 py-2 bg-purple-500/20 hover:bg-purple-500/30 text-purple-300 border border-purple-500/40 font-semibold rounded-lg text-xs cursor-pointer"
                      title="Entrar e já ativar Anti-Disconnect nesta call"
                    >
                      Entrar + Travar
                    </button>
                  </div>
                </div>
              </section>

              {/* LISTA DE CANAIS DE VOZ DO SERVIDOR E MEMBROS EM CALL */}
              <section className="bg-[#131722] border border-[#1e2638] rounded-xl p-4">
                <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
                  <div>
                    <h2 className="text-sm font-bold text-white flex items-center gap-2">
                      <Server className="w-4 h-4 text-cyan-400" />
                      <span>
                        Canais de Voz — {selectedGuild?.name || 'Selecione um Servidor'}
                      </span>
                    </h2>
                    <p className="text-xs text-[#94a3b8]">
                      Visualize quem está nas calls em tempo real e aplique Coleira, Seguir Call, Guard ou Kick com 1 clique.
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
                      const isMyChannel = cv.channelId === ch.id;
                      const isLockedChannel =
                        feat.antiDisconnect?.enabled &&
                        feat.antiDisconnect?.channelId === ch.id;

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
                              <span className="font-semibold text-xs text-white truncate">
                                {ch.name}
                              </span>
                              <span className="text-[10px] font-mono text-[#64748b]">
                                ({members.length}
                                {ch.user_limit ? `/${ch.user_limit}` : ''})
                              </span>
                              {isLockedChannel && (
                                <span className="px-1.5 py-0.5 rounded text-[10px] bg-cyan-500/20 text-cyan-300 border border-cyan-500/40">
                                  TRAVADA
                                </span>
                              )}
                            </div>

                            <div className="flex items-center gap-1.5 shrink-0">
                              <button
                                onClick={() => joinCall(selectedGuild.id, ch.id, false)}
                                className="px-2 py-1 rounded bg-[#181e2c] hover:bg-cyan-500 hover:text-[#05070a] text-cyan-400 text-[11px] font-medium transition-colors cursor-pointer"
                              >
                                Entrar
                              </button>
                              <button
                                onClick={() => joinCall(selectedGuild.id, ch.id, true)}
                                className="px-2 py-1 rounded bg-purple-500/15 hover:bg-purple-500/30 text-purple-300 border border-purple-500/30 text-[11px] font-medium transition-colors cursor-pointer"
                                title="Entrar e travar Anti-Disconnect nesta call"
                              >
                                Travar
                              </button>
                            </div>
                          </div>

                          {/* MEMBROS DENTRO DESTA CALL */}
                          {members.length === 0 ? (
                            <div className="text-[11px] text-[#475569] pl-6">Sala vazia</div>
                          ) : (
                            <div className="space-y-1.5 mt-2 pt-2 border-t border-[#181e2c]">
                              {members.map((m) => {
                                const isMe = m.userId === botState.user.id;
                                const inColeira = coleiraTargetIds.has(m.userId);
                                const isFollowed =
                                  feat.followCall?.enabled &&
                                  feat.followCall?.targetUserId === m.userId;
                                const inAntiCall = antiCallTargetIds.has(m.userId);
                                const inGuard = guardTargetIds.has(m.userId);

                                return (
                                  <div
                                    key={m.userId}
                                    className="flex flex-wrap items-center justify-between gap-2 bg-[#131722] px-2.5 py-1.5 rounded-lg border border-[#1e2638]"
                                  >
                                    <div className="flex items-center gap-2 min-w-0">
                                      {getAvatarUrl(m.userId, m.avatar) ? (
                                        <img
                                          src={getAvatarUrl(m.userId, m.avatar)}
                                          alt=""
                                          className="w-5 h-5 rounded-full shrink-0"
                                        />
                                      ) : (
                                        <div className="w-5 h-5 rounded-full bg-cyan-500/20 text-cyan-300 text-[10px] font-bold flex items-center justify-center shrink-0">
                                          {(m.displayName || 'U')[0]}
                                        </div>
                                      )}
                                      <div className="truncate">
                                        <span className="text-xs font-medium text-white">
                                          {m.displayName}
                                        </span>
                                        <button
                                          onClick={() => copyToClipboard(m.userId)}
                                          className="ml-1.5 text-[10px] font-mono text-[#64748b] hover:text-cyan-400 cursor-pointer"
                                          title="Copiar ID"
                                        >
                                          {copiedText === m.userId ? 'Copiado!' : m.userId}
                                        </button>
                                      </div>

                                      {/* ÍCONES DE ESTADO DE VOZ */}
                                      <div className="flex items-center gap-1">
                                        {(m.selfMute || m.mute) && (
                                          <MicOff
                                            className={`w-3 h-3 ${
                                              m.mute ? 'text-red-400' : 'text-[#64748b]'
                                            }`}
                                            title={m.mute ? 'Server Mute' : 'Self Mute'}
                                          />
                                        )}
                                        {(m.selfDeaf || m.deaf) && (
                                          <VolumeX
                                            className={`w-3 h-3 ${
                                              m.deaf ? 'text-red-400' : 'text-[#64748b]'
                                            }`}
                                            title={m.deaf ? 'Server Deaf' : 'Self Deaf'}
                                          />
                                        )}
                                        {m.selfVideo && (
                                          <Video className="w-3 h-3 text-purple-400" />
                                        )}
                                        {m.selfStream && (
                                          <span className="px-1 rounded text-[9px] font-bold bg-red-500 text-white">
                                            LIVE
                                          </span>
                                        )}
                                      </div>
                                    </div>

                                    {/* BOTÕES DE AÇÃO EM 1 CLIQUE NO MEMBRO */}
                                    {!isMe && (
                                      <div className="flex flex-wrap items-center gap-1">
                                        <button
                                          onClick={() =>
                                            updateColeira({
                                              action: inColeira ? 'remove' : 'add',
                                              targetUserId: m.userId,
                                            })
                                          }
                                          className={`px-1.5 py-0.5 rounded text-[10px] font-semibold border cursor-pointer ${
                                            inColeira
                                              ? 'bg-purple-500 text-white border-purple-400'
                                              : 'bg-[#181e2c] text-purple-300 border-purple-500/30 hover:bg-purple-500/20'
                                          }`}
                                          title="Prender na Coleira (puxa sempre para sua call)"
                                        >
                                          {inColeira ? 'Na Coleira' : 'Coleira'}
                                        </button>

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
          )}

          {/* =============================================================== */}
          {/* ABA 2: COLEIRA, SEGUIR CALL, ANTI-DISCONNECT, ANTI-MUTE & GUARD */}
          {/* =============================================================== */}
          {activeTab === 'call_ops' && (
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
              {/* CARD 1: COLEIRA (LEASH) */}
              <section className="bg-[#131722] border border-[#1e2638] rounded-xl p-4 space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Link2 className="w-4 h-4 text-purple-400" />
                    <h3 className="text-sm font-bold text-white">
                      Coleira (Prender Usuário na sua Call)
                    </h3>
                  </div>
                  <button
                    onClick={() =>
                      updateColeira({ enabled: !feat.coleira?.enabled })
                    }
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
                    className="flex-1 px-3 py-2 bg-[#0b0d12] border border-[#1e2638] rounded-lg text-xs font-mono text-white"
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
                    className="px-3.5 py-2 bg-purple-500 hover:bg-purple-400 text-white font-semibold rounded-lg text-xs cursor-pointer"
                  >
                    Adicionar
                  </button>
                </div>

                <div className="flex flex-wrap gap-3 text-xs">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={Boolean(feat.coleira?.followSelfMove)}
                      onChange={(e) =>
                        updateColeira({ followSelfMove: e.target.checked })
                      }
                      className="accent-purple-500"
                    />
                    <span>Puxar quando eu trocar de call</span>
                  </label>

                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={Boolean(feat.coleira?.forceServerMute)}
                      onChange={(e) =>
                        updateColeira({ forceServerMute: e.target.checked })
                      }
                      className="accent-purple-500"
                    />
                    <span>Forçar Server Mute</span>
                  </label>

                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={Boolean(feat.coleira?.forceServerDeaf)}
                      onChange={(e) =>
                        updateColeira({ forceServerDeaf: e.target.checked })
                      }
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
                            onClick={() =>
                              updateColeira({ action: 'remove', targetUserId: t.id })
                            }
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
                    className="sm:col-span-2 px-3 py-2 bg-[#0b0d12] border border-[#1e2638] rounded-lg text-xs font-mono text-white"
                  />
                  <div className="flex items-center gap-1.5 bg-[#0b0d12] border border-[#1e2638] rounded-lg px-2.5 py-1.5">
                    <span className="text-[11px] text-[#64748b]">Delay(ms):</span>
                    <input
                      type="number"
                      min="0"
                      max="5000"
                      value={followDelayMs}
                      onChange={(e) => setFollowDelayMs(Number(e.target.value))}
                      className="w-full bg-transparent text-xs font-mono text-white focus:outline-none"
                    />
                  </div>
                </div>

                <div className="flex flex-wrap gap-3 text-xs">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={Boolean(feat.followCall?.syncAntiDisconnect)}
                      onChange={(e) =>
                        updateFollowCall({ syncAntiDisconnect: e.target.checked })
                      }
                      className="accent-amber-500"
                    />
                    <span>Atualizar trava Anti-Disconnect ao seguir</span>
                  </label>

                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={Boolean(feat.followCall?.leaveWhenTargetLeaves)}
                      onChange={(e) =>
                        updateFollowCall({ leaveWhenTargetLeaves: e.target.checked })
                      }
                      className="accent-amber-500"
                    />
                    <span>Sair da call quando o alvo sair</span>
                  </label>
                </div>

                <div className="flex items-center justify-between bg-[#0b0d12] p-3 rounded-lg border border-[#1e2638] text-xs">
                  <div>
                    <span className="text-[#64748b]">Alvo Atual: </span>
                    <strong className="text-white">
                      {feat.followCall?.targetLabel || 'Nenhum'}
                    </strong>
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
                        className="w-20 px-2 py-1 bg-[#131722] border border-[#1e2638] rounded text-right font-mono text-white"
                      />
                    </div>

                    <label className="flex items-center gap-2 text-xs cursor-pointer">
                      <input
                        type="checkbox"
                        checked={Boolean(feat.antiDisconnect?.rejoinOnMove)}
                        onChange={(e) =>
                          updateAntiDisconnect({ rejoinOnMove: e.target.checked })
                        }
                        className="accent-cyan-500"
                      />
                      <span>Voltar se me moverem para outra sala</span>
                    </label>
                  </div>

                  <div className="bg-[#0b0d12] p-3 rounded-lg border border-[#1e2638] space-y-2.5">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-white">
                        Anti-Mute / Anti-Deaf
                      </span>
                      <button
                        onClick={() =>
                          updateAntiMute({ enabled: !feat.antiMute?.enabled })
                        }
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

              {/* CARD 4: ANTI-CALL (KICK LOOP), MUTE-LOCK, GUARD & CHAOS MOVER */}
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
                      className="flex-1 px-2.5 py-1.5 bg-[#131722] border border-[#1e2638] rounded text-xs font-mono text-white"
                    />
                    <button
                      onClick={() => {
                        if (!antiCallInputId.trim()) return;
                        updateAntiCall({ action: 'add', targetUserId: antiCallInputId.trim() });
                        setAntiCallInputId('');
                      }}
                      className="px-3 py-1.5 bg-red-500 hover:bg-red-400 text-white rounded text-xs font-semibold cursor-pointer"
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
                            onClick={() =>
                              updateAntiCall({ action: 'remove', targetUserId: t.id })
                            }
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
                      className="flex-1 px-2.5 py-1.5 bg-[#131722] border border-[#1e2638] rounded text-xs font-mono text-white"
                    />
                    <button
                      onClick={() => {
                        if (!guardInputId.trim()) return;
                        updateGuard({ action: 'add', targetUserId: guardInputId.trim() });
                        setGuardInputId('');
                      }}
                      className="px-3 py-1.5 bg-emerald-500 hover:bg-emerald-400 text-[#05070a] rounded text-xs font-semibold cursor-pointer"
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
                            onClick={() =>
                              updateGuard({ action: 'remove', targetUserId: t.id })
                            }
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
                      Mute-Lock (Travar Alvo com Server Mute/Deaf em Loop)
                    </span>
                    <span className="font-mono text-[#64748b]">
                      {feat.muteLock?.targets?.length || 0} travado(s)
                    </span>
                  </div>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={muteLockInputId}
                      onChange={(e) => setMuteLockInputId(e.target.value)}
                      placeholder="User ID para travar mutado..."
                      className="flex-1 px-2.5 py-1.5 bg-[#131722] border border-[#1e2638] rounded text-xs font-mono text-white"
                    />
                    <button
                      onClick={() => {
                        if (!muteLockInputId.trim()) return;
                        updateMuteLock({ action: 'add', targetUserId: muteLockInputId.trim() });
                        setMuteLockInputId('');
                      }}
                      className="px-3 py-1.5 bg-purple-500 hover:bg-purple-400 text-white rounded text-xs font-semibold cursor-pointer"
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
                            onClick={() =>
                              updateMuteLock({ action: 'remove', targetUserId: t.id })
                            }
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
                        updateChaosMover({
                          enabled: !feat.chaoticMover?.enabled,
                          targetUserId: chaosTargetId.trim() || feat.chaoticMover?.targetUserId,
                          guildId: botState.selectedGuildId,
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
                      className="flex-1 px-2.5 py-1.5 bg-[#131722] border border-[#1e2638] rounded text-xs font-mono text-white"
                    />
                    <input
                      type="number"
                      min="600"
                      max="10000"
                      value={chaosIntervalMs}
                      onChange={(e) => setChaosIntervalMs(Number(e.target.value))}
                      className="w-24 px-2 py-1.5 bg-[#131722] border border-[#1e2638] rounded text-xs font-mono text-white"
                      title="Intervalo em ms"
                    />
                  </div>
                </div>
              </section>
            </div>
          )}

          {/* =============================================================== */}
          {/* ABA 3: STATUS RICH PRESENCE, PURGE (CL), GHOST PING & SNIPER */}
          {/* =============================================================== */}
          {activeTab === 'presence_chat' && (
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
                      className="w-full px-3 py-2 bg-[#0b0d12] border border-[#1e2638] rounded-lg text-xs text-white"
                    >
                      <option value="online">Online</option>
                      <option value="dnd">Não Perturbe (DND)</option>
                      <option value="idle">Ausente (Idle)</option>
                      <option value="invisible">Invisível</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-[11px] text-[#94a3b8] mb-1">
                      Tipo de Atividade
                    </label>
                    <select
                      value={presType}
                      onChange={(e) => setPresType(Number(e.target.value))}
                      className="w-full px-3 py-2 bg-[#0b0d12] border border-[#1e2638] rounded-lg text-xs text-white"
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
                    className="px-3 py-2 bg-[#0b0d12] border border-[#1e2638] rounded-lg text-xs text-white"
                  />
                  <input
                    type="text"
                    value={presCustom}
                    onChange={(e) => setPresCustom(e.target.value)}
                    placeholder="Recado / Custom Status..."
                    className="px-3 py-2 bg-[#0b0d12] border border-[#1e2638] rounded-lg text-xs text-white"
                  />
                  <input
                    type="text"
                    value={presDetails}
                    onChange={(e) => setPresDetails(e.target.value)}
                    placeholder="Detalhes (Linha 1)"
                    className="px-3 py-2 bg-[#0b0d12] border border-[#1e2638] rounded-lg text-xs text-white"
                  />
                  <input
                    type="text"
                    value={presState}
                    onChange={(e) => setPresState(e.target.value)}
                    placeholder="Estado (Linha 2)"
                    className="px-3 py-2 bg-[#0b0d12] border border-[#1e2638] rounded-lg text-xs text-white"
                  />
                </div>

                {presType === 1 && (
                  <input
                    type="text"
                    value={presUrl}
                    onChange={(e) => setPresUrl(e.target.value)}
                    placeholder="URL da Twitch (ex: https://twitch.tv/discord)"
                    className="w-full px-3 py-2 bg-[#0b0d12] border border-[#1e2638] rounded-lg text-xs font-mono text-white"
                  />
                )}

                <button
                  onClick={() =>
                    apiPost('/api/presence', {
                      status: presStatus,
                      activityType: presType,
                      activityName: presName,
                      activityDetails: presDetails,
                      activityState: presState,
                      streamUrl: presUrl,
                      customStatus: presCustom,
                    }).then((r) => r.state && setBotState(r.state))
                  }
                  className="w-full py-2 bg-cyan-500 hover:bg-cyan-400 text-[#05070a] font-semibold rounded-lg text-xs cursor-pointer"
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
                      className="flex-1 px-2.5 py-1.5 bg-[#131722] border border-[#1e2638] rounded text-xs font-mono text-white"
                    />
                    <input
                      type="number"
                      min="1"
                      max="200"
                      value={purgeLimit}
                      onChange={(e) => setPurgeLimit(Number(e.target.value))}
                      className="w-20 px-2 py-1.5 bg-[#131722] border border-[#1e2638] rounded text-xs font-mono text-white"
                    />
                    <button
                      onClick={() =>
                        purgeChannelId.trim() &&
                        apiPost('/api/chat/purge', {
                          channelId: purgeChannelId.trim(),
                          limit: purgeLimit,
                        })
                      }
                      className="px-3 py-1.5 bg-red-500 hover:bg-red-400 text-white rounded text-xs font-semibold cursor-pointer"
                    >
                      Executar CL
                    </button>
                  </div>
                </div>

                {/* GHOST PING */}
                <div className="bg-[#0b0d12] p-3 rounded-lg border border-[#1e2638] space-y-2">
                  <div className="text-xs font-semibold text-white">
                    Ghost Ping (Menciona e apaga em 180ms)
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    <input
                      type="text"
                      value={ghostChannelId}
                      onChange={(e) => setGhostChannelId(e.target.value)}
                      placeholder="Channel ID..."
                      className="px-2.5 py-1.5 bg-[#131722] border border-[#1e2638] rounded text-xs font-mono text-white"
                    />
                    <input
                      type="text"
                      value={ghostTargetId}
                      onChange={(e) => setGhostTargetId(e.target.value)}
                      placeholder="User ID do Alvo..."
                      className="px-2.5 py-1.5 bg-[#131722] border border-[#1e2638] rounded text-xs font-mono text-white"
                    />
                    <button
                      onClick={() =>
                        ghostChannelId.trim() &&
                        ghostTargetId.trim() &&
                        apiPost('/api/chat/ghost-ping', {
                          channelId: ghostChannelId.trim(),
                          targetUserId: ghostTargetId.trim(),
                        })
                      }
                      className="px-3 py-1.5 bg-purple-500 hover:bg-purple-400 text-white rounded text-xs font-semibold cursor-pointer"
                    >
                      Ghost Ping
                    </button>
                  </div>
                </div>

                {/* AUTO-REPLY & NITRO SNIPER */}
                <div className="bg-[#0b0d12] p-3 rounded-lg border border-[#1e2638] space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-white">
                      Auto-Reply & Nitro Sniper
                    </span>
                    <div className="flex gap-2">
                      <button
                        onClick={() =>
                          apiPost('/api/features/automation', {
                            nitroSniper: { enabled: !feat.nitroSniper?.enabled },
                          }).then((r) => r.state && setBotState(r.state))
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
                          apiPost('/api/features/automation', {
                            autoReply: {
                              enabled: !feat.autoReply?.enabled,
                              message: autoReplyMsg,
                              cooldownSec: autoReplyCooldown,
                            },
                          }).then((r) => r.state && setBotState(r.state))
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
                      className="flex-1 px-2.5 py-1.5 bg-[#131722] border border-[#1e2638] rounded text-xs text-white"
                    />
                    <input
                      type="number"
                      min="3"
                      max="300"
                      value={autoReplyCooldown}
                      onChange={(e) => setAutoReplyCooldown(Number(e.target.value))}
                      className="w-20 px-2 py-1.5 bg-[#131722] border border-[#1e2638] rounded text-xs font-mono text-white"
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
                      className="px-2.5 py-1.5 bg-[#131722] border border-[#1e2638] rounded text-xs font-mono text-white"
                    />
                    <input
                      type="number"
                      min="1"
                      max="50"
                      value={chatCount}
                      onChange={(e) => setChatCount(Number(e.target.value))}
                      className="px-2.5 py-1.5 bg-[#131722] border border-[#1e2638] rounded text-xs font-mono text-white"
                      title="Quantidade de mensagens"
                    />
                    <input
                      type="number"
                      min="400"
                      max="10000"
                      value={chatDelayMs}
                      onChange={(e) => setChatDelayMs(Number(e.target.value))}
                      className="px-2.5 py-1.5 bg-[#131722] border border-[#1e2638] rounded text-xs font-mono text-white"
                      title="Delay entre mensagens (ms)"
                    />
                  </div>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={chatContent}
                      onChange={(e) => setChatContent(e.target.value)}
                      placeholder="Conteúdo da mensagem..."
                      className="flex-1 px-2.5 py-1.5 bg-[#131722] border border-[#1e2638] rounded text-xs text-white"
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
                      className="px-3 py-1.5 bg-cyan-500 hover:bg-cyan-400 text-[#05070a] rounded text-xs font-semibold cursor-pointer"
                    >
                      Enviar
                    </button>
                  </div>
                </div>
              </section>
            </div>
          )}

          {/* =============================================================== */}
          {/* ABA 4: FÁBRICA DE SERVIDOR / ADMINISTRAÇÃO EM LOTE */}
          {/* =============================================================== */}
          {activeTab === 'factory' && (
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
              {/* CRIAR CANAIS EM LOTE */}
              <section className="bg-[#131722] border border-[#1e2638] rounded-xl p-4 space-y-3">
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  <Hash className="w-4 h-4 text-cyan-400" />
                  <span>Criar Canais em Lote ({selectedGuild?.name || 'Servidor'})</span>
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                  <input
                    type="text"
                    value={batchChName}
                    onChange={(e) => setBatchChName(e.target.value)}
                    placeholder="Nome base do canal"
                    className="px-3 py-2 bg-[#0b0d12] border border-[#1e2638] rounded-lg text-xs text-white"
                  />
                  <select
                    value={batchChType}
                    onChange={(e) => setBatchChType(Number(e.target.value))}
                    className="px-3 py-2 bg-[#0b0d12] border border-[#1e2638] rounded-lg text-xs text-white"
                  >
                    <option value={0}>Canal de Texto</option>
                    <option value={2}>Canal de Voz</option>
                  </select>
                  <input
                    type="number"
                    min="1"
                    max="50"
                    value={batchChCount}
                    onChange={(e) => setBatchChCount(Number(e.target.value))}
                    className="px-3 py-2 bg-[#0b0d12] border border-[#1e2638] rounded-lg text-xs font-mono text-white"
                  />
                </div>
                <button
                  onClick={() =>
                    apiPost('/api/batch/channels', {
                      guildId: botState.selectedGuildId,
                      name: batchChName,
                      type: batchChType,
                      count: batchChCount,
                    })
                  }
                  className="w-full py-2 bg-cyan-500 hover:bg-cyan-400 text-[#05070a] font-semibold rounded-lg text-xs cursor-pointer"
                >
                  Criar {batchChCount} Canal(is)
                </button>
              </section>

              {/* CRIAR CARGOS EM LOTE */}
              <section className="bg-[#131722] border border-[#1e2638] rounded-xl p-4 space-y-3">
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  <Users className="w-4 h-4 text-purple-400" />
                  <span>Criar Cargos em Lote</span>
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                  <input
                    type="text"
                    value={batchRoleName}
                    onChange={(e) => setBatchRoleName(e.target.value)}
                    placeholder="Nome do Cargo"
                    className="px-3 py-2 bg-[#0b0d12] border border-[#1e2638] rounded-lg text-xs text-white"
                  />
                  <input
                    type="color"
                    value={batchRoleColor}
                    onChange={(e) => setBatchRoleColor(e.target.value)}
                    className="w-full h-9 bg-[#0b0d12] border border-[#1e2638] rounded-lg px-1 cursor-pointer"
                  />
                  <input
                    type="number"
                    min="1"
                    max="50"
                    value={batchRoleCount}
                    onChange={(e) => setBatchRoleCount(Number(e.target.value))}
                    className="px-3 py-2 bg-[#0b0d12] border border-[#1e2638] rounded-lg text-xs font-mono text-white"
                  />
                </div>
                <button
                  onClick={() =>
                    apiPost('/api/batch/roles', {
                      guildId: botState.selectedGuildId,
                      name: batchRoleName,
                      color: batchRoleColor,
                      count: batchRoleCount,
                    })
                  }
                  className="w-full py-2 bg-purple-500 hover:bg-purple-400 text-white font-semibold rounded-lg text-xs cursor-pointer"
                >
                  Criar {batchRoleCount} Cargo(s)
                </button>
              </section>

              {/* CONVITES EM LOTE & NUKE / CLONAR CANAL */}
              <section className="bg-[#131722] border border-[#1e2638] rounded-xl p-4 space-y-3 xl:col-span-2">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <h4 className="text-xs font-bold text-white">
                      Gerar Convites em Todos os Canais do Servidor
                    </h4>
                    <p className="text-[11px] text-[#94a3b8]">
                      Gera links de convite únicos nos canais do servidor atual e exibe os links diretamente no console abaixo.
                    </p>
                    <button
                      onClick={() =>
                        apiPost('/api/batch/invites', {
                          guildId: botState.selectedGuildId,
                        })
                      }
                      className="px-4 py-2 bg-emerald-500 hover:bg-emerald-400 text-[#05070a] font-semibold rounded-lg text-xs cursor-pointer"
                    >
                      Gerar Convites em Lote
                    </button>
                  </div>

                  <div className="space-y-2">
                    <h4 className="text-xs font-bold text-white">
                      Nuke / Recriar Canal (Limpar Histórico Inteiro)
                    </h4>
                    <div className="flex gap-2">
                      <select
                        value={nukeChannelId}
                        onChange={(e) => setNukeChannelId(e.target.value)}
                        className="flex-1 px-3 py-2 bg-[#0b0d12] border border-[#1e2638] rounded-lg text-xs text-white"
                      >
                        <option value="">Selecione um canal do servidor...</option>
                        {textChannels.map((c) => (
                          <option key={c.id} value={c.id}>
                            #{c.name} ({c.id})
                          </option>
                        ))}
                      </select>
                      <button
                        onClick={() =>
                          nukeChannelId &&
                          apiPost('/api/channel/nuke', { channelId: nukeChannelId })
                        }
                        className="px-4 py-2 bg-red-500 hover:bg-red-400 text-white font-semibold rounded-lg text-xs cursor-pointer"
                      >
                        Clonar & Deletar
                      </button>
                    </div>
                  </div>
                </div>
              </section>
            </div>
          )}

          {/* =============================================================== */}
          {/* ABA 5: LIMPAR DM */}
          {/* =============================================================== */}
          {activeTab === 'limpar_dm' && (
            <div className="space-y-5">
              <section className="bg-[#131722] border border-[#1e2638] rounded-xl p-4">
                <div className="flex items-center gap-2 mb-4">
                  <Trash2 className="w-4 h-4 text-red-400" />
                  <h2 className="text-sm font-bold text-white">Limpar DM — Apagar suas mensagens</h2>
                </div>
                <p className="text-xs text-[#94a3b8] mb-4">
                  Apaga todas as suas mensagens em uma DM. Cole o ID do usuário ou do canal de DM. O bot buscará todo o histórico e deletará uma por uma com o delay configurado.
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 mb-3">
                  <input
                    type="text"
                    value={limparDmTarget}
                    onChange={(e) => setLimparDmTarget(e.target.value)}
                    placeholder="User ID ou Channel ID da DM"
                    className="sm:col-span-2 px-3 py-2 bg-[#0b0d12] border border-[#1e2638] rounded-lg text-xs font-mono text-white placeholder-[#475569] focus:outline-none focus:border-red-500"
                    disabled={limparDmTask?.phase === 'fetching' || limparDmTask?.phase === 'deleting'}
                  />
                  <div className="flex items-center gap-1.5 bg-[#0b0d12] border border-[#1e2638] rounded-lg px-2.5 py-1.5">
                    <span className="text-[11px] text-[#64748b] shrink-0">Delay(ms):</span>
                    <input
                      type="number"
                      min="300"
                      max="5000"
                      value={limparDmDelay}
                      onChange={(e) => setLimparDmDelay(Number(e.target.value))}
                      className="w-full bg-transparent text-xs font-mono text-white focus:outline-none"
                    />
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={async () => {
                      if (!limparDmTarget.trim()) return;
                      try {
                        setLimparDmTask({ phase: 'fetching', progress: 0, total: 0, username: '...', avatarUrl: null, message: 'Iniciando...' });
                        await apiPost('/api/limpar-dm', { targetId: limparDmTarget.trim(), delayMs: limparDmDelay });
                      } catch (err) {
                        setLimparDmTask({ phase: 'error', message: err.message || String(err) });
                      }
                    }}
                    disabled={!limparDmTarget.trim() || limparDmTask?.phase === 'fetching' || limparDmTask?.phase === 'deleting'}
                    className="flex-1 px-4 py-2 bg-red-500 hover:bg-red-400 disabled:bg-red-900/40 disabled:text-red-700 text-white font-semibold rounded-lg text-xs transition-colors cursor-pointer"
                  >
                    {limparDmTask?.phase === 'fetching' ? 'Buscando mensagens...' :
                     limparDmTask?.phase === 'deleting' ? 'Deletando...' : 'Iniciar Limpeza'}
                  </button>
                  {(limparDmTask?.phase === 'completed' || limparDmTask?.phase === 'error') && (
                    <button
                      onClick={() => { setLimparDmTask(null); setLimparDmTarget(''); }}
                      className="px-4 py-2 bg-[#181e2c] hover:bg-[#252f45] text-[#94a3b8] font-semibold rounded-lg text-xs cursor-pointer"
                    >
                      Limpar
                    </button>
                  )}
                </div>
              </section>

              {limparDmTask && (
                <section className="bg-[#131722] border border-[#1e2638] rounded-xl p-4">
                  {/* Cabeçalho com avatar e nome */}
                  <div className="flex items-center gap-3 mb-4">
                    {limparDmTask.avatarUrl ? (
                      <img src={limparDmTask.avatarUrl} alt="" className="w-10 h-10 rounded-full border border-[#1e2638] shrink-0" />
                    ) : (
                      <div className="w-10 h-10 rounded-full bg-red-500/20 border border-red-500/30 flex items-center justify-center text-red-300 font-bold text-sm shrink-0">
                        {(limparDmTask.username || '?')[0].toUpperCase()}
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold text-white truncate">{limparDmTask.username || '—'}</div>
                      <div className={`text-xs font-medium ${
                        limparDmTask.phase === 'completed' ? 'text-emerald-400' :
                        limparDmTask.phase === 'error' ? 'text-red-400' :
                        limparDmTask.phase === 'deleting' ? 'text-amber-400' : 'text-blue-400'
                      }`}>
                        {limparDmTask.phase === 'fetching' ? 'Buscando...' :
                         limparDmTask.phase === 'deleting' ? 'Deletando...' :
                         limparDmTask.phase === 'completed' ? 'Concluído' :
                         limparDmTask.phase === 'error' ? 'Erro' : limparDmTask.phase}
                      </div>
                    </div>
                    {limparDmTask.phase === 'deleting' && limparDmTask.total > 0 && (
                      <div className="text-2xl font-bold tabular-nums text-white shrink-0">
                        {Math.round((limparDmTask.progress / limparDmTask.total) * 100)}%
                      </div>
                    )}
                  </div>

                  {/* Barra de progresso */}
                  {limparDmTask.phase === 'deleting' && limparDmTask.total > 0 && (
                    <div className="h-1.5 bg-[#1e2638] rounded-full mb-4 overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-red-500 to-red-400 rounded-full transition-all duration-300"
                        style={{ width: `${Math.round((limparDmTask.progress / limparDmTask.total) * 100)}%` }}
                      />
                    </div>
                  )}
                  {(limparDmTask.phase === 'fetching') && (
                    <div className="h-1 bg-gradient-to-r from-transparent via-blue-500 to-transparent mb-4 animate-pulse rounded-full" />
                  )}

                  {/* Estatísticas */}
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    <div className="bg-[#0b0d12] p-3 rounded-lg border border-[#1e2638]">
                      <div className="text-[10px] uppercase text-[#64748b] mb-1">
                        {limparDmTask.phase === 'fetching' ? 'Encontradas' : 'Deletadas'}
                      </div>
                      <div className="text-xl font-bold tabular-nums text-white">{limparDmTask.progress.toLocaleString()}</div>
                    </div>
                    <div className="bg-[#0b0d12] p-3 rounded-lg border border-[#1e2638]">
                      <div className="text-[10px] uppercase text-[#64748b] mb-1">
                        {limparDmTask.phase === 'fetching' ? 'Analisadas' : 'Total'}
                      </div>
                      <div className="text-xl font-bold tabular-nums text-white">{limparDmTask.total.toLocaleString()}</div>
                    </div>
                    <div className="col-span-2 sm:col-span-1 bg-[#0b0d12] p-3 rounded-lg border border-[#1e2638]">
                      <div className="text-[10px] uppercase text-[#64748b] mb-1">Status</div>
                      <div className="text-xs text-[#94a3b8] truncate">{limparDmTask.message || '—'}</div>
                    </div>
                  </div>
                </section>
              )}
            </div>
          )}

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
                onClick={() => apiPost('/api/logs/clear')}
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
    </div>
  );
}

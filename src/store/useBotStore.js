import { create } from 'zustand';
import { SESSION_ID } from '../session.js';

export function getStoredPin() {
  if (typeof sessionStorage !== 'undefined') {
    return sessionStorage.getItem('panel_pin') || '';
  }
  return '';
}

export async function apiPost(endpoint, body = {}) {
  const pin = getStoredPin();
  const headers = {
    'Content-Type': 'application/json',
    'X-Session-Id': SESSION_ID,
    ...(pin ? { 'x-panel-pin': pin } : {}),
  };
  const res = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `HTTP ${res.status}`);
  }
  return data;
}

export async function apiGet(endpoint) {
  const pin = getStoredPin();
  const headers = {
    'X-Session-Id': SESSION_ID,
    ...(pin ? { 'x-panel-pin': pin } : {}),
  };
  const res = await fetch(endpoint, { headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `HTTP ${res.status}`);
  }
  return data;
}

export function getAvatarUrl(userId, avatarHash) {
  if (!userId || !avatarHash) return null;
  return `https://cdn.discordapp.com/avatars/${userId}/${avatarHash}.png?size=128`;
}

export function getGuildIconUrl(guildId, iconHash) {
  if (!guildId || !iconHash) return null;
  return `https://cdn.discordapp.com/icons/${guildId}/${iconHash}.png?size=128`;
}

export const useBotStore = create((set, get) => ({
  // Sessão & PIN
  pinRequired: null, // null = carregando, false = sem pin, true = precisa de pin
  pinInput: '',
  pinError: '',
  token:
    typeof localStorage !== 'undefined'
      ? localStorage.getItem(`sb_token_${SESSION_ID}`) || localStorage.getItem('sb_token') || ''
      : '',
  initialGuildId:
    typeof localStorage !== 'undefined'
      ? localStorage.getItem(`sb_guild_${SESSION_ID}`) || localStorage.getItem('sb_guild') || ''
      : '',
  loading: false,
  error: '',
  tokenList: [],

  // Navegação
  activeTab: 'radar', // radar | call_ops | presence_chat | factory | limpar_dm
  guildSearch: '',
  copiedText: '',

  // Estado do Bot
  botState: null,

  // Modals
  voiceMemberModal: {
    isOpen: false,
    member: null,
    guildId: null,
  },
  confirmActionModal: {
    isOpen: false,
    title: '',
    message: '',
    onConfirm: null,
  },

  // Inputs Operacionais Call Ops
  manualGuildId: '',
  manualChannelId: '',
  followInputId: '',
  followDelayMs: 250,
  antiDcDelayMs: 150,
  coleiraInputId: '',
  antiCallInputId: '',
  muteLockInputId: '',
  guardInputId: '',
  chaosTargetId: '',
  chaosIntervalMs: 1200,

  // Inputs Presence & Chat
  presStatus: 'online',
  presType: 1,
  presName: 'Discord Selfbot',
  presDetails: '',
  presState: '',
  presUrl: 'https://twitch.tv/discord',
  presCustom: '',
  chatChannelId: '',
  purgeChannelId: '',
  purgeLimit: 30,
  ghostChannelId: '',
  ghostTargetId: '',
  autoReplyMsg: 'Estou ocupado no momento, já respondo.',
  autoReplyCooldown: 15,

  // Inputs Server Factory
  batchChName: 'geral',
  batchChType: 0,
  batchChCount: 3,
  batchRoleName: 'Membro VIP',
  batchRoleColor: '#06b6d4',
  batchRoleCount: 3,
  nukeChannelId: '',

  // Limpar DM
  limparDmTarget: '',
  limparDmDelay: 700,
  limparDmTask: null,

  // Setters simples
  setPinInput: (val) => set({ pinInput: val }),
  setPinError: (val) => set({ pinError: val }),
  setToken: (val) => set({ token: val }),
  setInitialGuildId: (val) => set({ initialGuildId: val }),
  setLoading: (val) => set({ loading: val }),
  setError: (val) => set({ error: val }),
  setTokenList: (val) => set({ tokenList: val }),
  setActiveTab: (val) => set({ activeTab: val }),
  setGuildSearch: (val) => set({ guildSearch: val }),
  setCopiedText: (val) => set({ copiedText: val }),
  setLimparDmTarget: (val) => set({ limparDmTarget: val }),
  setLimparDmDelay: (val) => set({ limparDmDelay: val }),
  setLimparDmTask: (val) => set({ limparDmTask: val }),

  // Setters operacionais
  setManualGuildId: (val) => set({ manualGuildId: val }),
  setManualChannelId: (val) => set({ manualChannelId: val }),
  setFollowInputId: (val) => set({ followInputId: val }),
  setFollowDelayMs: (val) => set({ followDelayMs: val }),
  setAntiDcDelayMs: (val) => set({ antiDcDelayMs: val }),
  setColeiraInputId: (val) => set({ coleiraInputId: val }),
  setAntiCallInputId: (val) => set({ antiCallInputId: val }),
  setMuteLockInputId: (val) => set({ muteLockInputId: val }),
  setGuardInputId: (val) => set({ guardInputId: val }),
  setChaosTargetId: (val) => set({ chaosTargetId: val }),
  setChaosIntervalMs: (val) => set({ chaosIntervalMs: val }),

  setPresStatus: (val) => set({ presStatus: val }),
  setPresType: (val) => set({ presType: val }),
  setPresName: (val) => set({ presName: val }),
  setPresDetails: (val) => set({ presDetails: val }),
  setPresState: (val) => set({ presState: val }),
  setPresUrl: (val) => set({ presUrl: val }),
  setPresCustom: (val) => set({ presCustom: val }),
  setChatChannelId: (val) => set({ chatChannelId: val }),
  setPurgeChannelId: (val) => set({ purgeChannelId: val }),
  setPurgeLimit: (val) => set({ purgeLimit: val }),
  setGhostChannelId: (val) => set({ ghostChannelId: val }),
  setGhostTargetId: (val) => set({ ghostTargetId: val }),
  setAutoReplyMsg: (val) => set({ autoReplyMsg: val }),
  setAutoReplyCooldown: (val) => set({ autoReplyCooldown: val }),

  setBatchChName: (val) => set({ batchChName: val }),
  setBatchChType: (val) => set({ batchChType: val }),
  setBatchChCount: (val) => set({ batchChCount: val }),
  setBatchRoleName: (val) => set({ batchRoleName: val }),
  setBatchRoleColor: (val) => set({ batchRoleColor: val }),
  setBatchRoleCount: (val) => set({ batchRoleCount: val }),
  setNukeChannelId: (val) => set({ nukeChannelId: val }),

  // Modals Actions
  openVoiceMemberModal: (member, guildId) =>
    set({
      voiceMemberModal: { isOpen: true, member, guildId },
    }),
  closeVoiceMemberModal: () =>
    set({
      voiceMemberModal: { isOpen: false, member: null, guildId: null },
    }),

  openConfirmModal: ({ title, message, onConfirm }) =>
    set({
      confirmActionModal: { isOpen: true, title, message, onConfirm },
    }),
  closeConfirmModal: () =>
    set({
      confirmActionModal: { isOpen: false, title: '', message: '', onConfirm: null },
    }),

  // Atualização granular de estado
  setBotState: (newState) => {
    set({ botState: newState });
    if (newState?.features?.followCall?.targetUserId && !get().followInputId) {
      set({ followInputId: newState.features.followCall.targetUserId });
    }
  },

  patchBotState: (partial) => {
    set((prev) => ({
      botState: prev.botState ? { ...prev.botState, ...partial } : partial,
    }));
  },

  addLog: (logEntry) => {
    set((prev) => {
      if (!prev.botState) return prev;
      const exists = prev.botState.logs?.some((l) => l.id === logEntry.id);
      if (exists) return prev;
      return {
        botState: {
          ...prev.botState,
          logs: [logEntry, ...(prev.botState.logs || [])].slice(0, 120),
        },
      };
    });
  },

  copyToClipboard: (text) => {
    try {
      navigator.clipboard.writeText(text);
      set({ copiedText: text });
      setTimeout(() => set({ copiedText: '' }), 2000);
    } catch {}
  },

  // Rehidratação e SSE
  rehydrateState: async () => {
    try {
      const data = await apiGet('/api/state');
      if (data && data.status) {
        get().setBotState(data);
      }
    } catch {}
  },

  checkPinStatus: async () => {
    try {
      const d = await apiGet('/api/panel/config');
      if (!d.pinRequired) {
        set({ pinRequired: false });
      } else {
        const stored = getStoredPin();
        if (stored) {
          try {
            await apiPost('/api/panel/verify', { pin: stored });
            set({ pinRequired: false });
          } catch {
            sessionStorage.removeItem('panel_pin');
            set({ pinRequired: true });
          }
        } else {
          set({ pinRequired: true });
        }
      }
    } catch {
      set({ pinRequired: false });
    }
  },

  // Ações de Voz & Servidores
  selectGuild: async (guildId, forceRefresh = false) => {
    try {
      const res = await apiPost('/api/guild/select', { guildId, forceRefresh });
      if (res.state) get().setBotState(res.state);
    } catch (err) {
      get().setError(err.message);
    }
  },

  joinVoice: async (guildId, channelId, lockCall = false) => {
    try {
      const res = await apiPost('/api/voice/join', {
        guildId,
        channelId,
        selfMute: get().botState?.voiceConfig?.selfMute,
        selfDeaf: get().botState?.voiceConfig?.selfDeaf,
        selfVideo: get().botState?.voiceConfig?.selfVideo,
        fakeStream: get().botState?.voiceConfig?.fakeStream,
        lockCall,
      });
      if (res.state) get().setBotState(res.state);
    } catch (err) {
      get().setError(err.message);
    }
  },

  leaveVoice: async () => {
    try {
      const res = await apiPost('/api/voice/leave');
      if (res.state) get().setBotState(res.state);
    } catch (err) {
      get().setError(err.message);
    }
  },

  updateVoiceConfig: async (partial) => {
    try {
      const res = await apiPost('/api/voice/config', partial);
      if (res.state) get().setBotState(res.state);
    } catch (err) {
      get().setError(err.message);
    }
  },

  memberDirectAction: async (userId, action, channelId = undefined) => {
    try {
      const res = await apiPost('/api/voice/member-action', {
        guildId: get().botState?.selectedGuildId,
        userId,
        action,
        channelId,
      });
      if (res.state) get().setBotState(res.state);
      return res;
    } catch (err) {
      get().setError(err.message);
      throw err;
    }
  },

  // Ações de Features
  updateAntiDisconnect: async (payload) => {
    try {
      const res = await apiPost('/api/features/anti-disconnect', payload);
      if (res.state) get().setBotState(res.state);
    } catch (err) {
      get().setError(err.message);
    }
  },

  updateAntiMute: async (payload) => {
    try {
      const res = await apiPost('/api/features/anti-mute', payload);
      if (res.state) get().setBotState(res.state);
    } catch (err) {
      get().setError(err.message);
    }
  },

  updateFollowCall: async (payload) => {
    try {
      const res = await apiPost('/api/features/follow', payload);
      if (res.state) get().setBotState(res.state);
    } catch (err) {
      get().setError(err.message);
    }
  },

  updateColeira: async (payload) => {
    try {
      const res = await apiPost('/api/features/coleira', payload);
      if (res.state) get().setBotState(res.state);
    } catch (err) {
      get().setError(err.message);
    }
  },

  updateAntiCall: async (payload) => {
    try {
      const res = await apiPost('/api/features/anti-call', payload);
      if (res.state) get().setBotState(res.state);
    } catch (err) {
      get().setError(err.message);
    }
  },

  updateMuteLock: async (payload) => {
    try {
      const res = await apiPost('/api/features/mute-lock', payload);
      if (res.state) get().setBotState(res.state);
    } catch (err) {
      get().setError(err.message);
    }
  },

  updateGuard: async (payload) => {
    try {
      const res = await apiPost('/api/features/guard', payload);
      if (res.state) get().setBotState(res.state);
    } catch (err) {
      get().setError(err.message);
    }
  },

  updateChaoticMover: async (payload) => {
    try {
      const res = await apiPost('/api/features/chaotic-mover', payload);
      if (res.state) get().setBotState(res.state);
    } catch (err) {
      get().setError(err.message);
    }
  },

  updatePresence: async (payload) => {
    try {
      const res = await apiPost('/api/presence', payload);
      if (res.state) get().setBotState(res.state);
    } catch (err) {
      get().setError(err.message);
    }
  },

  updateAutomation: async (payload) => {
    try {
      const res = await apiPost('/api/features/automation', payload);
      if (res.state) get().setBotState(res.state);
    } catch (err) {
      get().setError(err.message);
    }
  },

  clearLogs: async () => {
    try {
      await apiPost('/api/logs/clear');
      get().patchBotState({ logs: [] });
    } catch (err) {
      get().setError(err.message);
    }
  },
}));

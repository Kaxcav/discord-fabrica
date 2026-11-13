import { Hash, Users, Zap, Bomb } from 'lucide-react';
import { useBotStore, apiPost } from '../store/useBotStore';

export default function FactoryTab() {
  const {
    botState,
    batchChName,
    setBatchChName,
    batchChType,
    setBatchChType,
    batchChCount,
    setBatchChCount,
    batchRoleName,
    setBatchRoleName,
    batchRoleColor,
    setBatchRoleColor,
    batchRoleCount,
    setBatchRoleCount,
    nukeChannelId,
    setNukeChannelId,
    openConfirmModal,
  } = useBotStore();

  const selectedGuild = botState?.selectedGuild;
  const textChannels = (selectedGuild?.channels || []).filter(
    (c) => c.type === 0 || c.type === 5
  );

  const handleNuke = () => {
    if (!nukeChannelId) return;
    const ch = textChannels.find((c) => c.id === nukeChannelId);
    openConfirmModal({
      title: 'Nuke de Canal',
      message: `Tem certeza que deseja recriar #${ch?.name || nukeChannelId}? O canal original será DELETADO permanentemente e recriado com as mesmas permissões.`,
      onConfirm: async () => {
        await apiPost('/api/channel/nuke', { channelId: nukeChannelId });
        setNukeChannelId('');
      },
    });
  };

  return (
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
            className="px-3 py-2 bg-[#0b0d12] border border-[#1e2638] rounded-lg text-xs text-white focus:outline-none focus:border-cyan-500"
          />
          <select
            value={batchChType}
            onChange={(e) => setBatchChType(Number(e.target.value))}
            className="px-3 py-2 bg-[#0b0d12] border border-[#1e2638] rounded-lg text-xs text-white focus:outline-none focus:border-cyan-500"
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
            className="px-3 py-2 bg-[#0b0d12] border border-[#1e2638] rounded-lg text-xs font-mono text-white focus:outline-none focus:border-cyan-500 text-right"
          />
        </div>
        <button
          onClick={() =>
            apiPost('/api/batch/channels', {
              guildId: botState?.selectedGuildId,
              name: batchChName,
              type: batchChType,
              count: batchChCount,
            })
          }
          className="w-full py-2 bg-cyan-500 hover:bg-cyan-400 text-[#05070a] font-semibold rounded-lg text-xs transition-colors cursor-pointer"
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
            className="px-3 py-2 bg-[#0b0d12] border border-[#1e2638] rounded-lg text-xs text-white focus:outline-none focus:border-purple-500"
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
            className="px-3 py-2 bg-[#0b0d12] border border-[#1e2638] rounded-lg text-xs font-mono text-white focus:outline-none focus:border-purple-500 text-right"
          />
        </div>
        <button
          onClick={() =>
            apiPost('/api/batch/roles', {
              guildId: botState?.selectedGuildId,
              name: batchRoleName,
              color: batchRoleColor,
              count: batchRoleCount,
            })
          }
          className="w-full py-2 bg-purple-500 hover:bg-purple-400 text-white font-semibold rounded-lg text-xs transition-colors cursor-pointer"
        >
          Criar {batchRoleCount} Cargo(s)
        </button>
      </section>

      {/* CONVITES EM LOTE & NUKE / CLONAR CANAL */}
      <section className="bg-[#131722] border border-[#1e2638] rounded-xl p-4 space-y-3 xl:col-span-2">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <h4 className="text-xs font-bold text-white flex items-center gap-2">
              <Zap className="w-3.5 h-3.5 text-emerald-400" />
              <span>Gerar Convites em Todos os Canais do Servidor</span>
            </h4>
            <p className="text-[11px] text-[#94a3b8]">
              Gera links de convite únicos nos canais do servidor atual e exibe os links diretamente no console de logs abaixo.
            </p>
            <button
              onClick={() =>
                apiPost('/api/batch/invites', {
                  guildId: botState?.selectedGuildId,
                })
              }
              className="px-4 py-2 bg-emerald-500 hover:bg-emerald-400 text-[#05070a] font-semibold rounded-lg text-xs transition-colors cursor-pointer"
            >
              Gerar Convites em Lote
            </button>
          </div>

          <div className="space-y-2">
            <h4 className="text-xs font-bold text-white flex items-center gap-2">
              <Bomb className="w-3.5 h-3.5 text-red-400" />
              <span>Nuke / Recriar Canal (Limpar Histórico Inteiro)</span>
            </h4>
            <div className="flex gap-2">
              <select
                value={nukeChannelId}
                onChange={(e) => setNukeChannelId(e.target.value)}
                className="flex-1 px-3 py-2 bg-[#0b0d12] border border-[#1e2638] rounded-lg text-xs text-white focus:outline-none focus:border-red-500"
              >
                <option value="">Selecione um canal do servidor...</option>
                {textChannels.map((c) => (
                  <option key={c.id} value={c.id}>
                    #{c.name} ({c.id})
                  </option>
                ))}
              </select>
              <button
                onClick={handleNuke}
                disabled={!nukeChannelId}
                className="px-4 py-2 bg-red-500 hover:bg-red-400 disabled:opacity-40 text-white font-semibold rounded-lg text-xs transition-colors cursor-pointer"
              >
                Clonar & Deletar
              </button>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}


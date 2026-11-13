import { Trash2, XCircle } from 'lucide-react';
import { useBotStore, apiPost } from '../store/useBotStore';

export default function LimparDmTab() {
  const {
    limparDmTarget,
    setLimparDmTarget,
    limparDmDelay,
    setLimparDmDelay,
    limparDmTask,
    setLimparDmTask,
  } = useBotStore();

  const isRunning =
    limparDmTask?.phase === 'fetching' || limparDmTask?.phase === 'deleting';

  const handleStart = async () => {
    if (!limparDmTarget.trim()) return;
    try {
      setLimparDmTask({
        phase: 'fetching',
        progress: 0,
        total: 0,
        username: '...',
        avatarUrl: null,
        message: 'Iniciando busca...',
      });
      const res = await apiPost('/api/limpar-dm', {
        targetId: limparDmTarget.trim(),
        delayMs: limparDmDelay,
      });
      if (res.taskId) {
        setLimparDmTask((prev) => ({
          ...prev,
          taskId: res.taskId,
          username: res.username || prev?.username,
          avatarUrl: res.avatarUrl || prev?.avatarUrl,
        }));
      }
    } catch (err) {
      setLimparDmTask({ phase: 'error', message: err.message || String(err) });
    }
  };

  const handleCancel = async () => {
    if (!limparDmTask?.taskId) return;
    try {
      await apiPost(`/api/tasks/${limparDmTask.taskId}/cancel`);
      setLimparDmTask((prev) => ({
        ...prev,
        phase: 'cancelled',
        message: 'Operação cancelada pelo usuário.',
      }));
    } catch {}
  };

  return (
    <div className="space-y-5">
      <section className="bg-[#131722] border border-[#1e2638] rounded-xl p-4">
        <div className="flex items-center gap-2 mb-4">
          <Trash2 className="w-4 h-4 text-red-400" />
          <h2 className="text-sm font-bold text-white">Limpar DM — Apagar suas mensagens</h2>
        </div>

        <p className="text-xs text-[#94a3b8] mb-4">
          Apaga todas as suas mensagens em uma DM privada. Cole o ID do usuário ou do canal de DM. O bot buscará o histórico e deletará mensagem por mensagem de forma segura com o delay configurado.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 mb-3">
          <input
            type="text"
            value={limparDmTarget}
            onChange={(e) => setLimparDmTarget(e.target.value)}
            placeholder="User ID ou Channel ID da DM"
            className="sm:col-span-2 px-3 py-2 bg-[#0b0d12] border border-[#1e2638] rounded-lg text-xs font-mono text-white placeholder-[#475569] focus:outline-none focus:border-red-500"
            disabled={isRunning}
          />
          <div className="flex items-center gap-1.5 bg-[#0b0d12] border border-[#1e2638] rounded-lg px-2.5 py-1.5">
            <span className="text-[11px] text-[#64748b] shrink-0">Delay(ms):</span>
            <input
              type="number"
              min="300"
              max="5000"
              value={limparDmDelay}
              onChange={(e) => setLimparDmDelay(Number(e.target.value))}
              disabled={isRunning}
              className="w-full bg-transparent text-xs font-mono text-white focus:outline-none text-right"
            />
          </div>
        </div>

        <div className="flex gap-2">
          <button
            onClick={handleStart}
            disabled={!limparDmTarget.trim() || isRunning}
            className="flex-1 px-4 py-2 bg-red-500 hover:bg-red-400 disabled:bg-red-900/40 disabled:text-red-700 text-white font-semibold rounded-lg text-xs transition-colors cursor-pointer"
          >
            {limparDmTask?.phase === 'fetching'
              ? 'Buscando mensagens...'
              : limparDmTask?.phase === 'deleting'
              ? 'Deletando...'
              : 'Iniciar Limpeza'}
          </button>

          {isRunning && (
            <button
              onClick={handleCancel}
              className="px-4 py-2 bg-amber-600 hover:bg-amber-500 text-white font-semibold rounded-lg text-xs flex items-center gap-1.5 cursor-pointer"
            >
              <XCircle className="w-3.5 h-3.5" />
              <span>Parar Limpeza</span>
            </button>
          )}

          {(limparDmTask?.phase === 'completed' ||
            limparDmTask?.phase === 'cancelled' ||
            limparDmTask?.phase === 'error') && (
            <button
              onClick={() => {
                setLimparDmTask(null);
                setLimparDmTarget('');
              }}
              className="px-4 py-2 bg-[#181e2c] hover:bg-[#252f45] text-[#94a3b8] font-semibold rounded-lg text-xs cursor-pointer"
            >
              Limpar Painel
            </button>
          )}
        </div>
      </section>

      {limparDmTask && (
        <section className="bg-[#131722] border border-[#1e2638] rounded-xl p-4">
          {/* Cabeçalho com avatar e nome */}
          <div className="flex items-center gap-3 mb-4">
            {limparDmTask.avatarUrl ? (
              <img
                src={limparDmTask.avatarUrl}
                alt=""
                className="w-10 h-10 rounded-full border border-[#1e2638] shrink-0"
              />
            ) : (
              <div className="w-10 h-10 rounded-full bg-red-500/20 border border-red-500/30 flex items-center justify-center text-red-300 font-bold text-sm shrink-0">
                {(limparDmTask.username || '?')[0].toUpperCase()}
              </div>
            )}
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold text-white truncate">
                {limparDmTask.username || '—'}
              </div>
              <div
                className={`text-xs font-medium ${
                  limparDmTask.phase === 'completed'
                    ? 'text-emerald-400'
                    : limparDmTask.phase === 'error'
                    ? 'text-red-400'
                    : limparDmTask.phase === 'cancelled'
                    ? 'text-amber-400'
                    : limparDmTask.phase === 'deleting'
                    ? 'text-amber-400'
                    : 'text-blue-400'
                }`}
              >
                {limparDmTask.phase === 'fetching'
                  ? 'Buscando mensagens...'
                  : limparDmTask.phase === 'deleting'
                  ? 'Deletando mensagens...'
                  : limparDmTask.phase === 'completed'
                  ? 'Concluído'
                  : limparDmTask.phase === 'cancelled'
                  ? 'Cancelado pelo Usuário'
                  : limparDmTask.phase === 'error'
                  ? 'Erro'
                  : limparDmTask.phase}
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
                style={{
                  width: `${Math.round((limparDmTask.progress / limparDmTask.total) * 100)}%`,
                }}
              />
            </div>
          )}
          {limparDmTask.phase === 'fetching' && (
            <div className="h-1 bg-gradient-to-r from-transparent via-blue-500 to-transparent mb-4 animate-pulse rounded-full" />
          )}

          {/* Estatísticas */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <div className="bg-[#0b0d12] p-3 rounded-lg border border-[#1e2638]">
              <div className="text-[10px] uppercase text-[#64748b] mb-1">
                {limparDmTask.phase === 'fetching' ? 'Encontradas' : 'Deletadas'}
              </div>
              <div className="text-xl font-bold tabular-nums text-white">
                {(limparDmTask.progress || 0).toLocaleString()}
              </div>
            </div>
            <div className="bg-[#0b0d12] p-3 rounded-lg border border-[#1e2638]">
              <div className="text-[10px] uppercase text-[#64748b] mb-1">
                {limparDmTask.phase === 'fetching' ? 'Analisadas' : 'Total'}
              </div>
              <div className="text-xl font-bold tabular-nums text-white">
                {(limparDmTask.total || 0).toLocaleString()}
              </div>
            </div>
            <div className="col-span-2 sm:col-span-1 bg-[#0b0d12] p-3 rounded-lg border border-[#1e2638]">
              <div className="text-[10px] uppercase text-[#64748b] mb-1">Status</div>
              <div className="text-xs text-[#94a3b8] truncate">
                {limparDmTask.message || '—'}
              </div>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}

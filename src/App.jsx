import { useState } from 'react';

export default function App() {
  const [step, setStep] = useState('login'); // 'login' | 'dashboard'
  const [token, setToken] = useState('');
  const [guildId, setGuildId] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleLogin(e) {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const res = await fetch('https://discord.com/api/v10/users/@me', {
        headers: { Authorization: token.trim() },
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message || `Discord API ${res.status}`);
      }

      const user = await res.json();
      // Validação simples de guilda via presença no objeto do usuário (opcional)
      // Para este fluxo, consideramos sucesso e avançamos para o dashboard.
      setStep('dashboard');
    } catch (err) {
      setError(err.message || 'Falha na conexão');
    } finally {
      setLoading(false);
    }
  }

  if (step === 'dashboard') {
    return (
      <div className="min-h-screen bg-[#36393f] text-[#dcddde] flex flex-col">
        <header className="h-14 bg-[#2f3136] border-b border-[#202225] flex items-center px-6 shrink-0">
          <span className="text-sm font-medium truncate">
            Servidor conectado: <span className="font-mono text-cyan-400">{guildId}</span>
          </span>
        </header>

        <main className="flex-1 overflow-auto p-6">
          <div className="max-w-2xl mx-auto space-y-6">
            <section className="bg-[#2f3136] rounded-lg p-5 border border-[#202225]">
              <h2 className="text-lg font-semibold text-white mb-2">Administração em lote</h2>
              <p className="text-sm text-[#b9bbbe] mb-4">
                Crie convites, cargos e canais em lote para este servidor.
              </p>

              <div className="flex flex-wrap gap-3">
                <button
                  className="px-4 py-2 bg-cyan-500 hover:bg-cyan-600 text-white rounded-md text-sm font-medium transition-colors"
                  onClick={() => alert('Ação: criar convites em lote (implementar endpoint /routes.js)')}
                >
                  Criar convites
                </button>
                <button
                  className="px-4 py-2 bg-cyan-500 hover:bg-cyan-600 text-white rounded-md text-sm font-medium transition-colors"
                  onClick={() => alert('Ação: criar cargos em lote (implementar endpoint /routes.js)')}
                >
                  Criar cargos
                </button>
                <button
                  className="px-4 py-2 bg-cyan-500 hover:bg-cyan-600 text-white rounded-md text-sm font-medium transition-colors"
                  onClick={() => alert('Ação: criar canais em lote (implementar endpoint /routes.js)')}
                >
                  Criar canais
                </button>
              </div>
            </section>

            <section className="bg-[#2f3136] rounded-lg p-5 border border-[#202225]">
              <h3 className="font-semibold text-white mb-3">Logs rápidos</h3>
              <pre className="text-xs text-[#72767d] bg-[#202225] rounded p-3 h-32 overflow-auto">
{`[${new Date().toLocaleTimeString()}] Conectado ao servidor ${guildId}
[${new Date().toLocaleTimeString()}] Worker grabber aguardando comandos...`}
              </pre>
            </section>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#36393f] text-[#dcddde] flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="bg-[#2f3136] rounded-lg border border-[#202225] shadow-lg overflow-hidden">
          <div className="p-6 border-b border-[#202225]">
            <h1 className="text-2xl font-bold text-white">discord-fabrica</h1>
            <p className="text-sm text-[#b9bbbe] mt-1">Crie convites, cargos e canais em lote para o seu servidor.</p>
          </div>

          <form onSubmit={handleLogin} className="p-6 space-y-4">
            <div>
              <label className="block text-sm font-medium text-[#b9bbbe] mb-2">
                Token
              </label>
              <input
                type="password"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="MTIzNDU2Nzg5..."
                className="w-full px-3 py-2 bg-[#202225] border border-[#202225] rounded-md text-[#dcddde] placeholder-[#72767d] focus:outline-none focus:ring-2 focus:ring-cyan-500 focus:border-transparent font-mono text-sm"
                required
                disabled={loading}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-[#b9bbbe] mb-2">
                Server ID
              </label>
              <input
                type="text"
                value={guildId}
                onChange={(e) => setGuildId(e.target.value)}
                placeholder="123456789012345678"
                className="w-full px-3 py-2 bg-[#202225] border border-[#202225] rounded-md text-[#dcddde] placeholder-[#72767d] focus:outline-none focus:ring-2 focus:ring-cyan-500 focus:border-transparent font-mono text-sm"
                required
                disabled={loading}
              />
            </div>

            {error && (
              <div className="text-red-400 text-sm bg-red-900/30 border border-red-800 rounded-md px-3 py-2">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 bg-cyan-500 hover:bg-cyan-600 disabled:bg-cyan-700 text-white rounded-md font-medium transition-colors text-sm"
            >
              {loading ? 'Conectando...' : 'Conectar'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

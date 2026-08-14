import { useState, useMemo, useEffect } from 'react';
import { create } from 'zustand';
import { Search, Moon, Sun, Copy, Download, FileJson, FileSpreadsheet, Check } from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs) {
  return twMerge(clsx(inputs));
}

const mockEvents = [
  { u: 'joao.silva@exemplo.com', p: 'senha123', ts: 1723581234, ip: '203.0.113.42', cc: 'BR', city: 'São Paulo', ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', token: 'MTIzNDU2Nzg5MDEyMzQ1Njc4OTAxMjM0NTY3ODkwMTI' },
  { u: 'maria.souza@exemplo.com', p: 'segura456', ts: 1723582345, ip: '198.51.100.15', cc: 'BR', city: 'Rio de Janeiro', ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', token: 'AABBCCDDEEFF00112233445566778899AABBCCDDEE' },
  { u: 'j.doe@example.com', p: 'password', ts: 1723583456, ip: '104.28.19.12', cc: 'US', city: 'New York', ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_5 like Mac OS X)', token: 'ZZYYXXWWVVUUTTSSRRQQPPOONNMMLLKKJJIIHHGG' },
  { u: 'carlos.m@exemplo.com', p: 'carlos2024', ts: 1723584567, ip: '177.32.14.99', cc: 'BR', city: 'Curitiba', ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', token: '5566778899001122334455667788990011223344' },
  { u: 'a.smith@example.uk', p: 'smith_uk', ts: 1723585678, ip: '82.12.34.56', cc: 'GB', city: 'London', ua: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36', token: 'QWERTYUIOPASDFGHJKLZXCVBNMQWERTYUIOPASDF' },
  { u: 'li.wei@example.cn', p: '88888888', ts: 1723586789, ip: '114.24.56.78', cc: 'CN', city: 'Beijing', ua: 'Mozilla/5.0 (Windows NT 10.0; WOW64)', token: 'ZXCVBNMASDFGHJKLQWERTYUIOPZXCVBNMASDFGH' },
  { u: 'fernanda.l@exemplo.com', p: 'fer_2024', ts: 1723587890, ip: '200.14.23.45', cc: 'BR', city: 'Belo Horizonte', ua: 'Mozilla/5.0 (Android 13; Mobile; rv:109.0)', token: 'POIUYTREWQLKJHGFDSAMNBVCXZPOIUYTREWQLK' },
  { u: 'd.muller@example.de', p: 'berlin_x', ts: 1723588901, ip: '46.11.22.33', cc: 'DE', city: 'Berlin', ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15)', token: 'MNBVCXZASDFGHJKLPOIUYTREWQMNBVCXZASDFG' },
  { u: 'lucas.p@exemplo.com', p: 'lucas_pass', ts: 1723590012, ip: '189.44.55.66', cc: 'BR', city: 'Salvador', ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', token: '0987654321098765432109876543210987654321' },
  { u: 'e.williams@example.au', p: 'sydney24', ts: 1723591123, ip: '120.21.32.43', cc: 'AU', city: 'Sydney', ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)', token: '1234512345123451234512345123451234512345' }
];

const useStore = create((set) => ({
  events: mockEvents,
  search: '',
  countryFilter: '',
  dateFrom: '',
  dateTo: '',
  theme: 'light',
  setSearch: (search) => set({ search }),
  setCountryFilter: (countryFilter) => set({ countryFilter }),
  setDateFrom: (dateFrom) => set({ dateFrom }),
  setDateTo: (dateTo) => set({ dateTo }),
  toggleTheme: () => set((state) => {
    const newTheme = state.theme === 'light' ? 'dark' : 'light';
    if (newTheme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
    return { theme: newTheme };
  }),
}));

const formatTimestamp = (ts) => {
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'medium'
  }).format(new Date(ts * 1000));
};

const summarizeUA = (ua) => {
  if (ua.includes('Windows')) return 'Windows';
  if (ua.includes('Macintosh') || ua.includes('Mac OS')) return 'macOS';
  if (ua.includes('iPhone') || ua.includes('iPad')) return 'iOS';
  if (ua.includes('Android')) return 'Android';
  if (ua.includes('Linux')) return 'Linux';
  return 'Outro';
};

function CopyButton({ text, label }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy', err);
    }
  };

  return (
    <button
      onClick={handleCopy}
      className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors duration-200"
      title={label}
    >
      {copied ? <Check size={16} className="text-green-500" /> : <Copy size={16} />}
    </button>
  );
}

export default function App() {
  const { events, search, countryFilter, dateFrom, dateTo, theme, setSearch, setCountryFilter, setDateFrom, setDateTo, toggleTheme } = useStore();

  useEffect(() => {
    // Check initial system preference
    if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
      if (theme !== 'dark') {
         useStore.getState().toggleTheme();
      }
    }
  }, []);

  const filteredEvents = useMemo(() => {
    return events.filter(ev => {
      const matchesSearch = 
        ev.u.toLowerCase().includes(search.toLowerCase()) || 
        ev.ip.includes(search) ||
        ev.city.toLowerCase().includes(search.toLowerCase());
      
      const matchesCountry = countryFilter ? ev.cc === countryFilter : true;
      
      let matchesDate = true;
      const eventDate = new Date(ev.ts * 1000).setHours(0, 0, 0, 0);

      if (dateFrom) {
        const fromDate = new Date(`${dateFrom}T00:00:00`).getTime();
        if (eventDate < fromDate) matchesDate = false;
      }

      if (dateTo) {
        const toDate = new Date(`${dateTo}T00:00:00`).getTime();
        if (eventDate > toDate) matchesDate = false;
      }

      return matchesSearch && matchesCountry && matchesDate;
    });
  }, [events, search, countryFilter, dateFrom, dateTo]);

  const uniqueCountries = useMemo(() => {
    return [...new Set(events.map(ev => ev.cc))].sort();
  }, [events]);

  const exportCSV = () => {
    if (filteredEvents.length === 0) return;
    const headers = ['Usuário', 'Senha', 'Timestamp', 'IP', 'País', 'Cidade', 'User Agent', 'Token'];
    const rows = filteredEvents.map(ev => [
      ev.u, ev.p, ev.ts, ev.ip, ev.cc, ev.city, ev.ua, ev.token
    ]);
    
    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `export_${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const exportJSON = () => {
    if (filteredEvents.length === 0) return;
    const jsonContent = JSON.stringify(filteredEvents, null, 2);
    const blob = new Blob([jsonContent], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `export_${Date.now()}.json`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="min-h-screen bg-background text-foreground p-6 font-sans transition-colors duration-200">
      <div className="max-w-7xl mx-auto space-y-6">
        
        {/* Header */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <h1 className="text-2xl font-bold tracking-tight">Painel de Integração</h1>
          <button 
            onClick={toggleTheme}
            className="p-2 rounded-full hover:bg-muted transition-colors border border-border bg-card shadow-sm"
            aria-label="Alternar tema"
          >
            {theme === 'dark' ? <Sun size={20} /> : <Moon size={20} />}
          </button>
        </div>

        {/* Toolbar */}
        <div className="flex flex-col gap-4 bg-card p-4 rounded-lg border border-border shadow-sm">
          <div className="flex flex-col md:flex-row gap-4 justify-between">
            <div className="flex flex-col sm:flex-row gap-4 flex-1">
              <div className="relative flex-1 max-w-md">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={18} />
                <input 
                  type="text" 
                  placeholder="Buscar por usuário, IP ou cidade..."
                  className="w-full pl-10 pr-4 py-2 bg-background border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-primary/50 transition-shadow"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              <select 
                className="px-4 py-2 bg-background border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-primary/50"
                value={countryFilter}
                onChange={(e) => setCountryFilter(e.target.value)}
              >
                <option value="">Todos os Países</option>
                {uniqueCountries.map(cc => (
                  <option key={cc} value={cc}>{cc}</option>
                ))}
              </select>
            </div>
            
            <div className="flex gap-2 self-start md:self-auto">
              <button 
                onClick={exportCSV}
                className="flex items-center gap-2 px-4 py-2 bg-background hover:bg-muted border border-border rounded-md transition-colors"
              >
                <FileSpreadsheet size={16} />
                <span className="hidden sm:inline">CSV</span>
              </button>
              <button 
                onClick={exportJSON}
                className="flex items-center gap-2 px-4 py-2 bg-background hover:bg-muted border border-border rounded-md transition-colors"
              >
                <FileJson size={16} />
                <span className="hidden sm:inline">JSON</span>
              </button>
            </div>
          </div>
          
          <div className="flex flex-col sm:flex-row gap-4 items-center">
            <span className="text-sm text-muted-foreground">Período:</span>
            <input 
              type="date"
              className="px-3 py-1.5 bg-background border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-primary/50 text-sm"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
            />
            <span className="text-sm text-muted-foreground">até</span>
            <input 
              type="date"
              className="px-3 py-1.5 bg-background border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-primary/50 text-sm"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
            />
          </div>
        </div>

        {/* Table / Cards */}
        <div className="bg-card rounded-lg border border-border shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="bg-muted text-muted-foreground uppercase font-semibold text-xs">
                <tr>
                  <th className="px-6 py-4">Usuário</th>
                  <th className="px-6 py-4">IP</th>
                  <th className="px-6 py-4">Localização</th>
                  <th className="px-6 py-4">Data/Hora</th>
                  <th className="px-6 py-4">Dispositivo</th>
                  <th className="px-6 py-4">Token (Resumo)</th>
                  <th className="px-6 py-4 text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filteredEvents.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-6 py-12 text-center text-muted-foreground">
                      Nenhum registro encontrado.
                    </td>
                  </tr>
                ) : (
                  filteredEvents.map((ev, i) => (
                    <tr key={i} className="hover:bg-muted/50 transition-colors">
                      <td className="px-6 py-4 font-medium">{ev.u}</td>
                      <td className="px-6 py-4 font-mono text-xs text-muted-foreground">{ev.ip}</td>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-xs bg-muted px-1.5 py-0.5 rounded">{ev.cc}</span>
                          <span>{ev.city}</span>
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">{formatTimestamp(ev.ts)}</td>
                      <td className="px-6 py-4 text-muted-foreground">{summarizeUA(ev.ua)}</td>
                      <td className="px-6 py-4 font-mono text-xs">
                        {ev.token.slice(0, 8)}...{ev.token.slice(-4)}
                      </td>
                      <td className="px-6 py-4 text-right">
                        <div className="flex justify-end gap-1">
                          <CopyButton text={`${ev.u}:${ev.p}`} label="Copiar Usuário:Senha" />
                          <CopyButton text={ev.token} label="Copiar Token" />
                          <CopyButton text={JSON.stringify(ev, null, 2)} label="Copiar JSON" />
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
        
        <div className="text-sm text-muted-foreground">
          Mostrando {filteredEvents.length} de {events.length} registros.
        </div>

      </div>
    </div>
  );
}

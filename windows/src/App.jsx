import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";

const BRIDGE_PORT = 6473;

function Badge({ ok }) {
  return (
    <span
      style={{
        display: "inline-block",
        width: 8,
        height: 8,
        borderRadius: "50%",
        background: ok ? "var(--green)" : "var(--red)",
        marginRight: 6,
        flexShrink: 0,
      }}
    />
  );
}

function Row({ label, value, mono }) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        padding: "6px 0",
        borderBottom: "1px solid var(--border)",
        gap: 12,
      }}
    >
      <span style={{ color: "var(--text-muted)", flexShrink: 0 }}>{label}</span>
      <span
        style={{
          fontFamily: mono ? "monospace" : "inherit",
          fontSize: mono ? 12 : 14,
          color: "var(--text)",
          wordBreak: "break-all",
          textAlign: "right",
        }}
      >
        {value ?? "—"}
      </span>
    </div>
  );
}

export default function App() {
  const [status, setStatus] = useState(null);
  const [port, setPort] = useState(BRIDGE_PORT);
  const [lastUpdate, setLastUpdate] = useState(null);

  const fetchStatus = useCallback(async () => {
    try {
      const p = await invoke("get_bridge_port").catch(() => BRIDGE_PORT);
      setPort(p);
      const res = await fetch(`http://127.0.0.1:${p}/status`, {
        signal: AbortSignal.timeout(2000),
      });
      if (res.ok) {
        setStatus(await res.json());
        setLastUpdate(new Date());
      }
    } catch {
      setStatus(null);
    }
  }, []);

  useEffect(() => {
    fetchStatus();
    const id = setInterval(fetchStatus, 2500);
    return () => clearInterval(id);
  }, [fetchStatus]);

  const user = status?.user;
  const vc = status?.currentVoiceChannel;

  return (
    <div
      style={{
        height: "100%",
        display: "flex",
        flexDirection: "column",
        background: "var(--bg)",
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: "16px 20px 12px",
          background: "var(--surface)",
          borderBottom: "1px solid var(--border)",
          display: "flex",
          alignItems: "center",
          gap: 10,
        }}
      >
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="12" r="12" fill="var(--accent)" />
          <path
            d="M17.3 7.1c-1.2-.6-2.5-.9-3.8-1.1l-.2.4c1.2.3 2.3.7 3.3 1.3-1.4-.8-3-1.3-4.6-1.3s-3.2.5-4.6 1.3c1-.6 2.1-1 3.3-1.3l-.2-.4C9.2 6.2 7.9 6.5 6.7 7.1 5.1 10 4.4 13.1 4.6 16.2c1.3 1 2.8 1.6 4.4 1.8.3-.4.6-.9.8-1.4-.9-.3-1.7-.8-2.4-1.4.2.1.4.2.6.4a9.5 9.5 0 0 0 8 0c.2-.1.4-.3.6-.4-.7.6-1.5 1.1-2.4 1.4.2.5.5 1 .8 1.4 1.6-.2 3.1-.8 4.4-1.8.2-3.1-.5-6.2-2.1-9.1zM9.8 14.4c-.8 0-1.4-.7-1.4-1.6s.6-1.6 1.4-1.6 1.4.7 1.4 1.6-.6 1.6-1.4 1.6zm4.4 0c-.8 0-1.4-.7-1.4-1.6s.6-1.6 1.4-1.6 1.4.7 1.4 1.6-.6 1.6-1.4 1.6z"
            fill="white"
          />
        </svg>
        <div>
          <div style={{ fontWeight: 600, fontSize: 15 }}>Discord Fabrica</div>
          <div style={{ color: "var(--text-muted)", fontSize: 12 }}>
            Bridge v2.0 — porta {port}
          </div>
        </div>
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center" }}>
          <Badge ok={!!status?.connected} />
          <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
            {status?.connected ? "Conectado" : status === null ? "Sem resposta" : "Desconectado"}
          </span>
        </div>
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflowY: "auto", padding: "16px 20px" }}>
        <div
          style={{
            background: "var(--surface)",
            borderRadius: "var(--radius)",
            padding: "12px 16px",
            marginBottom: 16,
          }}
        >
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              color: "var(--text-muted)",
              marginBottom: 8,
            }}
          >
            Status IPC
          </div>
          <Row label="Modo" value={status?.mode ?? "—"} mono />
          <Row
            label="Usuário local"
            value={
              user
                ? `${user.username ?? user.id}${user.discriminator && user.discriminator !== "0" ? `#${user.discriminator}` : ""}`
                : "—"
            }
          />
          <Row
            label="Canal de voz"
            value={vc ? (vc.name ?? vc.id) : status?.connected ? "Nenhum" : "—"}
          />
          <Row
            label="Última atualização"
            value={lastUpdate ? lastUpdate.toLocaleTimeString("pt-BR") : "—"}
          />
        </div>

        <div
          style={{
            background: "var(--surface)",
            borderRadius: "var(--radius)",
            padding: "12px 16px",
          }}
        >
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              color: "var(--text-muted)",
              marginBottom: 8,
            }}
          >
            Endpoints locais
          </div>
          <Row label="Status" value={`http://127.0.0.1:${port}/status`} mono />
          <Row label="Comando IPC" value={`http://127.0.0.1:${port}/ipc`} mono />
        </div>
      </div>

      {/* Footer */}
      <div
        style={{
          padding: "10px 20px",
          background: "var(--surface)",
          borderTop: "1px solid var(--border)",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
          Fechar minimiza para a bandeja do sistema
        </span>
        <button
          onClick={fetchStatus}
          style={{
            background: "var(--accent)",
            border: "none",
            borderRadius: 4,
            color: "#fff",
            padding: "4px 12px",
            fontSize: 12,
            cursor: "pointer",
            fontWeight: 600,
          }}
          onMouseEnter={(e) => (e.target.style.background = "var(--accent-hover)")}
          onMouseLeave={(e) => (e.target.style.background = "var(--accent)")}
        >
          Atualizar
        </button>
      </div>
    </div>
  );
}

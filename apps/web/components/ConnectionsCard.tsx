import { useEffect, useState } from "react";
import { Icon } from "./ui";
import { t, tf } from "../i18n";
import { useStore } from "../store";
import { getDbMode } from "../lib/db";
import { toast } from "sonner";

// ================================================================
// Connections card — server-side integrations:
//   * OneBot v11 (napcat / Lagrange / LLOneBot) chat-software bridge
//   * agent-tool bridge (claude code / codex / gemini CLI …)
// Both only exist in hub (server) mode.
// ================================================================

interface OnebotBinding {
  platform: string;
  channelUserId: string;
  agentId: string;
}

interface ToolInfo {
  id: string;
  label: string;
  available: boolean;
  hint?: string;
}

export default function ConnectionsCard() {
  const remote = getDbMode() === "remote";
  const agents = useStore((s) => s.agents);
  const [bindings, setBindings] = useState<OnebotBinding[]>([]);
  const [status, setStatus] = useState<{ running: boolean; mode?: string; connected?: boolean } | null>(null);
  const [tools, setTools] = useState<ToolInfo[]>([]);
  const [peer, setPeer] = useState("");
  const [agentId, setAgentId] = useState("");
  const [busy, setBusy] = useState(false);

  const load = async () => {
    try {
      const res = await fetch("/api/channels");
      const data = await res.json();
      setBindings(data.bindings ?? []);
      setStatus(data.onebot ?? null);
    } catch {
      /* not in hub mode */
    }
    try {
      const res = await fetch("/api/tools");
      const data = await res.json();
      setTools(data.tools ?? []);
    } catch {
      /* ignore */
    }
  };

  useEffect(() => {
    if (remote) load();
  }, [remote]);

  if (!remote) return null;

  const addBinding = async () => {
    if (!peer.trim() || !agentId) return;
    setBusy(true);
    try {
      const res = await fetch("/api/channels/onebot", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ platformUserId: peer.trim(), agentId }),
      });
      if (!res.ok) throw new Error(`http ${res.status}`);
      setPeer("");
      await load();
    } catch (e: any) {
      toast.error(String(e?.message ?? e));
    } finally {
      setBusy(false);
    }
  };

  const removeBinding = async (key: string) => {
    await fetch(`/api/channels/onebot/${encodeURIComponent(key)}`, { method: "DELETE" });
    await load();
  };

  const agentName = (id: string) => agents.find((a) => a.id === id)?.name ?? id;

  return (
    <div className="card">
      <h3>
        <Icon name="link" size={16} /> {t("secConnections")}
        <span className="hint">{t("connectionsHint")}</span>
      </h3>

      {/* ---- chat software (OneBot v11) ---- */}
      <div className="section-label" style={{ paddingTop: 6 }}>{t("onebotTitle")}</div>
      <div style={{ fontSize: 12.5, color: "var(--text-3)", marginBottom: 10, lineHeight: 1.6 }}>
        {t("onebotDesc")}
      </div>

      {status && (
        <div style={{ fontSize: 12.5, marginBottom: 10, display: "flex", alignItems: "center", gap: 6 }}>
          <span
            style={{
              width: 7, height: 7, borderRadius: "50%",
              background: status.connected ? "#16a34a" : status.running ? "#f59e0b" : "#94a3b8",
            }}
          />
          <span style={{ color: "var(--text-2)" }}>
            {status.connected ? t("onebotConnected") : status.running ? t("onebotWaiting") : t("onebotOff")}
            {status.mode ? ` · ${status.mode}` : ""}
          </span>
        </div>
      )}

      {bindings.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          {bindings.map((b) => (
            <div
              key={b.channelUserId}
              style={{
                display: "flex", alignItems: "center", justifyContent: "space-between",
                padding: "8px 10px", background: "var(--surface-2)", borderRadius: 9,
                marginBottom: 6, fontSize: 12.5,
              }}
            >
              <span style={{ color: "var(--text-1)" }}>
                <code style={{ fontSize: 11.5 }}>{b.channelUserId}</code>
                <span style={{ color: "var(--text-3)" }}> → {agentName(b.agentId)}</span>
              </span>
              <button className="btn ghost" style={{ padding: "3px 9px", fontSize: 11.5 }} onClick={() => removeBinding(b.channelUserId)}>
                {t("delete")}
              </button>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <input
          className="input"
          style={{ flex: "1 1 180px", minWidth: 160 }}
          placeholder={t("onebotPeerPh")}
          value={peer}
          onChange={(e) => setPeer(e.target.value)}
        />
        <select className="input" style={{ flex: "0 1 140px" }} value={agentId} onChange={(e) => setAgentId(e.target.value)}>
          <option value="">{t("onebotPickAgent")}</option>
          {agents.map((a) => (
            <option key={a.id} value={a.id}>
              {a.emoji} {a.name}
            </option>
          ))}
        </select>
        <button className="btn primary" disabled={busy || !peer.trim() || !agentId} onClick={addBinding}>
          {t("add")}
        </button>
      </div>

      {/* ---- agent tools ---- */}
      <div className="section-label" style={{ paddingTop: 18 }}>{t("toolsTitle")}</div>
      <div style={{ fontSize: 12.5, color: "var(--text-3)", marginBottom: 10, lineHeight: 1.6 }}>
        {t("toolsDesc")}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {tools.map((tool) => (
          <div
            key={tool.id}
            style={{
              display: "flex", alignItems: "center", gap: 8,
              padding: "8px 10px", background: "var(--surface-2)", borderRadius: 9, fontSize: 12.5,
            }}
          >
            <span
              style={{
                width: 7, height: 7, borderRadius: "50%",
                background: tool.available ? "#16a34a" : "#94a3b8",
              }}
            />
            <span style={{ color: "var(--text-1)" }}>{tool.label}</span>
            <span style={{ color: "var(--text-3)", fontSize: 11.5 }}>
              {tool.available ? t("toolReady") : t("toolMissing")}
            </span>
            {tool.hint && <span style={{ color: "var(--text-3)", fontSize: 11, marginLeft: "auto" }}>{tool.hint}</span>}
          </div>
        ))}
        {tools.length === 0 && (
          <div style={{ fontSize: 12.5, color: "var(--text-3)" }}>{tf("toolsCount", { n: 0 })}</div>
        )}
      </div>
    </div>
  );
}

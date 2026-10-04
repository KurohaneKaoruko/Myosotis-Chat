import { useStore } from "../store";
import { Avatar, Icon } from "./ui";
import { t } from "../i18n";

export default function AgentsView() {
  const agents = useStore((s) => s.agents);
  const createAgent = useStore((s) => s.createAgent);
  const newConversation = useStore((s) => s.newConversation);
  const setEditing = useStore((s) => s.setEditingAgentId);

  return (
    <div className="page">
      <div className="page-inner">
        <div className="page-title">
          {t("agentsTitle")}
          <span className="desc" style={{ fontWeight: 400 }}>
            {t("agentsDesc")}
          </span>
        </div>

        {agents.length === 0 ? (
          <div className="card" style={{ textAlign: "center", padding: "48px 24px" }}>
            <div style={{ fontSize: 52, marginBottom: 12 }}>✨</div>
            <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 6 }}>{t("createFirstAgent")}</div>
            <div style={{ fontSize: 13, color: "var(--text-3)", marginBottom: 22 }}>{t("createFirstAgentDesc")}</div>
            <button className="btn primary" style={{ padding: "12px 28px" }} onClick={() => createAgent()}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                <Icon name="plus" size={16} /> {t("startCreate")}
              </span>
            </button>
          </div>
        ) : (
          <div className="agent-grid">
            {agents.map((a) => (
              <div key={a.id} className="agent-card" onClick={() => newConversation(a.id)} title={`和 ${a.name} 聊天`}>
                <div style={{ position: "relative" }}>
                  <Avatar agent={a} size={62} radius={20} />
                  <button
                    className="icon-btn"
                    title={t("agentSettingsTip")}
                    style={{ position: "absolute", right: -10, bottom: -4, width: 28, height: 28, background: "var(--surface)", boxShadow: "var(--shadow)" }}
                    onClick={(e) => {
                      e.stopPropagation();
                      setEditing(a.id);
                    }}
                  >
                    <Icon name="edit" size={14} />
                  </button>
                </div>
                <div className="nm">{a.name}</div>
                <div className="ds">{a.persona.slice(0, 50) || t("noPersonaYet")}</div>
              </div>
            ))}

            <div className="agent-card add" onClick={() => createAgent()}>
              <Icon name="plus" size={26} />
              <span style={{ fontSize: 13 }}>{t("createNewAgent")}</span>
            </div>
          </div>
        )}

        <div className="card" style={{ fontSize: 13, color: "var(--text-2)", lineHeight: 1.8 }}>
          <b>💡 {t("whatIsAgent")}</b>
          <br />
          {t("whatIsAgentBody")}
        </div>
      </div>
    </div>
  );
}

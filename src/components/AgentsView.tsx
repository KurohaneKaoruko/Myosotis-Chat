import { useStore } from "../store";
import { Avatar, Icon } from "./ui";

export default function AgentsView() {
  const agents = useStore((s) => s.agents);
  const createAgent = useStore((s) => s.createAgent);
  const newConversation = useStore((s) => s.newConversation);
  const setEditing = useStore((s) => s.setEditingAgentId);

  return (
    <div className="page">
      <div className="page-inner">
        <div className="page-title">
          我的智能体
          <span className="desc" style={{ fontWeight: 400 }}>
            每个智能体都有自己的人设与记忆
          </span>
        </div>

        {agents.length === 0 ? (
          <div className="card" style={{ textAlign: "center", padding: "48px 24px" }}>
            <div style={{ fontSize: 52, marginBottom: 12 }}>✨</div>
            <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 6 }}>创建你的第一个智能体</div>
            <div style={{ fontSize: 13, color: "var(--text-3)", marginBottom: 22 }}>
              它是谁、什么性格、怎么说话——都由你定义
            </div>
            <button className="btn primary" style={{ padding: "12px 28px" }} onClick={() => createAgent()}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                <Icon name="plus" size={16} /> 开始创建
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
                    title="设定"
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
                <div className="ds">{a.persona.slice(0, 50) || "尚未设定人设"}</div>
              </div>
            ))}

            <div className="agent-card add" onClick={() => createAgent()}>
              <Icon name="plus" size={26} />
              <span style={{ fontSize: 13 }}>创建新智能体</span>
            </div>
          </div>
        )}

        <div className="card" style={{ fontSize: 13, color: "var(--text-2)", lineHeight: 1.8 }}>
          <b>💡 什么是智能体？</b>
          <br />
          智能体 = 人设 + 记忆。它只负责陪你聊天：没有任务、没有文件和工具，只有性格鲜明的「人」。
          你可以设定它的身份、说话方式、与你的关系；它会自动记住聊过的点点滴滴，下次接着聊。
        </div>
      </div>
    </div>
  );
}

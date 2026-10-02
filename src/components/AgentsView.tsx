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
          我的伙伴
          <span className="desc" style={{ fontWeight: 400 }}>
            每位伙伴都有自己的性格与记忆
          </span>
        </div>

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
              <div className="ds">{a.persona.slice(0, 50) || "温暖真诚的好朋友"}</div>
            </div>
          ))}

          <div className="agent-card add" onClick={() => createAgent()}>
            <Icon name="plus" size={26} />
            <span style={{ fontSize: 13 }}>创建新伙伴</span>
          </div>
        </div>

        <div className="card" style={{ fontSize: 13, color: "var(--text-2)", lineHeight: 1.8 }}>
          <b>💡 什么是伙伴？</b>
          <br />
          伙伴 = 性格（人设） + 记忆。它只负责陪你聊天：没有人给你安排的任务、没有文件和工具，只有性格鲜明的「人」。
          你可以设定它的身份、说话方式、与你的关系；它会自动记住聊过的点点滴滴，下次接着聊。
        </div>
      </div>
    </div>
  );
}

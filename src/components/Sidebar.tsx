import { useStore } from "../store";
import { Avatar, Icon } from "./ui";
import { formatTime } from "../lib/utils";

export default function Sidebar() {
  const convos = useStore((s) => s.convos);
  const agents = useStore((s) => s.agents);
  const view = useStore((s) => s.view);
  const activeConvoId = useStore((s) => s.activeConvoId);
  const setView = useStore((s) => s.setView);
  const setSidebar = useStore((s) => s.setSidebar);
  const openConversation = useStore((s) => s.openConversation);
  const newConversation = useStore((s) => s.newConversation);
  const deleteConversation = useStore((s) => s.deleteConversation);
  const settings = useStore((s) => s.settings);

  const agentOf = (id: string) => agents.find((a) => a.id === id);

  return (
    <aside className="sidebar">
      <div className="sidebar-head">
        <div className="brand">
          <img src="logo.png" alt="" />
          Myosotis
        </div>
        <nav className="nav">
          <button className={`nav-item ${view === "chat" ? "active" : ""}`} onClick={() => setView("chat")}>
            <Icon name="chat" />
            聊天
          </button>
          <button className={`nav-item ${view === "agents" ? "active" : ""}`} onClick={() => setView("agents")}>
            <Icon name="agents" />
            伙伴
          </button>
          <button className={`nav-item ${view === "memory" ? "active" : ""}`} onClick={() => setView("memory")}>
            <Icon name="memory" />
            记忆
          </button>
          <button className={`nav-item ${view === "settings" ? "active" : ""}`} onClick={() => setView("settings")}>
            <Icon name="settings" />
            设置
          </button>
        </nav>
      </div>

      <div className="convo-scroll">
        {convos.length > 0 && (
          <>
            <div className="section-label">最近对话</div>
            {convos.map((c) => {
              const agent = agentOf(c.agentId);
              if (!agent) return null;
              return (
                <div
                  key={c.id}
                  className={`convo-item ${c.id === activeConvoId && view === "chat" ? "active" : ""}`}
                  onClick={() => openConversation(c.id)}
                >
                  <Avatar agent={agent} />
                  <div className="meta">
                    <div className="t">
                      <span className="name">{agent.name} · {c.title}</span>
                      <span className="time">{formatTime(c.updatedAt)}</span>
                    </div>
                    <div className="preview">{c.lastMessage || "…"}</div>
                  </div>
                  <button
                    className="del"
                    title="删除对话"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (confirm(`删除与「${agent.name}」的这段对话？（记忆不受影响）`)) deleteConversation(c.id);
                    }}
                  >
                    <Icon name="trash" size={13} />
                  </button>
                </div>
              );
            })}
          </>
        )}

        <div className="section-label">
          伙伴
          <button onClick={() => setView("agents")}>管理</button>
        </div>
        {agents.map((a) => (
          <div key={a.id} className="convo-item" onClick={() => newConversation(a.id)} title={`和 ${a.name} 开始新对话`}>
            <Avatar agent={a} />
            <div className="meta">
              <div className="t">
                <span className="name">{a.name}</span>
              </div>
              <div className="preview">{a.greeting.slice(0, 26) || "…"}</div>
            </div>
          </div>
        ))}
      </div>

      <div className="sidebar-foot">
        <div className="foot-note">
          {settings.userName ? `${settings.userName}，` : ""}数据仅保存在本机 🔒
        </div>
      </div>
    </aside>
  );
}

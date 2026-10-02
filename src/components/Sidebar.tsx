import { useState } from "react";
import { useStore } from "../store";
import { Avatar, Icon, Menu, PromptModal } from "./ui";
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
  const pinConversation = useStore((s) => s.pinConversation);
  const renameConversation = useStore((s) => s.renameConversation);
  const settings = useStore((s) => s.settings);
  const [search, setSearch] = useState("");
  const [renaming, setRenaming] = useState<string | null>(null);

  const agentOf = (id: string) => agents.find((a) => a.id === id);
  const q = search.trim().toLowerCase();
  const filteredConvos = q
    ? convos.filter((c) => {
        const agent = agentOf(c.agentId);
        return (
          c.title.toLowerCase().includes(q) ||
          c.lastMessage.toLowerCase().includes(q) ||
          (agent?.name.toLowerCase().includes(q) ?? false)
        );
      })
    : convos;

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
            智能体
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
        <div className="search-box">
          <Icon name="search" size={15} />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="搜索对话…" />
        </div>
        {convos.length > 0 && (
          <>
            <div className="section-label">最近对话{q && `（${filteredConvos.length}/${convos.length}）`}</div>
            {q && filteredConvos.length === 0 && (
              <div style={{ textAlign: "center", color: "var(--text-3)", fontSize: 12, padding: "14px 0" }}>
                没有匹配的对话
              </div>
            )}
            {filteredConvos.map((c) => {
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
                      <span className="name">
                        {c.pinned && <span className="pin-mark">📌</span>}
                        {agent.name} · {c.title}
                      </span>
                      <span className="time">{formatTime(c.updatedAt)}</span>
                    </div>
                    <div className="preview">{c.lastMessage || "…"}</div>
                  </div>
                  <div className="convo-ops" onClick={(e) => e.stopPropagation()}>
                    <Menu
                      trigger={
                        <button className="ops-btn" title="更多">
                          <Icon name="dots" size={15} />
                        </button>
                      }
                      items={[
                        {
                          label: c.pinned ? "取消置顶" : "置顶",
                          icon: "pin",
                          onClick: () => pinConversation(c.id, !c.pinned),
                        },
                        { label: "重命名", icon: "edit", onClick: () => setRenaming(c.id) },
                        "separator",
                        {
                          label: "删除对话",
                          icon: "trash",
                          danger: true,
                          onClick: () => {
                            if (confirm(`删除与「${agent.name}」的这段对话？（记忆不受影响）`)) deleteConversation(c.id);
                          },
                        },
                      ]}
                    />
                  </div>
                </div>
              );
            })}
          </>
        )}

        <div className="section-label">
          智能体
          <button onClick={() => setView("agents")}>管理</button>
        </div>
        {agents.length === 0 ? (
          <div className="agent-empty-hint" onClick={() => setView("agents")}>
            <span>还没有智能体</span>
            <b>去创建 →</b>
          </div>
        ) : (
          agents.map((a) => (
            <div key={a.id} className="convo-item" onClick={() => newConversation(a.id)} title={`和 ${a.name} 开始新对话`}>
              <Avatar agent={a} />
              <div className="meta">
                <div className="t">
                  <span className="name">{a.name}</span>
                </div>
                <div className="preview">{a.greeting.slice(0, 26) || "…"}</div>
              </div>
            </div>
          ))
        )}
      </div>

      <div className="sidebar-foot">
        <div className="foot-note">
          {settings.userName ? `${settings.userName}，` : ""}数据仅保存在本机 🔒
        </div>
      </div>

      {renaming && (
        <PromptModal
          title="重命名对话"
          label="对话名称"
          initial={convos.find((c) => c.id === renaming)?.title}
          onClose={() => setRenaming(null)}
          onConfirm={(v) => {
            renameConversation(renaming, v);
            setRenaming(null);
          }}
        />
      )}
    </aside>
  );
}

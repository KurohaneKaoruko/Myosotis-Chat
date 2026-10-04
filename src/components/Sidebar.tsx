import { useState } from "react";
import { useStore } from "../store";
import { Avatar, Icon, Menu, TipFor } from "./ui";
import { t, tf } from "../i18n";
import { formatTime } from "../lib/utils";

/**
 * Chat-app style conversation list: one row per agent (its single
 * conversation). Clicking a row switches to that agent's conversation
 * inside the chat view.
 */
export default function Sidebar() {
  const agents = useStore((s) => s.agents);
  const convos = useStore((s) => s.convos);
  const view = useStore((s) => s.view);
  const activeConvoId = useStore((s) => s.activeConvoId);
  const openOrCreateConversation = useStore((s) => s.openOrCreateConversation);
  const createAgent = useStore((s) => s.createAgent);
  const pinConversation = useStore((s) => s.pinConversation);
  const deleteAgent = useStore((s) => s.deleteAgent);
  const sidebarOpen = useStore((s) => s.sidebarOpen);
  const [search, setSearch] = useState("");

  const q = search.trim().toLowerCase();
  const rows = agents
    .map((agent) => ({ agent, convo: convos.find((c) => c.agentId === agent.id) }))
    .filter(
      ({ agent, convo }) =>
        !q ||
        agent.name.toLowerCase().includes(q) ||
        (convo?.lastMessage.toLowerCase().includes(q) ?? false)
    )
    .sort(
      (a, b) =>
        Number(!!b.convo?.pinned) - Number(!!a.convo?.pinned) ||
        (b.convo?.updatedAt ?? b.agent.updatedAt) - (a.convo?.updatedAt ?? a.agent.updatedAt)
    );

  return (
    <aside className={`sidebar ${sidebarOpen ? "open" : ""}`}>
      <div className="list-head">
        <div className="search-box">
          <Icon name="search" size={15} />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("searchPh")} />
        </div>
        <TipFor text={t("newAgentBtn")}>
          <button
            className="new-btn"
            onClick={() => {
              useStore.getState().setSidebar(false);
              createAgent();
            }}
          >
            <Icon name="plus" size={18} />
          </button>
        </TipFor>
      </div>

      <div className="convo-scroll">
        {rows.length === 0 && (
          <div
            className="agent-empty-hint"
            onClick={() => {
              useStore.getState().setSidebar(false);
              createAgent();
            }}
          >
            <span>{t("noAgents")}</span>
            <b>{t("createFirst")}</b>
          </div>
        )}
        {rows.map(({ agent, convo }) => (
          <div
            key={agent.id}
            className={`convo-item ${convo?.id === activeConvoId && view === "chat" ? "active" : ""}`}
            onClick={() => openOrCreateConversation(agent.id)}
            title={tf("chatWith", { name: agent.name })}
          >
            <Avatar agent={agent} size={40} />
            <div className="meta">
              <div className="t">
                <span className="name">
                  {convo?.pinned && <span className="pin-mark">📌</span>}
                  {agent.name}
                </span>
                <span className="time">{convo ? formatTime(convo.updatedAt) : ""}</span>
              </div>
              <div className="preview">{convo?.lastMessage || "…"}</div>
            </div>
            <div className="convo-ops" onClick={(e) => e.stopPropagation()}>
              <Menu
                trigger={
                  <button className="ops-btn">
                    <Icon name="dots" size={15} />
                  </button>
                }
                items={[
                  ...(convo
                    ? ([
                        {
                          label: convo.pinned ? t("pinOff") : t("pinOn"),
                          icon: "pin" as const,
                          onClick: () => pinConversation(convo.id, !convo.pinned),
                        },
                      ] as const)
                    : []),
                  {
                    label: t("agentSettingsTip"),
                    icon: "edit" as const,
                    onClick: () => useStore.getState().setEditingAgentId(agent.id),
                  },
                  "separator",
                  {
                    label: t("delete"),
                    icon: "trash" as const,
                    danger: true,
                    onClick: () => {
                      useStore
                        .getState()
                        .askConfirm({
                          title: t("deleteAgentTitle"),
                          message: tf("deleteAgentMsg", { name: agent.name }),
                          confirmText: t("commonDelete"),
                          danger: true,
                        })
                        .then((ok) => {
                          if (ok) deleteAgent(agent.id);
                        });
                    },
                  },
                ]}
              />
            </div>
          </div>
        ))}
      </div>

      <div className="sidebar-foot">
        <span>🔒 {t("dataLocalOnly")}</span>
      </div>
    </aside>
  );
}

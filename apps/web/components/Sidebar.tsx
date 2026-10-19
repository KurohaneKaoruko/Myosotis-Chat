import { useState } from "react";
import { useStore } from "../store";
import { Avatar, Icon, Menu, PromptModal, TipFor } from "./ui";
import GroupEditor from "./GroupEditor";
import { t, tf } from "../i18n";
import { formatTime } from "@myosotis/core";
import type { Agent, Conversation } from "@myosotis/core";

type Filter = "all" | "pinned" | "archived";

const FILTER_LABEL: Record<Filter, "filterAll" | "filterPinned" | "filterArchived"> = {
  all: "filterAll",
  pinned: "filterPinned",
  archived: "filterArchived",
};

/** Small stacked-avatar badge for group conversations. */
function GroupAvatar({ agents }: { agents: Agent[] }) {
  return (
    <div className="group-ava" style={{ width: 40, height: 40 }}>
      {agents.slice(0, 3).map((a) => (
        <span
          key={a.id}
          style={{
            background: `linear-gradient(135deg, hsl(${a.hue} 70% 55%), hsl(${(a.hue + 40) % 360} 70% 45%))`,
          }}
        >
          {a.emoji}
        </span>
      ))}
      {agents.length === 0 && <span style={{ background: "var(--surface-3)" }}>👥</span>}
    </div>
  );
}

/**
 * Chat-app style conversation list. Every row is a conversation — a direct
 * chat is labelled by its agent, a group chat by its title and members.
 */
export default function Sidebar() {
  const agents = useStore((s) => s.agents);
  const convos = useStore((s) => s.convos);
  const view = useStore((s) => s.view);
  const activeConvoId = useStore((s) => s.activeConvoId);
  const openConversation = useStore((s) => s.openConversation);
  const openOrCreateConversation = useStore((s) => s.openOrCreateConversation);
  const createAgent = useStore((s) => s.createAgent);
  const pinConversation = useStore((s) => s.pinConversation);
  const archiveConversation = useStore((s) => s.archiveConversation);
  const duplicateConversation = useStore((s) => s.duplicateConversation);
  const deleteConversation = useStore((s) => s.deleteConversation);
  const deleteAgent = useStore((s) => s.deleteAgent);
  const setConversationTags = useStore((s) => s.setConversationTags);
  const sidebarOpen = useStore((s) => s.sidebarOpen);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [tagging, setTagging] = useState<Conversation | null>(null);
  const [groupEditorOpen, setGroupEditorOpen] = useState(false);
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);

  /** Open the group editor — null creates a new group, an id edits that one. */
  const openGroupEditor = (id: string | null) => {
    setEditingGroupId(id);
    setGroupEditorOpen(true);
  };

  const q = search.trim().toLowerCase();
  const agentOf = (id: string) => agents.find((a) => a.id === id);

  const matches = (convo: Conversation, agent: Agent | null) =>
    !q ||
    (!!agent && agent.name.toLowerCase().includes(q)) ||
    convo.title.toLowerCase().includes(q) ||
    (convo.lastMessage ?? "").toLowerCase().includes(q) ||
    (convo.tags ?? []).some((tg) => tg.toLowerCase().includes(q)) ||
    (convo.participants ?? []).some((p) => (agentOf(p.agentId)?.name ?? "").toLowerCase().includes(q));

  const rows = convos
    .filter((c) =>
      filter === "pinned" ? !!c.pinned : filter === "archived" ? !!c.archived : !c.archived
    )
    .map((convo) => ({
      convo,
      agent: convo.kind === "group" ? null : agentOf(convo.agentId) ?? null,
    }))
    .filter((r) => r.convo.kind === "group" || !!r.agent)
    .filter(({ convo, agent }) => matches(convo, agent));

  const orphanAgents =
    filter === "archived"
      ? []
      : agents
          .filter((a) => !convos.some((c) => c.agentId === a.id && c.kind !== "group"))
          .filter((a) => !q || a.name.toLowerCase().includes(q));

  const empty = rows.length === 0 && orphanAgents.length === 0;

  const confirmDelete = (title: string, message: string, onOk: () => void) =>
    useStore
      .getState()
      .askConfirm({ title, message, confirmText: t("commonDelete"), danger: true })
      .then((ok) => {
        if (ok) onOk();
      });

  return (
    <aside className={`sidebar ${sidebarOpen ? "open" : ""}`}>
      <div className="list-head">
        <div className="search-box">
          <Icon name="search" size={15} />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("searchPh")} />
        </div>
        <TipFor text={t("newGroupBtn")}>
          <button
            className="new-btn"
            onClick={() => {
              useStore.getState().setSidebar(false);
              openGroupEditor(null);
            }}
          >
            <Icon name="agents" size={18} />
          </button>
        </TipFor>
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

      <div className="filter-row">
        {(["all", "pinned", "archived"] as Filter[]).map((f) => (
          <button key={f} className={`chip ${filter === f ? "on" : ""}`} onClick={() => setFilter(f)}>
            {t(FILTER_LABEL[f])}
          </button>
        ))}
      </div>

      <div className="convo-scroll">
        {agents.length === 0 && (
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
        {agents.length > 0 && empty && <div className="agent-empty-hint">{t("noConvoMatch")}</div>}

        {rows.map(({ convo, agent }) => {
          const isActive = convo.id === activeConvoId && view === "chat";
          const isGroup = convo.kind === "group";
          const groupMembers = isGroup
            ? (convo.participants ?? []).map((p) => agentOf(p.agentId)).filter((a): a is Agent => !!a)
            : [];
          const multi = !isGroup && agent ? convos.filter((c) => c.agentId === agent.id && c.kind !== "group").length > 1 : false;
          const label = isGroup
            ? convo.title
            : multi && convo.title !== t("newChat")
              ? `${agent!.name} · ${convo.title}`
              : agent!.name;
          const chatMenu = [
            {
              label: convo.pinned ? t("pinOff") : t("pinOn"),
              icon: "pin" as const,
              onClick: () => pinConversation(convo.id, !convo.pinned),
            },
            {
              label: convo.archived ? t("unarchive") : t("archive"),
              icon: "book" as const,
              onClick: () => archiveConversation(convo.id, !convo.archived),
            },
            {
              label: t("duplicateConvo"),
              icon: "copy" as const,
              onClick: () => duplicateConversation(convo.id),
            },
            {
              label: t("editTags"),
              icon: "edit" as const,
              onClick: () => setTagging(convo),
            },
          ];
          return (
            <div
              key={convo.id}
              className={`convo-item ${isActive ? "active" : ""}`}
              onClick={() => openConversation(convo.id)}
              title={isGroup ? convo.title : tf("chatWith", { name: agent!.name })}
            >
              {isGroup ? <GroupAvatar agents={groupMembers} /> : <Avatar agent={agent!} size={40} />}
              <div className="meta">
                <div className="t">
                  <span className="name">
                    {convo.pinned && <span className="pin-mark">📌</span>}
                    {convo.archived && <span className="pin-mark">🗄️</span>}
                    {label}
                  </span>
                  <span className="time">{formatTime(convo.updatedAt)}</span>
                </div>
                <div className="preview">{convo.lastMessage || "…"}</div>
                {(convo.tags?.length ?? 0) > 0 && (
                  <div className="convo-tags">
                    {convo.tags!.map((tg) => (
                      <span key={tg} className="convo-tag">
                        {tg}
                      </span>
                    ))}
                  </div>
                )}
              </div>
              <div className="convo-ops" onClick={(e) => e.stopPropagation()}>
                <Menu
                  trigger={
                    <button className="ops-btn">
                      <Icon name="dots" size={15} />
                    </button>
                  }
                  items={[
                    ...chatMenu,
                    "separator" as const,
                    ...(isGroup
                      ? ([
                          {
                            label: t("groupEdit"),
                            icon: "agents" as const,
                            onClick: () => openGroupEditor(convo.id),
                          },
                        ] as const)
                      : ([
                          {
                            label: t("agentSettingsTip"),
                            icon: "edit" as const,
                            onClick: () => useStore.getState().setEditingAgentId(agent!.id),
                          },
                        ] as const)),
                    "separator" as const,
                    {
                      label: t("deleteConvo"),
                      icon: "trash" as const,
                      danger: true,
                      onClick: () =>
                        confirmDelete(
                          t("deleteConvoTitle"),
                          tf("deleteConvoMsg", { title: convo.title || agent?.name || "" }),
                          () => deleteConversation(convo.id)
                        ),
                    },
                    ...(isGroup
                      ? []
                      : ([
                          {
                            label: t("delete"),
                            icon: "trash" as const,
                            danger: true,
                            onClick: () =>
                              confirmDelete(
                                t("deleteAgentTitle"),
                                tf("deleteAgentMsg", { name: agent!.name }),
                                () => deleteAgent(agent!.id)
                              ),
                          },
                        ] as const)),
                  ]}
                />
              </div>
            </div>
          );
        })}

        {orphanAgents.map((agent) => (
          <div
            key={agent.id}
            className="convo-item"
            onClick={() => openOrCreateConversation(agent.id)}
            title={tf("chatWith", { name: agent.name })}
          >
            <Avatar agent={agent} size={40} />
            <div className="meta">
              <div className="t">
                <span className="name">{agent.name}</span>
                <span className="time" />
              </div>
              <div className="preview">{agent.greeting || "…"}</div>
            </div>
          </div>
        ))}
      </div>

      <div className="sidebar-foot">
        <span>🔒 {t("dataLocalOnly")}</span>
      </div>

      {tagging && (
        <PromptModal
          title={t("editTags")}
          label={t("tagsLabel")}
          initial={(tagging.tags ?? []).join(", ")}
          onConfirm={(v) => {
            setConversationTags(tagging.id, v.split(/[,，]/));
            setTagging(null);
          }}
          onClose={() => setTagging(null)}
        />
      )}

      {groupEditorOpen && (
        <GroupEditor convoId={editingGroupId} onClose={() => setGroupEditorOpen(false)} />
      )}
    </aside>
  );
}

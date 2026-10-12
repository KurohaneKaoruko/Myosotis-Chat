import { useState } from "react";
import { useStore } from "../store";
import { Avatar, Icon, Menu, PromptModal, TipFor } from "./ui";
import { t, tf } from "../i18n";
import { formatTime } from "../lib/utils";
import type { Conversation } from "../types";

type Filter = "all" | "pinned" | "archived";

const FILTER_LABEL: Record<Filter, "filterAll" | "filterPinned" | "filterArchived"> = {
  all: "filterAll",
  pinned: "filterPinned",
  archived: "filterArchived",
};

/**
 * Chat-app style conversation list. Every row is a conversation; an agent's
 * primary conversation is labelled by the agent name, and extra ones
 * (duplicates) append their title so they can be told apart.
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

  const q = search.trim().toLowerCase();
  const agentOf = (id: string) => agents.find((a) => a.id === id);

  const rows = convos
    .map((convo) => ({ convo, agent: agentOf(convo.agentId) }))
    .filter((r) => !!r.agent)
    .filter(({ convo }) =>
      filter === "pinned" ? !!convo.pinned : filter === "archived" ? !!convo.archived : !convo.archived
    )
    .filter(
      ({ convo, agent }) =>
        !q ||
        agent!.name.toLowerCase().includes(q) ||
        convo.title.toLowerCase().includes(q) ||
        (convo.lastMessage ?? "").toLowerCase().includes(q) ||
        (convo.tags ?? []).some((tg) => tg.toLowerCase().includes(q))
    );

  // agents created but never opened (no conversation yet) — shown only in "all"
  const orphanAgents =
    filter === "archived"
      ? []
      : agents
          .filter((a) => !convos.some((c) => c.agentId === a.id))
          .filter((a) => !q || a.name.toLowerCase().includes(q));

  const empty = rows.length === 0 && orphanAgents.length === 0;

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
          const multi = convos.filter((c) => c.agentId === agent!.id).length > 1;
          const label =
            multi && convo.title !== t("newChat") ? `${agent!.name} · ${convo.title}` : agent!.name;
          return (
            <div
              key={convo.id}
              className={`convo-item ${isActive ? "active" : ""}`}
              onClick={() => openConversation(convo.id)}
              title={tf("chatWith", { name: agent!.name })}
            >
              <Avatar agent={agent!} size={40} />
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
                    "separator",
                    {
                      label: t("agentSettingsTip"),
                      icon: "edit" as const,
                      onClick: () => useStore.getState().setEditingAgentId(agent!.id),
                    },
                    "separator",
                    {
                      label: t("deleteConvo"),
                      icon: "trash" as const,
                      danger: true,
                      onClick: () => {
                        useStore
                          .getState()
                          .askConfirm({
                            title: t("deleteConvoTitle"),
                            message: tf("deleteConvoMsg", { title: convo.title || agent!.name }),
                            confirmText: t("commonDelete"),
                            danger: true,
                          })
                          .then((ok) => {
                            if (ok) deleteConversation(convo.id);
                          });
                      },
                    },
                    {
                      label: t("delete"),
                      icon: "trash" as const,
                      danger: true,
                      onClick: () => {
                        useStore
                          .getState()
                          .askConfirm({
                            title: t("deleteAgentTitle"),
                            message: tf("deleteAgentMsg", { name: agent!.name }),
                            confirmText: t("commonDelete"),
                            danger: true,
                          })
                          .then((ok) => {
                            if (ok) deleteAgent(agent!.id);
                          });
                      },
                    },
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
    </aside>
  );
}

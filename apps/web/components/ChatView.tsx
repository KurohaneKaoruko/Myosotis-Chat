import { useEffect, useMemo, useRef, Fragment, useState } from "react";
import { useStore } from "../store";
import { resolveModel } from "@myosotis/core";
import { Avatar, Icon, Menu, Modal, SelectBox, TipFor } from "./ui";
import MessageBubble from "./MessageBubble";
import Composer, { filesToDataUrls } from "./Composer";
import ScenarioEditor from "./ScenarioEditor";
import GroupEditor from "./GroupEditor";
import { t, tf, dateLocale } from "../i18n";
import type { Agent, ChatMessage, Scenario } from "@myosotis/core";

function isSameDay(a: number, b: number): boolean {
  const da = new Date(a),
    db = new Date(b);
  return da.getFullYear() === db.getFullYear() && da.getMonth() === db.getMonth() && da.getDate() === db.getDate();
}

function dateLabel(ts: number): string {
  const d = new Date(ts);
  const today = new Date();
  if (isSameDay(ts, today.getTime())) return t("today");
  const yesterday = new Date(today.getTime() - 86400000);
  if (isSameDay(ts, yesterday.getTime())) return t("yesterday");
  const sameYear = d.getFullYear() === today.getFullYear();
  return d.toLocaleDateString(dateLocale(), sameYear ? { month: "long", day: "numeric" } : { year: "numeric", month: "long", day: "numeric" });
}

export default function ChatView() {
  const convos = useStore((s) => s.convos);
  const agents = useStore((s) => s.agents);
  const messages = useStore((s) => s.messages);
  const activeConvoId = useStore((s) => s.activeConvoId);
  const streamingConvoId = useStore((s) => s.streamingConvoId);
  const streamingAgentId = useStore((s) => s.streamingAgentId);
  const streamText = useStore((s) => s.streamText);
  const models = useStore((s) => s.models);
  const providers = useStore((s) => s.providers);
  const settings = useStore((s) => s.settings);
  const setSidebar = useStore((s) => s.setSidebar);
  const setEditing = useStore((s) => s.setEditingAgentId);
  const send = useStore((s) => s.send);
  const undoLastTurn = useStore((s) => s.undoLastTurn);
  const clearConversation = useStore((s) => s.clearConversation);
  const exportConversation = useStore((s) => s.exportConversation);
  const updateAgent = useStore((s) => s.updateAgent);
  const addPendingImages = useStore((s) => s.addPendingImages);
  const multiSelectActive = useStore((s) => s.multiSelectActive);
  const multiSelectIds = useStore((s) => s.multiSelectIds);
  const enterMultiSelect = useStore((s) => s.enterMultiSelect);
  const exitMultiSelect = useStore((s) => s.exitMultiSelect);
  const toggleMultiSelect = useStore((s) => s.toggleMultiSelect);
  const deleteSelected = useStore((s) => s.deleteSelected);
  const scenarios = useStore((s) => s.scenarios);
  const enterStoryMode = useStore((s) => s.enterStoryMode);
  const exitStoryMode = useStore((s) => s.exitStoryMode);
  const saveScenario = useStore((s) => s.saveScenario);

  const [showSummary, setShowSummary] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [showJump, setShowJump] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setQuery] = useState("");
  const [matchIdx, setMatchIdx] = useState(0);
  const [storyPicker, setStoryPicker] = useState(false);
  const [editingScenario, setEditingScenario] = useState<{ agentId: string; scenario: Scenario | null } | null>(null);
  const [groupEditor, setGroupEditor] = useState<{ convoId: string | null } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickBottom = useRef(true);
  const dragCounter = useRef(0);

  const q = searchQuery.trim().toLowerCase();
  const matches = useMemo(
    () => (q ? messages.filter((m) => m.content.toLowerCase().includes(q)).map((m) => m.id) : []),
    [messages, q]
  );

  const gotoMatch = (dir: 1 | -1) => {
    if (!matches.length) return;
    const next = (matchIdx + dir + matches.length) % matches.length;
    setMatchIdx(next);
    const el = document.querySelector(`[data-msg-id="${matches[next]}"]`);
    el?.scrollIntoView({ block: "center", behavior: "smooth" });
    el?.classList.add("search-hit");
    setTimeout(() => el?.classList.remove("search-hit"), 1800);
  };

  const convo = convos.find((c) => c.id === activeConvoId);
  const isGroup = convo?.kind === "group";
  const groupAgents = (convo?.participants ?? [])
    .map((p) => agents.find((a) => a.id === p.agentId))
    .filter((a): a is Agent => !!a);
  const agent = isGroup ? null : agents.find((a) => a.id === convo?.agentId) ?? null;
  const chatRm = agent ? resolveModel("chat", models, providers, settings, agent.models) : null;
  const isStreamingHere = streamingConvoId === activeConvoId && !!activeConvoId;
  const streamingAgent = streamingAgentId ? agents.find((a) => a.id === streamingAgentId) ?? null : null;
  /** which agent owns a given assistant message (group chats) */
  const agentForMessage = (m: ChatMessage): Agent | null =>
    (m.agentId ? agents.find((a) => a.id === m.agentId) : undefined) ?? agent ?? groupAgents[0] ?? null;
  const streamingBubbleAgent = streamingAgent ?? agent ?? groupAgents[0] ?? null;

  // auto scroll when near bottom
  useEffect(() => {
    const el = scrollRef.current;
    if (el && stickBottom.current) el.scrollTop = el.scrollHeight;
  }, [messages.length, streamText, activeConvoId]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 140;
    stickBottom.current = nearBottom;
    setShowJump(el.scrollHeight - el.scrollTop - el.clientHeight > 420);
  };

  const jumpToBottom = () => {
    const el = scrollRef.current;
    if (el) {
      el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
      stickBottom.current = true;
    }
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    dragCounter.current = 0;
    const files = Array.from(e.dataTransfer.files || []).filter((f) => f.type.startsWith("image/"));
    if (!files.length) return;
    filesToDataUrls(files).then((urls) => urls.length && addPendingImages(urls));
  };

  if (!convo || (!agent && !isGroup)) {
    const noAgents = agents.length === 0;
    return (
      <div className="empty-chat">
        <div className="big">🌸</div>
        <div className="t">{noAgents ? t("noAgentsTitle") : t("pickConversation")}</div>
        <div style={{ fontSize: 13, marginBottom: 18 }}>
          {noAgents
            ? t("noAgentsDesc")
            : window.innerWidth <= 768
              ? t("pickMobile")
              : t("pickDesktop")}
        </div>
        {noAgents && (
          <button className="btn primary" onClick={() => useStore.getState().createAgent()}>
            {t("createAgent")}
          </button>
        )}
      </div>
    );
  }

  const chatModels = models.filter((m) => m.roles.includes("chat"));
  const providerName = (id: string) => providers.find((p) => p.id === id)?.name ?? "?";

  // story mode
  const storyScenario =
    !isGroup && convo.mode === "story" && convo.scenarioId
      ? scenarios.find((s) => s.id === convo.scenarioId) ?? null
      : null;
  const agentScenarios = agent ? scenarios.filter((s) => s.agentId === agent.id) : [];

  // greeting suggestions: conversation has only the greeting so far
  const showSuggests =
    !!agent &&
    messages.length === 1 &&
    messages[0].role === "assistant" &&
    !isStreamingHere &&
    agent.suggestions.length > 0;

  return (
    <>
      <header className="chat-head">
        <button className="back" onClick={() => setSidebar(true)} title={t("convoList")}>
          <Icon name="back" />
        </button>
        {isGroup ? (
          <div className="group-ava" title={tf("groupMembers", { n: groupAgents.length })}>
            {groupAgents.slice(0, 3).map((a) => (
              <span
                key={a.id}
                style={{
                  background: `linear-gradient(135deg, hsl(${a.hue} 70% 55%), hsl(${(a.hue + 40) % 360} 70% 45%))`,
                }}
              >
                {a.emoji}
              </span>
            ))}
          </div>
        ) : (
          agent && <Avatar agent={agent} size={38} radius={12} />
        )}
        <div>
          <div className="title">
            {isGroup ? convo.title : agent!.name}
            {storyScenario && (
              <span className="story-badge" title={tf("storyBadgeTip", { name: storyScenario.name })}>
                📖 {storyScenario.name}
              </span>
            )}
          </div>
          {isGroup ? (
            <div className="sub">{tf("groupMembers", { n: groupAgents.length })}</div>
          ) : chatRm && agent ? (
            <Menu
              align="start"
              trigger={
                <button className="model-switch" title={t("switchModel")}>
                  <span className="sub">{chatRm.model.label}</span>
                  <Icon name="down" size={11} />
                </button>
              }
              items={[
                ...chatModels.slice(0, 12).map((m) => ({
                  label: `${m.label} · ${providerName(m.providerId)}`,
                  onClick: () =>
                    updateAgent(agent!.id, { models: { ...agent!.models, chat: m.id } }),
                })),
                ...(chatModels.length > 1
                  ? ([
                      "separator",
                      { label: t("manageModelsInSettings"), icon: "settings" as const, onClick: () => useStore.getState().setView("settings") },
                    ] as const)
                  : []),
              ]}
            />
          ) : (
            <div
              className="sub"
              style={{ color: "#f59e0b", cursor: "pointer" }}
              onClick={() => useStore.getState().setView("settings")}
              title={t("goSettings")}
            >
              {t("unconfiguredModel")}
            </div>
          )}
        </div>
        <div className="spacer" />
        {!isGroup && (
          <TipFor text={storyScenario ? t("storyModeOn") : t("storyModeTip")}>
            <button
              className={`icon-btn ${storyScenario ? "active" : ""}`}
              onClick={() => {
                if (storyScenario) {
                  useStore
                    .getState()
                    .askConfirm({
                      title: t("exitStoryTitle"),
                      message: t("exitStoryMsg"),
                      confirmText: t("storyModeOn"),
                      danger: false,
                    })
                    .then((ok) => { if (ok) exitStoryMode(convo.id); });
                } else {
                  setStoryPicker(true);
                }
              }}
            >
              <Icon name="book" />
            </button>
          </TipFor>
        )}
        <TipFor text={t("searchTip")}>
          <button
            className={`icon-btn ${searchOpen ? "active" : ""}`}
            onClick={() => {
              setSearchOpen(!searchOpen);
              setQuery("");
            }}
          >
            <Icon name="search" />
          </button>
        </TipFor>
        <TipFor text={isGroup ? t("groupEdit") : t("agentSettingsTip")}>
          <button
            className="icon-btn"
            onClick={() => (isGroup ? setGroupEditor({ convoId: convo.id }) : setEditing(agent!.id))}
          >
            <Icon name="edit" />
          </button>
        </TipFor>
        <Menu
          trigger={
            <button className="icon-btn" title={t("moreTip")}>
              <Icon name="dots" />
            </button>
          }
          items={[
            { label: t("exportMd"), icon: "download", onClick: () => exportConversation(convo.id) },
            { label: t("viewSummary"), icon: "book", onClick: () => setShowSummary(true) },
            {
              label: t("undoLastTurn"),
              icon: "refresh",
              onClick: () => undoLastTurn(),
            },
            { label: t("multiSelect"), icon: "check", onClick: () => enterMultiSelect() },
            {
              label: t("clearChat"),
              icon: "broom",
              danger: true,
              onClick: () => {
                useStore
                  .getState()
                  .askConfirm({
                    title: t("clearChat"),
                    message: t("clearChatMsg"),
                    confirmText: t("clear"),
                    danger: true,
                  })
                  .then((ok) => { if (ok) clearConversation(convo.id); });
              },
            },
          ]}
        />
      </header>

      {searchOpen && (
        <div className="msg-search">
          <Icon name="search" size={15} />
          <input
            autoFocus
            value={searchQuery}
            onChange={(e) => {
              setQuery(e.target.value);
              setMatchIdx(0);
            }}
            placeholder={t("searchInConvo")}
            onKeyDown={(e) => {
              if (e.key === "Enter") gotoMatch(e.shiftKey ? -1 : 1);
              if (e.key === "Escape") {
                setSearchOpen(false);
                setQuery("");
              }
            }}
          />
          <span className="search-count">
            {q ? `${matches.length ? matchIdx + 1 : 0}/${matches.length}` : ""}
          </span>
          <button className="icon-btn" style={{ width: 28, height: 28 }} onClick={() => gotoMatch(-1)} title={t("searchPrev")}>
            <Icon name="back" size={14} />
          </button>
          <button className="icon-btn" style={{ width: 28, height: 28 }} onClick={() => gotoMatch(1)} title={t("searchNext")}>
            <Icon name="down" size={14} />
          </button>
          <button
            className="icon-btn"
            style={{ width: 28, height: 28 }}
            onClick={() => {
              setSearchOpen(false);
              setQuery("");
            }}
            title={t("commonClose")}
          >
            <Icon name="x" size={14} />
          </button>
        </div>
      )}

      <div
        className={`chat-scroll ${dragging ? "dragging" : ""}`}
        ref={scrollRef}
        onScroll={onScroll}
        onDragEnter={(e) => {
          if (Array.from(e.dataTransfer.types).includes("Files")) {
            dragCounter.current++;
            setDragging(true);
          }
        }}
        onDragOver={(e) => e.preventDefault()}
        onDragLeave={() => {
          dragCounter.current--;
          if (dragCounter.current <= 0) setDragging(false);
        }}
        onDrop={onDrop}
      >
        {dragging && (
          <div className="drop-mask">
            <div className="drop-inner">{t("dropToSend")}</div>
          </div>
        )}
        <div className="msg-list">
          {messages.map((m, i) => {
            const prev = messages[i - 1];
            const showDate = !prev || !isSameDay(prev.createdAt, m.createdAt);
            return (
              <Fragment key={m.id}>
                {showDate && <div className="date-chip">{dateLabel(m.createdAt)}</div>}
                <div
                  data-msg-id={m.id}
                  className={multiSelectIds.includes(m.id) ? "msg-selected" : undefined}
                >
                  <MessageBubble
                    msg={m}
                    agent={agentForMessage(m) ?? agent!}
                    isLast={i === messages.length - 1}
                    showName={isGroup && m.role === "assistant"}
                    selectable={multiSelectActive}
                    selected={multiSelectIds.includes(m.id)}
                    onToggleSelect={() => toggleMultiSelect(m.id)}
                  />
                </div>
              </Fragment>
            );
          })}
          {isStreamingHere && streamingBubbleAgent && (
            <MessageBubble
              msg={
                {
                  id: "streaming",
                  conversationId: activeConvoId!,
                  role: "assistant",
                  content: "",
                  createdAt: Date.now(),
                } as ChatMessage
              }
              agent={streamingBubbleAgent}
              isLast
              streaming={streamText}
              showName={isGroup}
            />
          )}
          {showSuggests && (
            <div className="suggests" style={{ marginLeft: 47 }}>
              {agent!.suggestions.map((s, i) => (
                <button key={i} className="suggest-chip" onClick={() => send(s)}>
                  {s}
                </button>
              ))}
            </div>
          )}
        </div>
        {showJump && !isStreamingHere && (
          <button className="jump-btn" onClick={jumpToBottom} title={t("jumpBottom")}>
            <Icon name="down" size={17} />
          </button>
        )}
      </div>

      <Composer />

      {multiSelectActive && (
        <div className="multiselect-bar">
          <span>
            {tf("selectedN", { n: multiSelectIds.length })}
          </span>
          <div style={{ flex: 1 }} />
          <button className="btn sm ghost" onClick={exitMultiSelect}>
            {t("commonCancel")}
          </button>
          <button
            className="btn sm danger"
            disabled={!multiSelectIds.length}
            onClick={() => {
              useStore
                .getState()
                .askConfirm({
                  title: t("batchDeleteTitle"),
                  message: tf("batchDeleteMsg", { n: multiSelectIds.length }),
                  confirmText: t("commonDelete"),
                  danger: true,
                })
                .then((ok) => { if (ok) deleteSelected(); });
            }}
          >
            {t("deleteSelected")}
          </button>
        </div>
      )}

      {showSummary && (
        <Modal title={t("summaryTitle")} onClose={() => setShowSummary(false)}>
          <div className="summary-body">
            {convo.summary.trim() ? (
              convo.summary
            ) : (
              <span style={{ color: "var(--text-3)" }}>
                {t("summaryEmpty")}
              </span>
            )}
          </div>
        </Modal>
      )}

      {storyPicker && (
        <Modal title={t("storyPickerTitle")} onClose={() => setStoryPicker(false)}>
          {agentScenarios.length === 0 && (
            <div style={{ color: "var(--text-3)", fontSize: 13, textAlign: "center", padding: "8px 0 12px" }}>
              {t("noScenarios")}
            </div>
          )}
          {agentScenarios.map((s) => (
            <div
              key={s.id}
              className="provider-card"
              style={{ cursor: "pointer" }}
              onClick={() => {
                enterStoryMode(convo.id, s.id);
                setStoryPicker(false);
              }}
            >
              <div className="logo">📖</div>
              <div className="info">
                <div className="name">{s.name}</div>
                <div className="meta">{tf("nEvents", { n: s.events.length })}</div>
              </div>
              <button
                className="icon-btn"
                title={t("editScenario")}
                onClick={(e) => {
                  e.stopPropagation();
                  setEditingScenario({ agentId: agent!.id, scenario: s });
                }}
              >
                <Icon name="edit" size={17} />
              </button>
            </div>
          ))}
          <button
            className="btn"
            style={{ width: "100%", marginTop: 8 }}
            onClick={() => setEditingScenario({ agentId: agent!.id, scenario: null })}
          >
            <Icon name="plus" size={15} /> {t("newScenario")}
          </button>
        </Modal>
      )}

      {editingScenario && (
        <ScenarioEditor agentId={editingScenario.agentId} scenario={editingScenario.scenario} onClose={() => setEditingScenario(null)} />
      )}

      {groupEditor && <GroupEditor convoId={groupEditor.convoId} onClose={() => setGroupEditor(null)} />}
    </>
  );
}

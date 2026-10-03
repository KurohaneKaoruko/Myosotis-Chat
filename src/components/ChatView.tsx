import { useEffect, useMemo, useRef, Fragment, useState } from "react";
import { useStore } from "../store";
import { resolveModel } from "../lib/utils";
import { Avatar, Icon, Menu, Modal, SelectBox, TipFor } from "./ui";
import MessageBubble from "./MessageBubble";
import Composer, { filesToDataUrls } from "./Composer";
import type { ChatMessage } from "../types";

function isSameDay(a: number, b: number): boolean {
  const da = new Date(a),
    db = new Date(b);
  return da.getFullYear() === db.getFullYear() && da.getMonth() === db.getMonth() && da.getDate() === db.getDate();
}

function dateLabel(ts: number): string {
  const d = new Date(ts);
  const today = new Date();
  if (isSameDay(ts, today.getTime())) return "今天";
  const yesterday = new Date(today.getTime() - 86400000);
  if (isSameDay(ts, yesterday.getTime())) return "昨天";
  const sameYear = d.getFullYear() === today.getFullYear();
  return d.toLocaleDateString("zh-CN", sameYear ? { month: "long", day: "numeric" } : { year: "numeric", month: "long", day: "numeric" });
}

export default function ChatView() {
  const convos = useStore((s) => s.convos);
  const agents = useStore((s) => s.agents);
  const messages = useStore((s) => s.messages);
  const activeConvoId = useStore((s) => s.activeConvoId);
  const streamingConvoId = useStore((s) => s.streamingConvoId);
  const streamText = useStore((s) => s.streamText);
  const models = useStore((s) => s.models);
  const providers = useStore((s) => s.providers);
  const settings = useStore((s) => s.settings);
  const setSidebar = useStore((s) => s.setSidebar);
  const setEditing = useStore((s) => s.setEditingAgentId);
  const newConversation = useStore((s) => s.newConversation);
  const send = useStore((s) => s.send);
  const clearConversation = useStore((s) => s.clearConversation);
  const exportConversation = useStore((s) => s.exportConversation);
  const deleteConversation = useStore((s) => s.deleteConversation);
  const updateAgent = useStore((s) => s.updateAgent);
  const addPendingImages = useStore((s) => s.addPendingImages);
  const multiSelectActive = useStore((s) => s.multiSelectActive);
  const multiSelectIds = useStore((s) => s.multiSelectIds);
  const enterMultiSelect = useStore((s) => s.enterMultiSelect);
  const exitMultiSelect = useStore((s) => s.exitMultiSelect);
  const toggleMultiSelect = useStore((s) => s.toggleMultiSelect);
  const deleteSelected = useStore((s) => s.deleteSelected);

  const [showSummary, setShowSummary] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [showJump, setShowJump] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setQuery] = useState("");
  const [matchIdx, setMatchIdx] = useState(0);
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
  const agent = agents.find((a) => a.id === convo?.agentId);
  const chatRm = agent ? resolveModel("chat", models, providers, settings, agent.models) : null;
  const isStreamingHere = streamingConvoId === activeConvoId && !!activeConvoId;

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

  if (!convo || !agent) {
    const noAgents = agents.length === 0;
    return (
      <div className="empty-chat">
        <div className="big">🌸</div>
        <div className="t">{noAgents ? "还没有智能体" : "选择一个对话，开始聊天"}</div>
        <div style={{ fontSize: 13, marginBottom: 18 }}>
          {noAgents
            ? "先创建一个属于你的智能体吧"
            : window.innerWidth <= 768
              ? "点击底部「聊天」标签查看对话"
              : "从左侧列表中选择"}
        </div>
        {noAgents && (
          <button className="btn primary" onClick={() => useStore.getState().createAgent()}>
            创建智能体
          </button>
        )}
      </div>
    );
  }

  const chatModels = models.filter((m) => m.roles.includes("chat"));
  const providerName = (id: string) => providers.find((p) => p.id === id)?.name ?? "?";

  // greeting suggestions: conversation has only the greeting so far
  const showSuggests =
    messages.length === 1 &&
    messages[0].role === "assistant" &&
    !isStreamingHere &&
    agent.suggestions.length > 0;

  return (
    <>
      <header className="chat-head">
        <button className="back" onClick={() => setSidebar(true)} title="对话列表">
          <Icon name="back" />
        </button>
        <Avatar agent={agent} size={38} radius={12} />
        <div>
          <div className="title">{agent.name}</div>
          {chatRm ? (
            <Menu
              align="start"
              trigger={
                <button className="model-switch" title="切换对话模型">
                  <span className="sub">{chatRm.model.label}</span>
                  <Icon name="down" size={11} />
                </button>
              }
              items={[
                ...chatModels.slice(0, 12).map((m) => ({
                  label: `${m.label} · ${providerName(m.providerId)}`,
                  onClick: () =>
                    updateAgent(agent.id, { models: { ...agent.models, chat: m.id } }),
                })),
                ...(chatModels.length > 1
                  ? ([
                      "separator",
                      { label: "在设置中管理模型", icon: "settings" as const, onClick: () => useStore.getState().setView("settings") },
                    ] as const)
                  : []),
              ]}
            />
          ) : (
            <div
              className="sub"
              style={{ color: "#f59e0b", cursor: "pointer" }}
              onClick={() => useStore.getState().setView("settings")}
              title="点击前往设置"
            >
              ⚠ 未配置模型 · 点击设置
            </div>
          )}
        </div>
        <div className="spacer" />
        <TipFor text="搜索对话">
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
        <TipFor text="开始新对话">
          <button className="icon-btn" onClick={() => newConversation(agent.id)}>
            <Icon name="plus" />
          </button>
        </TipFor>
        <TipFor text="智能体设定">
          <button className="icon-btn" onClick={() => setEditing(agent.id)}>
            <Icon name="edit" />
          </button>
        </TipFor>
        <Menu
          trigger={
            <button className="icon-btn" title="更多">
              <Icon name="dots" />
            </button>
          }
          items={[
            { label: "导出为 Markdown", icon: "download", onClick: () => exportConversation(convo.id) },
            { label: "查看记忆摘要", icon: "book", onClick: () => setShowSummary(true) },
            { label: "多选消息", icon: "check", onClick: () => enterMultiSelect() },
            {
              label: "清空对话（保留记忆）",
              icon: "broom",
              onClick: () => {
                useStore
                  .getState()
                  .askConfirm({
                    title: "清空对话",
                    message: "清空这段对话的所有消息？\n智能体的长期记忆不受影响，清空后将从开场白重新开始。",
                    confirmText: "清空",
                    danger: true,
                  })
                  .then((ok) => ok && clearConversation(convo.id));
              },
            },
            "separator",
            {
              label: "删除对话",
              icon: "trash",
              danger: true,
              onClick: () => {
                useStore
                  .getState()
                  .askConfirm({
                    title: "删除对话",
                    message: `删除与「${agent.name}」的这段对话？\n智能体的长期记忆不受影响。`,
                    confirmText: "删除",
                    danger: true,
                  })
                  .then((ok) => ok && deleteConversation(convo.id));
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
            placeholder="在当前对话中搜索…"
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
          <button className="icon-btn" style={{ width: 28, height: 28 }} onClick={() => gotoMatch(-1)} title="上一个">
            <Icon name="back" size={14} />
          </button>
          <button className="icon-btn" style={{ width: 28, height: 28 }} onClick={() => gotoMatch(1)} title="下一个">
            <Icon name="down" size={14} />
          </button>
          <button
            className="icon-btn"
            style={{ width: 28, height: 28 }}
            onClick={() => {
              setSearchOpen(false);
              setQuery("");
            }}
            title="关闭"
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
            <div className="drop-inner">🖼️ 松开发送图片</div>
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
                    agent={agent}
                    isLast={i === messages.length - 1}
                    selectable={multiSelectActive}
                    selected={multiSelectIds.includes(m.id)}
                    onToggleSelect={() => toggleMultiSelect(m.id)}
                  />
                </div>
              </Fragment>
            );
          })}
          {isStreamingHere && (
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
              agent={agent}
              isLast
              streaming={streamText}
            />
          )}
          {showSuggests && (
            <div className="suggests" style={{ marginLeft: 47 }}>
              {agent.suggestions.map((s, i) => (
                <button key={i} className="suggest-chip" onClick={() => send(s)}>
                  {s}
                </button>
              ))}
            </div>
          )}
        </div>
        {showJump && !isStreamingHere && (
          <button className="jump-btn" onClick={jumpToBottom} title="回到底部">
            <Icon name="down" size={17} />
          </button>
        )}
      </div>

      <Composer />

      {multiSelectActive && (
        <div className="multiselect-bar">
          <span>
            已选 <b>{multiSelectIds.length}</b> 条
          </span>
          <div style={{ flex: 1 }} />
          <button className="btn sm ghost" onClick={exitMultiSelect}>
            取消
          </button>
          <button
            className="btn sm danger"
            disabled={!multiSelectIds.length}
            onClick={() => {
              useStore
                .getState()
                .askConfirm({
                  title: "批量删除",
                  message: `删除选中的 ${multiSelectIds.length} 条消息？\n智能体的长期记忆不受影响。`,
                  confirmText: "删除",
                  danger: true,
                })
                .then((ok) => ok && deleteSelected());
            }}
          >
            删除所选
          </button>
        </div>
      )}

      {showSummary && (
        <Modal title="本对话的记忆摘要" onClose={() => setShowSummary(false)}>
          <div className="summary-body">
            {convo.summary.trim() ? (
              convo.summary
            ) : (
              <span style={{ color: "var(--text-3)" }}>
                暂无摘要。对话进行一段时间后（约 20 轮以上），系统会自动把较早的内容压缩成摘要，作为智能体的记忆。
              </span>
            )}
          </div>
        </Modal>
      )}
    </>
  );
}

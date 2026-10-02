import { useEffect, useRef, Fragment } from "react";
import { useStore } from "../store";
import { resolveModel } from "../lib/utils";
import { Avatar, Icon, Menu, TipFor } from "./ui";
import MessageBubble from "./MessageBubble";
import Composer from "./Composer";

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

  const scrollRef = useRef<HTMLDivElement>(null);
  const stickBottom = useRef(true);

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
    stickBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 140;
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
          <div
            className="sub"
            style={{ color: chatRm ? undefined : "#f59e0b", cursor: chatRm ? "default" : "pointer" }}
            onClick={chatRm ? undefined : () => useStore.getState().setView("settings")}
            title={chatRm ? undefined : "点击前往设置"}
          >
            {chatRm ? chatRm.model.label : "⚠ 未配置模型 · 点击设置"}
          </div>
        </div>
        <div className="spacer" />
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
            { label: "清空对话（保留记忆）", icon: "broom", onClick: () => {
                if (confirm("清空这段对话的所有消息？智能体的长期记忆不受影响。")) clearConversation(convo.id);
              } },
            "separator",
            { label: "删除对话", icon: "trash", danger: true, onClick: () => {
                if (confirm(`删除与「${agent.name}」的这段对话？（记忆不受影响）`)) deleteConversation(convo.id);
              } },
          ]}
        />
      </header>
      <div className="chat-scroll" onScroll={onScroll} ref={scrollRef}>
        <div className="msg-list">
          {messages.map((m, i) => {
            const prev = messages[i - 1];
            const showDate = !prev || !isSameDay(prev.createdAt, m.createdAt);
            return (
              <Fragment key={m.id}>
                {showDate && <div className="date-chip">{dateLabel(m.createdAt)}</div>}
                <MessageBubble msg={m} agent={agent} isLast={i === messages.length - 1} />
              </Fragment>
            );
          })}
          {isStreamingHere && (
            <MessageBubble
              msg={{
                id: "streaming",
                conversationId: activeConvoId!,
                role: "assistant",
                content: "",
                createdAt: Date.now(),
              }}
              agent={agent}
              isLast
              streaming={streamText}
            />
          )}
          {showSuggests && (
            <div className="suggests" style={{ marginLeft: 44 }}>
              {agent.suggestions.map((s, i) => (
                <button key={i} className="suggest-chip" onClick={() => send(s)}>
                  {s}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <Composer />
    </>
  );
}

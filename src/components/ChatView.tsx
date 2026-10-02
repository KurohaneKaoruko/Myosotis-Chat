import { useEffect, useRef } from "react";
import { useStore } from "../store";
import { resolveModel } from "../lib/utils";
import { Avatar, Icon } from "./ui";
import MessageBubble from "./MessageBubble";
import Composer from "./Composer";

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
    return (
      <div className="empty-chat">
        <div className="big">🌸</div>
        <div className="t">选择一位伙伴，开始聊天</div>
        <div style={{ fontSize: 13 }}>
          {window.innerWidth <= 768 ? "点击底部「聊天」标签选择伙伴" : "从左侧「伙伴」列表中选择"}
        </div>
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
          <div className="sub" style={{ color: chatRm ? undefined : "var(--danger)" }}>
            {chatRm ? chatRm.model.label : "未配置模型"}
          </div>
        </div>
        <div className="spacer" />
        <button className="icon-btn" title="新对话" onClick={() => newConversation(agent.id)}>
          <Icon name="plus" />
        </button>
        <button className="icon-btn" title="伙伴设定" onClick={() => setEditing(agent.id)}>
          <Icon name="edit" />
        </button>
      </header>
      <div className="chat-scroll" onScroll={onScroll} ref={scrollRef}>
        <div className="msg-list">
          {messages.map((m, i) => (
            <MessageBubble key={m.id} msg={m} agent={agent} isLast={i === messages.length - 1} />
          ))}
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

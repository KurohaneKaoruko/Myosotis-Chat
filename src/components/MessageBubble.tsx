import { useState } from "react";
import type { Agent, ChatMessage } from "../types";
import { useStore } from "../store";
import { resolveModel, formatTime } from "../lib/utils";
import { speakBrowser, playTtsBlob, stopAudio } from "../lib/speech";
import { ttsSynthesize } from "../lib/api";
import { Icon } from "./ui";
import { t } from "../i18n";
import Markdown from "./Markdown";

export default function MessageBubble({
  msg,
  agent,
  isLast,
  streaming,
  selectable,
  selected,
  onToggleSelect,
}: {
  msg: ChatMessage;
  agent: Agent;
  isLast: boolean;
  streaming?: string;
  selectable?: boolean;
  selected?: boolean;
  onToggleSelect?: () => void;
}) {
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [speaking, setSpeaking] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState("");
  const settings = useStore((s) => s.settings);
  const models = useStore((s) => s.models);
  const providers = useStore((s) => s.providers);
  const regenerate = useStore((s) => s.regenerate);
  const deleteMessage = useStore((s) => s.deleteMessage);
  const editAndResend = useStore((s) => s.editAndResend);
  const setReplyTo = useStore((s) => s.setReplyTo);
  const showToast = useStore((s) => s.showToast);
  const isUser = msg.role === "user";
  const text = streaming ?? msg.content;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(msg.content);
      showToast(t("copied"), "success");
    } catch {
      showToast(t("copyFailed"), "error");
    }
  };

  const speak = async () => {
    if (speaking) {
      stopAudio();
      setSpeaking(false);
      return;
    }
    setSpeaking(true);
    try {
      if (settings.browserTts) {
        speakBrowser(msg.content, () => setSpeaking(false));
      } else {
        const rm = resolveModel("tts", models, providers, settings);
        if (!rm) {
          showToast(t("ttsNotConfigured"), "error");
          setSpeaking(false);
          return;
        }
        const blob = await ttsSynthesize(rm, msg.content.replace(/```[\s\S]*?```/g, "…").slice(0, 800));
        await playTtsBlob(blob);
        setSpeaking(false);
      }
    } catch (e: any) {
      setSpeaking(false);
      showToast(`${t("speakFailed")}: ${e?.message ?? e}`, "error");
    }
  };

  return (
    <div
      className={`msg ${isUser ? "user" : "ai"} ${msg.status === "error" ? "error" : ""} ${selectable ? "selectable" : ""} ${selected ? "selected" : ""}`}
      onClick={selectable ? onToggleSelect : undefined}
    >
      {isUser ? (
        <div className="ava user-ava">{settings.userName?.trim()?.slice(0, 1) || t("me")}</div>
      ) : (
        <div
          className="ava"
          style={{
            background: `linear-gradient(135deg, hsl(${agent.hue} 70% 55%), hsl(${(agent.hue + 40) % 360} 70% 45%))`,
          }}
        >
          {agent.emoji}
        </div>
      )}
      <div className="body">
        {selectable && (
          <div className={`checkbox ${selected ? "on" : ""}`} style={{ marginBottom: 4 }}>
            {selected && "✓"}
          </div>
        )}
        {!!msg.images?.length && (
          <div className="images">
            {msg.images.map((img, i) => (
              <img key={i} src={img} alt="" onClick={() => setLightbox(img)} />
            ))}
          </div>
        )}
        <div className={`bubble ${!isUser && !streaming ? "md" : ""}`}>
          {msg.replyTo && !editing && (
            <div className="reply-quote">
              <Icon name="chat" size={12} />
              <span>
                {msg.replyTo.role === "user" ? t("quoteSelf") : t("quoteAi")}：{msg.replyTo.content.slice(0, 80)}
                {msg.replyTo.content.length > 80 ? "…" : ""}
              </span>
            </div>
          )}
          {editing ? (
            <div className="edit-box">
              <textarea
                className="input"
                value={editText}
                onChange={(e) => setEditText(e.target.value)}
                rows={3}
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                    editAndResend(msg.id, editText);
                  }
                }}
              />
              <div className="edit-ops">
                <button className="btn sm ghost" onClick={() => setEditing(false)}>
                  {t("commonCancel")}
                </button>
                <button className="btn sm primary" onClick={() => editAndResend(msg.id, editText)}>
                  {t("saveResend")}
                </button>
              </div>
            </div>
          ) : streaming !== undefined && !text.trim() ? (
            <span className="typing">
              <i />
              <i />
              <i />
            </span>
          ) : !isUser && streaming === undefined ? (
            <Markdown text={text} />
          ) : (
            <>
              {text}
              {streaming !== undefined && <span className="cursor" />}
            </>
          )}
        </div>
        {streaming === undefined && !editing && (
          <div className="acts" style={isUser ? { justifyContent: "flex-end" } : undefined}>
            <span className="time">{formatTime(msg.createdAt)}</span>
            <button onClick={copy} title={t("copy")}>
              <Icon name="copy" size={12} /> {t("copy")}
            </button>
            {!isUser && (
              <button onClick={speak} title={speaking ? t("stopSpeak") : t("speak")}>
                <Icon name="speaker" size={12} /> {speaking ? t("stopSpeak") : t("speak")}
              </button>
            )}
            {!isUser && isLast && msg.status === "error" && (
              <button onClick={() => regenerate()} title={t("retry")}>
                <Icon name="refresh" size={12} /> {t("retry")}
              </button>
            )}
            {!isUser && isLast && msg.status !== "error" && (
              <button onClick={() => regenerate()} title={t("rewrite")}>
                <Icon name="refresh" size={12} /> {t("rewrite")}
              </button>
            )}
            <button
              title={t("quote")}
              onClick={() => setReplyTo({ role: msg.role, content: msg.content })}
            >
              <Icon name="chat" size={12} /> {t("quote")}
            </button>
            {isUser && (
              <button
                title={t("editResend")}
                onClick={() => {
                  setEditText(msg.content);
                  setEditing(true);
                }}
              >
                <Icon name="edit" size={12} /> {t("editMsg")}
              </button>
            )}
            <button
              title={t("deleteMsg")}
              onClick={() => {
                useStore
                  .getState()
                  .askConfirm({ title: t("deleteMsgTitle"), message: t("deleteMsgBody"), confirmText: t("commonDelete"), danger: true })
                  .then((ok) => { if (ok) deleteMessage(msg.id); });
              }}
            >
              <Icon name="trash" size={12} /> {t("deleteMsg")}
            </button>
          </div>
        )}
      </div>
      {lightbox && <div className="lightbox" onClick={() => setLightbox(null)}><img src={lightbox} alt="" /></div>}
    </div>
  );
}

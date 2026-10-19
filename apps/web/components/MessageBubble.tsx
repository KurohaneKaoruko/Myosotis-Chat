import { useEffect, useRef, useState } from "react";
import type { Agent, ChatMessage } from "@myosotis/core";
import { useStore } from "../store";
import { resolveModel, formatTime } from "@myosotis/core";
import { speakBrowser, playTtsBlob, stopAudio } from "../lib/speech";
import { ttsSynthesize } from "@myosotis/core";
import { Icon } from "./ui";
import { t } from "../i18n";
import Markdown from "./Markdown";

// ================================================================
// One chat message.
//
// Chat-app feel requirements handled here:
//  * long-press (touch) / right-click opens the action sheet — hover
//    doesn't exist on phones
//  * streaming bubble renders a live "typing" caret
//  * compact timestamp inside the action sheet, quiet by default
// ================================================================

/** minimum press duration (ms) before we treat a touch as long-press */
const LONG_PRESS_MS = 420;

export default function MessageBubble({
  msg,
  agent,
  isLast,
  streaming,
  selectable,
  selected,
  onToggleSelect,
  showName,
  /** consecutive message from the same sender: hide the avatar row */
  grouped,
}: {
  msg: ChatMessage;
  agent: Agent;
  isLast: boolean;
  streaming?: string;
  selectable?: boolean;
  selected?: boolean;
  onToggleSelect?: () => void;
  /** group chat: label the bubble with the speaking agent's name */
  showName?: boolean;
  /** chat-app style grouping: consecutive same-sender message */
  grouped?: boolean;
}) {
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [speaking, setSpeaking] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState("");
  const [sheetOpen, setSheetOpen] = useState(false);
  const settings = useStore((s) => s.settings);
  const models = useStore((s) => s.models);
  const providers = useStore((s) => s.providers);
  const regenerate = useStore((s) => s.regenerate);
  const deleteMessage = useStore((s) => s.deleteMessage);
  const editAndResend = useStore((s) => s.editAndResend);
  const retryMessage = useStore((s) => s.retryMessage);
  const setReplyTo = useStore((s) => s.setReplyTo);
  const showToast = useStore((s) => s.showToast);
  const isUser = msg.role === "user";
  const text = streaming ?? msg.content;

  const pressTimer = useRef<number | null>(null);
  const pressMoved = useRef(false);

  // close the action sheet on outside tap
  useEffect(() => {
    if (!sheetOpen) return;
    const close = (e: PointerEvent) => {
      if (!(e.target as HTMLElement).closest?.(".msg-sheet, .bubble")) setSheetOpen(false);
    };
    // capture phase: run before the tap does anything else
    document.addEventListener("pointerdown", close, true);
    return () => document.removeEventListener("pointerdown", close, true);
  }, [sheetOpen]);

  const armLongPress = () => {
    if (selectable || editing) return;
    pressMoved.current = false;
    pressTimer.current = window.setTimeout(() => {
      if (!pressMoved.current) {
        setSheetOpen(true);
        if (navigator.vibrate) navigator.vibrate(12);
      }
    }, LONG_PRESS_MS);
  };
  const disarmLongPress = () => {
    if (pressTimer.current) {
      clearTimeout(pressTimer.current);
      pressTimer.current = null;
    }
  };

  // story-mode narration (opening story): italic, no actions, never selectable chrome
  if (msg.kind === "narrative" && streaming === undefined) {
    return (
      <div className="msg ai">
        <div className="body">
          <div className="bubble narrative">{msg.content}</div>
        </div>
      </div>
    );
  }

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

  // ---- action list, shared between hover strip and touch sheet ----
  const actions: Array<{ key: string; label: string; icon: any; danger?: boolean; run: () => void }> = [
    { key: "copy", label: t("copy"), icon: "copy", run: copy },
  ];
  if (!isUser) {
    actions.push({ key: "speak", label: speaking ? t("stopSpeak") : t("speak"), icon: "speaker", run: speak });
    actions.push({
      key: "regen",
      label: isLast ? (msg.status === "error" ? t("retry") : t("rewrite")) : t("rewrite"),
      icon: "refresh",
      run: () => regenerate(),
    });
  }
  actions.push({
    key: "quote",
    label: t("quote"),
    icon: "chat",
    run: () => setReplyTo({ role: msg.role, content: msg.content }),
  });
  if (isUser) {
    actions.push({
      key: "edit",
      label: t("editMsg"),
      icon: "edit",
      run: () => {
        setEditText(msg.content);
        setEditing(true);
      },
    });
  }
  actions.push({
    key: "delete",
    label: t("deleteMsg"),
    icon: "trash",
    danger: true,
    run: () => {
      useStore
        .getState()
        .askConfirm({ title: t("deleteMsgTitle"), message: t("deleteMsgBody"), confirmText: t("commonDelete"), danger: true })
        .then((ok) => {
          if (ok) deleteMessage(msg.id);
        });
    },
  });

  const doAction = (a: (typeof actions)[number]) => {
    setSheetOpen(false);
    a.run();
  };

  const streamingNow = streaming !== undefined;

  return (
    <div
      className={[
        "msg",
        isUser ? "user" : "ai",
        msg.status === "error" ? "error" : "",
        selectable ? "selectable" : "",
        selected ? "selected" : "",
        grouped ? "grouped" : "",
        sheetOpen ? "sheet-open" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      onClick={selectable ? onToggleSelect : undefined}
      onTouchStart={armLongPress}
      onTouchMove={() => {
        pressMoved.current = true;
        disarmLongPress();
      }}
      onTouchEnd={disarmLongPress}
      onContextMenu={(e) => {
        // desktop right-click = the same sheet (nice symmetry, native feel)
        if (!selectable && !editing) {
          e.preventDefault();
          setSheetOpen(true);
        }
      }}
    >
      {!(grouped && !showName) &&
        (isUser ? (
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
        ))}
      <div className="body">
        {!isUser && showName && <div className="msg-name">{agent.name}</div>}
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
        <div className={`bubble ${!isUser && !streaming ? "md" : ""} ${isUser && msg.status === "sending" ? "sending" : ""} ${isUser && msg.status === "error" ? "failed" : ""}`}>
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
                  {t("editResend")}
                </button>
              </div>
            </div>
          ) : isUser || streamingNow ? (
            <>
              <span className="msg-text">{text}</span>
              {streamingNow && <span className="type-caret" aria-hidden />}
            </>
          ) : (
            <Markdown text={msg.content} />
          )}
        </div>

        {/* delivery status: sending spinner / failed retry */}
        {isUser && (msg.status === "sending" || msg.status === "error") && (
          <div className={`msg-status ${msg.status}`}>
            {msg.status === "sending" ? (
              <span className="status-spinner" aria-label={t("sending")} />
            ) : (
              <button className="status-retry" onClick={() => retryMessage(msg.id)} title={t("resendFailed")}>
                <Icon name="refresh" size={13} />
                <span>{t("resendFailed")}</span>
              </button>
            )}
          </div>
        )}

        {/* desktop hover strip (pointer devices only — touch uses the sheet) */}
        {streaming === undefined && !editing && (
          <div className="acts" style={isUser ? { justifyContent: "flex-end" } : undefined}>
            <span className="time">{formatTime(msg.createdAt)}</span>
            {actions
              .filter((a) => a.key !== "delete")
              .map((a) => (
                <button key={a.key} onClick={a.run} title={a.label}>
                  <Icon name={a.icon} size={12} /> {a.label}
                </button>
              ))}
            <button
              title={t("deleteMsg")}
              onClick={actions.find((a) => a.key === "delete")!.run}
            >
              <Icon name="trash" size={12} /> {t("deleteMsg")}
            </button>
          </div>
        )}

        {/* quiet timestamp for grouped/compact view */}
        {streaming === undefined && grouped && !editing && (
          <div className={`time-float ${isUser ? "right" : ""}`}>{formatTime(msg.createdAt)}</div>
        )}
      </div>

      {/* touch / right-click action sheet */}
      {sheetOpen && (
        <div className="msg-sheet">
          <div className="sheet-time">
            {new Date(msg.createdAt).toLocaleString(undefined, {
              month: "numeric",
              day: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            })}
          </div>
          {actions.map((a) => (
            <button key={a.key} className={a.danger ? "danger" : ""} onClick={() => doAction(a)}>
              <Icon name={a.icon} size={15} />
              {a.label}
            </button>
          ))}
        </div>
      )}

      {lightbox && (
        <div className="lightbox" onClick={() => setLightbox(null)}>
          <img src={lightbox} alt="" />
        </div>
      )}
    </div>
  );
}

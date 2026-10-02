import { useState } from "react";
import type { Agent, ChatMessage } from "../types";
import { useStore } from "../store";
import { resolveModel, formatTime } from "../lib/utils";
import { speakBrowser, playTtsBlob, stopAudio } from "../lib/speech";
import { ttsSynthesize } from "../lib/api";
import { Icon } from "./ui";
import Markdown from "./Markdown";

export default function MessageBubble({
  msg,
  agent,
  isLast,
  streaming,
}: {
  msg: ChatMessage;
  agent: Agent;
  isLast: boolean;
  streaming?: string;
}) {
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [speaking, setSpeaking] = useState(false);
  const settings = useStore((s) => s.settings);
  const models = useStore((s) => s.models);
  const providers = useStore((s) => s.providers);
  const regenerate = useStore((s) => s.regenerate);
  const showToast = useStore((s) => s.showToast);
  const isUser = msg.role === "user";
  const text = streaming ?? msg.content;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(msg.content);
      showToast("已复制", "success");
    } catch {
      showToast("复制失败", "error");
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
          showToast("未配置语音合成模型，可在「设置 → 语音」开启系统朗读", "error");
          setSpeaking(false);
          return;
        }
        const blob = await ttsSynthesize(rm, msg.content.replace(/```[\s\S]*?```/g, "代码略").slice(0, 800));
        await playTtsBlob(blob);
        setSpeaking(false);
      }
    } catch (e: any) {
      setSpeaking(false);
      showToast(`朗读失败：${e?.message ?? e}`, "error");
    }
  };

  return (
    <div className={`msg ${isUser ? "user" : "ai"} ${msg.status === "error" ? "error" : ""}`}>
      {isUser ? (
        <div className="ava user-ava">{settings.userName?.trim()?.slice(0, 1) || "我"}</div>
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
        {!!msg.images?.length && (
          <div className="images">
            {msg.images.map((img, i) => (
              <img key={i} src={img} alt="" onClick={() => setLightbox(img)} />
            ))}
          </div>
        )}
        <div className={`bubble ${!isUser && !streaming ? "md" : ""}`}>
          {streaming !== undefined && !text.trim() ? (
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
        {streaming === undefined && (
          <div className="acts" style={isUser ? { justifyContent: "flex-end" } : undefined}>
            <span className="time">{formatTime(msg.createdAt)}</span>
            <button onClick={copy} title="复制">
              <Icon name="copy" size={12} /> 复制
            </button>
            {!isUser && (
              <button onClick={speak} title={speaking ? "停止朗读" : "朗读"}>
                <Icon name="speaker" size={12} /> {speaking ? "停止" : "朗读"}
              </button>
            )}
            {!isUser && isLast && msg.status !== "error" && (
              <button onClick={() => regenerate()} title="重新生成">
                <Icon name="refresh" size={12} /> 重写
              </button>
            )}
          </div>
        )}
      </div>
      {lightbox && <div className="lightbox" onClick={() => setLightbox(null)}><img src={lightbox} alt="" /></div>}
    </div>
  );
}

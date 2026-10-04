import { useEffect, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { useStore } from "../store";
import { Icon } from "./ui";
import { SttSession, sttSupported, speakSmart, stopAudio } from "../lib/speech";
import { sttTranscribe } from "../lib/api";
import { db } from "../lib/db";
import { resolveModel } from "../lib/utils";
import { t } from "../i18n";

const MAX_IMG_SIDE = 1024;

export async function fileToCompressedDataUrl(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => {
      const im = new Image();
      im.onload = () => res(im);
      im.onerror = rej;
      im.src = url;
    });
    const scale = Math.min(1, MAX_IMG_SIDE / Math.max(img.width, img.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.86);
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function filesToDataUrls(files: File[]): Promise<string[]> {
  const urls: string[] = [];
  for (const f of files.slice(0, 4)) {
    if (!f.type.startsWith("image/")) continue;
    try {
      urls.push(await fileToCompressedDataUrl(f));
    } catch {}
  }
  return urls;
}

export default function Composer() {
  const [text, setText] = useState("");
  const [images, setImages] = useState<string[]>([]);
  const [listening, setListening] = useState(false);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const sttRef = useRef<SttSession | null>(null);
  const baseTextRef = useRef("");
  const recRef = useRef<{ recorder: MediaRecorder; chunks: Blob[] } | null>(null);
  const voiceChatRef = useRef(false);
  const interruptRef = useRef<SttSession | null>(null);
  const prevStreamingRef = useRef(false);

  const streamingConvoId = useStore((s) => s.streamingConvoId);
  const activeConvoId = useStore((s) => s.activeConvoId);
  const settings = useStore((s) => s.settings);
  const models = useStore((s) => s.models);
  const providers = useStore((s) => s.providers);
  const replyTo = useStore((s) => s.replyTo);
  const setReplyTo = useStore((s) => s.setReplyTo);
  const pendingImages = useStore((s) => s.pendingImages);
  const consumePendingImages = useStore((s) => s.consumePendingImages);
  const send = useStore((s) => s.send);
  const stop = useStore((s) => s.stop);
  const showToast = useStore((s) => s.showToast);
  const messages = useStore((s) => s.messages);
  const streamingNow = useStore((s) => s.streamingConvoId) !== null;
  const [voiceChat, setVoiceChat] = useState(false);

  const prompts = useLiveQuery(() => db.prompts.toArray(), []) ?? [];
  const slashQuery = text.startsWith("/") && !text.includes("\n") ? text.slice(1).toLowerCase() : null;
  const promptMatches =
    slashQuery !== null
      ? prompts.filter((p) => p.trigger.toLowerCase().startsWith(slashQuery)).slice(0, 6)
      : [];

  const busy = !!streamingConvoId;
  const hasVision = !!resolveModel("vision", models, providers, settings);
  const cloudStt = !settings.browserStt && !!resolveModel("stt", models, providers, settings);
  const sttAvailable = settings.browserStt ? sttSupported() : cloudStt || sttSupported();

  useEffect(() => {
    // auto-grow textarea
    const ta = taRef.current;
    if (ta) {
      ta.style.height = "0px";
      ta.style.height = Math.min(160, Math.max(28, ta.scrollHeight)) + "px";
    }
  }, [text]);

  // images dropped onto the chat area land here
  useEffect(() => {
    if (pendingImages.length) {
      setImages((prev) => [...prev, ...pendingImages].slice(0, 4));
      consumePendingImages();
    }
  }, [pendingImages, consumePendingImages]);

  const doSend = () => {
    if (busy || !activeConvoId) return;
    const t = text.trim();
    if (!t && !images.length) return;
    send(t, images.length ? images : undefined, replyTo ?? undefined);
    setText("");
    setImages([]);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey && settings.sendOnEnter && !e.nativeEvent.isComposing) {
      e.preventDefault();
      doSend();
    }
  };

  const onPaste = async (e: React.ClipboardEvent) => {
    const files = Array.from(e.clipboardData.files || []).filter((f) => f.type.startsWith("image/"));
    if (!files.length) return;
    e.preventDefault();
    const urls = await filesToDataUrls(files);
    if (urls.length) setImages((prev) => [...prev, ...urls].slice(0, 4));
  };

  const pickImages = async (files: FileList | null) => {
    if (!files?.length) return;
    const urls = await filesToDataUrls(Array.from(files));
    setImages((prev) => [...prev, ...urls].slice(0, 4));
    if (fileRef.current) fileRef.current.value = "";
  };

  // ---------------- voice input & continuous voice chat ----------------
  const stopListening = () => {
    sttRef.current?.stop();
    sttRef.current = null;
    if (recRef.current) {
      try {
        recRef.current.recorder.stop();
      } catch {}
      recRef.current = null;
    }
    setListening(false);
  };

  const stopInterruptListener = () => {
    interruptRef.current?.stop();
    interruptRef.current = null;
  };

  // while the reply is being spoken, listen for the user's voice to interrupt
  const startInterruptListener = () => {
    if (!sttSupported()) return;
    const s = new SttSession();
    interruptRef.current = s;
    let fired = false;
    s.start(
      () => {
        if (fired) return;
        fired = true;
        stopAudio();
        stopInterruptListener();
        if (voiceChatRef.current) startListening();
      },
      () => {},
      () => {
        interruptRef.current = null;
      }
    );
  };

  const resumeVoiceChatAfterReply = () => {
    if (voiceChatRef.current && !interruptRef.current) startListening();
  };

  const startListening = async () => {
    if (listening) {
      stopListening();
      return;
    }
    baseTextRef.current = text;
    // prefer browser STT (free, instant)
    if (settings.browserStt && sttSupported()) {
      const session = new SttSession();
      sttRef.current = session;
      setListening(true);
      session.start(
        (partial) => {
          setText((baseTextRef.current + " " + partial).trim());
          stopAudio(); // speaking? the user wants to interrupt
        },
        (finalT) => {
          if (voiceChatRef.current) {
            // continuous mode: send right away, reply is spoken when ready
            stopListening();
            send(finalT.trim());
            return;
          }
          baseTextRef.current = (baseTextRef.current + " " + finalT).trim();
          setText(baseTextRef.current);
        },
        (err) => {
          showToast(err, "error");
          stopListening();
        }
      );
      return;
    }
    // fallback: record and transcribe with cloud model
    const rm = resolveModel("stt", models, providers, settings);
    if (!rm) {
      showToast(t("visionMissingToast"), "error");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      const chunks: Blob[] = [];
      recorder.ondataavailable = (e) => chunks.push(e.data);
      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunks, { type: chunks[0]?.type || "audio/webm" });
        showToast(t("transcribing"));
        try {
          const t = await sttTranscribe(rm, blob);
          if (t) {
            if (voiceChatRef.current) {
              stopListening();
              send(t.trim());
            } else {
              setText((prev) => (prev ? prev + " " + t : t));
            }
          }
        } catch (e: any) {
          showToast(`${t("sttFailed")}${e?.message ?? e}`, "error");
        }
      };
      recRef.current = { recorder, chunks };
      recorder.start();
      setListening(true);
    } catch {
      showToast(t("micDenied"), "error");
    }
  };

  // ---------------- continuous voice chat mode ----------------
  const toggleVoiceChat = () => {
    if (voiceChat) {
      voiceChatRef.current = false;
      setVoiceChat(false);
      stopListening();
      stopInterruptListener();
      stopAudio();
      return;
    }
    if (!activeConvoId) return;
    voiceChatRef.current = true;
    setVoiceChat(true);
    startListening();
  };

  // generation finished → speak the reply, then resume listening
  useEffect(() => {
    if (!voiceChat) {
      prevStreamingRef.current = streamingNow;
      return;
    }
    if (prevStreamingRef.current && !streamingNow) {
      const lastAi = [...messages].reverse().find((m) => m.role === "assistant" && m.status === "ok");
      if (lastAi) {
        speakSmart(lastAi.content, {
          settings,
          models,
          providers,
          onDone: resumeVoiceChatAfterReply,
        });
        startInterruptListener();
      } else {
        resumeVoiceChatAfterReply();
      }
    }
    prevStreamingRef.current = streamingNow;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [streamingNow, voiceChat]);

  return (
    <div className="composer-wrap">
      <div className="composer">
        <button
          className="tool"
          title={hasVision ? t("sendImg") : t("noVision")}
          onClick={() => hasVision && fileRef.current?.click()}
          style={{ opacity: hasVision ? 1 : 0.4, cursor: hasVision ? "pointer" : "not-allowed" }}
        >
          <Icon name="image" />
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(e) => pickImages(e.target.files)}
        />
        <div className="inner">
          {replyTo && (
            <div className="reply-bar">
              <Icon name="chat" size={13} />
              <span className="reply-text">
                {replyTo.role === "user" ? t("quoteBarSelf") : t("quoteBarAi")}
                {replyTo.content.slice(0, 60)}
                {replyTo.content.length > 60 ? "…" : ""}
              </span>
              <button className="reply-x" onClick={() => setReplyTo(null)}>
                <Icon name="x" size={11} />
              </button>
            </div>
          )}
          {voiceChat && (
            <div className="voice-chat-bar">
              <span className="typing">
                <i />
                <i />
                <i />
              </span>
              <span>{t("voiceChatBar")}</span>
            </div>
          )}
          {promptMatches.length > 0 && (
            <div className="prompt-pop">
              {promptMatches.map((p) => (
                <button
                  key={p.id}
                  className="prompt-item"
                  onClick={() => {
                    setText(p.content);
                    taRef.current?.focus();
                  }}
                >
                  <b>/{p.trigger}</b>
                  <span>{p.content.slice(0, 50)}</span>
                </button>
              ))}
            </div>
          )}
          {images.length > 0 && (
            <div className="img-previews">
              {images.map((img, i) => (
                <div className="ip" key={i}>
                  <img src={img} alt="" />
                  <button className="rm" onClick={() => setImages(images.filter((_, j) => j !== i))}>
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}
          <textarea
            ref={taRef}
            rows={1}
            placeholder={listening ? t("listening") : t("inputPh")}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKeyDown}
            onPaste={onPaste}
            disabled={!activeConvoId}
          />
        </div>
        <button
          className={`tool ${voiceChat ? "active" : ""}`}
          title={voiceChat ? t("voiceModeOn") : t("voiceModeTip")}
          onClick={toggleVoiceChat}
        >
          <Icon name="headphones" />
        </button>
        <button
          className={`tool ${listening ? "active" : ""}`}
          title={sttAvailable ? (listening ? t("sttOn") : t("sttOff")) : t("sttUnavailable")}
          onClick={sttAvailable ? startListening : () => showToast(t("sttNoSupport"), "error")}
          style={{ opacity: sttAvailable ? 1 : 0.4 }}
        >
          <Icon name="mic" />
        </button>
        {busy ? (
          <button className="send" title={t("stopGen")} onClick={stop}>
            <Icon name="stop" />
          </button>
        ) : (
          <button className="send" title={t("send")} onClick={doSend} disabled={(!text.trim() && !images.length) || !activeConvoId}>
            <Icon name="send" />
          </button>
        )}
      </div>
    </div>
  );
}

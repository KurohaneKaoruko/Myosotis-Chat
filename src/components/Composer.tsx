import { useEffect, useRef, useState } from "react";
import { useStore } from "../store";
import { Icon } from "./ui";
import { SttSession, sttSupported } from "../lib/speech";
import { sttTranscribe } from "../lib/api";
import { resolveModel } from "../lib/utils";

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

  // ---------------- voice input ----------------
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
        (partial) => setText((baseTextRef.current + " " + partial).trim()),
        (finalT) => {
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
      showToast("语音输入不可用：可在设置中开启系统识别，或配置语音转文字模型", "error");
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
        showToast("正在识别语音…");
        try {
          const t = await sttTranscribe(rm, blob);
          if (t) setText((prev) => (prev ? prev + " " + t : t));
        } catch (e: any) {
          showToast(`语音识别失败：${e?.message ?? e}`, "error");
        }
      };
      recRef.current = { recorder, chunks };
      recorder.start();
      setListening(true);
    } catch {
      showToast("无法访问麦克风，请检查系统权限", "error");
    }
  };

  return (
    <div className="composer-wrap">
      <div className="composer">
        <button
          className="tool"
          title={hasVision ? "发送图片（需要看图模型）" : "尚未配置看图模型，图片功能不可用"}
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
                引用 {replyTo.role === "user" ? "自己" : "AI"}：{replyTo.content.slice(0, 60)}
                {replyTo.content.length > 60 ? "…" : ""}
              </span>
              <button className="reply-x" onClick={() => setReplyTo(null)}>
                <Icon name="x" size={11} />
              </button>
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
            placeholder={listening ? "正在听你说…" : "输入消息，可粘贴/拖入图片…"}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKeyDown}
            onPaste={onPaste}
            disabled={!activeConvoId}
          />
        </div>
        <button
          className={`tool ${listening ? "active" : ""}`}
          title={sttAvailable ? (listening ? "停止识别" : "语音输入") : "语音输入不可用"}
          onClick={sttAvailable ? startListening : () => showToast("语音输入不可用：浏览器不支持且未配置识别模型", "error")}
          style={{ opacity: sttAvailable ? 1 : 0.4 }}
        >
          <Icon name="mic" />
        </button>
        {busy ? (
          <button className="send" title="停止生成" onClick={stop}>
            <Icon name="stop" />
          </button>
        ) : (
          <button className="send" title="发送" onClick={doSend} disabled={(!text.trim() && !images.length) || !activeConvoId}>
            <Icon name="send" />
          </button>
        )}
      </div>
    </div>
  );
}

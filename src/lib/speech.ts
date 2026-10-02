// ================================================================
// Browser-native speech: zero-config fallback for TTS & STT.
// Cloud models (OpenAI-compatible) can be configured in settings.
// ================================================================

export function ttsSupported(): boolean {
  return typeof speechSynthesis !== "undefined";
}

export function speakBrowser(text: string, onEnd?: () => void): void {
  if (!ttsSupported()) return;
  speechSynthesis.cancel();
  // strip markdown for nicer reading
  const clean = text
    .replace(/```[\s\S]*?```/g, "（代码略）")
    .replace(/[*_#>`~\[\]()]/g, "")
    .trim();
  if (!clean) return;
  const u = new SpeechSynthesisUtterance(clean);
  u.lang = "zh-CN";
  u.rate = 1;
  const voices = speechSynthesis.getVoices();
  const zh = voices.find((v) => /zh[-_]CN/i.test(v.lang));
  if (zh) u.voice = zh;
  if (onEnd) u.onend = () => onEnd();
  speechSynthesis.speak(u);
}

export function stopSpeak(): void {
  if (ttsSupported()) speechSynthesis.cancel();
}

// ----------------------------------------------------------------
// Speech recognition (Chrome/Edge/Safari)
// ----------------------------------------------------------------
function getRecognitionCtor(): any {
  const w = window as any;
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}

export function sttSupported(): boolean {
  return !!getRecognitionCtor();
}

export class SttSession {
  private rec: any = null;
  private manualStop = false;

  start(onPartial: (t: string) => void, onFinal: (t: string) => void, onError: (e: string) => void): void {
    const Ctor = getRecognitionCtor();
    if (!Ctor) {
      onError("当前环境不支持语音识别，可在设置中配置语音转文字模型");
      return;
    }
    this.stop();
    this.manualStop = false;
    const rec = new Ctor();
    rec.lang = "zh-CN";
    rec.continuous = true;
    rec.interimResults = true;
    rec.onresult = (ev: any) => {
      let interim = "";
      let final = "";
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const r = ev.results[i];
        if (r.isFinal) final += r[0].transcript;
        else interim += r[0].transcript;
      }
      if (interim) onPartial(interim);
      if (final) onFinal(final);
    };
    rec.onerror = (ev: any) => {
      const err = ev?.error ?? "unknown";
      if (err === "no-speech") return;
      if (err === "aborted" && this.manualStop) return;
      onError(err === "not-allowed" ? "麦克风权限被拒绝，请在系统设置中允许" : `语音识别错误: ${err}`);
    };
    rec.onend = () => {
      // auto restart to keep a continuous session until user stops
      if (!this.manualStop && this.rec === rec) {
        try {
          rec.start();
        } catch {}
      }
    };
    this.rec = rec;
    try {
      rec.start();
    } catch (e) {
      onError(String(e));
    }
  }

  stop(): void {
    this.manualStop = true;
    if (this.rec) {
      try {
        this.rec.stop();
      } catch {}
      this.rec = null;
    }
  }

  get active(): boolean {
    return !!this.rec && !this.manualStop;
  }
}

// ----------------------------------------------------------------
// Audio playback helper for cloud TTS blobs
// ----------------------------------------------------------------
let currentAudio: HTMLAudioElement | null = null;

export async function playTtsBlob(blob: Blob): Promise<void> {
  stopAudio();
  const url = URL.createObjectURL(blob);
  const audio = new Audio(url);
  currentAudio = audio;
  audio.onended = () => {
    URL.revokeObjectURL(url);
    currentAudio = null;
  };
  await audio.play();
}

export function stopAudio(): void {
  if (currentAudio) {
    currentAudio.pause();
    currentAudio = null;
  }
  stopSpeak();
}

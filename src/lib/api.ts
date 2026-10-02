import type { Provider, ResolvedModel } from "../types";
import { trimUrl } from "./utils";

// ================================================================
// Unified multi-protocol model client (OpenAI / Anthropic / Gemini)
// All requests go straight from the app to the provider, no server.
// ================================================================

export interface ApiMessage {
  role: "system" | "user" | "assistant";
  text: string;
  images?: string[]; // data urls
}

export interface ChatOptions {
  onDelta?: (text: string) => void;
  signal?: AbortSignal;
  temperature?: number;
  maxTokens?: number;
}

function authHeaders(p: Provider): Record<string, string> {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (p.protocol === "openai") {
    if (p.apiKey) h["Authorization"] = `Bearer ${p.apiKey}`;
  } else if (p.protocol === "anthropic") {
    h["x-api-key"] = p.apiKey;
    h["anthropic-version"] = "2023-06-01";
    // allow direct browser calls
    h["anthropic-dangerous-direct-browser-access"] = "true";
  } else if (p.protocol === "gemini") {
    if (p.apiKey) h["x-goog-api-key"] = p.apiKey;
  }
  return h;
}

async function readError(res: Response): Promise<never> {
  let detail = "";
  try {
    const body = await res.text();
    try {
      const j = JSON.parse(body);
      detail = j?.error?.message ?? j?.error?.msg ?? j?.message ?? body;
    } catch {
      detail = body;
    }
  } catch {}
  const e = new Error(`${res.status} ${detail || res.statusText}`) as Error & { status?: number };
  e.status = res.status;
  throw e;
}

/** Iterate `data:` payloads of an SSE stream. */
async function* sseData(res: Response, signal?: AbortSignal): AsyncGenerator<string> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  try {
    while (true) {
      if (signal?.aborted) throw new DOMException("aborted", "AbortError");
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, idx).trim();
        buf = buf.slice(idx + 1);
        if (line.startsWith("data:")) yield line.slice(5).trim();
      }
    }
    const rest = buf.trim();
    if (rest.startsWith("data:")) yield rest.slice(5).trim();
  } finally {
    try {
      reader.releaseLock();
    } catch {}
  }
}

function splitDataUrl(dataUrl: string): { mime: string; data: string } {
  const m = /^data:([^;]+);base64,(.*)$/.exec(dataUrl);
  if (!m) throw new Error("图片格式无法解析");
  return { mime: m[1], data: m[2] };
}

// ----------------------------------------------------------------
// Request body builders
// ----------------------------------------------------------------
function buildOpenAIMessages(messages: ApiMessage[]) {
  return messages.map((m) => {
    if (m.images?.length && m.role === "user") {
      const content: any[] = [];
      if (m.text) content.push({ type: "text", text: m.text });
      for (const img of m.images) content.push({ type: "image_url", image_url: { url: img } });
      return { role: m.role, content };
    }
    return { role: m.role, content: m.text };
  });
}

function buildAnthropicBody(messages: ApiMessage[], model: string, opts: ChatOptions, stream: boolean) {
  const system = messages
    .filter((m) => m.role === "system")
    .map((m) => m.text)
    .join("\n\n");
  const rest = messages
    .filter((m) => m.role !== "system")
    .map((m) => {
      if (m.images?.length && m.role === "user") {
        const content: any[] = [];
        if (m.text) content.push({ type: "text", text: m.text });
        for (const img of m.images) {
          const { mime, data } = splitDataUrl(img);
          content.push({ type: "image", source: { type: "base64", media_type: mime, data } });
        }
        return { role: m.role, content };
      }
      return { role: m.role, content: m.text };
    });
  const body: any = {
    model,
    messages: rest,
    max_tokens: opts.maxTokens ?? 4096,
    stream,
  };
  if (system) body.system = system;
  if (opts.temperature != null) body.temperature = opts.temperature;
  return body;
}

function buildGeminiBody(messages: ApiMessage[], opts: ChatOptions) {
  const system = messages
    .filter((m) => m.role === "system")
    .map((m) => m.text)
    .join("\n\n");
  const contents = messages
    .filter((m) => m.role !== "system")
    .map((m) => {
      const parts: any[] = [];
      if (m.text) parts.push({ text: m.text });
      if (m.images && m.role === "user") {
        for (const img of m.images) {
          const { mime, data } = splitDataUrl(img);
          parts.push({ inline_data: { mime_type: mime, data } });
        }
      }
      if (!parts.length) parts.push({ text: " " });
      return { role: m.role === "assistant" ? "model" : "user", parts };
    });
  const body: any = { contents };
  if (system) body.systemInstruction = { parts: [{ text: system }] };
  body.generationConfig = {
    temperature: opts.temperature ?? 0.8,
    maxOutputTokens: opts.maxTokens ?? 8192,
  };
  return body;
}

// ----------------------------------------------------------------
// Chat completion (streaming)
// ----------------------------------------------------------------
export async function chatComplete(rm: ResolvedModel, messages: ApiMessage[], opts: ChatOptions = {}): Promise<string> {
  const { provider: p, model } = rm;
  const base = trimUrl(p.baseUrl);
  let url: string;
  let body: any;
  const stream = !!opts.onDelta;

  if (p.protocol === "openai") {
    url = `${base}/chat/completions`;
    body = { model: model.name, messages: buildOpenAIMessages(messages), stream };
    if (opts.temperature != null) body.temperature = opts.temperature;
    if (opts.maxTokens) body.max_tokens = opts.maxTokens;
    if (stream) body.stream_options = { include_usage: false };
  } else if (p.protocol === "anthropic") {
    url = `${base}/v1/messages`;
    body = buildAnthropicBody(messages, model.name, opts, stream);
  } else {
    url = `${base}/v1beta/models/${encodeURIComponent(model.name)}:${stream ? "streamGenerateContent?alt=sse" : "generateContent"}`;
    body = buildGeminiBody(messages, opts);
  }

  const res = await fetch(url, {
    method: "POST",
    headers: authHeaders(p),
    body: JSON.stringify(body),
    signal: opts.signal,
  });
  if (!res.ok) await readError(res);

  // Non-streaming
  if (!stream) {
    const j = await res.json();
    if (p.protocol === "openai") return j.choices?.[0]?.message?.content ?? "";
    if (p.protocol === "anthropic") return (j.content ?? []).map((c: any) => c.text ?? "").join("");
    return (j.candidates?.[0]?.content?.parts ?? []).map((x: any) => x.text ?? "").join("");
  }

  // Streaming
  let full = "";
  for await (const payload of sseData(res, opts.signal)) {
    if (payload === "[DONE]") break;
    let j: any;
    try {
      j = JSON.parse(payload);
    } catch {
      continue;
    }
    let delta = "";
    if (p.protocol === "openai") {
      if (j.error) throw new Error(j.error.message ?? "服务返回错误");
      delta = j.choices?.[0]?.delta?.content ?? "";
    } else if (p.protocol === "anthropic") {
      if (j.type === "content_block_delta" && j.delta?.type === "text_delta") delta = j.delta.text ?? "";
      if (j.type === "error") throw new Error(j.error?.message ?? "服务返回错误");
    } else {
      if (j.error) throw new Error(j.error.message ?? "服务返回错误");
      delta = (j.candidates?.[0]?.content?.parts ?? []).map((x: any) => x.text ?? "").join("");
    }
    if (delta) {
      full += delta;
      opts.onDelta!(delta);
    }
  }
  return full;
}

// ----------------------------------------------------------------
// Embeddings
// ----------------------------------------------------------------
export async function embedText(rm: ResolvedModel, text: string): Promise<number[]> {
  const { provider: p, model } = rm;
  const base = trimUrl(p.baseUrl);
  if (p.protocol === "openai") {
    const res = await fetch(`${base}/embeddings`, {
      method: "POST",
      headers: authHeaders(p),
      body: JSON.stringify({ model: model.name, input: text }),
    });
    if (!res.ok) await readError(res);
    const j = await res.json();
    return j.data?.[0]?.embedding ?? [];
  }
  if (p.protocol === "gemini") {
    const res = await fetch(`${base}/v1beta/models/${encodeURIComponent(model.name)}:embedContent`, {
      method: "POST",
      headers: authHeaders(p),
      body: JSON.stringify({ model: `models/${model.name}`, content: { parts: [{ text }] } }),
    });
    if (!res.ok) await readError(res);
    const j = await res.json();
    return j.embedding?.values ?? [];
  }
  throw new Error("Anthropic 暂不提供向量模型，请使用 OpenAI 兼容或 Gemini 的 Embedding 模型");
}

// ----------------------------------------------------------------
// Model listing
// ----------------------------------------------------------------
export async function listRemoteModels(p: Provider): Promise<{ id: string; label: string }[]> {
  const base = trimUrl(p.baseUrl);
  if (p.protocol === "openai") {
    const res = await fetch(`${base}/models`, { headers: authHeaders(p) });
    if (!res.ok) await readError(res);
    const j = await res.json();
    return (j.data ?? []).map((m: any) => ({ id: m.id, label: m.id }));
  }
  if (p.protocol === "anthropic") {
    const res = await fetch(`${base}/v1/models?limit=100`, { headers: authHeaders(p) });
    if (!res.ok) await readError(res);
    const j = await res.json();
    return (j.data ?? []).map((m: any) => ({ id: m.id, label: m.display_name || m.id }));
  }
  // gemini
  const res = await fetch(`${base}/v1beta/models?pageSize=200`, { headers: authHeaders(p) });
  if (!res.ok) await readError(res);
  const j = await res.json();
  return (j.models ?? [])
    .filter((m: any) => (m.supportedGenerationMethods ?? []).some((x: string) => x !== "countTokens"))
    .map((m: any) => ({ id: String(m.name).replace(/^models\//, ""), label: m.displayName || m.name }));
}

// ----------------------------------------------------------------
// Speech (OpenAI-compatible endpoints)
// ----------------------------------------------------------------
export async function ttsSynthesize(rm: ResolvedModel, text: string): Promise<Blob> {
  const base = trimUrl(rm.provider.baseUrl);
  const res = await fetch(`${base}/audio/speech`, {
    method: "POST",
    headers: authHeaders(rm.provider),
    body: JSON.stringify({ model: rm.model.name, input: text, voice: "alloy", response_format: "mp3" }),
  });
  if (!res.ok) await readError(res);
  return await res.blob();
}

export async function sttTranscribe(rm: ResolvedModel, audio: Blob, filename = "audio.webm"): Promise<string> {
  const base = trimUrl(rm.provider.baseUrl);
  const fd = new FormData();
  fd.append("model", rm.model.name);
  fd.append("file", audio, filename);
  const res = await fetch(`${base}/audio/transcriptions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${rm.provider.apiKey}` },
    body: fd,
  });
  if (!res.ok) await readError(res);
  const j = await res.json();
  return j.text ?? "";
}

// ================================================================
// OneBot v11 channel adapter — connects to napcat/Lagrange/LLOneBot
// over a reverse WebSocket (the bot framework connects to us) or a
// forward WebSocket (we connect to the bot framework).
//
// Private messages route to the bound (user, agent) pair; group
// messages are delivered when @-mentioned. Replies stream back as
// edited segments so the chat-software UX stays natural.
// ================================================================
import WebSocket, { WebSocketServer } from "ws";
import type { HubDB } from "./db.ts";
import { runSingleTurn, listMessages } from "./chat-service.ts";
import {
  buildContextMessages,
  chatComplete,
  uid,
  now,
  resolveModel,
  type Agent,
  type ChatMessage,
  type Conversation,
  type ModelConfig,
  type Provider,
  type Settings,
} from "@myosotis/core";

export interface OnebotConfig {
  mode: "forward" | "reverse";
  /** forward: ws(s)://host:port [+ token]; reverse: the port we listen on */
  url?: string;
  token?: string;
  /** reverse mode: port for napcat to connect to */
  listenPort?: number;
  /** our access token, napcat must present it as ?access-token or header */
  accessToken?: string;
  /** "hex" replies streamed by segment edits, "oneline" single-shot */
  streaming?: boolean;
  /** prefix that summons the companion in group chats without an @ */
  commandPrefix?: string;
}

interface OnebotEvent {
  post_type: "message" | "notice" | "request" | "meta_event";
  message_type?: "private" | "group";
  sub_type?: string;
  message_id?: number;
  user_id?: number;
  group_id?: number;
  raw_message?: string;
  message?: any;
  self_id?: number;
  time?: number;
}

export class OnebotAdapter {
  private ws: WebSocket | null = null;
  private server: import("ws").WebSocketServer | null = null;
  private clients = new Set<WebSocket>();
  private reconnectTimer: NodeJS.Timeout | null = null;
  private editTimers = new Map<number, NodeJS.Timeout>();
  running = false;

  private db: HubDB;
  private cfg: OnebotConfig;
  private deps: { loadEntities: (userId: string, agentId: string) => SingleTurnEntities | null };

  constructor(
    db: HubDB,
    cfg: OnebotConfig,
    deps: { loadEntities: (userId: string, agentId: string) => SingleTurnEntities | null }
  ) {
    this.db = db;
    this.cfg = cfg;
    this.deps = deps;
  }

  start() {
    if (this.running) return;
    this.running = true;
    if (this.cfg.mode === "forward") this.connectForward();
    else this.startReverse();
  }

  stop() {
    this.running = false;
    this.ws?.close();
    this.server?.close();
    this.clients.clear();
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
  }

  /** any live socket (forward connection or reverse clients) */
  isConnected(): boolean {
    return (this.ws?.readyState === WebSocket.OPEN) || [...this.clients].some((c) => c.readyState === WebSocket.OPEN);
  }

  // ---------------- forward mode: we dial napcat ----------------
  private connectForward() {
    if (!this.running) return;
    const url = new URL(this.cfg.url ?? "ws://127.0.0.1:3001");
    const headers: Record<string, string> = {};
    if (this.cfg.token) headers["Authorization"] = `Bearer ${this.cfg.token}`;
    const ws = new WebSocket(url, { headers });
    this.ws = ws;
    ws.on("open", () => console.log("[onebot] forward connected:", url.toString()));
    ws.on("message", (raw) => this.handleFrame(ws, raw.toString()));
    ws.on("error", (e) => console.warn("[onebot] ws error:", e.message));
    ws.on("close", () => {
      this.ws = null;
      if (this.running) {
        this.reconnectTimer = setTimeout(() => this.connectForward(), 5000);
      }
    });
    ws.on("ping", () => ws.pong());
  }

  // ---------------- reverse mode: napcat dials us ----------------
  private startReverse() {
    const wss = new WebSocketServer({ port: this.cfg.listenPort ?? 8081 });
    this.server = wss;
    wss.on("connection", (ws, req) => {
      const url = new URL(req.url ?? "/", "http://localhost");
      if (this.cfg.accessToken) {
        const q = url.searchParams.get("access-token");
        const h = req.headers.authorization;
        const ok = q === this.cfg.accessToken || h === `Bearer ${this.cfg.accessToken}`;
        if (!ok) {
          console.warn(`[onebot] unauthorized connection url=${req.url} expected=${this.cfg.accessToken} got=${q}`);
          ws.close(4001, "unauthorized");
          return;
        }
      }
      console.log("[onebot] reverse client connected");
      this.clients.add(ws);
      ws.on("message", (raw) => this.handleFrame(ws, raw.toString()));
      ws.on("close", () => this.clients.delete(ws));
      ws.on("error", () => this.clients.delete(ws));
    });
    console.log(`[onebot] reverse ws listening on :${this.cfg.listenPort ?? 8081}`);
  }

  // ---------------- protocol plumbing ----------------
  private send(ws: WebSocket, action: string, params: Record<string, unknown>) {
    if (ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ action, params, echo: uid("echo") }));
  }

  private handleFrame(ws: WebSocket, text: string) {
    let frame: any;
    try {
      frame = JSON.parse(text);
    } catch {
      return;
    }
    if (frame.post_type === "message") this.onMessage(ws, frame as OnebotEvent);
  }

  // ---------------- message routing ----------------
  private async onMessage(ws: WebSocket, ev: OnebotEvent) {
    try {
      const raw = String(ev.raw_message ?? "").trim();
      if (!raw) return;

      const isGroup = ev.message_type === "group";
      const selfId = ev.self_id;
      const atSelf = isGroup && new RegExp(`\\[CQ:at,qq=${selfId}(,[^\\]]*)?\\]`).test(raw);
      // strip every @-segment aimed at us, keep other mentions
      const text = isGroup
        ? raw
            .replace(new RegExp(`\\[CQ:at,qq=${selfId}(,[^\\]]*)?\\]`, "g"), "")
            .trim()
        : raw;

      // group policy: reply when mentioned, or when the message starts
      // with the command prefix (so the companion can be addressed in prose)
      const cmdPrefix = this.cfg.commandPrefix ?? "/myo";
      if (isGroup && !atSelf && !text.startsWith(cmdPrefix)) return;
      const body = text.startsWith(cmdPrefix) ? text.slice(cmdPrefix.length).trim() : text;
      if (!body) return;

      // images: napcat sends [CQ:image,file=…]; fetch and inline them
      const images = await this.collectImages(ev, body);

      const bindingKey = isGroup ? `group:${ev.group_id}` : `user:${ev.user_id}`;
      const binding = this.db.getBinding("onebot", bindingKey);
      if (!binding) {
        this.reply(ws, ev, "🪻 我还不知道该让哪位伙伴回复你。请先在 Myosotis 网页端「连接」页完成绑定。");
        return;
      }
      const entities = this.deps.loadEntities(binding.userId, binding.agentId);
      if (!entities) return;

      const convo = this.ensureChannelConversation(entities, bindingKey);
      runSingleTurn(
        this.db,
        entities.userId,
        { agent: entities.agent, convo, settings: entities.settings, models: entities.models, providers: entities.providers },
        body,
        images,
        undefined,
        {
          onDelta: (d) => this.streamEdit(ws, ev, d, true),
          onMessage: (m) => this.streamEdit(ws, ev, m.content, false),
        }
      ).catch((e) => console.warn("[onebot] turn failed:", e));
    } catch (e) {
      console.warn("[onebot] message handling failed:", e);
    }
  }

  /**
   * Download image segments referenced by the message and turn them into
   * data URLs so vision models can look at them.
   */
  private async collectImages(ev: OnebotEvent, text: string): Promise<string[] | undefined> {
    const cq = /\[CQ:image,([^\]]*)\]/g;
    const out: string[] = [];
    for (const m of text.matchAll(cq)) {
      const params = m[1];
      const file = /file=([^,]+)/.exec(params)?.[1];
      const url = /url=([^,]+)/.exec(params)?.[1];
      const source = url ?? file;
      if (!source) continue;
      try {
        const res = await fetch(source.startsWith("http") ? source : `http://127.0.0.1:5700${source}`);
        if (!res.ok) continue;
        const buf = Buffer.from(await res.arrayBuffer());
        const mime = res.headers.get("content-type") ?? "image/jpeg";
        out.push(`data:${mime};base64,${buf.toString("base64")}`);
      } catch {
        /* skip unreadable image */
      }
    }
    return out.length ? out : undefined;
  }

  /**
   * Buffered streaming: accumulate deltas and edit the outgoing message
   * every 1.2s (napcat rate limits edits), final edit on completion.
   */
  private streamBuf = new Map<number, string>();

  private streamEdit(ws: WebSocket, ev: OnebotEvent, chunk: string, more: boolean) {
    if (!this.cfg.streaming) return;
    const key = ev.message_id!;
    if (more) {
      this.streamBuf.set(key, (this.streamBuf.get(key) ?? "") + chunk);
      if (!this.editTimers.has(key)) {
        this.editTimers.set(
          key,
          setTimeout(() => {
            this.editTimers.delete(key);
            const buf = this.streamBuf.get(key);
            if (buf) this.reply(ws, ev, buf + " ▌");
          }, 1200)
        );
      }
      return;
    }
    // final: flush pending buffer timer, send the complete text once
    const t = this.editTimers.get(key);
    if (t) {
      clearTimeout(t);
      this.editTimers.delete(key);
    }
    this.streamBuf.delete(key);
    this.reply(ws, ev, chunk);
  }

  private reply(ws: WebSocket, ev: OnebotEvent, text: string) {
    if (ev.message_type === "group") {
      this.send(ws, "send_group_msg", {
        group_id: ev.group_id,
        message: [{ type: "at", data: { qq: ev.user_id } }, " ", ...this.toSegments(text)],
      });
    } else {
      this.send(ws, "send_private_msg", { user_id: ev.user_id, message: this.toSegments(text) });
    }
  }

  private toSegments(text: string): any[] {
    // CQ codes pass through as plain text segments (napcat renders them)
    const parts: any[] = [];
    const re = /\[CQ:[^\]]+\]/g;
    let last = 0;
    for (const m of text.matchAll(re)) {
      const idx = m.index!;
      if (idx > last) parts.push({ type: "text", data: { text: text.slice(last, idx) } });
      parts.push({ type: "text", data: { text: m[0] } });
      last = idx + m[0].length;
    }
    if (last < text.length) parts.push({ type: "text", data: { text: text.slice(last) } });
    return parts;
  }

  private ensureChannelConversation(e: SingleTurnEntities, bindingKey: string): Conversation {
    // one persistent conversation per channel peer per agent
    const metaKey = `onebot:convo:${e.userId}:${bindingKey}:${e.agent.id}`;
    let convoId = this.db.getMeta(metaKey);
    let convo = convoId ? this.db.getJson<Conversation>("conversations", convoId) : undefined;
    if (!convo) {
      convo = {
        id: uid("cnv"),
        agentId: e.agent.id,
        title: `OneBot ${bindingKey}`,
        lastMessage: "",
        messageCount: 0,
        createdAt: now(),
        updatedAt: now(),
        kind: "direct",
        summary: "",
        summarizedUntil: 0,
      };
      this.db.putJson("conversations", convo.id, e.userId, convo, { agent_id: convo.agentId, updated_at: convo.updatedAt });
      this.db.setMeta(metaKey, convo.id);
    }
    return convo;
  }
}

interface SingleTurnEntities {
  userId: string;
  agent: Agent;
  settings: Settings;
  models: ModelConfig[];
  providers: Provider[];
}

export function createOnebotAdapter(db: HubDB, cfg: OnebotConfig, deps: { loadEntities: (userId: string, agentId: string) => SingleTurnEntities | null }) {
  return new OnebotAdapter(db, cfg, deps);
}

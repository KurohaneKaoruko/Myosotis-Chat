// ================================================================
// Myosotis Hub — the server core.
// Serves the web app, the REST/SSE API, channel adapters and the
// agent-tool bridge. Everything runs here; clients are shells.
// ================================================================
import Fastify from "fastify";
import fastifyCookie from "@fastify/cookie";
import fastifyStatic from "@fastify/static";
import { createReadStream, existsSync, statSync } from "node:fs";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { installStoragePort, HubDB } from "./db.ts";
import {
  hashPassword,
  verifyPassword,
  newToken,
  setSessionCookie,
  clearSessionCookie,
  sessionTokenFrom,
  generateTotpSecret,
  verifyTotp,
  totpUri,
} from "./auth.ts";
import { runSingleTurn, runGroupTurn, listMessages } from "./chat-service.ts";
import { createOnebotAdapter } from "./adapter-onebot.ts";
import { ChannelManager } from "./channels.ts";
import { bus } from "./events.ts";
import { UploadStore, MAX_UPLOAD_BYTES } from "./uploads.ts";
import {
  DEFAULT_SETTINGS,
  uid,
  now,
  setI18n,
  type Agent,
  type ChatMessage,
  type Conversation,
  type MemoryItem,
  type ModelConfig,
  type Provider,
  type Scenario,
  type Settings,
} from "@myosotis/core";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.MYO_DATA_DIR ?? path.join(__dirname, "../../../data");
const PORT = Number(process.env.PORT ?? 8790);
const HOST = process.env.HOST ?? "0.0.0.0";
const WEB_DIST = process.env.MYO_WEB_DIST ?? path.join(__dirname, "../../web/dist");
const TRUST_PROXY = process.env.TRUST_PROXY === "1";

mkdirSync(DATA_DIR, { recursive: true });
const db = new HubDB(path.join(DATA_DIR, "hub.db"));
const uploads = new UploadStore(DATA_DIR);

// server-side i18n port: log-friendly keys, no UI strings needed here
setI18n({ t: (k) => k });

const app = Fastify({ trustProxy: TRUST_PROXY, logger: { level: "warn" } });
await app.register(fastifyCookie);

// ----------------------------------------------------------------
// auth plumbing
// ----------------------------------------------------------------
declare module "fastify" {
  interface FastifyRequest {
    userId: string;
  }
}

function currentUser(req: any): string | null {
  const token = sessionTokenFrom(req);
  if (!token) return null;
  const session = db.getSession(token);
  return session?.userId ?? null;
}

/**
 * Fastify rejects an empty body when content-type says JSON. Clients
 * often send DELETE without a body, so strip the content-type for
 * bodyless verbs instead of failing the request.
 */
app.addHook("onRequest", async (req: any) => {
  const len = req.headers["content-length"];
  if (!len || len === "0") {
    // no payload → don't claim it is JSON
    delete req.headers["content-type"];
    delete req.headers["content-length"];
  }
});

app.addHook("preHandler", async (req: any, res: any) => {
  // public endpoints
  if (
    req.url.startsWith("/api/auth") ||
    req.url.startsWith("/api/health") ||
    req.url === "/api/bootstrap" ||
    !req.url.startsWith("/api/")
  ) {
    return;
  }
  const userId = currentUser(req);
  if (!userId) return res.status(401).send({ error: "unauthorized" });
  req.userId = userId;
});

// per-request storage port binding (multi-tenant isolation)
installStoragePort(db, () => currentUserIdSlot.value);
const currentUserIdSlot = { value: null as string | null };

function bindUser(userId: string) {
  currentUserIdSlot.value = userId;
}

// ----------------------------------------------------------------
// bootstrap & auth routes
// ----------------------------------------------------------------
app.get("/api/health", async () => ({ ok: true, name: "myosotis-hub", version: "0.3.0" }));

app.get("/api/bootstrap", async () => {
  const needsSetup = db.userCount() === 0;
  return { needsSetup, version: "0.3.0" };
});

app.post("/api/auth/setup", async (req: any, res: any) => {
  const { username, password } = req.body ?? {};
  if (db.userCount() > 0) return res.status(403).send({ error: "already-setup" });
  if (!username || typeof username !== "string" || username.trim().length < 1 || username.length > 32)
    return res.status(400).send({ error: "bad-username" });
  if (!password || password.length < 8) return res.status(400).send({ error: "weak-password" });
  const id = uid("usr");
  db.createUser({ id, username: username.trim(), passwordHash: hashPassword(password), totpSecret: null, createdAt: now() });
  const token = newToken();
  db.createSession({ id: token, userId: id, createdAt: now(), expiresAt: Date.now() + 30 * 86400_000 });
  setSessionCookie(res, token, req.secure || TRUST_PROXY);
  return { ok: true, username: username.trim() };
});

app.post("/api/auth/login", async (req: any, res: any) => {
  const { username, password, totp } = req.body ?? {};
  const user = db.getUserByUsername(String(username ?? ""));
  if (!user || !verifyPassword(String(password ?? ""), user.passwordHash)) {
    return res.status(401).send({ error: "bad-credentials" });
  }
  if (user.totpSecret) {
    if (!totp) return res.status(401).send({ error: "totp-required" });
    if (!verifyTotp(user.totpSecret, String(totp))) return res.status(401).send({ error: "bad-totp" });
  }
  const token = newToken();
  db.createSession({ id: token, userId: user.id, createdAt: now(), expiresAt: Date.now() + 30 * 86400_000 });
  setSessionCookie(res, token, req.secure || TRUST_PROXY);
  return { ok: true, username: user.username, totpEnabled: !!user.totpSecret };
});

app.post("/api/auth/logout", async (req: any, res: any) => {
  const token = sessionTokenFrom(req);
  if (token) db.deleteSession(token);
  clearSessionCookie(res);
  return { ok: true };
});

app.get("/api/auth/me", async (req: any, res: any) => {
  const userId = currentUser(req);
  if (!userId) return res.status(401).send({ error: "unauthorized" });
  const u = db.getUser(userId);
  return { username: u?.username, totpEnabled: !!u?.totpSecret };
});

// ---- TOTP 2FA ----
app.post("/api/auth/totp/begin", async (req: any, res: any) => {
  const userId = req.userId;
  if (!userId) return res.status(401).send({ error: "unauthorized" });
  const secret = generateTotpSecret();
  const u = db.getUser(userId)!;
  return { secret, uri: totpUri(secret, u.username) };
});

app.post("/api/auth/totp/enable", async (req: any, res: any) => {
  const { secret, code } = req.body ?? {};
  if (!secret || !verifyTotp(String(secret), String(code ?? ""))) return res.status(400).send({ error: "bad-code" });
  db.updateUser(req.userId, { totpSecret: String(secret) });
  return { ok: true };
});

app.post("/api/auth/totp/disable", async (req: any, res: any) => {
  const { code, password } = req.body ?? {};
  const u = db.getUser(req.userId);
  if (!u) return res.status(404).send({ error: "no-user" });
  if (!verifyPassword(String(password ?? ""), u.passwordHash)) return res.status(401).send({ error: "bad-password" });
  if (u.totpSecret && !verifyTotp(u.totpSecret, String(code ?? ""))) return res.status(401).send({ error: "bad-totp" });
  db.updateUser(req.userId, { totpSecret: null });
  return { ok: true };
});

app.post("/api/auth/password", async (req: any, res: any) => {
  const { oldPassword, newPassword } = req.body ?? {};
  const u = db.getUser(req.userId);
  if (!u) return res.status(404).send({ error: "no-user" });
  if (!verifyPassword(String(oldPassword ?? ""), u.passwordHash)) return res.status(401).send({ error: "bad-old" });
  if (typeof newPassword !== "string" || newPassword.length < 8) return res.status(400).send({ error: "weak-password" });
  db.updateUser(req.userId, { passwordHash: hashPassword(newPassword) });
  return { ok: true };
});

// ----------------------------------------------------------------
// data sync routes (providers/models/agents/convos/messages/memories…)
// ----------------------------------------------------------------
const TABLES = ["providers", "models", "agents", "prompts", "scenarios", "memories"] as const;

app.get("/api/data", async (req: any) => {
  bindUser(req.userId);
  const [providers, models, agents, prompts, scenarios, convos, memories] = await Promise.all([
    db.listJson("providers", req.userId) as Provider[],
    db.listJson("models", req.userId) as ModelConfig[],
    db.listJson("agents", req.userId, "created_at ASC") as Agent[],
    db.listJson("prompts", req.userId),
    db.listJson("scenarios", req.userId) as Scenario[],
    db.listJson("conversations", req.userId, "updated_at DESC") as Conversation[],
    db.listMemoriesForUser(req.userId),
  ]);
  const settings = db.getJson<Settings>("settings", req.userId);
  // server-computed unread counts for the conversation list badges
  const conversations = convos.map((c) => ({
    ...c,
    unread: db.unreadCount(req.userId, c.id, c.lastReadAt ?? 0),
  }));
  return {
    providers,
    models,
    agents,
    prompts,
    scenarios,
    conversations,
    memories,
    settings: settings ?? DEFAULT_SETTINGS,
  };
});

// mark a conversation as read (clears its badge on every device)
app.post("/api/conversations/:id/read", async (req: any, res: any) => {
  bindUser(req.userId);
  // clients may POST with an empty body → don't let fastify reject it
  if (req.body === undefined) req.body = {};
  const convo = db.getJson<Conversation>("conversations", req.params.id);
  if (!convo) return res.status(404).send({ error: "not-found" });
  const updated = { ...convo, lastReadAt: now() };
  db.putJson("conversations", convo.id, req.userId, updated, { agent_id: convo.agentId, updated_at: convo.updatedAt });
  bus.emit(req.userId, { type: "conversation", conversation: updated });
  return { ok: true };
});

app.put("/api/data/settings", async (req: any) => {
  const existing = db.getJson<Settings>("settings", req.userId);
  const merged = deepMergeSettings(existing ?? DEFAULT_SETTINGS, req.body);
  db.putJson("settings", req.userId, req.userId, merged);
  return { ok: true };
});

/** merge a partial settings patch over defaults so no field is ever undefined */
function deepMergeSettings(base: Settings, patch: any): Settings {
  const out: any = { ...base };
  for (const [k, v] of Object.entries(patch ?? {})) {
    if (v && typeof v === "object" && !Array.isArray(v) && typeof out[k] === "object" && !Array.isArray(out[k])) {
      out[k] = { ...out[k], ...v };
    } else if (v !== undefined) {
      out[k] = v;
    }
  }
  return out;
}

for (const t of TABLES) {
  app.put(`/api/data/${t}/:id`, async (req: any) => {
    bindUser(req.userId);
    const item = req.body as any;
    db.putJson(t, req.params.id, req.userId, item, extraColsFor(t, item));
    if (t === "agents") bus.emit(req.userId, { type: "agent", agent: item as Agent });
    else if (t === "memories") bus.emit(req.userId, { type: "memory", memory: item as MemoryItem });
    else bus.emit(req.userId, { type: "settings" });
    return { ok: true };
  });
  app.delete(`/api/data/${t}/:id`, async (req: any) => {
    db.deleteJson(t, req.params.id);
    if (t === "agents") {
      const agent = db.getJson<Agent>("agents", req.params.id);
      if (agent) bus.emit(req.userId, { type: "agent", agent, removed: true });
    } else if (t === "memories") {
      bus.emit(req.userId, { type: "memory", memory: { id: req.params.id } as MemoryItem });
    }
    bus.emit(req.userId, { type: "settings" });
    return { ok: true };
  });
}

// conversations live in their own table (indexed by agent + updated_at)
app.put("/api/data/conversations/:id", async (req: any, res: any) => {
  bindUser(req.userId);
  const item = req.body as any;
  if (!item?.id) return res.status(400).send({ error: "bad-conversation" });
  db.putJson("conversations", req.params.id, req.userId, item, {
    agent_id: String(item.agentId ?? ""),
    updated_at: item.updatedAt ?? Date.now(),
  });
  return { ok: true };
});

app.delete("/api/data/conversations/:id", async (req: any) => {
  db.deleteJson("conversations", req.params.id);
  return { ok: true };
});

function extraColsFor(t: string, item: any): Record<string, string | number> | undefined {
  if (t === "models") return { provider_id: String(item.providerId ?? "") };
  if (t === "providers") return { created_at: item.createdAt ?? now() };
  if (t === "agents") return { created_at: item.createdAt ?? now(), updated_at: item.updatedAt ?? now() };
  if (t === "scenarios") return { agent_id: String(item.agentId ?? ""), updated_at: item.updatedAt ?? now() };
  if (t === "memories") return { agent_id: String(item.agentId ?? ""), updated_at: item.updatedAt ?? now() };
  return undefined;
}

// ---- conversations & messages ----
app.post("/api/conversations", async (req: any, res: any) => {
  bindUser(req.userId);
  const { agentId, title, kind, participants } = req.body ?? {};
  if (!agentId && kind !== "group") return res.status(400).send({ error: "agent-required" });
  const convo: Conversation = {
    id: uid("cnv"),
    agentId: agentId ?? "",
    title: String(title ?? "").trim(),
    lastMessage: "",
    messageCount: 0,
    createdAt: now(),
    updatedAt: now(),
    kind: kind === "group" ? "group" : "direct",
    summary: "",
    summarizedUntil: 0,
    ...(kind === "group" ? { participants: participants ?? [] } : {}),
  };
  db.putJson("conversations", convo.id, req.userId, convo, { agent_id: convo.agentId, updated_at: convo.updatedAt });
  bus.emit(req.userId, { type: "conversation", conversation: convo });
  return convo;
});

app.put("/api/conversations/:id", async (req: any, res: any) => {
  bindUser(req.userId);
  const existing = db.getJson<Conversation>("conversations", req.params.id);
  if (!existing) return res.status(404).send({ error: "not-found" });
  const merged = { ...existing, ...req.body, id: req.params.id } as Conversation;
  db.putJson("conversations", req.params.id, req.userId, merged, { agent_id: existing.agentId, updated_at: now() });
  bus.emit(req.userId, { type: "conversation", conversation: merged });
  return { ok: true };
});

app.delete("/api/conversations/:id", async (req: any, res: any) => {
  bindUser(req.userId);
  const convo = db.getJson<Conversation>("conversations", req.params.id);
  if (!convo) return res.status(404).send({ error: "not-found" });
  db.raw.prepare("DELETE FROM messages WHERE conversation_id = ?").run(req.params.id);
  db.deleteJson("conversations", req.params.id);
  bus.emit(req.userId, { type: "clear-conversation", conversationId: req.params.id });
  return { ok: true };
});

app.get("/api/conversations/:id/messages", async (req: any, res: any) => {
  bindUser(req.userId);
  const convo = db.getJson<Conversation>("conversations", req.params.id);
  if (!convo) return res.status(404).send({ error: "not-found" });
  return listMessages(db, req.userId, req.params.id);
});

app.put("/api/conversations/:id/messages/:mid", async (req: any, res: any) => {
  bindUser(req.userId);
  const existing = db.getJson<ChatMessage>("messages", req.params.mid);
  if (!existing) return res.status(404).send({ error: "not-found" });
  const merged = { ...existing, ...req.body, id: req.params.mid } as ChatMessage;
  db.putJson("messages", req.params.mid, req.userId, merged, { conversation_id: req.params.id, created_at: existing.createdAt });
  bus.emit(req.userId, { type: "message", conversationId: req.params.id, message: merged });
  return { ok: true };
});

// client-created messages (greetings, edits) — upsert
app.post("/api/conversations/:id/messages", async (req: any, res: any) => {
  bindUser(req.userId);
  const convo = db.getJson<Conversation>("conversations", req.params.id);
  if (!convo) return res.status(404).send({ error: "no-convo" });
  const m = req.body as ChatMessage;
  if (!m?.id || typeof m.content !== "string") return res.status(400).send({ error: "bad-message" });
  db.putJson("messages", m.id, req.userId, m, { conversation_id: req.params.id, created_at: m.createdAt ?? now() });
  bus.emit(req.userId, { type: "message", conversationId: req.params.id, message: m });
  return { ok: true };
});

function remoteDBcacheSync(_m: ChatMessage) {} // placeholder; cache lives client-side

app.delete("/api/conversations/:id/messages/:mid", async (req: any) => {
  db.deleteJson("messages", req.params.mid);
  bus.emit(req.userId, { type: "delete-message", conversationId: req.params.id, messageId: req.params.mid });
  return { ok: true };
});

// ---- memories ----
app.get("/api/memories", async (req: any) => {
  bindUser(req.userId);
  const agentId = (req.query as any).agentId as string | undefined;
  const all = db.listMemoriesForUser(req.userId);
  return agentId ? all.filter((m) => m.agentId === agentId) : all;
});

// ----------------------------------------------------------------
// realtime event stream (cross-device sync)
// ----------------------------------------------------------------
app.get("/api/events", async (req: any, res: any) => {
  const userId = req.userId;
  if (!userId) return res.status(401).send({ error: "unauthorized" });

  res.raw.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.raw.write(":connected\n\n");

  const clientId = uid("evt");
  let closed = false;
  bus.add({
    id: clientId,
    userId,
    write: (event) => {
      if (closed || res.raw.writableEnded || res.raw.destroyed) return;
      try {
        res.raw.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
      } catch {}
    },
    close: () => {
      closed = true;
      bus.remove(clientId);
    },
  });

  const heartbeat = setInterval(() => {
    if (closed || res.raw.writableEnded || res.raw.destroyed) return;
    try {
      res.raw.write(`event: ping\ndata: {"type":"ping","t":${now()}}\n\n`);
    } catch {}
  }, 25000);

  req.raw.on("close", () => {
    closed = true;
    clearInterval(heartbeat);
    bus.remove(clientId);
  });
});

// ----------------------------------------------------------------
// chat turn — SSE stream
// ----------------------------------------------------------------
function loadEntities(userId: string, agentId: string) {
  const agent = db.getJson<Agent>("agents", agentId);
  if (!agent) return null;
  const settings = deepMergeSettings(DEFAULT_SETTINGS, db.getJson<Settings>("settings", userId) ?? {});
  const models = db.listJson<ModelConfig>("models", userId);
  const providers = db.listJson<Provider>("providers", userId);
  return { userId, agent, settings, models, providers };
}

const activeStreams = new Set<AbortController>();
/** userId+conversationId → controller, so "stop" can cancel the right turn */
const streamByConvo = new Map<string, AbortController>();

app.post("/api/chat", async (req: any, res: any) => {
  const { conversationId, text, images, replyTo, storyEventId } = req.body ?? {};
  const convo = db.getJson<Conversation>("conversations", conversationId);
  if (!convo) return res.status(404).send({ error: "no-convo" });
  const userId = req.userId;
  bindUser(userId);

  // SSE stream setup
  res.raw.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.raw.write(":open\n\n");
  let streamClosed = false;
  const send = (event: string, data: unknown) => {
    if (streamClosed || res.raw.writableEnded || res.raw.destroyed) return;
    try {
      res.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    } catch {
      /* client vanished mid-write */
    }
  };

  const ac = new AbortController();
  const streamKey = `${userId}:${req.body?.conversationId ?? ""}`;
  activeStreams.add(ac);
  streamByConvo.set(streamKey, ac);
  req.raw.on("close", () => {
    streamClosed = true;
    activeStreams.delete(ac);
    if (streamByConvo.get(streamKey) === ac) streamByConvo.delete(streamKey);
    ac.abort();
  });

  try {
    if (convo.kind === "group") {
      const agents = db.listJson<Agent>("agents", userId);
      const settings = deepMergeSettings(DEFAULT_SETTINGS, db.getJson<Settings>("settings", userId) ?? {});
      const models = db.listJson<ModelConfig>("models", userId);
      const providers = db.listJson<Provider>("providers", userId);
      await runGroupTurn(
        db,
        userId,
        { convo, settings, models, providers, agents },
        text,
        images,
        {
          onUser: (m) => send("user", m),
          onDelta: () => {},
          onAgentDelta: (agentId, delta) => send("delta", { agentId, delta }),
          onMessage: (m) => send("message", m),
          onStatus: (s) => send("status", s),
        },
        ac.signal
      );
    } else {
      const e = loadEntities(userId, convo.agentId);
      if (!e) {
        send("error", { message: "agent-missing" });
      } else {
        const result = await runSingleTurn(
          db,
          userId,
          { agent: e.agent, convo, settings: e.settings, models: e.models, providers: e.providers },
          String(text ?? ""),
          images,
          replyTo,
          {
            onUser: (m) => send("user", m),
            onDelta: (d) => send("delta", { delta: d }),
            onMessage: (m) => send("message", m),
            onStatus: (s) => send("status", s),
            // inline images (e.g. from a chat platform) become stored URLs
            persistImage: async (dataUrl: string) => {
              const saved = uploads.save(dataUrl);
              if (!saved) return dataUrl;
              const proto = req.protocol ?? "http";
              const host = req.headers["x-forwarded-host"] ?? req.headers.host ?? "localhost";
              return `${proto}://${host}${saved.url}`;
            },
          },
          ac.signal,
          storyEventId
        );
        if (result.error) send("error", { message: result.error });
      }
    }
  } catch (e: any) {
    send("error", { message: e?.message ?? String(e) });
  } finally {
    send("done", { at: now() });
    if (!res.raw.writableEnded && !res.raw.destroyed) {
      try { res.raw.end(); } catch {}
    }
    activeStreams.delete(ac);
    if (streamByConvo.get(streamKey) === ac) streamByConvo.delete(streamKey);
  }
});
app.post("/api/chat/stop", async (req: any, res: any) => {
  const { conversationId } = req.body ?? {};
  const key = `${req.userId}:${conversationId ?? ""}`;
  const ac = streamByConvo.get(key);
  if (ac) {
    ac.abort();
    streamByConvo.delete(key);
    return { ok: true, stopped: true };
  }
  return { ok: true, stopped: false };
});

// ----------------------------------------------------------------
// channel bindings (OneBot / napcat)
// ----------------------------------------------------------------
app.get("/api/channels", async (req: any) => {
  return { bindings: db.listBindings(req.userId), onebot: channels.status() };
});

app.put("/api/channels/onebot", async (req: any, res: any) => {
  const { platformUserId, agentId } = req.body ?? {};
  if (!platformUserId?.trim() || !agentId) return res.status(400).send({ error: "missing-fields" });
  db.putBinding("onebot", String(platformUserId).trim(), req.userId, String(agentId));
  return { ok: true };
});

app.delete("/api/channels/onebot/:key", async (req: any) => {
  db.deleteBinding("onebot", req.params.key);
  return { ok: true };
});

// runtime configuration of the OneBot adapter (restart-free)
app.put("/api/channels/onebot/config", async (req: any, res: any) => {
  const body = req.body ?? {};
  const patch: any = {};
  if (typeof body.enabled === "boolean") patch.enabled = body.enabled;
  if (body.mode === "forward" || body.mode === "reverse") patch.mode = body.mode;
  if (typeof body.url === "string") patch.url = body.url;
  if (typeof body.token === "string") patch.token = body.token;
  if (typeof body.accessToken === "string") patch.accessToken = body.accessToken;
  if (body.listenPort != null) patch.listenPort = Number(body.listenPort);
  if (typeof body.streaming === "boolean") patch.streaming = body.streaming;
  return { ok: true, onebot: await channels.update(patch) };
});

// ----------------------------------------------------------------
// image uploads (content-addressed files on disk)
// ----------------------------------------------------------------
app.post("/api/upload", async (req: any, res: any) => {
  const { data } = req.body ?? {};
  if (typeof data !== "string" || !data.startsWith("data:")) {
    return res.status(400).send({ error: "bad-upload" });
  }
  // cheap guard before decoding: base64 inflates by 4/3
  if (data.length > MAX_UPLOAD_BYTES * 1.4) {
    return res.status(413).send({ error: "too-large" });
  }
  const saved = uploads.save(data);
  if (!saved) return res.status(400).send({ error: "unsupported-image" });
  // absolute URL so other devices / the desktop shell can load it too
  const proto = req.protocol ?? "http";
  const host = req.headers["x-forwarded-host"] ?? req.headers.host ?? "localhost";
  return { url: `${proto}://${host}${saved.url}`, path: saved.url, bytes: saved.bytes, mime: saved.mime };
});

app.get("/uploads/:name", async (req: any, res: any) => {
  const file = uploads.read(req.params.name);
  if (!file) return res.status(404).send({ error: "not-found" });
  res.type(file.mime);
  res.header("Cache-Control", "public, max-age=31536000, immutable");
  return res.send(file.data);
});

// ----------------------------------------------------------------
// static web app
// ----------------------------------------------------------------
if (existsSync(WEB_DIST)) {
  await app.register(fastifyStatic, {
    root: WEB_DIST,
    wildcard: false,
    maxAge: "1h",
    // hashed assets are immutable; index.html must always revalidate
    setHeaders(res, pathname) {
      if (pathname.endsWith(".html") || pathname === "/" || !pathname.includes("/assets/")) {
        res.setHeader("Cache-Control", "no-cache");
      }
    },
  });
  app.setNotFoundHandler((req, res) => {
    const p = path.join(WEB_DIST, "index.html");
    if (req.url.startsWith("/api/")) return res.status(404).send({ error: "not-found" });
    if (existsSync(p)) {
      res.type("text/html").header("Cache-Control", "no-cache");
      return res.send(createReadStream(p));
    }
    res.status(404).send({ error: "web-dist-missing" });
  });
}

// ----------------------------------------------------------------
// boot
// ----------------------------------------------------------------
const channels = new ChannelManager(db, loadEntities);
await channels.init();

db.deleteExpiredSessions();
setInterval(() => db.deleteExpiredSessions(), 6 * 3600_000).unref();

// a single broken client must never take the hub down
process.on("uncaughtException", (err) => {
  console.error("[hub] uncaught exception (kept alive):", err?.message ?? err);
});
process.on("unhandledRejection", (err) => {
  console.error("[hub] unhandled rejection (kept alive):", (err as any)?.message ?? err);
});

app.listen({ port: PORT, host: HOST }).then(() => {
  console.log(`Myosotis Hub 0.3.0 listening on http://${HOST}:${PORT}`);
  console.log(`  data dir: ${DATA_DIR}`);
  console.log(`  web dist: ${WEB_DIST}${existsSync(WEB_DIST) ? "" : " (missing — build the web app first)"}`);
  const st = channels.status();
  console.log(`  onebot: ${st.enabled ? `${st.mode} mode` : "disabled"}`);
});

// ================================================================
// Server-side chat orchestration — the heart of the hub.
// Mirrors the web app's store.send() flow but persists through the
// hub database and streams over SSE. Channel adapters (OneBot/napcat)
// and agent-tool bridges (claude/codex CLI) call into here too.
// ================================================================
import {
  buildContextMessages,
  buildGroupContext,
  extractMemories,
  generateTitle,
  maybeSummarize,
  replyingParticipants,
  retrieveMemories,
  chatComplete,
  embedText,
  uid,
  now,
  resolveModel,
  friendlyError,
  type Agent,
  type ChatMessage,
  type Conversation,
  type MemoryItem,
  type ModelConfig,
  type Provider,
  type Scenario,
  type ScenarioEvent,
  type Settings,
} from "@myosotis/core";
import type { HubDB } from "./db.ts";
import { bus } from "./events.ts";

export interface TurnCallbacks {
  /** the user's message was persisted — echo it back immediately */
  onUser?: (m: ChatMessage) => void;
  /** convert inline data URLs into stored URLs before persisting */
  persistImage?: (dataUrl: string) => Promise<string>;
  onDelta?: (text: string) => void;
  onMessage?: (m: ChatMessage) => void;
  onStatus?: (s: string) => void;
  onAgentDelta?: (agentId: string, delta: string) => void;
}

/** list conversation messages ordered by createdAt */
export function listMessages(db: HubDB, userId: string, convoId: string): ChatMessage[] {
  return (db.raw
    .prepare("SELECT data FROM messages WHERE conversation_id = ? AND user_id = ? ORDER BY created_at ASC")
    .all(convoId, userId) as any[]).map((r) => JSON.parse(r.data) as ChatMessage);
}

function touchConvo(db: HubDB, userId: string, convo: Conversation, lastText: string): Conversation {
  const updated: Conversation = {
    ...convo,
    lastMessage: lastText.slice(0, 60),
    messageCount: (convo.messageCount ?? 0) + 1,
    updatedAt: now(),
  };
  db.putJson("conversations", updated.id, userId, updated, { agent_id: updated.agentId, updated_at: updated.updatedAt });
  return updated;
}

// ----------------------------------------------------------------
// Story mode (剧情模式)
// ----------------------------------------------------------------

export interface StoryContext {
  scenario: Scenario;
  /** events fired on this very turn, injected as "just happened" */
  newlyTriggered: ScenarioEvent[];
}

/**
 * Resolve the story context for this turn: the scenario in play, the
 * events that just fired (keyword triggers plus an optional manual
 * "advance the plot" event) and the updated story state.
 */
export function resolveStory(
  db: HubDB,
  userId: string,
  convo: Conversation,
  userText: string,
  /** id of an event the user triggered manually (composer button) */
  manualEventId?: string
): { story: StoryContext | undefined; storyState: Conversation["storyState"] } {
  if (convo.mode !== "story" || !convo.scenarioId) {
    return { story: undefined, storyState: convo.storyState };
  }
  const scenario = db.getJson<Scenario>("scenarios", convo.scenarioId);
  if (!scenario) return { story: undefined, storyState: convo.storyState };

  const triggered = [...(convo.storyState?.triggeredEventIds ?? [])];
  const newly: ScenarioEvent[] = [];

  // manual "advance the plot" event: force-fire it this turn
  if (manualEventId) {
    const ev = scenario.events.find((x) => x.id === manualEventId);
    if (ev) {
      if (!triggered.includes(ev.id)) triggered.push(ev.id);
      newly.push(ev);
    }
  }

  // keyword triggers: comma-separated keywords matched against the message
  for (const ev of scenario.events) {
    if (triggered.includes(ev.id) || newly.some((n) => n.id === ev.id)) continue;
    const keywords = ev.trigger
      .split(/[,，]/)
      .map((k) => k.trim())
      .filter(Boolean);
    if (keywords.length && keywords.some((k) => userText.includes(k))) {
      triggered.push(ev.id);
      newly.push(ev);
    }
  }

  const storyState = { openedAt: convo.storyState?.openedAt, triggeredEventIds: triggered };
  return { story: { scenario, newlyTriggered: newly }, storyState };
}

// ----------------------------------------------------------------
// Single-agent turn (1:1 conversation)
// ----------------------------------------------------------------
export async function runSingleTurn(
  db: HubDB,
  userId: string,
  e: { agent: Agent; convo: Conversation; settings: Settings; models: ModelConfig[]; providers: Provider[] },
  userText: string,
  images: string[] | undefined,
  replyTo: { id: string; role: string; content: string } | undefined,
  cb: TurnCallbacks,
  /** abort signal — lets the client actually cancel the upstream call */
  signal?: AbortSignal,
  /** story mode: event the user triggered manually */
  storyEventId?: string
): Promise<{ userMsg: ChatMessage | null; assistantMsg: ChatMessage | null; error?: string }> {
  const trimmed = userText.trim();
  if (!trimmed && !images?.length) return { userMsg: null, assistantMsg: null };

  // 1. persist user message (inline images become stored URLs)
  let storedImages = images;
  if (images?.length && cb.persistImage) {
    storedImages = [];
    for (const img of images) {
      try {
        storedImages.push(await cb.persistImage(img));
      } catch {
        storedImages.push(img);
      }
    }
  }
  const userMsg: ChatMessage = {
    id: uid("msg"),
    conversationId: e.convo.id,
    role: "user",
    content: trimmed,
    images: storedImages?.length ? storedImages : undefined,
    replyTo: replyTo as any,
    createdAt: now(),
    status: "ok",
  };
  db.putJson("messages", userMsg.id, userId, userMsg, { conversation_id: e.convo.id, created_at: userMsg.createdAt });
  const convo0 = touchConvo(db, userId, e.convo, trimmed);
  cb.onUser?.(userMsg);
  bus.emit(userId, { type: "message", conversationId: e.convo.id, message: userMsg });
  bus.emit(userId, { type: "conversation", conversation: convo0 });

  // 2. resolve chat model (vision falls back to chat)
  const hasImages = !!images?.length;
  const chatRm = resolveModel("chat", e.models, e.providers, e.settings, e.agent.models);
  const visionRm = resolveModel("vision", e.models, e.providers, e.settings, e.agent.models);
  const rm = hasImages ? (visionRm ?? chatRm) : chatRm;
  if (!rm) return { userMsg, assistantMsg: null, error: "no-model" };

  // 3. rolling summary keeps context bounded
  let convo = convo0;
  const history0 = listMessages(db, userId, convo.id);
  cb.onStatus?.("summarizing");
  const summarized = await maybeSummarize(convo, e.agent as any, history0, rm as any);
  if (summarized) {
    convo = summarized;
    db.putJson("conversations", convo.id, userId, convo, { agent_id: convo.agentId, updated_at: convo.updatedAt });
  }

  // 4. story mode: resolve the scenario and the events that just fired
  let story: StoryContext | undefined;
  if (convo.mode === "story" && convo.scenarioId) {
    const resolved = resolveStory(db, userId, convo, trimmed, storyEventId);
    story = resolved.story;
    const before = convo.storyState?.triggeredEventIds?.length ?? 0;
    if (resolved.storyState && resolved.storyState.triggeredEventIds.length !== before) {
      convo = { ...convo, storyState: resolved.storyState };
      db.putJson("conversations", convo.id, userId, convo, { agent_id: convo.agentId, updated_at: convo.updatedAt });
      bus.emit(userId, { type: "conversation", conversation: convo });
    }
  }

  // 5. build context (memory retrieval happens inside buildContextMessages)
  // the vision model gets the original data URLs (not the stored paths)
  const modelImages = images?.length ? images : undefined;
  const context = await buildContextMessages(
    e.agent,
    convo,
    listMessages(db, userId, convo.id).map((m) => (m.id === userMsg.id && modelImages ? { ...m, images: modelImages } : m)),
    e.settings,
    e.models,
    e.providers,
    story
  );
  const assistantMsg: ChatMessage = {
    id: uid("msg"),
    conversationId: convo.id,
    role: "assistant",
    agentId: e.agent.id,
    content: "",
    createdAt: now(),
    status: undefined as any,
  };
  try {
    await chatComplete(rm, context, {
      signal,
      temperature: e.settings.genParams?.temperature,
      maxTokens: e.settings.genParams?.maxTokens,
      onDelta: (d) => {
        assistantMsg.content += d;
        cb.onDelta?.(d);
      },
    });
    assistantMsg.status = "ok";
  } catch (err: any) {
    if (err?.name === "AbortError" || signal?.aborted) {
      assistantMsg.status = "aborted";
      assistantMsg.content = assistantMsg.content;
    } else {
      assistantMsg.content = assistantMsg.content || friendlyError(err);
      assistantMsg.status = "error";
    }
  }
  db.putJson("messages", assistantMsg.id, userId, assistantMsg, { conversation_id: convo.id, created_at: assistantMsg.createdAt });
  const convoAfter = touchConvo(db, userId, convo, assistantMsg.content);
  bus.emit(userId, { type: "message", conversationId: convo.id, message: assistantMsg });
  bus.emit(userId, { type: "conversation", conversation: convoAfter });
  cb.onMessage?.(assistantMsg);

  // 5. background jobs: title & memory extraction (fire-and-forget)
  const firstUser = history0.find((m) => m.role === "user");
  if (!convo.title && firstUser && assistantMsg.status === "ok") {
    generateTitle(firstUser.content, assistantMsg.content, rm as any)
      .then((title) => {
        if (title) {
          const fresh = db.getJson<Conversation>("conversations", convo.id);
          if (fresh && !fresh.title) {
            db.putJson("conversations", convo.id, userId, { ...fresh, title }, { agent_id: fresh.agentId, updated_at: fresh.updatedAt });
          }
        }
      })
      .catch(() => {});
  }
  if (e.agent.memoryEnabled !== false) {
    const recent = listMessages(db, userId, convo.id).slice(-6);
    const embRm = resolveModel("embedding", e.models, e.providers, e.settings, e.agent.models);
    extractMemories(e.agent as any, recent, rm as any, embRm).catch(() => {});
  }

  return { userMsg, assistantMsg, error: assistantMsg.status === "error" ? assistantMsg.content : undefined };
}

// ----------------------------------------------------------------
// Group turn (multi-agent round table)
// ----------------------------------------------------------------
export async function runGroupTurn(
  db: HubDB,
  userId: string,
  e: { convo: Conversation; settings: Settings; models: ModelConfig[]; providers: Provider[]; agents: Agent[] },
  userText: string,
  images: string[] | undefined,
  cb: TurnCallbacks,
  signal?: AbortSignal
): Promise<void> {
  const participants = e.convo.participants ?? [];
  const text = userText.trim();
  if (!text && !images?.length) return;

  const userMsg: ChatMessage = {
    id: uid("msg"),
    conversationId: e.convo.id,
    role: "user",
    content: text,
    images: images?.length ? images : undefined,
    createdAt: now(),
    status: "ok",
  };
  db.putJson("messages", userMsg.id, userId, userMsg, { conversation_id: e.convo.id, created_at: userMsg.createdAt });
  touchConvo(db, userId, e.convo, text);
  cb.onUser?.(userMsg);
  bus.emit(userId, { type: "message", conversationId: e.convo.id, message: userMsg });

  const replyOrder = replyingParticipants(participants, text, e.agents);
  if (!replyOrder.length) return;

  // embed the query once, reuse across agents
  let queryVec: number[] | null = null;
  const embeddingRm = resolveModel("embedding", e.models, e.providers, e.settings, undefined);
  if (embeddingRm && text) {
    try {
      queryVec = await embedText(embeddingRm, text.slice(0, 500));
    } catch {
      queryVec = null;
    }
  }

  for (const p of replyOrder) {
    const agent = e.agents.find((a) => a.id === p.agentId);
    if (!agent) continue;
    const rm = resolveModel("chat", e.models, e.providers, e.settings, agent.models);
    if (!rm) continue;

    let memories: MemoryItem[] = [];
    try {
      memories = await retrieveMemories(agent.id, text, embeddingRm, queryVec);
    } catch {}

    const ctx = buildGroupContext(agent, e.convo, listMessages(db, userId, e.convo.id), e.agents, e.settings, memories);
    const assistantMsg: ChatMessage = {
      id: uid("msg"),
      conversationId: e.convo.id,
      role: "assistant",
      agentId: agent.id,
      content: "",
      createdAt: now(),
      status: undefined as any,
    };
    try {
      await chatComplete(rm, ctx, {
        signal,
        temperature: e.settings.genParams?.temperature,
        maxTokens: e.settings.genParams?.maxTokens,
        onDelta: (d) => {
          assistantMsg.content += d;
          cb.onAgentDelta?.(agent.id, d);
        },
      });
      assistantMsg.status = "ok";
    } catch (err: any) {
      if (err?.name === "AbortError" || signal?.aborted) {
        assistantMsg.status = "aborted";
      } else {
        assistantMsg.content = assistantMsg.content || friendlyError(err);
        assistantMsg.status = "error";
      }
    }
    db.putJson("messages", assistantMsg.id, userId, assistantMsg, { conversation_id: e.convo.id, created_at: assistantMsg.createdAt });
    const after = touchConvo(db, userId, e.convo, assistantMsg.content);
    bus.emit(userId, { type: "message", conversationId: e.convo.id, message: assistantMsg });
    bus.emit(userId, { type: "conversation", conversation: after });
    cb.onMessage?.(assistantMsg);
  }
}

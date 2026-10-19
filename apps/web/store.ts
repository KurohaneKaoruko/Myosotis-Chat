import { create } from "zustand";
import { persist } from "zustand/middleware";
import { toast } from "sonner";
import { setLanguage, t, tf, dateLocale } from "./i18n";
import { db, exportAll, importAll, getDbMode, remoteDB, apiBase } from "./lib/db";
import { mergeAgentConversations } from "./lib/migrate";
import { chatComplete, embedText } from "@myosotis/core";
import { buildContextMessages, extractMemories, maybeSummarize, generateTitle, retrieveMemories } from "@myosotis/core";
import { buildGroupContext, replyingParticipants, visibleAgentIds } from "@myosotis/core";
import { uid, now, resolveModel, resolveGenParams, friendlyError, plainPreview } from "@myosotis/core";
import {
  DEFAULT_SETTINGS,
  type Agent,
  type ChatMessage,
  type Conversation,
  type GroupParticipant,
  type MemoryItem,
  type ModelConfig,
  type ModelRole,
  type Provider,
  type Scenario,
  type ScenarioEvent,
  type Settings,
} from "@myosotis/core";

export type View = "chat" | "memory" | "settings";

// ----------------------------------------------------------------
// Hub (remote) mode: run one turn on the server over SSE.
// Mirrors the local flow's UX: optimistic user bubble, streamed
// assistant text, persisted messages returned as events.
// ----------------------------------------------------------------
async function sendRemoteTurn(
  get: () => any,
  set: (patch: any) => void,
  convo: Conversation,
  text: string,
  images: string[] | undefined,
  replyTo: { id: string; role: string; content: string } | undefined
) {
  const trimmed = text.trim();
  if (!trimmed && !images?.length) return;
  const agent = get().agents.find((a: Agent) => a.id === convo.agentId);
  set({ streamingConvoId: convo.id, streamingAgentId: null, streamText: "" });

  // optimistic user bubble (server returns the canonical one)
  const optimistic: ChatMessage = {
    id: uid("msg"),
    conversationId: convo.id,
    role: "user",
    content: trimmed,
    images: images?.length ? images : undefined,
    replyTo: replyTo as any,
    createdAt: now(),
    status: "ok",
  };
  set((s: any) => ({ messages: [...s.messages, optimistic], replyTo: null }));

  try {
    const res = await fetch(apiBase() + "/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ conversationId: convo.id, text: trimmed, images, replyTo }),
    });
    if (res.status === 401) {
      window.dispatchEvent(new CustomEvent("myo:unauthorized"));
      return;
    }
    if (!res.ok || !res.body) throw new Error(`hub ${res.status}`);

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    let agentStreams = new Map<string, string>(); // group mode per-agent text
    let lastAssistant: ChatMessage | null = null;

    const handleEvent = (event: string, dataRaw: string) => {
      let data: any;
      try {
        data = JSON.parse(dataRaw);
      } catch {
        return;
      }
      if (event === "delta") {
        if (data.agentId) {
          // group frame
          const cur = (agentStreams.get(data.agentId) ?? "") + data.delta;
          agentStreams.set(data.agentId, cur);
          set({ streamingAgentId: data.agentId, streamText: cur });
        } else {
          set((s: any) => ({ streamText: s.streamText + data.delta }));
        }
      } else if (event === "message") {
        lastAssistant = data as ChatMessage;
        const finished: ChatMessage = data;
        remoteDB.messages.cache.set(finished.id, finished);
        set((s: any) => ({
          messages: [...s.messages.filter((m: ChatMessage) => m.id !== optimistic.id), finished],
          streamText: "",
        }));
        // subtle "reply arrived" haptic (ignored where unsupported)
        try {
          navigator.vibrate?.(15);
        } catch {}
      } else if (event === "error") {
        toast.error(String(data?.message ?? "hub error"));
      }
    };

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buf.indexOf("\n\n")) >= 0) {
        const frame = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        let event = "message";
        const dataLines: string[] = [];
        for (const line of frame.split("\n")) {
          if (line.startsWith("event: ")) event = line.slice(7).trim();
          else if (line.startsWith("data: ")) dataLines.push(line.slice(6));
        }
        if (dataLines.length) handleEvent(event, dataLines.join("\n"));
      }
    }
  } catch (e: any) {
    toast.error(friendlyError(e));
  } finally {
    set({ streamingConvoId: null, streamingAgentId: null, streamText: "" });
    // refresh conversation meta (title may have been generated server-side)
    try {
      const data = await remoteDB.bootstrap();
      set({
        convos: sortConvos(data.conversations ?? []),
        memories: undefined,
      });
    } catch {}
  }
}

function sortConvos(list: Conversation[]): Conversation[] {
  return [...list].sort(
    (a, b) =>
      Number(!!a.archived) - Number(!!b.archived) ||
      Number(b.pinned ?? false) - Number(a.pinned ?? false) ||
      b.updatedAt - a.updatedAt
  );
}

interface Toast {
  text: string;
  kind: "info" | "error" | "success";
}

interface AppState {
  // ----- data -----
  providers: Provider[];
  models: ModelConfig[];
  agents: Agent[];
  convos: Conversation[];
  messages: ChatMessage[]; // messages of the active conversation
  scenarios: Scenario[];
  settings: Settings;
  ready: boolean;

  // ----- ui -----
  view: View;
  activeConvoId: string | null;
  editingAgentId: string | null; // agent editor open
  sidebarOpen: boolean; // mobile drawer
  streamingConvoId: string | null;
  /** group chat: which participant is currently composing a reply */
  streamingAgentId: string | null;
  streamText: string;
  memoryAgentFilter: string | null;
  confirmOptions: { title: string; message: string; confirmText?: string; danger?: boolean } | null;
  replyTo: { role: "user" | "assistant"; content: string } | null;
  pendingImages: string[];
  multiSelectActive: boolean;
  multiSelectIds: string[];

  // ----- lifecycle -----
  init: () => Promise<void>;
  showToast: (text: string, kind?: Toast["kind"]) => void;
  askConfirm: (opts: { title: string; message: string; confirmText?: string; danger?: boolean }) => Promise<boolean>;
  resolveConfirm: (ok: boolean) => void;
  setReplyTo: (r: { role: "user" | "assistant"; content: string } | null) => void;
  addPendingImages: (urls: string[]) => void;
  consumePendingImages: () => void;
  enterMultiSelect: (firstId?: string) => void;
  toggleMultiSelect: (id: string) => void;
  exitMultiSelect: () => void;
  deleteSelected: () => Promise<void>;
  setSettings: (patch: Partial<Settings>) => void;
  setView: (v: View) => void;
  setSidebar: (open: boolean) => void;
  setEditingAgentId: (id: string | null) => void;

  // ----- providers & models -----
  addProvider: (p: Omit<Provider, "id" | "createdAt">) => Promise<Provider>;
  updateProvider: (id: string, patch: Partial<Provider>) => Promise<void>;
  removeProvider: (id: string) => Promise<void>;
  addModels: (providerId: string, names: string[], roles: ModelRole[]) => Promise<void>;
  updateModel: (id: string, patch: Partial<ModelConfig>) => Promise<void>;
  removeModel: (id: string) => Promise<void>;
  setDefault: (role: ModelRole, modelId: string | null) => void;

  // ----- agents -----
  createAgent: () => Promise<Agent>;
  updateAgent: (id: string, patch: Partial<Agent>) => Promise<void>;
  deleteAgent: (id: string) => Promise<void>;

  // ----- conversations -----
  openOrCreateConversation: (agentId: string) => Promise<string>;
  openConversation: (id: string) => Promise<void>;
  deleteConversation: (id: string) => Promise<void>;
  pinConversation: (id: string, pinned: boolean) => Promise<void>;
  archiveConversation: (id: string, archived: boolean) => Promise<void>;
  duplicateConversation: (id: string) => Promise<void>;
  setConversationTags: (id: string, tags: string[]) => Promise<void>;
  renameConversation: (id: string, title: string) => Promise<void>;
  clearConversation: (id: string) => Promise<void>;
  exportConversation: (id: string) => Promise<void>;

  // ----- group chat -----
  createGroupConversation: (title: string, participants: GroupParticipant[]) => Promise<string>;
  updateGroupConversation: (id: string, patch: Partial<Pick<Conversation, "title" | "participants">>) => Promise<void>;
  sendGroupTurn: (
    convoId: string,
    text: string,
    images?: string[],
    replyTo?: { role: "user" | "assistant"; content: string }
  ) => Promise<void>;

  // ----- messaging -----
  send: (text: string, images?: string[], replyTo?: { role: "user" | "assistant"; content: string }) => Promise<void>;
  stop: () => void;
  regenerate: () => Promise<void>;
  undoLastTurn: () => Promise<void>;
  deleteMessage: (id: string) => Promise<void>;
  editAndResend: (messageId: string, newText: string) => Promise<void>;

  // ----- memories -----
  addMemory: (m: Omit<MemoryItem, "id" | "createdAt" | "updatedAt" | "hitCount" | "pinned">) => Promise<void>;
  updateMemory: (id: string, patch: Partial<MemoryItem>) => Promise<void>;
  deleteMemory: (id: string) => Promise<void>;

  // ----- scenarios (story mode) -----
  saveScenario: (s: Scenario) => Promise<void>;
  deleteScenario: (id: string) => Promise<void>;
  duplicateScenario: (id: string) => Promise<Scenario | null>;
  enterStoryMode: (convoId: string, scenarioId: string) => Promise<void>;
  exitStoryMode: (convoId: string) => Promise<void>;
  triggerNextStoryEvent: (convoId: string) => Promise<ScenarioEvent | null>;

  // ----- backup -----
  backup: () => Promise<void>;
  restore: (file: File) => Promise<void>;
}

const abortRef: { current: AbortController | null } = { current: null };
const extractCounter: Record<string, number> = {}; // convoId -> user turns since last extraction
// manual "advance plot" event waiting to be injected into the next send()
const pendingStoryEvent: { current: { convoId: string; eventId: string } | null } = { current: null };
let initStarted = false; // React StrictMode double-invokes effects
let confirmResolver: ((ok: boolean) => void) | null = null;

function guessRoles(name: string): ModelRole[] {
  const n = name.toLowerCase();
  if (/embed|bge|m3e|text-embed/.test(n)) return ["embedding"];
  if (/whisper|transcribe|asr|stt/.test(n)) return ["stt"];
  if (/tts|speech|audio-speech|voice/.test(n)) return ["tts"];
  // modern multimodal chat models
  if (/gpt-4o|gpt-4\.1|o[34]|vision|claude|gemini|doubao|qwen-vl|glm-4v|vl-|multimodal|grok/i.test(n)) return ["chat", "vision"];
  return ["chat"];
}

export const useStore = create<AppState>()(
  persist(
    (set, get) => ({
      providers: [],
      models: [],
      agents: [],
      convos: [],
      messages: [],
      scenarios: [],
      settings: DEFAULT_SETTINGS,
      ready: false,

      view: "chat",
      activeConvoId: null,
      editingAgentId: null,
      sidebarOpen: false,
      streamingConvoId: null,
      streamingAgentId: null,
      streamText: "",
      memoryAgentFilter: null,
      confirmOptions: null,
      replyTo: null,
      pendingImages: [],
      multiSelectActive: false,
      multiSelectIds: [],

      // -------------------------------------------------------
      async init() {
        if (initStarted) return; // React StrictMode runs effects twice
        initStarted = true;
        // remote (hub) mode: one fetch bootstraps every table cache
        if (getDbMode() === "remote") {
          try {
            const data = await remoteDB.bootstrap();
            const convos = sortConvos(data.conversations ?? []);
            const settings = { ...DEFAULT_SETTINGS, ...(data.settings ?? {}) };
            set({
              providers: data.providers ?? [],
              models: data.models ?? [],
              agents: [...(data.agents ?? [])].sort((a, b) => a.createdAt - b.createdAt),
              convos,
              scenarios: data.scenarios ?? [],
              settings,
              ready: true,
            });
            const last = get().activeConvoId;
            if (last && convos.some((c) => c.id === last)) await get().openConversation(last);
            else if (convos[0]) await get().openConversation(convos[0].id);
          } catch (e: any) {
            console.error("[init] hub bootstrap failed:", e);
            if (String(e?.message) === "unauthorized") window.dispatchEvent(new CustomEvent("myo:unauthorized"));
          }
          return;
        }
        // one-time merge so every agent owns exactly one conversation
        let convoRemap: Map<string, string> | null = null;
        try {
          convoRemap = await mergeAgentConversations();
        } catch (e) {
          console.error("[init] conversation merge migration failed:", e);
        }
        let providers: Provider[] = [];
        let models: ModelConfig[] = [];
        let agents: Agent[] = [];
        let convos: Conversation[] = [];
        let scenarios: Scenario[] = [];
        try {
          [providers, models, agents, convos, scenarios] = await Promise.all([
            db.providers.toArray(),
            db.models.toArray(),
            db.agents.orderBy("createdAt").toArray(),
            db.conversations.orderBy("updatedAt").reverse().toArray(),
            db.scenarios.toArray(),
          ]);
          convos = sortConvos(convos);
        } catch (e) {
          console.error("[init] database error:", e);
          get().showToast(t("dbReadFailed"), "error");
        }
        set({ providers, models, agents, convos, scenarios, ready: true });
        // restore last conversation; remap if it was merged away
        const last = get().activeConvoId;
        const target = last ? (convoRemap?.get(last) ?? last) : null;
        if (target && convos.some((c) => c.id === target)) {
          try {
            await get().openConversation(target);
          } catch {}
        } else if (convos[0]) {
          await get().openConversation(convos[0].id);
        }
        // fire-and-forget scheduled auto backup (WebDAV)
        const wd = get().settings.webdav;
        if (wd && wd.autoBackup !== "off" && wd.url.trim()) {
          const lastBk = Number(localStorage.getItem("myosotis.lastAutoBackup") || 0);
          const interval = wd.autoBackup === "daily" ? 86400000 : 7 * 86400000;
          if (Date.now() - lastBk > interval) {
            import("./lib/backup")
              .then(({ webdavBackup }) =>
                webdavBackup(
                  { url: wd.url, username: wd.username, password: wd.appPassword, directory: wd.directory },
                  { encrypt: wd.encrypt, backupPassword: wd.backupPassword }
                )
              )
              .then((f) => {
                localStorage.setItem("myosotis.lastAutoBackup", String(Date.now()));
                get().showToast(tf("autoBackupDone", { file: f }), "success");
              })
              .catch((e) => get().showToast(tf("autoBackupFailed", { err: e?.message ?? e }), "error"));
          }
        }
      },

      showToast(text, kind = "info") {
        if (kind === "error") toast.error(text);
        else if (kind === "success") toast.success(text);
        else toast(text);
      },

      askConfirm(opts) {
        set({ confirmOptions: opts });
        return new Promise<boolean>((res) => {
          confirmResolver = res;
        });
      },
      resolveConfirm(ok) {
        confirmResolver?.(ok);
        confirmResolver = null;
        set({ confirmOptions: null });
      },
      setReplyTo(r) {
        set({ replyTo: r });
      },
      addPendingImages(urls) {
        set((s) => ({ pendingImages: [...s.pendingImages, ...urls].slice(0, 4) }));
      },
      consumePendingImages() {
        set({ pendingImages: [] });
      },
      enterMultiSelect(firstId) {
        set({ multiSelectActive: true, multiSelectIds: firstId ? [firstId] : [] });
      },
      toggleMultiSelect(id) {
        set((s) => ({
          multiSelectIds: s.multiSelectIds.includes(id)
            ? s.multiSelectIds.filter((x) => x !== id)
            : [...s.multiSelectIds, id],
        }));
      },
      exitMultiSelect() {
        set({ multiSelectActive: false, multiSelectIds: [] });
      },
      async deleteSelected() {
        const ids = get().multiSelectIds;
        if (!ids.length) return;
        const convoId = get().activeConvoId;
        await db.messages.bulkDelete(ids);
        set((s) => ({
          messages: s.messages.filter((m) => !ids.includes(m.id)),
          multiSelectActive: false,
          multiSelectIds: [],
        }));
        if (convoId) {
          const last = await db.messages.where("conversationId").equals(convoId).reverse().sortBy("createdAt");
          const lastMsg = last[0];
          const patch = {
            lastMessage: lastMsg ? (lastMsg.content || "…").slice(0, 40) : "",
            messageCount: await db.messages.where("conversationId").equals(convoId).count(),
            lastMessageRole: lastMsg?.role,
          };
          await db.conversations.update(convoId, patch);
          set((s) => ({ convos: s.convos.map((c) => (c.id === convoId ? { ...c, ...patch } : c)) }));
        }
        get().showToast(tf("deletedNMsgs", { n: ids.length }), "success");
      },

      setSettings(patch) {
        const next = { ...get().settings, ...patch };
        set({ settings: next });
        applyTheme(next);
        if (patch.language) setLanguage(patch.language);
        // hub mode: persist settings server-side (shared across devices)
        if (getDbMode() === "remote") {
          fetch(apiBase() + "/api/data/settings", {
            method: "PUT",
            headers: { "content-type": "application/json" },
            credentials: "include",
            body: JSON.stringify(next),
          }).catch(() => {});
        }
      },
      setView(v) {
        set({ view: v, sidebarOpen: false });
      },
      setSidebar(open) {
        set({ sidebarOpen: open });
      },
      setEditingAgentId(id) {
        set({ editingAgentId: id });
      },

      // -------------------------------------------------------
      async addProvider(p) {
        const provider: Provider = { ...p, id: uid("prv"), createdAt: now() };
        await db.providers.add(provider);
        set({ providers: [...get().providers, provider] });
        return provider;
      },
      async updateProvider(id, patch) {
        await db.providers.update(id, patch);
        set({ providers: get().providers.map((p) => (p.id === id ? { ...p, ...patch } : p)) });
      },
      async removeProvider(id) {
        await db.transaction("rw", db.providers, db.models, async () => {
          await db.providers.delete(id);
          const doomed = await db.models.where("providerId").equals(id).primaryKeys();
          await db.models.bulkDelete(doomed);
        });
        const s = get().settings;
        const defaults = { ...s.defaults };
        for (const k of Object.keys(defaults) as ModelRole[]) {
          const mid = defaults[k];
          if (mid && !get().models.find((m) => m.id === mid && m.providerId !== id)) defaults[k] = null;
        }
        set({
          providers: get().providers.filter((p) => p.id !== id),
          models: get().models.filter((m) => m.providerId !== id),
          settings: { ...s, defaults },
        });
      },
      async addModels(providerId, names, roles) {
        const existing = new Set(get().models.filter((m) => m.providerId === providerId).map((m) => m.name));
        const fresh: ModelConfig[] = names
          .filter((n) => n && !existing.has(n))
          .map((name) => ({
            id: uid("mdl"),
            name,
            providerId,
            label: name,
            roles: roles.length ? roles : guessRoles(name),
          }));
        if (fresh.length) await db.models.bulkAdd(fresh);
        const models = [...get().models, ...fresh];
        // auto-fill empty role defaults
        const defaults = { ...get().settings.defaults };
        for (const role of ["chat", "vision", "embedding", "tts", "stt"] as ModelRole[]) {
          if (!defaults[role]) {
            const hit = models.find((m) => m.roles.includes(role));
            if (hit) defaults[role] = hit.id;
          }
        }
        set({ models, settings: { ...get().settings, defaults } });
      },
      async updateModel(id, patch) {
        await db.models.update(id, patch);
        set({ models: get().models.map((m) => (m.id === id ? { ...m, ...patch } : m)) });
      },
      async removeModel(id) {
        await db.models.delete(id);
        const defaults = { ...get().settings.defaults };
        for (const k of Object.keys(defaults) as ModelRole[]) if (defaults[k] === id) defaults[k] = null;
        set({ models: get().models.filter((m) => m.id !== id), settings: { ...get().settings, defaults } });
      },
      setDefault(role, modelId) {
        set({ settings: { ...get().settings, defaults: { ...get().settings.defaults, [role]: modelId } } });
      },

      // -------------------------------------------------------
      async createAgent() {
        const agent: Agent = {
          id: uid("agt"),
          name: t("newAgent"),
          emoji: "✨",
          hue: Math.floor(Math.random() * 360),
          persona: "",
          speechRules: "",
          greeting: "",
          suggestions: [],
          memoryEnabled: true,
          models: {},
          createdAt: now(),
          updatedAt: now(),
        };
        await db.agents.add(agent);
        set({ agents: [...get().agents, agent], editingAgentId: agent.id });
        return agent;
      },
      async updateAgent(id, patch) {
        await db.agents.update(id, { ...patch, updatedAt: now() });
        set({ agents: get().agents.map((a) => (a.id === id ? { ...a, ...patch, updatedAt: now() } : a)) });
      },
      async deleteAgent(id) {
        await db.transaction("rw", db.agents, db.conversations, db.messages, db.memories, db.scenarios, async () => {
          // only direct conversations belong to the agent; group chats survive
          const owned = await db.conversations.where("agentId").equals(id).toArray();
          const convoIds = owned.filter((c) => c.kind !== "group").map((c) => c.id);
          await db.conversations.bulkDelete(convoIds);
          await db.messages.where("conversationId").anyOf(convoIds).delete();
          await db.memories.where("agentId").equals(id).delete();
          await db.scenarios.where("agentId").equals(id).delete();
          await db.agents.delete(id);
        });
        // drop the agent from every group it was part of
        const groups = get().convos.filter(
          (c) => c.kind === "group" && (c.participants ?? []).some((p) => p.agentId === id)
        );
        const groupPatches = new Map<string, GroupParticipant[]>();
        for (const g of groups) {
          const participants = (g.participants ?? [])
            .filter((p) => p.agentId !== id)
            .map((p, i) => ({ ...p, sortOrder: i }));
          groupPatches.set(g.id, participants);
          await db.conversations.update(g.id, { participants });
        }
        const convos = get()
          .convos.filter((c) => c.kind === "group" || c.agentId !== id)
          .map((c) => (groupPatches.has(c.id) ? { ...c, participants: groupPatches.get(c.id)! } : c));
        const activeLost = convos.every((c) => c.id !== get().activeConvoId);
        set({
          agents: get().agents.filter((a) => a.id !== id),
          convos: sortConvos(convos),
          scenarios: get().scenarios.filter((s) => s.agentId !== id),
          activeConvoId: activeLost ? convos[0]?.id ?? null : get().activeConvoId,
          editingAgentId: null,
        });
        if (activeLost && get().activeConvoId) await get().openConversation(get().activeConvoId!);
      },

      // -------------------------------------------------------
      async openOrCreateConversation(agentId) {
        const agent = get().agents.find((a) => a.id === agentId);
        if (!agent) return "";
        const existing = get().convos.find((c) => c.agentId === agentId);
        if (existing) {
          await get().openConversation(existing.id);
          return existing.id;
        }
        const convo: Conversation = {
          id: uid("cnv"),
          agentId,
          title: t("newChat"),
          lastMessage: agent.greeting.trim() ? plainPreview(agent.greeting) : "",
          messageCount: agent.greeting.trim() ? 1 : 0,
          lastMessageRole: agent.greeting.trim() ? "assistant" : undefined,
          summary: "",
          summarizedUntil: 0,
          createdAt: now(),
          updatedAt: now(),
        };
        await db.conversations.add(convo);
        let greeting: ChatMessage | null = null;
        if (agent.greeting.trim()) {
          greeting = {
            id: uid("msg"),
            conversationId: convo.id,
            role: "assistant",
            content: agent.greeting,
            createdAt: now() + 1,
            status: "ok",
          };
          await db.messages.add(greeting);
        }
        set({
          convos: sortConvos([convo, ...get().convos]),
          activeConvoId: convo.id,
          messages: greeting ? [greeting] : [],
          view: "chat",
          sidebarOpen: false,
        });
        return convo.id;
      },
      async openConversation(id) {
        let messages: ChatMessage[];
        if (getDbMode() === "remote") {
          messages = await remoteDB.loadMessages(id);
        } else {
          messages = await db.messages.where("conversationId").equals(id).sortBy("createdAt");
        }
        messages.sort((a, b) => a.createdAt - b.createdAt);
        set({ activeConvoId: id, messages, view: "chat", sidebarOpen: false });
      },
      async deleteConversation(id) {
        if (getDbMode() === "remote") {
          await fetch(`/api/conversations/${encodeURIComponent(id)}`, { method: "DELETE" });
          remoteDB.conversations.cache.delete(id);
          for (const [mid, m] of remoteDB.messages.cache) if (m.conversationId === id) remoteDB.messages.cache.delete(mid);
        } else {
          await db.transaction("rw", db.conversations, db.messages, async () => {
            await db.conversations.delete(id);
            await db.messages.where("conversationId").equals(id).delete();
          });
        }
        const convos = get().convos.filter((c) => c.id !== id);
        const wasActive = get().activeConvoId === id;
        set({ convos });
        if (wasActive) {
          set({ activeConvoId: convos[0]?.id ?? null, messages: [] });
          if (convos[0]) await get().openConversation(convos[0].id);
        }
      },
      async pinConversation(id, pinned) {
        await db.conversations.update(id, { pinned });
        set({ convos: sortConvos(get().convos.map((c) => (c.id === id ? { ...c, pinned } : c))) });
      },
      async archiveConversation(id, archived) {
        // archiving a pinned conversation also unpins it (ported behaviour)
        const patch: Partial<Conversation> = archived ? { archived: true, pinned: false } : { archived: false };
        await db.conversations.update(id, patch);
        set({ convos: sortConvos(get().convos.map((c) => (c.id === id ? { ...c, ...patch } : c))) });
        get().showToast(t(archived ? "archivedToast" : "unarchivedToast"), "success");
      },
      async duplicateConversation(id) {
        const src = get().convos.find((c) => c.id === id);
        if (!src) return;
        const msgs = await db.messages.where("conversationId").equals(id).sortBy("createdAt");
        const copy: Conversation = {
          ...src,
          id: uid("cnv"),
          title: `${src.title} ${t("copySuffix")}`,
          pinned: false,
          archived: false,
          createdAt: now(),
          updatedAt: now(),
        };
        await db.conversations.add(copy);
        if (msgs.length) {
          await db.messages.bulkAdd(
            msgs.map((m) => ({ ...m, id: uid("msg"), conversationId: copy.id }))
          );
        }
        set({ convos: sortConvos([copy, ...get().convos]) });
        get().showToast(t("convoDuplicated"), "success");
      },
      async setConversationTags(id, tags) {
        const clean = Array.from(new Set(tags.map((x) => x.trim()).filter(Boolean))).slice(0, 6);
        await db.conversations.update(id, { tags: clean });
        set({ convos: get().convos.map((c) => (c.id === id ? { ...c, tags: clean } : c)) });
      },
      async renameConversation(id, title) {
        const t = title.trim().slice(0, 24);
        if (!t) return;
        await db.conversations.update(id, { title: t });
        set({ convos: get().convos.map((c) => (c.id === id ? { ...c, title: t } : c)) });
      },
      async clearConversation(id) {
        await db.messages.where("conversationId").equals(id).delete();
        await db.conversations.update(id, {
          summary: "",
          summarizedUntil: 0,
          lastMessage: "",
          messageCount: 0,
          lastMessageRole: undefined,
          title: t("newChat"),
        });
        const agent = get().agents.find((a) => a.id === get().convos.find((c) => c.id === id)?.agentId);
        set({
          convos: get().convos.map((c) =>
            c.id === id
              ? { ...c, summary: "", summarizedUntil: 0, lastMessage: "", messageCount: 0, lastMessageRole: undefined, title: t("newChat") }
              : c
          ),
          messages: [],
        });
        // restore greeting like a fresh conversation
        if (agent?.greeting.trim() && get().activeConvoId === id) {
          const greeting = {
            id: uid("msg"),
            conversationId: id,
            role: "assistant" as const,
            content: agent.greeting,
            createdAt: Date.now() + 1,
            status: "ok" as const,
          };
          await db.messages.add(greeting);
          await db.conversations.update(id, { messageCount: 1, lastMessageRole: "assistant" });
          set((s) => ({
            messages: [greeting],
            convos: s.convos.map((c) =>
              c.id === id ? { ...c, messageCount: 1, lastMessageRole: "assistant" as const } : c
            ),
          }));
        }
      },
      async exportConversation(id) {
        const [convo, msgs] = await Promise.all([
          db.conversations.get(id),
          db.messages.where("conversationId").equals(id).sortBy("createdAt"),
        ]);
        if (!convo) return;
        const agent = get().agents.find((a) => a.id === convo.agentId);
        const lines = [`# ${agent?.name ?? "AI"} · ${convo.title}`, ""];
        for (const m of msgs) {
          const who = m.role === "user" ? get().settings.userName || t("me") : agent?.name ?? "AI";
          const time = new Date(m.createdAt).toLocaleString(dateLocale());
          lines.push(`**${who}** · ${time}`, "", m.content, "");
        }
        const blob = new Blob([lines.join("\n")], { type: "text/markdown;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${convo.title || t("convoFile")}.md`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 5000);
        get().showToast(t("exportedMdDone"), "success");
      },

      // -------------------------------------------------------
      // Group chat (multi-agent round table)
      // -------------------------------------------------------
      async createGroupConversation(title, participants) {
        const convo: Conversation = {
          id: uid("cnv"),
          // groups are addressed through participants, not a single owner
          agentId: "",
          title: title.trim() || t("newGroup"),
          lastMessage: "",
          messageCount: 0,
          kind: "group",
          participants: participants.map((p, i) => ({ ...p, sortOrder: i })),
          summary: "",
          summarizedUntil: 0,
          createdAt: now(),
          updatedAt: now(),
        };
        await db.conversations.add(convo);
        set((s) => ({
          convos: sortConvos([convo, ...s.convos]),
          activeConvoId: convo.id,
          messages: [],
          view: "chat",
          sidebarOpen: false,
        }));
        return convo.id;
      },
      async updateGroupConversation(id, patch) {
        const next = patch.participants
          ? { ...patch, participants: patch.participants.map((p, i) => ({ ...p, sortOrder: i })) }
          : patch;
        await db.conversations.update(id, next);
        set((s) => ({ convos: s.convos.map((c) => (c.id === id ? { ...c, ...next } : c)) }));
      },
      async sendGroupTurn(convoId, text, images, replyTo) {
        const convo = get().convos.find((c) => c.id === convoId);
        if (!convo || convo.kind !== "group") return;
        const participants = convo.participants ?? [];
        const { models, providers, settings, agents } = get();
        if (!participants.length) {
          get().showToast(t("groupNoParticipants"), "error");
          return;
        }
        const trimmed = text.trim();
        if (!trimmed && !images?.length) return;

        // 1. persist the user message together with who may see it
        const visible = visibleAgentIds(participants, trimmed, agents);
        const userMsg: ChatMessage = {
          id: uid("msg"),
          conversationId: convo.id,
          role: "user",
          content: trimmed,
          images: images?.length ? images : undefined,
          replyTo: replyTo ?? undefined,
          visibleTo: visible,
          createdAt: now(),
          status: "ok",
        };
        await db.messages.add(userMsg);
        if (replyTo) set({ replyTo: null });
        set((s) => ({ messages: [...s.messages, userMsg] }));

        const refreshMeta = async () => {
          const all = await db.messages.where("conversationId").equals(convo.id).sortBy("createdAt");
          const last = all[all.length - 1];
          const patch: Partial<Conversation> = {
            updatedAt: now(),
            lastMessage: last ? plainPreview(last.content).slice(0, 40) || "…" : "",
            messageCount: all.length,
            lastMessageRole: last?.role,
          };
          if (convo.title === t("newGroup") && trimmed) {
            patch.title = plainPreview(trimmed).slice(0, 16) || convo.title;
          }
          await db.conversations.update(convo.id, patch);
          set((s) => ({
            convos: sortConvos(s.convos.map((c) => (c.id === convo.id ? { ...c, ...patch } : c))),
          }));
        };

        // 2. decide who answers this message
        const repliers = replyingParticipants(participants, trimmed, agents);
        if (!repliers.length) {
          await refreshMeta();
          get().showToast(t("groupNoReply"), "info");
          return;
        }

        // 3. embed the query once so every participant can reuse it
        const embRm = resolveModel("embedding", models, providers, settings);
        let qvec: number[] | null = null;
        if (embRm && trimmed) {
          try {
            qvec = await embedText(embRm, trimmed.slice(0, 500));
          } catch {
            qvec = null;
          }
        }

        const controller = new AbortController();
        abortRef.current = controller;
        set({ streamingConvoId: convo.id, streamingAgentId: null, streamText: "" });

        // 4. let each participant answer in turn, each seeing the previous replies
        for (const p of repliers) {
          if (controller.signal.aborted) break;
          const agent = agents.find((a) => a.id === p.agentId);
          if (!agent) continue;
          const rm = resolveModel("chat", models, providers, settings, agent.models);
          if (!rm) {
            get().showToast(tf("groupAgentNoModel", { name: agent.name }), "error");
            continue;
          }
          let memories: MemoryItem[] = [];
          if (agent.memoryEnabled) {
            try {
              memories = await retrieveMemories(agent.id, trimmed, embRm, qvec);
            } catch {
              memories = [];
            }
          }
          const all = await db.messages.where("conversationId").equals(convo.id).sortBy("createdAt");
          const context = buildGroupContext(agent, convo, all, agents, settings, memories);
          const gen = resolveGenParams("reply", settings, agent);

          set({ streamingAgentId: agent.id, streamText: "" });
          let full = "";
          let status: ChatMessage["status"] = "ok";
          try {
            full = await chatComplete(rm, context, {
              signal: controller.signal,
              temperature: gen.temperature,
              maxTokens: gen.maxTokens,
              topP: gen.topP,
              frequencyPenalty: gen.frequencyPenalty,
              keySeed: `${agent.id}:${trimmed}`,
              onDelta: (d) => set((s) => ({ streamText: s.streamText + d })),
            });
          } catch (e: any) {
            if (e?.name === "AbortError") {
              status = "aborted";
              full = get().streamText;
            } else {
              status = "error";
              full = friendlyError(e);
            }
          }
          if (!full.trim() && status === "error") {
            set({ streamText: "" });
            continue;
          }
          const aiMsg: ChatMessage = {
            id: uid("msg"),
            conversationId: convo.id,
            role: "assistant",
            agentId: agent.id,
            content: full,
            visibleTo: visible,
            createdAt: now(),
            status,
          };
          await db.messages.add(aiMsg);
          set((s) => ({ messages: [...s.messages, aiMsg], streamText: "" }));
        }

        abortRef.current = null;
        set({ streamingConvoId: null, streamingAgentId: null, streamText: "" });
        await refreshMeta();
      },

      // -------------------------------------------------------
      async send(text, images, replyTo) {
        const { activeConvoId } = get();
        if (!activeConvoId) return;
        if (get().streamingConvoId) return;
        const convo = get().convos.find((c) => c.id === activeConvoId);
        if (!convo) return;

        // hub mode: the server runs the whole turn (persist + memory + stream)
        if (getDbMode() === "remote") {
          await sendRemoteTurn(get, set as any, convo, text, images, replyTo as any);
          return;
        }

        // multi-agent round table has its own orchestration
        if (convo.kind === "group") {
          await get().sendGroupTurn(convo.id, text, images, replyTo);
          return;
        }
        const agent = get().agents.find((a) => a.id === convo.agentId);
        if (!agent) return;

        const trimmed = text.trim();
        if (!trimmed && !images?.length) return;

        // 1. persist user message
        const userMsg: ChatMessage = {
          id: uid("msg"),
          conversationId: convo.id,
          role: "user",
          content: trimmed,
          images: images?.length ? images : undefined,
          replyTo: replyTo ?? undefined,
          createdAt: now(),
          status: "ok",
        };
        await db.messages.add(userMsg);

        // 2. resolve model
        const { models, providers, settings } = get();
        const hasImages = !!images?.length;
        const chatRm = resolveModel("chat", models, providers, settings, agent.models);
        const visionRm = resolveModel("vision", models, providers, settings, agent.models);
        const rm = hasImages ? (visionRm ?? chatRm) : chatRm;
        if (!rm) {
          set((s) => ({ messages: [...s.messages, userMsg] }));
          get().showToast(t("sendFirst"), "error");
          set({ view: "settings" });
          return;
        }

        // 3. rolling summary (keeps context bounded)
        const allMsgs = await db.messages.where("conversationId").equals(convo.id).sortBy("createdAt");
        let currentConvo = convo;
        try {
          const summarized = await maybeSummarize(convo, agent, allMsgs, rm);
          if (summarized) {
            currentConvo = summarized;
            set({ convos: get().convos.map((c) => (c.id === summarized.id ? summarized : c)) });
          }
        } catch {}

        // 4. build context with memory retrieval (or story injection in story mode)
        let story: { scenario: Scenario; newlyTriggered: ScenarioEvent[] } | undefined;
        if (currentConvo.mode === "story" && currentConvo.scenarioId) {
          const scenario = get().scenarios.find((s) => s.id === currentConvo.scenarioId);
          if (scenario) {
            const triggered = [...(currentConvo.storyState?.triggeredEventIds ?? [])];
            const newly: ScenarioEvent[] = [];
            // manual "advance plot" event queued by the composer button;
            // it is pre-marked as triggered, so treat it as newly fired unconditionally
            if (pendingStoryEvent.current?.convoId === convo.id) {
              const ev = scenario.events.find((e) => e.id === pendingStoryEvent.current!.eventId);
              if (ev) {
                if (!triggered.includes(ev.id)) triggered.push(ev.id);
                newly.push(ev);
              }
              pendingStoryEvent.current = null;
            }
            // keyword triggers: comma-separated keywords matched against the user message
            for (const ev of scenario.events) {
              if (triggered.includes(ev.id) || newly.some((n) => n.id === ev.id)) continue;
              const keywords = ev.trigger.split(/[,，]/).map((k) => k.trim()).filter(Boolean);
              if (keywords.length && keywords.some((k) => trimmed.includes(k))) {
                triggered.push(ev.id);
                newly.push(ev);
              }
            }
            if (triggered.length !== (currentConvo.storyState?.triggeredEventIds?.length ?? 0)) {
              const storyState = {
                openedAt: currentConvo.storyState?.openedAt,
                triggeredEventIds: triggered,
              };
              await db.conversations.update(convo.id, { storyState });
              currentConvo = { ...currentConvo, storyState };
              set((s) => ({
                convos: s.convos.map((c) => (c.id === convo.id ? { ...c, storyState } : c)),
              }));
            }
            story = { scenario, newlyTriggered: newly };
          }
        }

        const context = await buildContextMessages(agent, currentConvo, allMsgs, settings, models, providers, story);

        // 5. stream
        set((s) => ({
          messages: [...s.messages, userMsg],
          streamingConvoId: convo.id,
          streamText: "",
        }));
        const controller = new AbortController();
        abortRef.current = controller;
        // count user turns for extraction trigger
        extractCounter[convo.id] = (extractCounter[convo.id] ?? 0) + 1;

        let full = "";
        let finalStatus: ChatMessage["status"] = "ok";
        // slot-level params: vision slot when images are present, reply otherwise
        const gen = resolveGenParams(hasImages ? "vision" : "reply", settings, agent);
        try {
          full = await chatComplete(rm, context, {
            signal: controller.signal,
            temperature: gen.temperature,
            maxTokens: gen.maxTokens,
            topP: gen.topP,
            frequencyPenalty: gen.frequencyPenalty,
            keySeed: `${agent.id}:${trimmed}`,
            onDelta: (d) => set((s) => ({ streamText: s.streamText + d })),
          });
        } catch (e: any) {
          if (e?.name === "AbortError") {
            finalStatus = "aborted";
            full = get().streamText;
          } else {
            finalStatus = "error";
            full = friendlyError(e);
          }
        } finally {
          abortRef.current = null;
          if (replyTo) set({ replyTo: null });
        }

        if (!full.trim() && finalStatus === "error") {
          set({ streamingConvoId: null, streamText: "" });
          get().showToast(full, "error");
          return;
        }

        // 6. persist assistant message
        const aiMsg: ChatMessage = {
          id: uid("msg"),
          conversationId: convo.id,
          role: "assistant",
          content: full,
          createdAt: now(),
          status: finalStatus,
        };
        await db.messages.add(aiMsg);

        const isFirstReal = currentConvo.title === t("newChat");
        const patch: Partial<Conversation> = {
          updatedAt: now(),
          lastMessage: plainPreview(full).slice(0, 40) || "…",
          messageCount: await db.messages.where("conversationId").equals(convo.id).count(),
          lastMessageRole: "assistant",
        };
        if (isFirstReal && trimmed) patch.title = plainPreview(trimmed).slice(0, 16) || t("newChat");
        await db.conversations.update(convo.id, patch);
        const updatedConvo = { ...currentConvo, ...patch };

        set((s) => ({
          messages: [...s.messages, aiMsg],
          streamingConvoId: null,
          streamText: "",
          convos: sortConvos([updatedConvo, ...s.convos.filter((c) => c.id !== convo.id)]),
        }));

        // 7. background jobs: title + memory extraction (fire & forget)
        const chatRmForJobs = rm;
        if (isFirstReal && trimmed) {
          generateTitle(trimmed, full, chatRmForJobs)
            .then((t) =>
              t
                ? db.conversations
                    .update(convo.id, { title: t })
                    .then(() =>
                      set((s) => ({ convos: s.convos.map((c) => (c.id === convo.id ? { ...c, title: t } : c)) }))
                    )
                : null
            )
            .catch(() => {});
        }
        if (agent.memoryEnabled && currentConvo.mode !== "story" && extractCounter[convo.id] >= 3) {
          extractCounter[convo.id] = 0;
          const embeddingRm = resolveModel("embedding", models, providers, settings, agent.models);
          const recent = [...allMsgs, userMsg, aiMsg].slice(-14);
          extractMemories(agent, recent, chatRmForJobs, embeddingRm)
            .then((n) => {
              if (n > 0) get().showToast(tf("rememberedN", { n }), "success");
            })
            .catch(() => {});
        }
      },

      stop() {
        abortRef.current?.abort();
      },

      async regenerate() {
        const { messages, activeConvoId } = get();
        if (!activeConvoId || get().streamingConvoId) return;
        // drop trailing assistant message(s), resend from last user message
        const lastUser = [...messages].reverse().find((m) => m.role === "user");
        if (!lastUser) return;
        const dropIds = messages.filter((m) => m.createdAt > lastUser.createdAt).map((m) => m.id);
        if (dropIds.length) {
          await db.messages.bulkDelete(dropIds);
          const kept = messages.filter((m) => !dropIds.includes(m.id));
          set({ messages: kept });
          await get().send(lastUser.content, lastUser.images);
        }
      },

      /**
       * Undo the last exchange (ported from the old project's undo_last_chat_turn):
       * drop the newest assistant message together with the user message it
       * answered; when there is no assistant message, drop the trailing user
       * message instead.
       */
      async undoLastTurn() {
        const { messages, activeConvoId } = get();
        if (!activeConvoId || get().streamingConvoId || !messages.length) return;

        const lastAssistantIdx = messages.map((m) => m.role).lastIndexOf("assistant");
        let doomed: ChatMessage[] = [];
        if (lastAssistantIdx >= 0) {
          const userIdx = lastAssistantIdx > 0 && messages[lastAssistantIdx - 1].role === "user" ? lastAssistantIdx - 1 : -1;
          if (userIdx < 0) {
            // only the greeting is left — nothing to undo
            get().showToast(t("nothingToUndo"));
            return;
          }
          doomed = messages.slice(userIdx);
        } else {
          const lastUserId = messages.map((m) => m.role).lastIndexOf("user");
          if (lastUserId < 0) return;
          doomed = messages.slice(lastUserId);
        }
        if (!doomed.length) return;

        const ids = doomed.map((m) => m.id);
        await db.messages.bulkDelete(ids);
        const kept = messages.filter((m) => !ids.includes(m.id));
        set({ messages: kept });
        const last = kept[kept.length - 1];
        const patch = {
          lastMessage: last ? (last.content || "…").slice(0, 40) : "",
          messageCount: kept.length,
          lastMessageRole: last?.role,
        };
        await db.conversations.update(activeConvoId, patch);
        set((s) => ({ convos: s.convos.map((c) => (c.id === activeConvoId ? { ...c, ...patch } : c)) }));
        get().showToast(tf("undoDone", { n: ids.length }), "success");
      },

      async deleteMessage(id) {        const msg = await db.messages.get(id);
        if (!msg) return;
        await db.messages.delete(id);
        set((s) => ({ messages: s.messages.filter((m) => m.id !== id) }));
        // refresh preview in list
        const last = await db.messages.where("conversationId").equals(msg.conversationId).reverse().sortBy("createdAt");
        const lastMsg = last[0];
        const patch = {
          lastMessage: lastMsg ? (lastMsg.content || "…").slice(0, 40) : "",
          messageCount: await db.messages.where("conversationId").equals(msg.conversationId).count(),
          lastMessageRole: lastMsg?.role,
        };
        await db.conversations.update(msg.conversationId, patch);
        set((s) => ({ convos: s.convos.map((c) => (c.id === msg.conversationId ? { ...c, ...patch } : c)) }));
      },

      async editAndResend(messageId, newText) {
        if (get().streamingConvoId) return;
        const msg = await db.messages.get(messageId);
        if (!msg || msg.role !== "user") return;
        const text = newText.trim();
        if (!text) return;
        // remove this message and everything after, then resend
        const all = await db.messages.where("conversationId").equals(msg.conversationId).sortBy("createdAt");
        const idx = all.findIndex((m) => m.id === messageId);
        if (idx < 0) return;
        const toDelete = all.slice(idx).map((m) => m.id);
        await db.messages.bulkDelete(toDelete);
        set({ messages: all.slice(0, idx) });
        await get().send(text, msg.images);
      },

      // -------------------------------------------------------
      async addMemory(m) {
        const item: MemoryItem = {
          ...m,
          id: uid("mem"),
          pinned: false,
          hitCount: 0,
          createdAt: now(),
          updatedAt: now(),
        };
        await db.memories.add(item);
      },
      async updateMemory(id, patch) {
        await db.memories.update(id, { ...patch, updatedAt: now() });
      },
      async deleteMemory(id) {
        await db.memories.delete(id);
      },

      // -------------------------------------------------------
      async saveScenario(s) {
        const next: Scenario = { ...s, updatedAt: now() };
        await db.scenarios.put(next);
        set((st) => ({
          scenarios: st.scenarios.some((x) => x.id === next.id)
            ? st.scenarios.map((x) => (x.id === next.id ? next : x))
            : [...st.scenarios, next],
        }));
      },
      async deleteScenario(id) {
        await db.scenarios.delete(id);
        // conversations running this scenario fall back to chat mode (messages kept)
        const affected = get().convos.filter((c) => c.scenarioId === id && c.mode === "story");
        for (const c of affected) await db.conversations.update(c.id, { mode: "chat" });
        set((st) => ({
          scenarios: st.scenarios.filter((s) => s.id !== id),
          convos: st.convos.map((c) => (c.scenarioId === id ? { ...c, mode: "chat" as const } : c)),
        }));
      },
      async duplicateScenario(id) {
        const src = get().scenarios.find((s) => s.id === id);
        if (!src) return null;
        const copy: Scenario = {
          ...src,
          id: uid("scn"),
          name: `${src.name} ${t("copySuffix")}`,
          events: src.events.map((e) => ({ ...e, id: uid("evt") })),
          createdAt: now(),
          updatedAt: now(),
        };
        await db.scenarios.add(copy);
        set((st) => ({ scenarios: [...st.scenarios, copy] }));
        return copy;
      },
      async enterStoryMode(convoId, scenarioId) {
        const convo = get().convos.find((c) => c.id === convoId);
        const scenario = get().scenarios.find((s) => s.id === scenarioId);
        if (!convo || !scenario) return;
        const storyState = {
          openedAt: convo.storyState?.openedAt,
          triggeredEventIds: [...(convo.storyState?.triggeredEventIds ?? [])],
        };
        // first entry into this scenario: insert the opening narration once
        const newMsgs: ChatMessage[] = [];
        if (!storyState.openedAt && scenario.openingStory.trim()) {
          storyState.openedAt = Date.now();
          const narrative: ChatMessage = {
            id: uid("msg"),
            conversationId: convoId,
            role: "assistant",
            content: scenario.openingStory,
            kind: "narrative",
            createdAt: now() + 1,
            status: "ok",
          };
          await db.messages.add(narrative);
          newMsgs.push(narrative);
        }
        const patch = { mode: "story" as const, scenarioId, storyState };
        await db.conversations.update(convoId, patch);
        set((st) => ({
          convos: st.convos.map((c) => (c.id === convoId ? { ...c, ...patch } : c)),
          messages: st.activeConvoId === convoId ? [...st.messages, ...newMsgs] : st.messages,
        }));
      },
      async exitStoryMode(convoId) {
        await db.conversations.update(convoId, { mode: "chat" });
        set((st) => ({
          convos: st.convos.map((c) => (c.id === convoId ? { ...c, mode: "chat" as const } : c)),
        }));
      },
      async triggerNextStoryEvent(convoId) {
        const convo = get().convos.find((c) => c.id === convoId);
        const scenario = convo?.scenarioId ? get().scenarios.find((s) => s.id === convo.scenarioId) : null;
        if (!convo || !scenario) return null;
        const done = new Set(convo.storyState?.triggeredEventIds ?? []);
        const next = scenario.events.find((e) => !done.has(e.id));
        if (!next) return null;
        const storyState = {
          openedAt: convo.storyState?.openedAt,
          triggeredEventIds: [...(convo.storyState?.triggeredEventIds ?? []), next.id],
        };
        await db.conversations.update(convoId, { storyState });
        set((st) => ({
          convos: st.convos.map((c) => (c.id === convoId ? { ...c, storyState } : c)),
        }));
        pendingStoryEvent.current = { convoId, eventId: next.id };
        return next;
      },

      // -------------------------------------------------------
      async backup() {
        const blob = await exportAll();
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `myosotis-backup-${new Date().toISOString().slice(0, 10)}.json`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 5000);
        get().showToast(t("backupExported"), "success");
      },
      async restore(file) {
        await importAll(file);
        get().showToast(t("restoreDone"), "success");
        setTimeout(() => location.reload(), 900);
      },
    }),
    {
      name: "myosotis.settings",
      version: 2,
      migrate: (persisted: any) => {
        // v0 -> v1: default theme azure -> mono (black/white minimal)
        if (persisted?.settings?.themeId === "azure") {
          persisted.settings.themeId = "mono";
        }
        // ensure fields added after v0.1.0 exist for older snapshots
        if (persisted?.settings) {
          if (!persisted.settings.genParams) {
            persisted.settings.genParams = { temperature: 0.8, maxTokens: 4096, contextTurns: 12 };
          }
          if (!persisted.settings.fontSize) {
            persisted.settings.fontSize = 15;
          }
          if (!persisted.settings.language) {
            persisted.settings.language = "zh-CN";
          }
          if (!persisted.settings.webdav) {
            persisted.settings.webdav = {
              url: "",
              username: "",
              appPassword: "",
              directory: "/Myosotis",
              encrypt: false,
              backupPassword: "",
              autoBackup: "off",
            };
          }
        }
        return persisted;
      },
      partialize: (s) => ({
        settings: s.settings,
        activeConvoId: s.activeConvoId,
        memoryAgentFilter: s.memoryAgentFilter,
      }),
      // merge persisted settings over defaults so newly added fields always exist
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as any;
        const merged = {
          ...current,
          ...p,
          settings: {
            ...DEFAULT_SETTINGS,
            ...(p.settings ?? {}),
            defaults: { ...DEFAULT_SETTINGS.defaults, ...(p.settings?.defaults ?? {}) },
            genParams: { ...DEFAULT_SETTINGS.genParams, ...(p.settings?.genParams ?? {}) },
            webdav: { ...DEFAULT_SETTINGS.webdav, ...(p.settings?.webdav ?? {}) },
          },
        };
        return merged as AppState;
      },
      onRehydrateStorage: () => (state) => {
        if (state?.settings) applyTheme(state.settings);
      },
    }
  )
);

export function applyTheme(settings: Settings) {
  const root = document.documentElement;
  root.dataset.theme = settings.themeId;
  const dark =
    settings.themeMode === "dark" ||
    (settings.themeMode === "auto" && matchMedia("(prefers-color-scheme: dark)").matches);
  root.dataset.mode = dark ? "dark" : "light";
}

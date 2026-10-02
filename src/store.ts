import { create } from "zustand";
import { persist } from "zustand/middleware";
import { db, exportAll, importAll } from "./lib/db";
import { chatComplete } from "./lib/api";
import { buildContextMessages, extractMemories, maybeSummarize, generateTitle } from "./lib/memory";
import { uid, now, resolveModel, friendlyError, plainPreview } from "./lib/utils";
import {
  AGENT_PRESETS,
  DEFAULT_SETTINGS,
  type Agent,
  type ChatMessage,
  type Conversation,
  type MemoryItem,
  type ModelConfig,
  type ModelRole,
  type Provider,
  type Settings,
} from "./types";

export type View = "chat" | "agents" | "memory" | "settings";

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
  settings: Settings;
  ready: boolean;

  // ----- ui -----
  view: View;
  activeConvoId: string | null;
  editingAgentId: string | null; // agent editor open
  sidebarOpen: boolean; // mobile drawer
  toast: Toast | null;
  streamingConvoId: string | null;
  streamText: string;
  memoryAgentFilter: string | null;

  // ----- lifecycle -----
  init: () => Promise<void>;
  showToast: (text: string, kind?: Toast["kind"]) => void;
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
  createAgent: (presetIdx?: number) => Promise<Agent>;
  updateAgent: (id: string, patch: Partial<Agent>) => Promise<void>;
  deleteAgent: (id: string) => Promise<void>;

  // ----- conversations -----
  newConversation: (agentId: string) => Promise<string>;
  openConversation: (id: string) => Promise<void>;
  deleteConversation: (id: string) => Promise<void>;

  // ----- messaging -----
  send: (text: string, images?: string[]) => Promise<void>;
  stop: () => void;
  regenerate: () => Promise<void>;

  // ----- memories -----
  addMemory: (m: Omit<MemoryItem, "id" | "createdAt" | "updatedAt" | "hitCount" | "pinned">) => Promise<void>;
  updateMemory: (id: string, patch: Partial<MemoryItem>) => Promise<void>;
  deleteMemory: (id: string) => Promise<void>;

  // ----- backup -----
  backup: () => Promise<void>;
  restore: (file: File) => Promise<void>;
}

const abortRef: { current: AbortController | null } = { current: null };
const extractCounter: Record<string, number> = {}; // convoId -> user turns since last extraction

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
      settings: DEFAULT_SETTINGS,
      ready: false,

      view: "chat",
      activeConvoId: null,
      editingAgentId: null,
      sidebarOpen: false,
      toast: null,
      streamingConvoId: null,
      streamText: "",
      memoryAgentFilter: null,

      // -------------------------------------------------------
      async init() {
        const [providers, models, agents, convos] = await Promise.all([
          db.providers.toArray(),
          db.models.toArray(),
          db.agents.orderBy("createdAt").toArray(),
          db.conversations.orderBy("updatedAt").reverse().toArray(),
        ]);
        // seed default agent on first launch
        if (!agents.length) {
          const preset = AGENT_PRESETS[0];
          const agent: Agent = { ...preset, id: uid("agt"), createdAt: now(), updatedAt: now() };
          await db.agents.add(agent);
          agents.push(agent);
        }
        set({ providers, models, agents, convos, ready: true });
        // restore last conversation
        const last = get().activeConvoId;
        if (last && convos.some((c) => c.id === last)) {
          await get().openConversation(last);
        }
      },

      showToast(text, kind = "info") {
        set({ toast: { text, kind } });
        setTimeout(() => {
          if (get().toast?.text === text) set({ toast: null });
        }, 3600);
      },

      setSettings(patch) {
        set({ settings: { ...get().settings, ...patch } });
        applyTheme(get().settings);
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
      async createAgent(presetIdx = 3) {
        const preset = AGENT_PRESETS[presetIdx] ?? AGENT_PRESETS[3];
        const agent: Agent = { ...preset, id: uid("agt"), createdAt: now(), updatedAt: now() };
        await db.agents.add(agent);
        set({ agents: [...get().agents, agent], editingAgentId: agent.id });
        return agent;
      },
      async updateAgent(id, patch) {
        await db.agents.update(id, { ...patch, updatedAt: now() });
        set({ agents: get().agents.map((a) => (a.id === id ? { ...a, ...patch, updatedAt: now() } : a)) });
      },
      async deleteAgent(id) {
        await db.transaction("rw", db.agents, db.conversations, db.messages, db.memories, async () => {
          const convoIds = await db.conversations.where("agentId").equals(id).primaryKeys();
          await db.conversations.bulkDelete(convoIds);
          await db.messages.where("conversationId").anyOf(convoIds).delete();
          await db.memories.where("agentId").equals(id).delete();
          await db.agents.delete(id);
        });
        const convos = get().convos.filter((c) => c.agentId !== id);
        const activeLost = convos.every((c) => c.id !== get().activeConvoId);
        set({
          agents: get().agents.filter((a) => a.id !== id),
          convos,
          activeConvoId: activeLost ? convos[0]?.id ?? null : get().activeConvoId,
          editingAgentId: null,
        });
        if (activeLost && get().activeConvoId) await get().openConversation(get().activeConvoId!);
      },

      // -------------------------------------------------------
      async newConversation(agentId) {
        const agent = get().agents.find((a) => a.id === agentId);
        if (!agent) return "";
        const convo: Conversation = {
          id: uid("cnv"),
          agentId,
          title: "新对话",
          lastMessage: agent.greeting.trim() ? plainPreview(agent.greeting) : "",
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
          convos: [convo, ...get().convos],
          activeConvoId: convo.id,
          messages: greeting ? [greeting] : [],
          view: "chat",
          sidebarOpen: false,
        });
        return convo.id;
      },
      async openConversation(id) {
        const messages = await db.messages.where("conversationId").equals(id).sortBy("createdAt");
        set({ activeConvoId: id, messages, view: "chat", sidebarOpen: false });
      },
      async deleteConversation(id) {
        await db.transaction("rw", db.conversations, db.messages, async () => {
          await db.conversations.delete(id);
          await db.messages.where("conversationId").equals(id).delete();
        });
        const convos = get().convos.filter((c) => c.id !== id);
        const wasActive = get().activeConvoId === id;
        set({ convos });
        if (wasActive) {
          set({ activeConvoId: convos[0]?.id ?? null, messages: [] });
          if (convos[0]) await get().openConversation(convos[0].id);
        }
      },

      // -------------------------------------------------------
      async send(text, images) {
        const { activeConvoId } = get();
        if (!activeConvoId) return;
        if (get().streamingConvoId) return;
        const convo = get().convos.find((c) => c.id === activeConvoId);
        const agent = get().agents.find((a) => a.id === convo?.agentId);
        if (!convo || !agent) return;

        const trimmed = text.trim();
        if (!trimmed && !images?.length) return;

        // 1. persist user message
        const userMsg: ChatMessage = {
          id: uid("msg"),
          conversationId: convo.id,
          role: "user",
          content: trimmed,
          images: images?.length ? images : undefined,
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
          get().showToast("还没有配置可用的对话模型，请先到「设置」添加模型", "error");
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

        // 4. build context with memory retrieval
        const context = await buildContextMessages(agent, currentConvo, allMsgs, settings, models, providers);

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
        try {
          full = await chatComplete(rm, context, {
            signal: controller.signal,
            temperature: 0.8,
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

        const isFirstReal = currentConvo.title === "新对话";
        const patch: Partial<Conversation> = {
          updatedAt: now(),
          lastMessage: plainPreview(full).slice(0, 40) || "…",
        };
        if (isFirstReal && trimmed) patch.title = plainPreview(trimmed).slice(0, 16) || "新对话";
        await db.conversations.update(convo.id, patch);
        const updatedConvo = { ...currentConvo, ...patch };

        set((s) => ({
          messages: [...s.messages, aiMsg],
          streamingConvoId: null,
          streamText: "",
          convos: [updatedConvo, ...s.convos.filter((c) => c.id !== convo.id)],
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
        if (agent.memoryEnabled && extractCounter[convo.id] >= 3) {
          extractCounter[convo.id] = 0;
          const embeddingRm = resolveModel("embedding", models, providers, settings, agent.models);
          const recent = [...allMsgs, userMsg, aiMsg].slice(-14);
          extractMemories(agent, recent, chatRmForJobs, embeddingRm)
            .then((n) => {
              if (n > 0) get().showToast(`小助手记住了 ${n} 条新记忆`, "success");
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
      async backup() {
        const blob = await exportAll();
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `myosotis-backup-${new Date().toISOString().slice(0, 10)}.json`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 5000);
        get().showToast("备份已导出", "success");
      },
      async restore(file) {
        await importAll(file);
        get().showToast("恢复完成，即将刷新", "success");
        setTimeout(() => location.reload(), 900);
      },
    }),
    {
      name: "myosotis.settings",
      partialize: (s) => ({
        settings: s.settings,
        activeConvoId: s.activeConvoId,
        memoryAgentFilter: s.memoryAgentFilter,
      }),
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

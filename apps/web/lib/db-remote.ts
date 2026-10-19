// ================================================================
// Remote Dexie-compatible tables over the Hub API.
//
// Same surface the app used against IndexedDB (get/add/put/update/
// delete/toArray/where/orderBy/bulk*), but every mutation is also
// persisted server-side. One GET /api/data bootstraps the caches.
//
// Why keep the Dexie-ish API? store.ts (1300 lines of orchestration)
// stays untouched — only the storage backend swaps.
// ================================================================
import type {
  Agent,
  ChatMessage,
  Conversation,
  MemoryItem,
  ModelConfig,
  PromptTemplate,
  Provider,
  Scenario,
} from "@myosotis/core";

// The API base: same-origin by default (hub-hosted web app), or an
// explicit hub URL when the desktop/mobile shell points at a server.
function apiBase(): string {
  const explicit = (window as any).__MYO_API_BASE__ || localStorage.getItem("myosotis.hubUrl") || "";
  return explicit.replace(/\/+$/, "");
}

async function jfetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(apiBase() + url, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
    credentials: "include",
  });
  if (res.status === 401) {
    window.dispatchEvent(new CustomEvent("myo:unauthorized"));
    throw new Error("unauthorized");
  }
  if (!res.ok) throw new Error(`api ${res.status}`);
  return res.json() as Promise<T>;
}

type Row = { id: string; createdAt?: number };

class WhereChain<T extends Row> {
  constructor(private rows: T[], private table: RemoteTable<T>) {}
  toArray(): Promise<T[]> {
    return Promise.resolve(this.rows);
  }
  sortBy(key: keyof T): Promise<T[]> {
    return Promise.resolve([...this.rows].sort((a, b) => Number(a[key]) - Number(b[key])));
  }
  last(): Promise<T | undefined> {
    return Promise.resolve([...this.rows].sort((a, b) => Number(b.createdAt) - Number(a.createdAt))[0]);
  }
  async modify(patch: Partial<T> | ((m: T) => void)): Promise<number> {
    for (const row of this.rows) {
      const next = typeof patch === "function" ? (patch(row as any), row) : { ...row, ...patch };
      this.table.cache.set(row.id, next);
      this.table.remotePut(row.id, next);
    }
    return this.rows.length;
  }
  async delete(): Promise<number> {
    for (const row of this.rows) await this.table.delete(row.id);
    return this.rows.length;
  }
}

class RemoteTable<T extends Row> {
  cache = new Map<string, T>();

  constructor(private endpoint: string, private collection?: { convoField?: string }) {}

  private persist(id: string, item: T) {
    // messages POST to their conversation endpoint (server-side upsert);
    // everything else has a per-item PUT
    if (this.endpoint === "messages") {
      const convoId = (item as any).conversationId;
      if (convoId) {
        jfetch(`/api/conversations/${encodeURIComponent(convoId)}/messages`, {
          method: "POST",
          body: JSON.stringify(item),
        }).catch(() => {});
        return;
      }
    }
    jfetch(`/api/data/${this.endpoint}/${encodeURIComponent(id)}`, {
      method: "PUT",
      body: JSON.stringify(item),
    }).catch(() => {});
  }

  remotePut(id: string, item: T) {
    this.persist(id, item);
  }

  get(id: string): Promise<T | undefined> {
    return Promise.resolve(this.cache.get(id));
  }
  async add(item: T): Promise<string> {
    this.cache.set(item.id, item);
    this.remotePut(item.id, item);
    return item.id;
  }
  async put(item: T): Promise<string> {
    return this.add(item);
  }
  async update(id: string, patch: Partial<T>): Promise<number> {
    const cur = this.cache.get(id);
    if (!cur) return 0;
    const next = { ...cur, ...patch };
    this.cache.set(id, next);
    this.remotePut(id, next);
    return 1;
  }
  async delete(id: string): Promise<void> {
    const item = this.cache.get(id);
    this.cache.delete(id);
    if (this.endpoint === "messages") {
      const convoId = (item as any)?.conversationId;
      if (convoId) {
        jfetch(`/api/conversations/${encodeURIComponent(convoId)}/messages/${encodeURIComponent(id)}`, {
          method: "DELETE",
        }).catch(() => {});
        return;
      }
    }
    jfetch(`/api/data/${this.endpoint}/${encodeURIComponent(id)}`, { method: "DELETE" }).catch(() => {});
  }
  async clear(): Promise<void> {
    const ids = [...this.cache.keys()];
    this.cache.clear();
    for (const id of ids)
      jfetch(`/api/data/${this.endpoint}/${encodeURIComponent(id)}`, { method: "DELETE" }).catch(() => {});
  }
  toArray(): Promise<T[]> {
    return Promise.resolve([...this.cache.values()]);
  }
  bulkAdd(items: T[]): Promise<void> {
    for (const i of items) this.cache.set(i.id, i);
    for (const i of items) this.remotePut(i.id, i);
    return Promise.resolve();
  }
  bulkPut(items: T[]): Promise<void> {
    return this.bulkAdd(items);
  }
  async bulkDelete(ids: string[]): Promise<void> {
    for (const id of ids) await this.delete(id);
  }
  where(index: string): { equals(v: any): WhereChain<T>; anyOf(vs: any[]): WhereChain<T> } {
    const filter = (pred: (r: T) => boolean) => new WhereChain([...this.cache.values()].filter(pred), this);
    return {
      equals: (v: any) => filter((r) => (r as any)[index] === v),
      anyOf: (vs: any[]) => filter((r) => vs.includes((r as any)[index])),
    };
  }
  orderBy(index: string): { reverse(): { toArray(): Promise<T[]> }; toArray(): Promise<T[]> } {
    const sorted = [...this.cache.values()].sort((a, b) => Number((a as any)[index]) - Number((b as any)[index]));
    return {
      reverse: () => ({ toArray: () => Promise.resolve(sorted.reverse()) }),
      toArray: () => Promise.resolve(sorted),
    };
  }
}

// ----------------------------------------------------------------
// The concrete "db" the app talks to
// ----------------------------------------------------------------
class RemoteDB {
  providers = new RemoteTable<Provider>("providers");
  models = new RemoteTable<ModelConfig>("models");
  agents = new RemoteTable<Agent>("agents");
  conversations = new RemoteTable<Conversation>("conversations");
  messages = new RemoteTable<ChatMessage>("messages", {});
  memories = new RemoteTable<MemoryItem>("memories");
  prompts = new RemoteTable<PromptTemplate>("prompts");
  scenarios = new RemoteTable<Scenario>("scenarios");

  /** load everything from the hub into the local caches */
  async bootstrap() {
    const data = await jfetch<{
      providers: Provider[];
      models: ModelConfig[];
      agents: Agent[];
      prompts: PromptTemplate[];
      scenarios: Scenario[];
      conversations: Conversation[];
      memories: MemoryItem[];
      settings: unknown;
    }>("/api/data");
    const fill = <T extends Row>(t: RemoteTable<T>, rows: T[] | undefined) => {
      t.cache.clear();
      for (const r of rows ?? []) t.cache.set(r.id, r);
    };
    fill(this.providers, data.providers);
    fill(this.models, data.models);
    fill(this.agents, data.agents);
    fill(this.prompts, data.prompts);
    fill(this.scenarios, data.scenarios);
    fill(this.conversations, data.conversations);
    fill(this.memories, data.memories);
    return data;
  }

  /** conversation messages are fetched on open (can be huge) */
  async loadMessages(convoId: string): Promise<ChatMessage[]> {
    const msgs = await jfetch<ChatMessage[]>(`/api/conversations/${encodeURIComponent(convoId)}/messages`);
    for (const m of msgs) this.messages.cache.set(m.id, m);
    return msgs;
  }

  /** no-op shim: Dexie-style transaction(res, tables..., fn) → just run fn */
  async transaction(_mode: string, ...rest: unknown[]) {
    const fn = rest[rest.length - 1] as () => Promise<unknown>;
    await fn();
  }
}

export const db = new RemoteDB();
export type { RemoteDB };

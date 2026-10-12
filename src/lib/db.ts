import Dexie, { type Table } from "dexie";
import type { Agent, ChatMessage, Conversation, MemoryItem, ModelConfig, PromptTemplate, Provider, Scenario } from "../types";

/**
 * Local-first storage. Everything lives in IndexedDB:
 * works identically in Tauri desktop webview and mobile webview,
 * and survives restarts. Backups via export/import JSON.
 */
class MyosotisDB extends Dexie {
  providers!: Table<Provider, string>;
  models!: Table<ModelConfig, string>;
  agents!: Table<Agent, string>;
  conversations!: Table<Conversation, string>;
  messages!: Table<ChatMessage, string>;
  memories!: Table<MemoryItem, string>;
  prompts!: Table<PromptTemplate, string>;
  scenarios!: Table<Scenario, string>;

  constructor() {
    super("myosotis");
    this.version(1).stores({
      providers: "id, createdAt",
      models: "id, providerId, name",
      agents: "id, updatedAt",
      conversations: "id, agentId, updatedAt",
      messages: "id, conversationId, createdAt",
      memories: "id, agentId, updatedAt",
    });
    // v2: add createdAt index to agents (was missing, broke orderBy)
    this.version(2).stores({
      agents: "id, createdAt, updatedAt",
    });
    // v3: prompts table for quick commands (trigger -> prompt template)
    this.version(3).stores({
      prompts: "id, trigger",
    });
    // v4: scenarios for story mode (world setting + opening + triggered events)
    this.version(4).stores({
      scenarios: "id, agentId, updatedAt",
    });
  }
}

export const db = new MyosotisDB();

// ---------------------------------------------------------------
// Full backup / restore (JSON file download & upload)
// ---------------------------------------------------------------
export async function exportAll(): Promise<Blob> {
  const data = {
    version: 2,
    exportedAt: Date.now(),
    providers: await db.providers.toArray(),
    models: await db.models.toArray(),
    agents: await db.agents.toArray(),
    conversations: await db.conversations.toArray(),
    messages: await db.messages.toArray(),
    memories: await db.memories.toArray(),
    prompts: await db.prompts.toArray(),
    scenarios: await db.scenarios.toArray(),
    settings: JSON.parse(localStorage.getItem("myosotis.settings") || "null"),
  };
  return new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
}

export async function importAll(file: File): Promise<void> {
  const text = await file.text();
  const data = JSON.parse(text);
  if (!data || !Array.isArray(data.agents)) throw new Error("Invalid Myosotis backup file");
  await db.transaction("rw", [db.providers, db.models, db.agents, db.conversations, db.messages, db.memories, db.prompts, db.scenarios], async () => {
    await db.providers.clear();
    await db.models.clear();
    await db.agents.clear();
    await db.conversations.clear();
    await db.messages.clear();
    await db.memories.clear();
    await db.prompts.clear();
    await db.scenarios.clear();
    if (data.providers?.length) await db.providers.bulkAdd(data.providers);
    if (data.models?.length) await db.models.bulkAdd(data.models);
    if (data.agents?.length) await db.agents.bulkAdd(data.agents);
    if (data.conversations?.length) await db.conversations.bulkAdd(data.conversations);
    if (data.messages?.length) await db.messages.bulkAdd(data.messages);
    if (data.memories?.length) await db.memories.bulkAdd(data.memories);
    // older backups have no prompts/scenarios: default to empty
    if (data.prompts?.length) await db.prompts.bulkAdd(data.prompts);
    if (data.scenarios?.length) await db.scenarios.bulkAdd(data.scenarios);
    if (data.settings?.state) localStorage.setItem("myosotis.settings", JSON.stringify(data.settings));
  });
}

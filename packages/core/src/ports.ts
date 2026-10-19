// ================================================================
// Platform ports for the Myosotis core.
//
// The core (memory engine, model client, group engine) is pure
// platform-agnostic TypeScript. It never touches Dexie, DOM, i18n
// singletons or localStorage directly — hosts inject implementations
// of these ports at startup:
//
//   * the browser app  → Dexie-backed store + UI i18n strings
//   * the hub server   → SQLite-backed store + server logs
// ================================================================

/** Storage port: minimal persistence surface the core needs. */
export interface StoragePort {
  listMemories(agentId?: string): Promise<MemoryItem[]>;
  saveMemory(item: MemoryItem): Promise<void>;
  touchMemories(ids: string[], at: number): Promise<void>;
  getConversation(id: string): Promise<Conversation | undefined>;
  saveConversation(c: Conversation): Promise<void>;
}

/** Translation port: hosts map keys to their own localized strings. */
export interface I18nPort {
  t(key: string): string;
}

import type { Conversation, MemoryItem } from "./types.ts";

let storageImpl: StoragePort | null = null;
let i18nImpl: I18nPort | null = null;

/** Install the storage implementation (call once at host boot). */
export function setStorage(port: StoragePort) {
  storageImpl = port;
}

/** Install the translation implementation (call once at host boot). */
export function setI18n(port: I18nPort) {
  i18nImpl = port;
}

/** @internal core-internal accessor; throws if the host forgot to install. */
export function storage(): StoragePort {
  if (!storageImpl) throw new Error("Myosotis core: storage port not installed — call setStorage() first");
  return storageImpl;
}

/** @internal core-internal accessor with graceful fallback. */
export function i18n(): I18nPort {
  if (!i18nImpl) return { t: (k) => k };
  return i18nImpl;
}

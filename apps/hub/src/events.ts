// ================================================================
// Hub event bus — cross-device realtime.
//
// Every connected client (web / desktop / mobile) subscribes to
// GET /api/events and receives server-side changes as SSE frames.
// This is what makes "the core runs on the server" feel like a
// real multi-device messenger: send on the phone, it appears on
// the desktop instantly.
// ================================================================
import type { Agent, ChatMessage, Conversation, MemoryItem } from "@myosotis/core";

export type HubEvent =
  | { type: "message"; conversationId: string; message: ChatMessage }
  | { type: "conversation"; conversation: Conversation }
  | { type: "delete-message"; conversationId: string; messageId: string }
  | { type: "clear-conversation"; conversationId: string }
  | { type: "memory"; memory: MemoryItem }
  | { type: "agent"; agent: Agent; removed?: boolean }
  | { type: "settings" }
  | { type: "ping" };

interface Client {
  id: string;
  userId: string;
  write: (event: HubEvent) => void;
  close: () => void;
}

export class EventBus {
  private clients = new Map<string, Client>();
  /** userId -> client ids */
  private byUser = new Map<string, Set<string>>();

  add(client: Client) {
    this.clients.set(client.id, client);
    let set = this.byUser.get(client.userId);
    if (!set) {
      set = new Set();
      this.byUser.set(client.userId, set);
    }
    set.add(client.id);
  }

  remove(id: string) {
    const c = this.clients.get(id);
    if (!c) return;
    this.clients.delete(id);
    this.byUser.get(c.userId)?.delete(id);
    if (this.byUser.get(c.userId)?.size === 0) this.byUser.delete(c.userId);
  }

  /** deliver to every client of one user */
  emit(userId: string, event: HubEvent) {
    const ids = this.byUser.get(userId);
    if (!ids?.size) return;
    for (const id of [...ids]) {
      const c = this.clients.get(id);
      if (!c) continue;
      try {
        c.write(event);
      } catch {
        this.remove(id);
      }
    }
  }

  /** deliver to all users (admin-level events) */
  emitAll(event: HubEvent) {
    for (const c of this.clients.values()) {
      try {
        c.write(event);
      } catch {}
    }
  }

  get size() {
    return this.clients.size;
  }
}

export const bus = new EventBus();

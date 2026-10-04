// One-time data migration for the 1-agent-1-conversation model.
// Agents that own multiple conversations get their conversations merged:
// all messages move (conversationId rewritten) into the kept conversation,
// which is the most recently active one. Idempotent: agents already at 1:1
// are never written to.

import { db } from "./db";
import type { Conversation } from "../types";

/** Merge conversations so every agent owns exactly one.
 *  Returns a map of removed conversation id -> kept conversation id. */
export async function mergeAgentConversations(): Promise<Map<string, string>> {
  const remap = new Map<string, string>(); // removed convo id -> kept convo id

  await db.transaction("rw", db.conversations, db.messages, async () => {
    const convos = await db.conversations.toArray();
    const byAgent = new Map<string, Conversation[]>();
    for (const c of convos) {
      const list = byAgent.get(c.agentId);
      if (list) list.push(c);
      else byAgent.set(c.agentId, [c]);
    }

    for (const [agentId, list] of byAgent) {
      void agentId;
      if (list.length < 2) continue;

      const kept = [...list].sort((a, b) => b.updatedAt - a.updatedAt)[0];
      const doomed = list.filter((c) => c.id !== kept.id);

      // move every message of the doomed conversations into the kept one
      for (const d of doomed) {
        const msgs = await db.messages.where("conversationId").equals(d.id).toArray();
        if (msgs.length) {
          await db.messages.bulkPut(msgs.map((m) => ({ ...m, conversationId: kept.id })));
        }
        remap.set(d.id, kept.id);
      }

      // pinned intent survives the merge; preview and recency recomputed
      const pinned = list.some((c) => c.pinned);
      const all = await db.messages.where("conversationId").equals(kept.id).sortBy("createdAt");
      const last = all[all.length - 1];
      await db.conversations.update(kept.id, {
        pinned: pinned || !!kept.pinned,
        lastMessage: last ? (last.content || "…").slice(0, 40) : kept.lastMessage,
        updatedAt: Math.max(...list.map((c) => c.updatedAt)),
      });

      await db.conversations.bulkDelete(doomed.map((d) => d.id));
    }
  });

  return remap;
}

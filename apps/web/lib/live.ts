// ================================================================
// Live sync — subscribe to server events so every device stays in
// step: send on the phone, watch it appear on the desktop.
//
// The hub pushes one SSE stream per user; the store applies the
// deltas to its local caches.
// ================================================================
import { apiBase } from "./db";
import { useStore } from "../store";
import type { ChatMessage, Conversation } from "@myosotis/core";

let source: EventSource | null = null;
let retry = 0;
let closedByUser = false;

/**
 * Unread state lives on the conversation objects in the store (the
 * server computes the initial counts, live events bump them), so
 * every component that renders conversations re-renders for free.
 */
export function unreadCount(convoId: string): number {
  const c = useStore.getState().convos.find((x) => x.id === convoId);
  return c?.unread ?? 0;
}

export function totalUnread(): number {
  return useStore.getState().convos.reduce((n, c) => n + (c.unread ?? 0), 0);
}

export function clearUnread(convoId: string) {
  const convos = useStore.getState().convos;
  if (!convos.some((c) => c.id === convoId && c.unread)) return;
  useStore.setState({ convos: convos.map((c) => (c.id === convoId ? { ...c, unread: 0 } : c)) });
}

/** open the live stream (idempotent) */
export function connectLive() {
  if (source) return;
  closedByUser = false;
  const base = apiBase();
  if (!base) return; // local mode: nothing to sync with

  const es = new EventSource(`${base}/api/events`, { withCredentials: true });
  source = es;

  es.addEventListener("message", (e) => {
    const data = JSON.parse((e as MessageEvent).data);
    applyEvent(data);
  });

  es.addEventListener("conversation", (e) => {
    const data = JSON.parse((e as MessageEvent).data);
    const convo = data.conversation as Conversation;
    const store = useStore.getState();
    const exists = store.convos.some((c) => c.id === convo.id);
    if (!exists) {
      useStore.setState({ convos: [convo, ...store.convos] });
      return;
    }
    useStore.setState({
      convos: store.convos.map((c) => (c.id === convo.id ? { ...c, ...convo } : c)),
    });
  });

  es.addEventListener("delete-message", (e) => {
    const data = JSON.parse((e as MessageEvent).data);
    const store = useStore.getState();
    useStore.setState({
      messages: store.messages.filter((m) => m.id !== data.messageId),
    });
  });

  es.addEventListener("clear-conversation", (e) => {
    const data = JSON.parse((e as MessageEvent).data);
    const store = useStore.getState();
    if (store.activeConvoId === data.conversationId) {
      useStore.setState({ messages: [] });
    }
  });

  es.addEventListener("memory", (e) => {
    const data = JSON.parse((e as MessageEvent).data);
    const store = useStore.getState();
    const m = data.memory;
    if (!m?.id) return;
    if (m.content === undefined) {
      // deletion marker
      useStore.setState({});
      return;
    }
    void import("./db").then(({ remoteDB }) => {
      remoteDB.memories.cache.set(m.id, m);
    });
  });

  es.addEventListener("agent", (e) => {
    const data = JSON.parse((e as MessageEvent).data);
    const agent = data.agent;
    const store = useStore.getState();
    if (data.removed) {
      useStore.setState({ agents: store.agents.filter((a) => a.id !== agent.id) });
    } else {
      const exists = store.agents.some((a) => a.id === agent.id);
      useStore.setState({
        agents: exists ? store.agents.map((a) => (a.id === agent.id ? { ...a, ...agent } : a)) : [...store.agents, agent],
      });
    }
  });

  es.addEventListener("settings", () => {
    // settings changed on another device — pull the fresh copy
    void import("./db").then(async ({ remoteDB }) => {
      const data = await remoteDB.bootstrap();
      useStore.setState({ settings: data.settings as any });
    });
  });

  es.onerror = () => {
    es.close();
    source = null;
    if (closedByUser) return;
    // exponential backoff, capped
    retry = Math.min(retry + 1, 6);
    setTimeout(() => {
      if (!closedByUser) connectLive();
    }, Math.min(1000 * 2 ** retry, 30000));
  };

  es.onopen = () => {
    retry = 0;
  };
}

export function disconnectLive() {
  closedByUser = true;
  source?.close();
  source = null;
  retry = 0;
}

/** apply a live message to the local view */
function applyEvent(data: { type: string; conversationId: string; message: ChatMessage }) {
  const store = useStore.getState();
  const msg = data.message;
  if (!msg?.id) return;

  // the message we sent ourselves is already in the list
  if (store.activeConvoId === data.conversationId) {
    if (store.messages.some((m) => m.id === msg.id)) return;
    // our own optimistic bubble → swap in the canonical message
    const optimistic = store.messages.find(
      (m) => m.role === msg.role && m.content === msg.content && m.status === "sending"
    );
    if (optimistic) {
      useStore.setState({
        messages: store.messages.map((m) => (m.id === optimistic.id ? { ...msg, status: "ok" } : m)),
      });
      return;
    }
    useStore.setState({ messages: [...store.messages, msg] });
    return;
  }
  // another conversation: count it as unread and refresh the preview
  const convos = store.convos.map((c) =>
    c.id === data.conversationId
      ? {
          ...c,
          lastMessage: msg.content.slice(0, 60),
          lastMessageRole: msg.role,
          updatedAt: msg.createdAt,
          unread: (c.unread ?? 0) + (msg.role === "assistant" ? 1 : 0),
        }
      : c
  );
  useStore.setState({ convos });
}

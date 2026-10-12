import type { Agent, ChatMessage, Conversation, GroupParticipant, MemoryItem, Settings } from "../types";
import type { ApiMessage } from "./api";
import { buildSystemPrompt } from "./memory";

// ================================================================
// Multi-agent group chat helpers.
//
// Ported from Girl-Ai-Agent's workspace-chat engine: participants each
// carry a receive policy (which messages they see) and a reply policy
// (when they speak); @mention decides for the "mention" policies, and
// per-agent history is rebuilt with other speakers prefixed "name: ".
// ================================================================

/** Does this text @mention the agent (by display name or id, case-insensitive)? */
export function messageMentionsAgent(text: string, agent: Agent): boolean {
  if (!text) return false;
  const lower = text.toLowerCase();
  const name = (agent.name ?? "").toLowerCase();
  if (name && lower.includes(`@${name}`)) return true;
  return lower.includes(`@${agent.id.toLowerCase()}`);
}

/** Participants that receive this user message as context. */
export function receivingParticipants(
  participants: GroupParticipant[],
  text: string,
  agents: Agent[]
): GroupParticipant[] {
  return participants.filter((p) => {
    if (p.receiveMode === "all") return true;
    const a = agents.find((x) => x.id === p.agentId);
    return !!a && messageMentionsAgent(text, a);
  });
}

/** Participants that should produce a reply to this user message, in order. */
export function replyingParticipants(
  participants: GroupParticipant[],
  text: string,
  agents: Agent[]
): GroupParticipant[] {
  return [...participants]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .filter((p) => {
      if (p.replyMode === "all") return true;
      const a = agents.find((x) => x.id === p.agentId);
      return !!a && messageMentionsAgent(text, a);
    });
}

/** Agent ids allowed to see a message (empty array = everyone). */
export function visibleAgentIds(
  participants: GroupParticipant[],
  text: string,
  agents: Agent[]
): string[] {
  return receivingParticipants(participants, text, agents).map((p) => p.agentId);
}

/** Is a stored message visible to one participant? (empty visibleTo = everyone) */
export function messageVisibleTo(msg: ChatMessage, agentId: string): boolean {
  return !msg.visibleTo?.length || msg.visibleTo.includes(agentId);
}

/**
 * Rebuild the chat history from one participant's point of view:
 * messages they cannot see are dropped, and other agents' replies are
 * prefixed with "name: " so the model can tell speakers apart.
 */
export function groupHistory(
  messages: ChatMessage[],
  selfId: string,
  agents: Agent[],
  contextTurns: number
): ApiMessage[] {
  const window = messages.slice(-Math.max(4, contextTurns * 2));
  const out: ApiMessage[] = [];
  for (const m of window) {
    if (!messageVisibleTo(m, selfId)) continue;
    if (m.role === "user") {
      out.push({ role: "user", text: m.content, images: m.images });
    } else {
      const speaker = m.agentId ? agents.find((a) => a.id === m.agentId) : undefined;
      const prefix = speaker && speaker.id !== selfId ? `${speaker.name}：` : "";
      out.push({ role: "assistant", text: `${prefix}${m.content}` });
    }
  }
  // Anthropic requires the conversation to start with a user turn
  while (out.length && out[0].role === "assistant") out.shift();
  return out;
}

/** System prompt for one participant: persona + speech rules + group framing. */
export function buildGroupSystemPrompt(
  agent: Agent,
  convo: Conversation,
  settings: Settings,
  memories: MemoryItem[],
  agents: Agent[]
): string {
  const others = (convo.participants ?? [])
    .filter((p) => p.agentId !== agent.id)
    .map((p) => agents.find((a) => a.id === p.agentId)?.name)
    .filter((n): n is string => !!n);
  return buildSystemPrompt(agent, convo, settings, memories, undefined, {
    title: convo.title,
    others,
  });
}

/** Full request payload for one participant's turn. */
export function buildGroupContext(
  agent: Agent,
  convo: Conversation,
  allMessages: ChatMessage[],
  agents: Agent[],
  settings: Settings,
  memories: MemoryItem[]
): ApiMessage[] {
  const gen = settings.genParams ?? { temperature: 0.8, maxTokens: 4096, contextTurns: 12 };
  const system = buildGroupSystemPrompt(agent, convo, settings, memories, agents);
  const history = groupHistory(allMessages, agent.id, agents, gen.contextTurns);
  return [{ role: "system", text: system }, ...history];
}

import { db } from "./db";
import { chatComplete, embedText, type ApiMessage } from "./api";
import { cosine, textSimilarity, now, uid } from "./utils";
import type {
  Agent,
  ChatMessage,
  Conversation,
  MemoryItem,
  MemoryKind,
  ModelConfig,
  Provider,
  Settings,
} from "../types";

// ================================================================
// The memory engine.
//
// Three layers keep an agent "in character" and "remembering":
//   1. Persona layer  — the system prompt, always first, never dropped.
//   2. Working memory — recent messages sent verbatim.
//   3. Long-term memory —
//        a) rolling summary of older turns (conversation.summary)
//        b) extracted facts about the user (memories table),
//           retrieved by embedding similarity (or text fallback).
// ================================================================

const NEUTRAL_PERSONA =
  "你是一个温暖、真诚的AI聊天朋友。你善于倾听，回答简洁自然，像朋友聊天而不是客服。你尊重用户的感受，遇到求助时先共情再给建议。";

export function buildSystemPrompt(
  agent: Agent,
  convo: Conversation,
  settings: Settings,
  memories: MemoryItem[]
): string {
  const parts: string[] = [];
  parts.push(agent.persona.trim() || NEUTRAL_PERSONA);

  const profileBits: string[] = [];
  if (settings.userName.trim()) profileBits.push(`用户的称呼：${settings.userName.trim()}`);
  if (settings.userProfile.trim()) profileBits.push(`用户的自我介绍：${settings.userProfile.trim()}`);
  if (profileBits.length) parts.push(`## 关于用户\n${profileBits.join("\n")}`);

  if (memories.length) {
    const lines = memories
      .sort((a, b) => b.importance - a.importance)
      .slice(0, 12)
      .map((m) => `- [${m.kind === "fact" ? "事实" : m.kind === "preference" ? "喜好" : m.kind === "event" ? "经历" : m.kind === "relationship" ? "关系" : "目标"}] ${m.content}`);
    parts.push(
      `## 你的长期记忆（从过往对话中记住的）\n${lines.join("\n")}\n\n自然地运用这些记忆，像老朋友一样在合适的时候提起；不要一次全部罗列，也不要每句都提。若信息与用户当前所说冲突，以用户最新的话为准。`
    );
  }

  if (convo.summary.trim()) {
    parts.push(`## 本对话更早内容的回顾\n${convo.summary.trim()}`);
  }

  if (agent.memoryEnabled) {
    parts.push(
      "## 记忆机制\n用户知道你拥有长期记忆。当用户分享重要的新信息（喜好、计划、经历、约定）时，正常回应即可，系统会自动帮你记住，无需宣称\"我会记住\"。用户说\"你还记得…吗\"时，优先依据上面的长期记忆和回顾回答。"
    );
  }
  return parts.join("\n\n");
}

// ----------------------------------------------------------------
// Retrieval
// ----------------------------------------------------------------
export async function retrieveMemories(
  agentId: string,
  query: string,
  embeddingRm: { model: ModelConfig; provider: Provider } | null
): Promise<MemoryItem[]> {
  const all = await db.memories.where("agentId").equals(agentId).toArray();
  if (!all.length) return [];
  const pinned = all.filter((m) => m.pinned);
  const rest = all.filter((m) => !m.pinned);
  if (!rest.length) return pinned;

  let scored: { m: MemoryItem; s: number }[];
  if (embeddingRm && query.trim()) {
    let qvec: number[] | null = null;
    try {
      qvec = await embedText(embeddingRm, query.slice(0, 500));
    } catch {
      qvec = null;
    }
    if (qvec && qvec.length) {
      scored = rest.map((m) => ({ m, s: m.embedding?.length ? cosine(qvec!, m.embedding) : 0 }));
    } else {
      scored = rest.map((m) => ({ m, s: textSimilarity(query, m.content) }));
    }
  } else {
    scored = rest.map((m) => ({ m, s: textSimilarity(query, m.content) }));
  }

  scored.sort((a, b) => b.s - a.s);
  const threshold = 0.25;
  const top = scored.filter((x) => x.s > threshold).slice(0, 8);
  // fresh memories deserve a chance even below threshold
  const recent = rest
    .slice()
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 2)
    .filter((m) => !top.some((t) => t.m.id === m.id));

  const result = [...pinned, ...top.map((x) => x.m), ...recent];
  // bump hit counts (fire and forget)
  const hit = result.map((m) => m.id);
  db.memories.where("id").anyOf(hit).modify((m) => {
    m.hitCount = (m.hitCount || 0) + 1;
  }).catch(() => {});
  return result;
}

// ----------------------------------------------------------------
// Context assembly: what actually gets sent to the model
// ----------------------------------------------------------------
export async function buildContextMessages(
  agent: Agent,
  convo: Conversation,
  recentMessages: ChatMessage[],
  settings: Settings,
  models: ModelConfig[],
  providers: Provider[]
): Promise<ApiMessage[]> {
  let memories: MemoryItem[] = [];
  if (agent.memoryEnabled) {
    const embRm = resolveEmbedding(models, providers, settings, agent);
    const query = recentMessages
      .filter((m) => m.role === "user")
      .slice(-2)
      .map((m) => m.content)
      .join("\n");
    try {
      memories = await retrieveMemories(agent.id, query, embRm);
    } catch {
      memories = [];
    }
  }

  const system = buildSystemPrompt(agent, convo, settings, memories);

  const gen = settings.genParams ?? { temperature: 0.8, maxTokens: 4096, contextTurns: 12 };
  const historyWindow = recentMessages.slice(-Math.max(4, gen.contextTurns * 2));
  const apiMsgs: ApiMessage[] = historyWindow.map((m) => ({
    role: m.role,
    text: m.replyTo
      ? `[引用${m.replyTo.role === "user" ? "用户" : "你"}之前说的]「${m.replyTo.content.slice(0, 150)}」\n\n${m.content}`
      : m.content,
    images: m.role === "user" ? m.images : undefined,
  }));

  // Ensure the conversation starts with a user turn (Anthropic requirement)
  while (apiMsgs.length && apiMsgs[0].role === "assistant") apiMsgs.shift();

  return [{ role: "system", text: system }, ...apiMsgs];
}

function resolveEmbedding(
  models: ModelConfig[],
  providers: Provider[],
  settings: Settings,
  agent: Agent
): { model: ModelConfig; provider: Provider } | null {
  const pick = (id?: string | null) => {
    if (!id) return null;
    const m = models.find((x) => x.id === id);
    if (!m) return null;
    const p = providers.find((x) => x.id === m.providerId);
    return p ? { model: m, provider: p } : null;
  };
  return pick(agent.models.embedding) ?? pick(settings.defaults.embedding);
}

// ----------------------------------------------------------------
// Extraction: mine new long-term memories from recent turns
// ----------------------------------------------------------------
const EXTRACT_PROMPT = `你是一个记忆管理器，负责为一个AI聊天智能体维护关于用户的长期记忆。

分析下面的对话，提取"值得长期记住的用户信息"。

【提取标准】
- 用户的个人信息、身份背景（事实 fact）
- 用户的喜好与厌恶（喜好 preference）
- 用户的重要经历、近期发生的事（经历 event）
- 用户的人际关系：家人朋友同事等（关系 relationship）
- 用户的计划、目标、约定（目标 goal）

【不要提取】
- 一次性的闲聊寒暄、与用户无关的内容、AI自己说的话
- 对话中临时性的问题（例如"这个词什么意思"）

输出严格的 JSON 数组，不要任何其他文字或代码块标记：
[{"content": "用户喜欢在深夜写代码", "kind": "preference", "importance": 3}]

importance 为 1-5：5 = 对理解用户极重要（核心身份、重大事件）；3 = 比较有用；1 = 略微相关。
没有值得记的就输出 []

对话内容：
`;

export async function extractMemories(
  agent: Agent,
  msgs: ChatMessage[],
  chatRm: { model: ModelConfig; provider: Provider },
  embeddingRm: { model: ModelConfig; provider: Provider } | null
): Promise<number> {
  const transcript = msgs
    .map((m) => `${m.role === "user" ? "用户" : "AI"}: ${m.content.slice(0, 400)}`)
    .join("\n");
  if (!transcript.trim()) return 0;

  let raw = "";
  try {
    raw = await chatComplete(chatRm, [{ role: "user", text: EXTRACT_PROMPT + transcript }], {
      temperature: 0.1,
      maxTokens: 1000,
    });
  } catch {
    return 0;
  }

  const parsed = parseJsonArray(raw);
  if (!parsed.length) return 0;

  const existing = await db.memories.where("agentId").equals(agent.id).toArray();
  let added = 0;

  for (const item of parsed) {
    const content = String(item.content ?? "").trim();
    if (!content || content.length > 200) continue;
    const kind = (["fact", "preference", "event", "relationship", "goal"].includes(item.kind)
      ? item.kind
      : "fact") as MemoryKind;
    const importance = Math.max(1, Math.min(5, Number(item.importance) || 2));

    // dedupe against existing memories
    let embedding: number[] | null = null;
    if (embeddingRm) {
      try {
        embedding = await embedText(embeddingRm, content);
      } catch {
        embedding = null;
      }
    }
    const dup = findDuplicate(content, embedding, existing);
    if (dup) {
      if (importance > dup.importance) {
        await db.memories.update(dup.id, { importance, updatedAt: now() });
      }
      continue;
    }
    const entry: MemoryItem = {
      id: uid("mem"),
      agentId: agent.id,
      content,
      kind,
      importance,
      embedding,
      pinned: false,
      hitCount: 0,
      createdAt: now(),
      updatedAt: now(),
    };
    existing.push(entry);
    await db.memories.add(entry);
    added++;
  }
  return added;
}

function parseJsonArray(text: string): any[] {
  let t = text.trim();
  t = t.replace(/```(?:json)?/g, "").trim();
  const start = t.indexOf("[");
  const end = t.lastIndexOf("]");
  if (start < 0 || end <= start) return [];
  try {
    const arr = JSON.parse(t.slice(start, end + 1));
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function findDuplicate(
  content: string,
  embedding: number[] | null,
  existing: MemoryItem[]
): MemoryItem | null {
  for (const m of existing) {
    let sim = 0;
    if (embedding && m.embedding?.length) sim = cosine(embedding, m.embedding);
    else sim = textSimilarity(content, m.content);
    if (sim > (embedding ? 0.62 : 0.45)) return m;
  }
  return null;
}

// ----------------------------------------------------------------
// Rolling summary: compress old turns so context stays bounded
// ----------------------------------------------------------------
const SUMMARIZE_PROMPT = `你在为一段AI与用户的聊天对话维护一份"记忆摘要"。请把【新发生的对话】并入【已有摘要】，输出一份更新后的摘要（400字以内）。

摘要必须包含：
1. 讨论过的主要话题和结论
2. 用户提到的重要事实、决定、计划
3. 用户的情绪状态和两人间的氛围
4. 未完成、待继续的话题

用简洁的要点书写，保留具体细节（名字、日期、数字），这将作为AI的记忆使用。直接输出摘要正文。`;

export async function maybeSummarize(
  convo: Conversation,
  agent: Agent,
  msgs: ChatMessage[],
  chatRm: { model: ModelConfig; provider: Provider }
): Promise<Conversation | null> {
  const unsummarized = msgs.filter((m) => m.createdAt > convo.summarizedUntil && m.status !== "error");
  if (unsummarized.length < 44) return null;

  // summarize the older 70% of unsummarized messages, keep the tail verbatim
  const cut = Math.floor(unsummarized.length * 0.7);
  const toSummarize = unsummarized.slice(0, cut);
  if (!toSummarize.length) return null;

  const transcript = toSummarize
    .map((m) => `${m.role === "user" ? "用户" : "AI"}: ${m.content.slice(0, 300)}`)
    .join("\n");
  const input = `【已有摘要】\n${convo.summary || "（无）"}\n\n【新发生的对话】\n${transcript}`;

  let summary = "";
  try {
    summary = await chatComplete(chatRm, [{ role: "user", text: SUMMARIZE_PROMPT + "\n\n" + input }], {
      temperature: 0.2,
      maxTokens: 900,
    });
  } catch {
    return null;
  }
  if (!summary.trim()) return null;

  const updated: Conversation = {
    ...convo,
    summary: summary.trim(),
    summarizedUntil: toSummarize[toSummarize.length - 1].createdAt,
  };
  await db.conversations.put(updated);
  return updated;
}

// ----------------------------------------------------------------
// Conversation title
// ----------------------------------------------------------------
export async function generateTitle(
  firstUserText: string,
  assistantText: string,
  chatRm: { model: ModelConfig; provider: Provider }
): Promise<string | null> {
  const prompt = `为下面这段对话生成一个4~8个字的中文标题（像微信聊天列表里的备注一样简短自然，不要标点、不要书名号）。\n\n用户：${firstUserText.slice(0, 200)}\nAI：${assistantText.slice(0, 200)}\n\n只输出标题。`;
  try {
    const out = await chatComplete(chatRm, [{ role: "user", text: prompt }], {
      temperature: 0.3,
      maxTokens: 30,
    });
    const t = out.trim().replace(/["'《》\s]/g, "");
    if (t && t.length <= 16) return t;
    return null;
  } catch {
    return null;
  }
}

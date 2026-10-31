// Unit tests for @myosotis/core — pure functions only, no network,
// no storage port needed except where noted.
//
//   pnpm --filter @myosotis/core test
import {
  clamp,
  trimUrl,
  uid,
  cosine,
  textSimilarity,
  plainPreview,
  resolveModel,
  resolveGenParams,
  DEFAULT_SETTINGS,
  messageMentionsAgent,
  receivingParticipants,
  replyingParticipants,
  visibleAgentIds,
  messageVisibleTo,
  groupHistory,
  buildGroupContext,
  providerKeyPool,
  pickProviderKey,
  type Agent,
  type ChatMessage,
  type Conversation,
  type GroupParticipant,
  type ModelConfig,
  type Provider,
  type Settings,
} from "../src/index.ts";

// ports: plain key pass-through so plainPreview() works without a host
import { setI18n } from "../src/ports.ts";
setI18n({ t: (k) => k });

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean, detail = "") {
  if (cond) {
    pass++;
    console.log(`  ✅ ${name}`);
  } else {
    fail++;
    console.log(`  ❌ ${name} ${detail}`);
  }
}
function eq(name: string, got: unknown, want: unknown) {
  ok(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
}

// ----------------------------------------------------------------
// helpers to build fixtures
// ----------------------------------------------------------------
function provider(id: string, baseUrl = "https://api.example.com"): Provider {
  return { id, name: id, protocol: "openai", baseUrl, apiKey: "sk-" + id, createdAt: 1 };
}
function model(id: string, providerId: string, roles: ModelConfig["roles"], name = id): ModelConfig {
  return { id, name, providerId, label: id, roles };
}
function agent(id: string, name: string): Agent {
  return {
    id,
    name,
    emoji: "🌸",
    hue: 330,
    persona: `你是${name}`,
    greeting: "",
    suggestions: [],
    memoryEnabled: true,
    models: {},
    createdAt: 1,
    updatedAt: 1,
  };
}
function convo(partial: Partial<Conversation> = {}): Conversation {
  return {
    id: "cnv1",
    agentId: "ag1",
    title: "测试",
    lastMessage: "",
    messageCount: 0,
    createdAt: 1,
    updatedAt: 1,
    kind: "direct",
    summary: "",
    summarizedUntil: 0,
    ...partial,
  };
}
function msg(partial: Partial<ChatMessage>): ChatMessage {
  return { id: "m", conversationId: "cnv1", role: "user", content: "hi", createdAt: 1, ...partial } as ChatMessage;
}

console.log("== utils ==");

eq("uid has prefix", uid("mem").startsWith("mem_"), true);
ok("uid unique", uid() !== uid());
eq("clamp", [clamp(5, 0, 3), clamp(-1, 0, 3), clamp(2, 0, 3)], [3, 0, 2]);
eq("trimUrl strips trailing slashes", trimUrl("https://api.x.com/v1//"), "https://api.x.com/v1");
eq("trimUrl empty", trimUrl(""), "");

const va = [1, 0], vb = [1, 0], vc = [0, 1];
ok("cosine identical = 1", Math.abs(cosine(va, vb) - 1) < 1e-9);
ok("cosine orthogonal = 0", Math.abs(cosine(va, vc)) < 1e-9);
eq("cosine zero vector = 0", cosine([], [1]), 0);

ok("textSimilarity same text = 1", Math.abs(textSimilarity("喜欢深夜写代码", "喜欢深夜写代码") - 1) < 1e-9);
ok("textSimilarity related > unrelated",
  textSimilarity("用户喜欢深夜写代码", "用户常在夜里编程") > textSimilarity("用户喜欢深夜写代码", "今天天气很好"));
eq("textSimilarity empty = 0", textSimilarity("", "abc"), 0);

ok("plainPreview strips markdown", !/[#*`>[\]]/.test(plainPreview("# 你好 **世界**")));
ok("plainPreview collapses code blocks", plainPreview("看看：\n```js\nlet x=1;\n```").includes("previewCode"));

console.log("== resolveModel ==");

const provs = [provider("p1"), provider("p2")];
const mods = [
  model("m-chat", "p1", ["chat"]),
  model("m-vis", "p2", ["vision"]),
  model("m-both", "p1", ["chat", "vision"]),
];
const settings: Settings = structuredClone(DEFAULT_SETTINGS);

// global default wins over capability scan
const s1: Settings = { ...settings, defaults: { ...settings.defaults, chat: "m-chat" } };
eq("global default resolves", resolveModel("chat", mods, provs, s1)?.model.id, "m-chat");

// agent override wins over the global default
eq("agent override resolves",
  resolveModel("chat", mods, provs, s1, { chat: "m-both" })?.model.id, "m-both");

// no default → fall back to any capable model
eq("capability fallback",
  resolveModel("vision", mods, provs, DEFAULT_SETTINGS)?.model.id, "m-vis");

// provider must resolve with the model
eq("provider resolved with model",
  resolveModel("chat", mods, provs, DEFAULT_SETTINGS)?.provider.id, "p1");

// nothing capable → null, never throw
eq("unresolvable role → null", resolveModel("tts", mods, provs, DEFAULT_SETTINGS), null);

console.log("== resolveGenParams ==");

const sGen: Settings = { ...settings, genParams: { temperature: 0.5, maxTokens: 1000, contextTurns: 8 } };
eq("global params used without agent", resolveGenParams("reply", sGen), { temperature: 0.5, maxTokens: 1000 });
eq("agent override applies",
  resolveGenParams("reply", sGen, { slotParams: { reply: { temperature: 1.2 } } } as Agent),
  { temperature: 1.2, maxTokens: 1000 });
eq("null override falls through",
  resolveGenParams("reply", sGen, { slotParams: { reply: { temperature: null } } } as Agent),
  { temperature: 0.5, maxTokens: 1000 });

console.log("== key pool ==");

const poolProv = provider("pp");
poolProv.keys = [" k2 ", "", "k2"];
eq("pool dedupes and trims", providerKeyPool(poolProv), ["sk-pp", "k2"]);
eq("pool pick is stable", pickProviderKey(poolProv, "seed-a"), pickProviderKey(poolProv, "seed-a"));
ok("empty pool → empty key", pickProviderKey({ ...poolProv, apiKey: "", keys: [] }, "s") === "");

console.log("== group engine ==");

const ag1 = agent("ag1", "小樱");
const ag2 = agent("ag2", "知夏");
const agents = [ag1, ag2];
const all: GroupParticipant[] = [
  { agentId: "ag1", receiveMode: "all", replyMode: "all", sortOrder: 1 },
  { agentId: "ag2", receiveMode: "mention", replyMode: "mention", sortOrder: 0 },
];

const agEn = agent("ag-en", "Iris");
ok("mention by display name", messageMentionsAgent("快来 @知夏 看看", ag2));
ok("mention is case-insensitive", messageMentionsAgent("@IRIS 在吗", agEn));
ok("no false mention", !messageMentionsAgent("知夏真好看", ag2));

eq("receiving: mention-only filtered out",
  receivingParticipants(all, "随便聊聊", agents).map((p) => p.agentId), ["ag1"]);
eq("receiving: mention lets the agent in",
  receivingParticipants(all, "@知夏 在吗", agents).map((p) => p.agentId), ["ag1", "ag2"]);

// replies keep sortOrder order (ag2 sorts before ag1)
eq("replying keeps sortOrder",
  replyingParticipants(all, "@知夏 @小樱 你们好", agents).map((p) => p.agentId), ["ag2", "ag1"]);
eq("replying filters non-mention",
  replyingParticipants(all, "随便聊聊", agents).map((p) => p.agentId), ["ag1"]);

eq("visibleAgentIds", visibleAgentIds(all, "嗨", agents), ["ag1"]);
ok("message visible when visibleTo empty", messageVisibleTo(msg({}), "ag2"));
ok("message hidden from excluded agent",
  !messageVisibleTo(msg({ visibleTo: ["ag1"] }), "ag2"));

// groupHistory: other speakers prefixed, own voice clean, leading
// assistant turns dropped (Anthropic requires a user turn first)
const history = [
  msg({ id: "a", role: "assistant", agentId: "ag2", content: "我先说" }),
  msg({ id: "b", role: "user", content: "你们好" }),
  msg({ id: "c", role: "assistant", agentId: "ag1", content: "你好呀" }),
];
const gh = groupHistory(history, "ag1", agents, 12);
eq("leading assistant turn dropped", gh.map((m) => m.text), ["你们好", "你好呀"]);
const gh2 = groupHistory(history, "ag2", agents, 12);
eq("other speaker prefixed for ag2", gh2[1]?.text, "小樱：你好呀");

// Anthropic compat: the first non-system message must be a user turn
const gh3 = groupHistory([msg({ id: "x", role: "assistant", agentId: "ag1", content: "开场" }), msg({ id: "y", role: "user", content: "嗨" })], "ag1", agents, 12);
eq("assistant-first history shifted", gh3[0]?.role, "user");

// full context: system prompt first, group framing inside
const ctx = buildGroupContext(ag1, convo({ kind: "group", participants: all, title: "圆桌" }), history, agents, DEFAULT_SETTINGS, []);
eq("context starts with system", ctx[0]?.role, "system");
ok("group framing mentions the chat title", ctx[0]?.text.includes("圆桌"));
ok("group framing names the other agent", ctx[0]?.text.includes("知夏"));

console.log(`\nPASS=${pass} FAIL=${fail}`);
// the suite is plain node — exit code is how the runner sees failures
(globalThis as any).process?.exit?.(fail === 0 ? 0 : 1);

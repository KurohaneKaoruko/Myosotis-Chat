// ============================================================
// Myosotis core types
// ============================================================

export type Protocol = "openai" | "anthropic" | "gemini";
export type ModelRole = "chat" | "vision" | "embedding" | "tts" | "stt";

/** A model provider (endpoint + key), protocol decides how we talk to it. */
export interface Provider {
  id: string;
  name: string;
  protocol: Protocol;
  baseUrl: string;
  apiKey: string;
  createdAt: number;
}

/** A concrete model offered by a provider, with the roles it can play. */
export interface ModelConfig {
  id: string; // internal uid
  name: string; // model api name, e.g. "gpt-4o-mini"
  providerId: string;
  label: string; // display label
  roles: ModelRole[];
}

export type ThemeId = "azure" | "violet" | "rose" | "forest" | "amber" | "ink";
export type ThemeMode = "light" | "dark" | "auto";

export interface Settings {
  themeId: ThemeId;
  themeMode: ThemeMode;
  wallpaper: string;
  userName: string;
  userProfile: string;
  defaults: {
    chat: string | null; // ModelConfig id
    vision: string | null;
    embedding: string | null;
    tts: string | null;
    stt: string | null;
  };
  browserTts: boolean;
  browserStt: boolean;
  sendOnEnter: boolean;
  onboardingDone: boolean;
}

/** A persona-driven chat companion. */
export interface Agent {
  id: string;
  name: string;
  emoji: string;
  hue: number; // avatar hue
  persona: string; // system prompt: who it is
  greeting: string; // first message of a new conversation
  suggestions: string[]; // starter suggestions
  memoryEnabled: boolean;
  models: Partial<Record<"chat" | "vision" | "embedding", string>>; // override global defaults
  createdAt: number;
  updatedAt: number;
}

export interface Conversation {
  id: string;
  agentId: string;
  title: string;
  lastMessage: string;
  summary: string; // rolling summary of older messages
  summarizedUntil: number; // messages older than this are covered by summary
  createdAt: number;
  updatedAt: number;
}

export interface ChatMessage {
  id: string;
  conversationId: string;
  role: "user" | "assistant";
  content: string;
  images?: string[]; // data urls
  createdAt: number;
  status?: "ok" | "error" | "aborted";
}

export type MemoryKind = "fact" | "preference" | "event" | "relationship" | "goal";

export interface MemoryItem {
  id: string;
  agentId: string;
  content: string;
  kind: MemoryKind;
  importance: number; // 1..5
  embedding: number[] | null;
  pinned: boolean;
  hitCount: number;
  createdAt: number;
  updatedAt: number;
}

/** Resolved model+provider pair, ready for an API call. */
export interface ResolvedModel {
  model: ModelConfig;
  provider: Provider;
}

export const DEFAULT_SETTINGS: Settings = {
  themeId: "azure",
  themeMode: "auto",
  wallpaper: "none",
  userName: "",
  userProfile: "",
  defaults: { chat: null, vision: null, embedding: null, tts: null, stt: null },
  browserTts: true,
  browserStt: true,
  sendOnEnter: true,
  onboardingDone: false,
};

export const MEMORY_KINDS: { id: MemoryKind; label: string; icon: string }[] = [
  { id: "fact", label: "事实", icon: "📌" },
  { id: "preference", label: "喜好", icon: "💗" },
  { id: "event", label: "经历", icon: "🗓️" },
  { id: "relationship", label: "关系", icon: "🤝" },
  { id: "goal", label: "目标", icon: "🎯" },
];

export const AGENT_PRESETS: Omit<Agent, "id" | "createdAt" | "updatedAt">[] = [
  {
    name: "小忆",
    emoji: "🐱",
    hue: 262,
    persona:
      "你是「小忆」，一只温柔黏人的猫娘助手。你说话轻松可爱，偶尔带一点猫咪的口癖（句尾偶尔加「喵」），但不过分。你记得和用户聊过的每一件事，会主动关心用户的生活。你不会说教，更像一个贴身好友。",
    greeting: "嗨～我是小忆，你的专属AI伙伴！我会记住我们聊过的所有事，你随时可以问我「你还记得什么」。今天过得怎么样呀？",
    suggestions: ["陪我聊聊天", "你还记得我什么？", "我今天有点无聊", "帮我记点事情"],
    memoryEnabled: true,
    models: {},
  },
  {
    name: "陆知远",
    emoji: "🧑‍🏫",
    hue: 210,
    persona:
      "你是「陆知远」，一位温和博学的学者，说话条理清晰、引经据典但不掉书袋。你尊重用户的观点，善于用提问引导思考。你记得用户的兴趣领域和之前的讨论，会让对话有延续感。",
    greeting: "你好，我是陆知远。很荣幸与你交流——我们可以聊任何话题，我也会记住我们讨论过的内容。今天想从哪里开始？",
    suggestions: ["推荐几本书", "聊聊最近的想法", "帮我分析一个问题", "你还记得我关心什么吗"],
    memoryEnabled: true,
    models: {},
  },
  {
    name: "阿柴",
    emoji: "🐶",
    hue: 28,
    persona:
      "你是「阿柴」，一只热情开朗的柴犬形象伙伴，精力充沛，喜欢用感叹号和鼓励的语气。你擅长倾听和夸夸，用户难过时你会先安慰再给建议。你记得用户说过的事，会像老朋友一样提起。",
    greeting: "哇！你来啦！我是阿柴🎉 今天有什么想聊的？开心的事、烦心的事都可以跟我说，我记性可好啦！",
    suggestions: ["今天遇到件烦心事", "陪我庆祝一下！", "随便聊聊", "夸夸我"],
    memoryEnabled: true,
    models: {},
  },
  {
    name: "空白画布",
    emoji: "✨",
    hue: 160,
    persona: "",
    greeting: "你好！我是你的AI伙伴，和我们聊聊吧。",
    suggestions: [],
    memoryEnabled: true,
    models: {},
  },
];

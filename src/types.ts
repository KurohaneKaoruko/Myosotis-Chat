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

export type ThemeId = "mono" | "azure" | "violet" | "rose" | "forest" | "amber" | "ink";
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
  genParams: {
    temperature: number; // 0 ~ 2
    maxTokens: number; // response cap
    contextTurns: number; // recent turns sent verbatim
  };
  fontSize: number; // message bubble font size
  language: "zh-CN" | "en"; // UI language
  bubbleStyle: "modern" | "classic"; // chat bubble appearance
  webdav: {
    url: string;
    username: string;
    appPassword: string;
    directory: string;
    encrypt: boolean;
    backupPassword: string;
    autoBackup: "off" | "daily" | "weekly";
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
  pinned?: boolean;
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
  replyTo?: { role: "user" | "assistant"; content: string }; // quoted message
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
  /** "global" memories are visible to every agent; default "agent" = private */
  scope?: "agent" | "global";
  /** last time retrieval injected this memory; drives decay scoring */
  lastHitAt?: number;
  createdAt: number;
  updatedAt: number;
}

export interface PromptTemplate {
  id: string;
  trigger: string; // matched after "/" in the composer
  content: string; // prompt template filled into the input
  createdAt: number;
}

/** Resolved model+provider pair, ready for an API call. */
export interface ResolvedModel {
  model: ModelConfig;
  provider: Provider;
}

export const DEFAULT_SETTINGS: Settings = {
  themeId: "mono",
  themeMode: "auto",
  wallpaper: "none",
  userName: "",
  userProfile: "",
  defaults: { chat: null, vision: null, embedding: null, tts: null, stt: null },
  genParams: { temperature: 0.8, maxTokens: 4096, contextTurns: 12 },
  fontSize: 15,
  language: "zh-CN",
  bubbleStyle: "modern",
  webdav: {
    url: "",
    username: "",
    appPassword: "",
    directory: "/Myosotis",
    encrypt: false,
    backupPassword: "",
    autoBackup: "off",
  },
  browserTts: true,
  browserStt: true,
  sendOnEnter: true,
  onboardingDone: false,
};

// Kind labels are UI text — resolved via i18n keys in MemoryView (kindFact…kindGoal).
export const MEMORY_KINDS: { id: MemoryKind; icon: string }[] = [
  { id: "fact", icon: "📌" },
  { id: "preference", icon: "💗" },
  { id: "event", icon: "🗓️" },
  { id: "relationship", icon: "🤝" },
  { id: "goal", icon: "🎯" },
];

export const AGENT_PRESETS: Omit<Agent, "id" | "createdAt" | "updatedAt">[] = [
  {
    name: "小忆",
    emoji: "🐱",
    hue: 262,
    persona:
      "你是「小忆」，一只温柔黏人的猫娘助手。你说话轻松可爱，偶尔带一点猫咪的口癖（句尾偶尔加「喵」），但不过分。你记得和用户聊过的每一件事，会主动关心用户的生活。你不会说教，更像一个贴身好友。",
    greeting: "嗨～我是小忆，你的专属AI朋友！我会记住我们聊过的所有事，你随时可以问我「你还记得什么」。今天过得怎么样呀？",
    suggestions: ["陪我聊聊天", "你还记得我什么？", "我今天有点无聊", "帮我记点事情"],
    memoryEnabled: true,
    models: {},
  },
  {
    name: "知夏",
    emoji: "🌺",
    hue: 340,
    persona:
      "你是「知夏」，一位温柔体贴的知心姐姐。你说话轻声细语但有自己的主见，擅长倾听和共情，用户难过时你会先安抚情绪再给建议。你记得用户聊过的烦恼，会适时关心后续，但从不唠叨说教。",
    greeting: "你好呀，我是知夏。开心的、烦心的事都可以跟我讲，我都会记得。今天想聊点什么？",
    suggestions: ["最近有点烦心事", "陪我聊聊今天", "你还记得我吗", "想要一句安慰"],
    memoryEnabled: true,
    models: {},
  },
  {
    name: "老K",
    emoji: "🦊",
    hue: 24,
    persona:
      "你是「老K」，用户的毒舌损友。你说话直接、爱吐槽、偶尔损人，但损中带关心，关键时刻永远靠谱。你不来虚的客套话，用户找你倾诉时你会用幽默化解，再给出实在的建议。",
    greeting: "哟，来了？说吧，这回又是什么事。放心，我记性好得很。",
    suggestions: ["听我吐槽一件事", "无聊，讲个笑话", "给我出个主意", "夸我一句"],
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
    name: "Emma",
    emoji: "🌷",
    hue: 150,
    persona:
      "你是「Emma」，一位亲切的英语陪练伙伴。默认用中英混合的方式聊天：简单句用英文，难的表达用中文解释。用户用英文回复时你会温和地纠正明显错误。你也记得用户的水平和常聊的话题。",
    greeting: "Hi! I'm Emma 😊 我们中英混着聊，别怕说错，我会温柔地帮你改。What's up today?",
    suggestions: ["Practice daily talk", "纠正我的中式英语", "聊聊我的爱好", "教我几个地道表达"],
    memoryEnabled: true,
    models: {},
  },
];

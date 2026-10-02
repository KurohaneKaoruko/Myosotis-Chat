import { useState } from "react";
import { useStore } from "../store";
import { Modal, Icon } from "./ui";
import type { Agent } from "../types";

const EMOJIS = [
  "🌸","🌺","🌻","🌷","🌹","🪻","🐱","🐶","🦊","🐰","🐻","🐼","🐨","🦁","🐯","🐹",
  "🧚","🧝","🧙","🧛","👼","👧","👦","🧑‍🏫","🧑‍🎨","🧑‍💻","👨‍🍳","👩‍⚕️","🤖","👽","🐲","🦄",
  "⭐","🌙","☀️","🌈","🎵","📚","☕","🍵","🎮","🎨","✨","🔮","💎","🍀","🌊","🔥",
];

const PERSONA_IDEAS = [
  {
    name: "温柔知心姐姐",
    text: "你是「知夏」，一位温柔体贴的知心姐姐。你说话轻声细语但有自己的主见，擅长倾听和共情，用户难过时你会先安抚情绪再给建议。你记得用户聊过的烦恼，会适时关心后续，但从不唠叨说教。",
  },
  {
    name: "毒舌损友",
    text: "你是「老K」，用户的毒舌损友。你说话直接、爱吐槽、偶尔损人，但损中带关心，关键时刻永远靠谱。你不来虚的客套话，用户找你倾诉时你会用幽默化解，再给出实在的建议。",
  },
  {
    name: "博学导师",
    text: "你是「陆知远」，一位温和博学的学者，说话条理清晰、引经据典但不掉书袋。你尊重用户的观点，善于用提问引导思考，记得用户的兴趣领域，让讨论有延续感。",
  },
  {
    name: "二次元同好",
    text: "你是「小满」，一个热情的二次元同好。你对动漫、游戏如数家珍，说话带点网络梗但不过度，能陪用户聊作品聊角色，也记得用户推过的番和玩过的游戏。",
  },
  {
    name: "英文陪练",
    text: "你是「Emma」，一位亲切的英语陪练伙伴。默认用中英混合的方式聊天：简单句用英文，难的表达用中文解释。用户用英文回复时你会温和地纠正明显错误。你也记得用户的水平和常聊的话题。",
  },
  {
    name: "生活管家",
    text: "你是「安姐」，一位细心可靠的生活管家式伙伴。你擅长提醒、记事、出主意：从做饭、旅行规划到送礼建议。用户拜托你记住的事你会认真确认，之后主动提起。",
  },
];

export default function AgentEditor() {
  const editingAgentId = useStore((s) => s.editingAgentId);
  if (!editingAgentId) return null;
  return <EditorBody key={editingAgentId} agentId={editingAgentId} />;
}

function EditorBody({ agentId }: { agentId: string }) {
  const agents = useStore((s) => s.agents);
  const models = useStore((s) => s.models);
  const settings = useStore((s) => s.settings);
  const updateAgent = useStore((s) => s.updateAgent);
  const deleteAgent = useStore((s) => s.deleteAgent);
  const setEditingAgentId = useStore((s) => s.setEditingAgentId);
  const newConversation = useStore((s) => s.newConversation);
  const showToast = useStore((s) => s.showToast);

  const agent = agents.find((a) => a.id === agentId);
  const providers = useStore((s) => s.providers);
  const [form, setForm] = useState<Agent>(agent ? { ...agent } : ({} as Agent));
  const [suggText, setSuggText] = useState((agent?.suggestions ?? []).join("\n"));
  const [showEmoji, setShowEmoji] = useState(false);
  const [showIdeas, setShowIdeas] = useState(false);

  if (!agent) return null;
  const set = (patch: Partial<Agent>) => setForm((f) => ({ ...f, ...patch }));

  const save = async () => {
    if (!form.name?.trim()) {
      showToast("先给伙伴起个名字吧", "error");
      return;
    }
    const suggestions = suggText
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 6);
    await updateAgent(agent.id, { ...form, name: form.name.trim(), suggestions });
    setEditingAgentId(null);
    showToast("已保存", "success");
  };

  const chatModels = models.filter((m) => m.roles.includes("chat"));
  const visionModels = models.filter((m) => m.roles.includes("vision"));
  const embedModels = models.filter((m) => m.roles.includes("embedding"));
  const modelSelect = (
    label: string,
    role: "chat" | "vision" | "embedding",
    options: typeof chatModels
  ) => (
    <div className="field">
      <label>{label}</label>
      <select
        className="select input"
        value={form.models?.[role] ?? ""}
        onChange={(e) => set({ models: { ...form.models, [role]: e.target.value || undefined } })}
      >
        <option value="">跟随全局默认</option>
        {options.map((m) => (
          <option key={m.id} value={m.id}>
            {m.label}（{providers.find((p) => p.id === m.providerId)?.name ?? "?"}）
          </option>
        ))}
      </select>
    </div>
  );

  return (
    <Modal
      title="伙伴设定"
      onClose={() => setEditingAgentId(null)}
      footer={
        <>
          <button
            className="btn danger"
            onClick={() => {
              if (confirm(`确定删除「${agent.name}」？其对话与记忆也会一并删除。`)) {
                deleteAgent(agent.id);
              }
            }}
          >
            删除
          </button>
          <button
            className="btn ghost"
            onClick={async () => {
              await save();
              newConversation(agent.id);
            }}
          >
            保存并开聊
          </button>
          <button className="btn primary" onClick={save}>
            保存
          </button>
        </>
      }
    >
      {/* avatar preview + emoji + hue */}
      <div className="row" style={{ alignItems: "center", marginBottom: 16 }}>
        <div
          className="ava"
          style={{
            width: 68,
            height: 68,
            borderRadius: 22,
            background: `linear-gradient(135deg, hsl(${form.hue} 70% 55%), hsl(${(form.hue + 40) % 360} 70% 45%))`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 36,
            cursor: "pointer",
          }}
          title="点击更换头像"
          onClick={() => setShowEmoji(!showEmoji)}
        >
          {form.emoji}
        </div>
        <div style={{ flex: 1 }}>
          <div className="field" style={{ marginBottom: 8 }}>
            <label>名字</label>
            <input className="input" value={form.name ?? ""} onChange={(e) => set({ name: e.target.value })} placeholder="伙伴的名字" />
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <label>头像色（点击左侧头像换表情）</label>
            <input
              type="range"
              min={0}
              max={359}
              value={form.hue ?? 260}
              style={{ width: "100%", accentColor: `hsl(${form.hue} 70% 55%)` }}
              onChange={(e) => set({ hue: Number(e.target.value) })}
            />
          </div>
        </div>
      </div>

      {showEmoji && (
        <div className="emoji-grid" style={{ marginBottom: 16 }}>
          {EMOJIS.map((e) => (
            <button key={e} className={e === form.emoji ? "on" : ""} onClick={() => set({ emoji: e })}>
              {e}
            </button>
          ))}
        </div>
      )}

      <div className="field">
        <label style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          人设（伙伴是谁、怎么说话）
          <button className="btn sm ghost" onClick={() => setShowIdeas(!showIdeas)}>
            {showIdeas ? "收起灵感" : "灵感模板"}
          </button>
        </label>
        <textarea
          className="input"
          rows={5}
          value={form.persona ?? ""}
          onChange={(e) => set({ persona: e.target.value })}
          placeholder="描述伙伴的性格、说话方式、与你的关系…&#10;例如：你是我的高中同学，性格开朗爱开玩笑，我们都喜欢打篮球…"
        />
        <div className="desc">留空则使用默认性格：温暖真诚的好朋友</div>
      </div>

      {showIdeas && (
        <div className="chips" style={{ marginBottom: 14 }}>
          {PERSONA_IDEAS.map((p) => (
            <button key={p.name} className="chip" onClick={() => set({ persona: p.text })}>
              {p.name}
            </button>
          ))}
        </div>
      )}

      <div className="field">
        <label>开场白（新对话的第一句话）</label>
        <textarea
          className="input"
          rows={2}
          value={form.greeting ?? ""}
          onChange={(e) => set({ greeting: e.target.value })}
          placeholder="嗨～很高兴见到你！"
        />
      </div>

      <div className="field">
        <label>开场建议（每行一条，新对话时显示为快捷气泡）</label>
        <textarea
          className="input"
          rows={2}
          value={suggText}
          onChange={(e) => setSuggText(e.target.value)}
          placeholder={"陪我聊聊天\n今天有点无聊"}
        />
      </div>

      <div className="set-row" style={{ padding: "6px 0 12px" }}>
        <div className="info">
          <div className="t">长期记忆</div>
          <div className="d">自动记住你的喜好与经历，跨对话保持。可在「记忆」页管理</div>
        </div>
        <button className={`toggle ${form.memoryEnabled ? "on" : ""}`} onClick={() => set({ memoryEnabled: !form.memoryEnabled })} />
      </div>

      {(chatModels.length > 0 || visionModels.length > 0 || embedModels.length > 0) && (
        <>
          <div className="section-label" style={{ padding: "4px 0" }}>专属模型（可选）</div>
          {modelSelect("对话模型", "chat", chatModels)}
          {modelSelect("看图模型", "vision", visionModels)}
          {modelSelect("记忆检索模型", "embedding", embedModels)}
        </>
      )}
    </Modal>
  );
}

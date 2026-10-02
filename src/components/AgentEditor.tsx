import { useState } from "react";
import { useStore } from "../store";
import { Modal, Icon } from "./ui";
import { AGENT_PRESETS, type Agent } from "../types";

const EMOJIS = [
  "🌸","🌺","🌻","🌷","🌹","🪻","🐱","🐶","🦊","🐰","🐻","🐼","🐨","🦁","🐯","🐹",
  "🧚","🧝","🧙","🧛","👼","👧","👦","🧑‍🏫","🧑‍🎨","🧑‍💻","👨‍🍳","👩‍⚕️","🤖","👽","🐲","🦄",
  "⭐","🌙","☀️","🌈","🎵","📚","☕","🍵","🎮","🎨","✨","🔮","💎","🍀","🌊","🔥",
];

export default function AgentEditor() {
  const editingAgentId = useStore((s) => s.editingAgentId);
  if (!editingAgentId) return null;
  return <EditorBody key={editingAgentId} agentId={editingAgentId} />;
}

function EditorBody({ agentId }: { agentId: string }) {
  const agents = useStore((s) => s.agents);
  const models = useStore((s) => s.models);
  const providers = useStore((s) => s.providers);
  const updateAgent = useStore((s) => s.updateAgent);
  const deleteAgent = useStore((s) => s.deleteAgent);
  const setEditingAgentId = useStore((s) => s.setEditingAgentId);
  const newConversation = useStore((s) => s.newConversation);
  const showToast = useStore((s) => s.showToast);

  const agent = agents.find((a) => a.id === agentId);
  const [form, setForm] = useState<Agent>(agent ? { ...agent } : ({} as Agent));
  const [suggText, setSuggText] = useState((agent?.suggestions ?? []).join("\n"));
  const [showEmoji, setShowEmoji] = useState(false);

  if (!agent) return null;
  const isNew = agent.name === "新智能体" && !agent.persona;
  const set = (patch: Partial<Agent>) => setForm((f) => ({ ...f, ...patch }));

  const applyPreset = (p: (typeof AGENT_PRESETS)[number]) => {
    set({
      name: p.name,
      emoji: p.emoji,
      hue: p.hue,
      persona: p.persona,
      greeting: p.greeting,
      suggestions: p.suggestions,
    });
    setSuggText(p.suggestions.join("\n"));
    showToast(`已套用「${p.name}」模板，可继续修改`, "success");
  };

  const save = async () => {
    if (!form.name?.trim() || form.name === "新智能体") {
      showToast("先给智能体起个名字吧", "error");
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
  const modelSelect = (label: string, role: "chat" | "vision" | "embedding", options: typeof chatModels) => (
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
      title="智能体设定"
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
      {isNew && (
        <div className="field">
          <label>从模板开始（点一下即可套用，还能继续改）</label>
          <div className="chips">
            {AGENT_PRESETS.map((p) => (
              <button key={p.name} className="chip" onClick={() => applyPreset(p)}>
                {p.emoji} {p.name}
              </button>
            ))}
            <button
              className="chip"
              onClick={() => {
                set({ name: "", persona: "", greeting: "" });
                setSuggText("");
                showToast("从零开始，自由发挥吧", "success");
              }}
            >
              🎨 从零开始
            </button>
          </div>
        </div>
      )}

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
            <input className="input" value={form.name ?? ""} onChange={(e) => set({ name: e.target.value })} placeholder="智能体的名字" />
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
        <label>人设（它是谁、怎么说话）</label>
        <textarea
          className="input"
          rows={5}
          value={form.persona ?? ""}
          onChange={(e) => set({ persona: e.target.value })}
          placeholder="描述智能体的性格、说话方式、与你的关系…&#10;例如：你是我的高中同学，性格开朗爱开玩笑，我们都喜欢打篮球…"
        />
        <div className="desc">留空则使用默认性格：温暖真诚的好朋友</div>
      </div>

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

import { useState } from "react";
import { useStore } from "../store";
import { Modal, Icon, SelectBox, Toggle } from "./ui";
import { AGENT_PRESETS, type Agent } from "../types";
import { t, tf } from "../i18n";

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
  const openOrCreateConversation = useStore((s) => s.openOrCreateConversation);
  const showToast = useStore((s) => s.showToast);

  const agent = agents.find((a) => a.id === agentId);
  const [form, setForm] = useState<Agent>(agent ? { ...agent } : ({} as Agent));
  const [suggText, setSuggText] = useState((agent?.suggestions ?? []).join("\n"));
  const [showEmoji, setShowEmoji] = useState(false);

  if (!agent) return null;
  const isNew = agent.name === t("newAgent") && !agent.persona;
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
    showToast(tf("presetApplied", { name: p.name }), "success");
  };

  const save = async () => {
    if (!form.name?.trim() || form.name === t("newAgent")) {
      showToast(t("nameRequired"), "error");
      return;
    }
    const suggestions = suggText
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 6);
    await updateAgent(agent.id, { ...form, name: form.name.trim(), suggestions });
    setEditingAgentId(null);
    // chat-app flow: saving (new or existing) lands in the agent's single conversation
    await openOrCreateConversation(agent.id);
    showToast(t("saved"), "success");
  };

  const chatModels = models.filter((m) => m.roles.includes("chat"));
  const visionModels = models.filter((m) => m.roles.includes("vision"));
  const embedModels = models.filter((m) => m.roles.includes("embedding"));
  const modelSelect = (label: string, role: "chat" | "vision" | "embedding", options: typeof chatModels) => (
    <div className="field">
      <label>{label}</label>
      <SelectBox
        value={form.models?.[role] ?? null}
        onChange={(v) => set({ models: { ...form.models, [role]: v ?? undefined } })}
        options={options.map((m) => ({
          value: m.id,
          label: `${m.label}（${providers.find((p) => p.id === m.providerId)?.name ?? "?"}）`,
        }))}
        placeholder={t("followGlobal")}
      />
    </div>
  );

  return (
    <Modal
      title={t("editorTitle")}
      onClose={() => setEditingAgentId(null)}
      footer={
        <>
          <button
            className="btn danger"
            onClick={() => {
              useStore
                .getState()
                .askConfirm({
                  title: t("deleteAgentTitle"),
                  message: tf("deleteAgentMsg", { name: agent.name }),
                  confirmText: t("commonDelete"),
                  danger: true,
                })
                .then((ok) => { if (ok) deleteAgent(agent.id); });
            }}
          >
            {t("delete")}
          </button>
          <button className="btn primary" onClick={save}>
            {t("commonSave")}
          </button>
        </>
      }
    >
      {isNew && (
        <div className="field">
          <label>{t("fromTemplate")}</label>
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
                showToast(t("fromScratchToast"), "success");
              }}
            >
              {t("fromScratch")}
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
          title={t("changeAvatar")}
          onClick={() => setShowEmoji(!showEmoji)}
        >
          {form.emoji}
        </div>
        <div style={{ flex: 1 }}>
          <div className="field" style={{ marginBottom: 8 }}>
            <label>{t("name")}</label>
            <input className="input" value={form.name ?? ""} onChange={(e) => set({ name: e.target.value })} placeholder={t("agentNamePh")} />
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <label>{t("avatarColor")}</label>
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
        <label>{t("persona")}</label>
        <textarea
          className="input"
          rows={5}
          value={form.persona ?? ""}
          onChange={(e) => set({ persona: e.target.value })}
          placeholder={t("personaPh")}
        />
        <div className="desc">{t("personaEmpty")}</div>
      </div>

      <div className="field">
        <label>{t("greeting")}</label>
        <textarea
          className="input"
          rows={2}
          value={form.greeting ?? ""}
          onChange={(e) => set({ greeting: e.target.value })}
          placeholder={t("greetingPh")}
        />
      </div>

      <div className="field">
        <label>{t("suggestions")}</label>
        <textarea
          className="input"
          rows={2}
          value={suggText}
          onChange={(e) => setSuggText(e.target.value)}
          placeholder={t("suggestionsPh")}
        />
      </div>

      <div className="set-row" style={{ padding: "6px 0 12px" }}>
        <div className="info">
          <div className="t">{t("longMemory")}</div>
          <div className="d">{t("longMemoryDesc")}</div>
        </div>
        <Toggle checked={!!form.memoryEnabled} onChange={(v) => set({ memoryEnabled: v })} />
      </div>

      {(chatModels.length > 0 || visionModels.length > 0 || embedModels.length > 0) && (
        <>
          <div className="section-label" style={{ padding: "4px 0" }}>{t("customModels")}</div>
          {modelSelect(t("chatModel"), "chat", chatModels)}
          {modelSelect(t("visionModel"), "vision", visionModels)}
          {modelSelect(t("embedModel"), "embedding", embedModels)}
        </>
      )}
    </Modal>
  );
}

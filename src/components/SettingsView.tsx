import { useState } from "react";
import { useStore } from "../store";
import { listRemoteModels } from "../lib/api";
import { friendlyError } from "../lib/utils";
import { Modal, Icon, SelectBox, Toggle, SliderRow } from "./ui";
import type { ModelRole, Protocol, Provider, ThemeId, ThemeMode } from "../types";

const PROTOCOL_LABELS: Record<Protocol, string> = {
  openai: "OpenAI 兼容",
  anthropic: "Anthropic",
  gemini: "Gemini",
};

const TEMPLATE_GROUPS: { label: string; items: { name: string; protocol: Protocol; baseUrl: string }[] }[] = [
  {
    label: "热门",
    items: [
      { name: "DeepSeek", protocol: "openai", baseUrl: "https://api.deepseek.com/v1" },
      { name: "OpenAI", protocol: "openai", baseUrl: "https://api.openai.com/v1" },
      { name: "Anthropic", protocol: "anthropic", baseUrl: "https://api.anthropic.com" },
      { name: "Gemini", protocol: "gemini", baseUrl: "https://generativelanguage.googleapis.com" },
      { name: "MiniMax", protocol: "openai", baseUrl: "https://api.minimax.chat/v1" },
      { name: "硅基流动", protocol: "openai", baseUrl: "https://api.siliconflow.cn/v1" },
      { name: "Kimi", protocol: "openai", baseUrl: "https://api.moonshot.cn/v1" },
      { name: "智谱", protocol: "openai", baseUrl: "https://open.bigmodel.cn/api/paas/v4" },
    ],
  },
  {
    label: "更多国内",
    items: [
      { name: "通义千问", protocol: "openai", baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1" },
      { name: "腾讯混元", protocol: "openai", baseUrl: "https://api.hunyuan.cloud.tencent.com/v1" },
      { name: "讯飞星火", protocol: "openai", baseUrl: "https://spark-api-open.xf-yun.com/v1" },
      { name: "百川", protocol: "openai", baseUrl: "https://api.baichuan-ai.com/v1" },
      { name: "零一万物", protocol: "openai", baseUrl: "https://api.lingyiwanwu.com/v1" },
    ],
  },
  {
    label: "国际",
    items: [
      { name: "OpenRouter", protocol: "openai", baseUrl: "https://openrouter.ai/api/v1" },
      { name: "Groq", protocol: "openai", baseUrl: "https://api.groq.com/openai/v1" },
      { name: "xAI Grok", protocol: "openai", baseUrl: "https://api.x.ai/v1" },
      { name: "Together", protocol: "openai", baseUrl: "https://api.together.xyz/v1" },
      { name: "DeepInfra", protocol: "openai", baseUrl: "https://api.deepinfra.com/v1/openai" },
      { name: "Cerebras", protocol: "openai", baseUrl: "https://api.cerebras.ai/v1" },
    ],
  },
  {
    label: "本地",
    items: [
      { name: "Ollama", protocol: "openai", baseUrl: "http://localhost:11434/v1" },
      { name: "LM Studio", protocol: "openai", baseUrl: "http://localhost:1234/v1" },
    ],
  },
];

const ROLE_ROWS: { role: ModelRole; label: string; desc: string }[] = [
  { role: "chat", label: "对话模型", desc: "智能体的大脑，负责聊天与记忆整理" },
  { role: "vision", label: "看图模型", desc: "理解你发来的图片" },
  { role: "embedding", label: "记忆检索模型", desc: "让回忆找得更准（可选，不填也能用）" },
  { role: "tts", label: "语音朗读模型", desc: "把回复读给你听（可选）" },
  { role: "stt", label: "语音识别模型", desc: "把你的语音变成文字（可选）" },
];

const THEMES: { id: ThemeId; name: string; colors: string }[] = [
  { id: "azure", name: "蔚蓝", colors: "linear-gradient(135deg,#3b82f6,#6366f1)" },
  { id: "violet", name: "紫罗兰", colors: "linear-gradient(135deg,#8b5cf6,#d946ef)" },
  { id: "rose", name: "蔷薇", colors: "linear-gradient(135deg,#f43f5e,#fb7185)" },
  { id: "forest", name: "森绿", colors: "linear-gradient(135deg,#10b981,#14b8a6)" },
  { id: "amber", name: "暖阳", colors: "linear-gradient(135deg,#f59e0b,#f97316)" },
  { id: "ink", name: "墨色", colors: "linear-gradient(135deg,#475569,#334155)" },
];

export default function SettingsView() {
  return (
    <div className="page">
      <div className="page-inner">
        <div className="page-title">
          设置
          <span className="desc" style={{ fontWeight: 400 }}>
            配置一次，处处可用
          </span>
        </div>
        <ProvidersCard />
        <DefaultModelsCard />
        <GenParamsCard />
        <AppearanceCard />
        <VoiceCard />
        <ProfileCard />
        <DataCard />
        <div className="card" style={{ textAlign: "center", color: "var(--text-3)", fontSize: 12 }}>
          Myosotis v0.1.0 · 数据 100% 本地存储，直连模型服务商
        </div>
      </div>
    </div>
  );
}

// ================================================================
// Providers
// ================================================================
function ProvidersCard() {
  const providers = useStore((s) => s.providers);
  const models = useStore((s) => s.models);
  const removeProvider = useStore((s) => s.removeProvider);
  const [editing, setEditing] = useState<Provider | "new" | null>(null);

  return (
    <div className="card">
      <h3>
        <Icon name="key" size={16} /> 模型服务
        <span className="hint">你的 API Key 只保存在本机</span>
      </h3>

      {providers.length === 0 && (
        <div style={{ color: "var(--text-3)", fontSize: 13, marginBottom: 12, padding: "14px", background: "var(--surface-2)", borderRadius: 10, textAlign: "center" }}>
          还没有添加模型服务。添加一家（如 DeepSeek、OpenAI），就可以开始聊天了 →
        </div>
      )}

      {providers.map((p) => {
        const count = models.filter((m) => m.providerId === p.id).length;
        return (
          <div key={p.id} className="provider-card">
            <div className="logo" style={{ background: `linear-gradient(135deg, hsl(${p.name.length * 47 % 360} 65% 52%), hsl(${(p.name.length * 47 + 40) % 360} 65% 44%))` }}>
              {p.name.slice(0, 1)}
            </div>
            <div className="info">
              <div className="name">
                {p.name} <span style={{ fontWeight: 400, fontSize: 11, color: "var(--text-3)" }}>{PROTOCOL_LABELS[p.protocol]}</span>
              </div>
              <div className="meta">
                {p.baseUrl} · {count} 个模型
              </div>
            </div>
            <button className="icon-btn" title="管理模型" onClick={() => setEditing(p)}>
              <Icon name="settings" size={17} />
            </button>
            <button
              className="icon-btn danger"
              title="删除"
              onClick={() => {
                useStore
                  .getState()
                  .askConfirm({
                    title: "删除服务商",
                    message: `删除「${p.name}」及其下所有模型配置？`,
                    confirmText: "删除",
                    danger: true,
                  })
                  .then((ok) => ok && removeProvider(p.id));
              }}
            >
              <Icon name="trash" size={17} />
            </button>
          </div>
        );
      })}

      <button className="btn primary" style={{ width: "100%" }} onClick={() => setEditing("new")}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <Icon name="plus" size={16} /> 添加模型服务
        </span>
      </button>

      {editing && <ProviderForm provider={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function ProviderForm({ provider, onClose }: { provider: Provider | null; onClose: () => void }) {
  const addProvider = useStore((s) => s.addProvider);
  const updateProvider = useStore((s) => s.updateProvider);
  const addModels = useStore((s) => s.addModels);
  const showToast = useStore((s) => s.showToast);

  const [name, setName] = useState(provider?.name ?? "");
  const [protocol, setProtocol] = useState<Protocol>(provider?.protocol ?? "openai");
  const [baseUrl, setBaseUrl] = useState(provider?.baseUrl ?? "");
  const [apiKey, setApiKey] = useState(provider?.apiKey ?? "");
  const [showKey, setShowKey] = useState(false);
  const [remote, setRemote] = useState<{ id: string; label: string }[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [manualName, setManualName] = useState("");

  const placeholder =
    protocol === "openai" ? "https://api.openai.com/v1" : protocol === "anthropic" ? "https://api.anthropic.com" : "https://generativelanguage.googleapis.com";

  const applyTemplate = (t: (typeof TEMPLATES)[number]) => {
    setProtocol(t.protocol);
    setBaseUrl(t.baseUrl);
    if (!name) setName(t.name);
  };

  const saveAndFetch = async () => {
    if (!name.trim() || !baseUrl.trim()) {
      showToast("请填写名称和接口地址", "error");
      return;
    }
    setLoading(true);
    try {
      let p = provider;
      const patch = { name: name.trim(), protocol, baseUrl: baseUrl.trim(), apiKey: apiKey.trim() };
      if (p) {
        await updateProvider(p.id, patch);
        p = { ...p, ...patch };
      } else {
        p = await addProvider(patch);
      }
      const list = await listRemoteModels(p);
      setRemote(list);
      setPicked(new Set());
      showToast(`连接成功，发现 ${list.length} 个模型`, "success");
    } catch (e) {
      showToast(`${friendlyError(e)}\n服务已保存，可手动添加模型名`, "error");
      setRemote([]);
    } finally {
      setLoading(false);
    }
  };

  const togglePick = (id: string) => {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const confirmPick = async () => {
    if (!provider) return;
    if (!picked.size) {
      showToast("先勾选要添加的模型", "error");
      return;
    }
    await addModels(provider.id, Array.from(picked), []);
    showToast(`已添加 ${picked.size} 个模型`, "success");
    onClose();
  };

  const manualAdd = async () => {
    const n = manualName.trim();
    if (!n) return;
    if (!provider) {
      // create provider first if somehow missing
      const p = await addProvider({ name: name.trim() || "自定义", protocol, baseUrl: baseUrl.trim() || placeholder, apiKey: apiKey.trim() });
      await addModels(p.id, [n], []);
    } else {
      await addModels(provider.id, [n], []);
    }
    setManualName("");
    showToast("模型已添加", "success");
  };

  return (
    <Modal title={provider ? `管理「${provider.name}」` : "添加模型服务"} onClose={onClose}>
      {!provider && (
        <div className="field">
          <label>快速选择服务商</label>
          {TEMPLATE_GROUPS.map((group) => (
            <div key={group.label} style={{ marginBottom: 8 }}>
              <div style={{ fontSize: 11, color: "var(--text-3)", margin: "4px 0" }}>{group.label}</div>
              <div className="chips">
                {group.items.map((t) => (
                  <button key={t.name} className={`chip ${baseUrl === t.baseUrl ? "on" : ""}`} onClick={() => applyTemplate(t)}>
                    {t.name}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="field">
        <label>接口协议</label>
        <div className="chips">
          {(Object.keys(PROTOCOL_LABELS) as Protocol[]).map((pr) => (
            <button key={pr} className={`chip ${protocol === pr ? "on" : ""}`} onClick={() => setProtocol(pr)}>
              {PROTOCOL_LABELS[pr]}
            </button>
          ))}
        </div>
      </div>

      <div className="row">
        <div className="field">
          <label>名称</label>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="如 DeepSeek" />
        </div>
        <div className="field">
          <label>API Key</label>
          <div style={{ position: "relative" }}>
            <input
              className="input"
              type={showKey ? "text" : "password"}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="sk-…"
              style={{ paddingRight: 44 }}
              autoComplete="off"
            />
            <button
              onClick={() => setShowKey(!showKey)}
              style={{ position: "absolute", right: 6, top: 6, border: "none", background: "none", cursor: "pointer", color: "var(--text-3)", padding: "4px 8px" }}
            >
              {showKey ? "隐藏" : "显示"}
            </button>
          </div>
        </div>
      </div>

      <div className="field">
        <label>接口地址（Base URL）</label>
        <input className="input" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder={placeholder} />
        <div className="desc">到服务商控制台获取 API Key，粘贴即可</div>
      </div>

      <button className="btn primary" style={{ width: "100%" }} onClick={saveAndFetch} disabled={loading}>
        {loading ? "连接中…" : provider ? "保存并获取模型列表" : "保存并获取模型列表"}
      </button>

      {remote && (
        <>
          {remote.length > 0 ? (
            <div className="remote-list">
              {remote.map((m) => (
                <div key={m.id} className="remote-item" onClick={() => togglePick(m.id)}>
                  <div className={`checkbox ${picked.has(m.id) ? "on" : ""}`}>{picked.has(m.id) && "✓"}</div>
                  <div className="name" title={m.id}>
                    {m.label}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="remote-list" style={{ padding: 12, textAlign: "center", color: "var(--text-3)", fontSize: 13 }}>
              没有获取到模型列表，可手动添加
            </div>
          )}
          <div className="row" style={{ marginTop: 10 }}>
            <input
              className="input"
              value={manualName}
              onChange={(e) => setManualName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && manualAdd()}
              placeholder="手动输入模型名，如 gpt-4o-mini"
            />
            <button className="btn" style={{ flex: "0 0 auto" }} onClick={manualAdd}>
              添加
            </button>
          </div>
          {picked.size > 0 && (
            <button className="btn primary" style={{ width: "100%", marginTop: 10 }} onClick={confirmPick}>
              添加所选 {picked.size} 个模型
            </button>
          )}
          {provider && modelsOfProvider(provider.id).length > 0 && <ExistingModels providerId={provider.id} />}
        </>
      )}
    </Modal>
  );
}

function modelsOfProvider(id: string) {
  return useStore.getState().models.filter((m) => m.providerId === id);
}

function ExistingModels({ providerId }: { providerId: string }) {
  const models = useStore((s) => s.models).filter((m) => m.providerId === providerId);
  const removeModel = useStore((s) => s.removeModel);
  const updateModel = useStore((s) => s.updateModel);
  if (!models.length) return null;
  const ROLE_LABELS: Record<string, string> = { chat: "对话", vision: "看图", embedding: "检索", tts: "朗读", stt: "识别" };
  return (
    <>
      <div className="section-label" style={{ paddingTop: 14 }}>已添加模型（点击徽章切换用途）</div>
      {models.map((m) => (
        <div key={m.id} className="model-row">
          <div className="name" title={m.name}>
            {m.label}
          </div>
          <div className="roles">
            {(["chat", "vision", "embedding", "tts", "stt"] as ModelRole[]).map((r) => (
              <button
                key={r}
                className={`role-badge ${m.roles.includes(r) ? "" : "muted"}`}
                style={{ border: "none", cursor: "pointer" }}
                title={`${m.roles.includes(r) ? "取消" : "设为"}${ROLE_LABELS[r]}用途`}
                onClick={() => {
                  const roles = m.roles.includes(r) ? m.roles.filter((x) => x !== r) : [...m.roles, r];
                  if (!roles.length) return;
                  updateModel(m.id, { roles });
                }}
              >
                {ROLE_LABELS[r]}
              </button>
            ))}
          </div>
          <button className="icon-btn danger" style={{ width: 28, height: 28 }} onClick={() => removeModel(m.id)} title="删除模型">
            <Icon name="trash" size={14} />
          </button>
        </div>
      ))}
    </>
  );
}

// ================================================================
// Default models per role
// ================================================================
function DefaultModelsCard() {
  const models = useStore((s) => s.models);
  const providers = useStore((s) => s.providers);
  const settings = useStore((s) => s.settings);
  const setDefault = useStore((s) => s.setDefault);
  const providerName = (id: string) => providers.find((p) => p.id === id)?.name ?? "?";

  return (
    <div className="card">
      <h3>
        <Icon name="chat" size={16} /> 默认模型
        <span className="hint">按用途自动选用</span>
      </h3>
      {models.length === 0 && <div style={{ color: "var(--text-3)", fontSize: 13 }}>先在上方添加模型服务</div>}
      {ROLE_ROWS.map((row) => {
        const options = models.filter((m) => m.roles.includes(row.role));
        return (
          <div key={row.role} className="set-row">
            <div className="info">
              <div className="t">{row.label}</div>
              <div className="d">{row.desc}</div>
            </div>
            <SelectBox
              value={settings.defaults[row.role]}
              onChange={(v) => setDefault(row.role, v)}
              options={options.map((m) => ({ value: m.id, label: `${m.label} · ${providerName(m.providerId)}` }))}
              placeholder="不设置"
              style={{ maxWidth: 230 }}
            />
          </div>
        );
      })}
    </div>
  );
}

// ================================================================
// Appearance
// ================================================================
function AppearanceCard() {
  const settings = useStore((s) => s.settings);
  const setSettings = useStore((s) => s.setSettings);
  return (
    <div className="card">
      <h3>
        <Icon name="image" size={16} /> 外观
      </h3>
      <div className="field">
        <label>主题色</label>
        <div className="swatches">
          {THEMES.map((t) => (
            <div
              key={t.id}
              className={`swatch ${settings.themeId === t.id ? "on" : ""}`}
              style={{ background: t.colors }}
              title={t.name}
              onClick={() => setSettings({ themeId: t.id })}
            />
          ))}
        </div>
      </div>
      <div className="field">
        <label>明暗</label>
        <div className="chips">
          {(["light", "dark", "auto"] as ThemeMode[]).map((m) => (
            <button key={m} className={`chip ${settings.themeMode === m ? "on" : ""}`} onClick={() => setSettings({ themeMode: m })}>
              {m === "light" ? "浅色" : m === "dark" ? "深色" : "跟随系统"}
            </button>
          ))}
        </div>
      </div>
      <div className="field" style={{ marginBottom: 0 }}>
        <label>聊天背景</label>
        <div className="chips">
          {[
            { id: "none", label: "纯色" },
            { id: "aurora", label: "极光" },
            { id: "mesh", label: "渐变" },
          ].map((w) => (
            <button key={w.id} className={`chip ${settings.wallpaper === w.id ? "on" : ""}`} onClick={() => setSettings({ wallpaper: w.id })}>
              {w.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ================================================================
// Voice & generation
// ================================================================
function VoiceCard() {
  const settings = useStore((s) => s.settings);
  const setSettings = useStore((s) => s.setSettings);
  return (
    <div className="card">
      <h3>
        <Icon name="speaker" size={16} /> 语音
      </h3>
      <div className="set-row">
        <div className="info">
          <div className="t">使用系统朗读</div>
          <div className="d">免费、离线可用；关闭后使用云端语音模型</div>
        </div>
        <Toggle checked={settings.browserTts} onChange={(v) => setSettings({ browserTts: v })} />
      </div>
      <div className="set-row">
        <div className="info">
          <div className="t">使用系统语音识别</div>
          <div className="d">按住麦克风说话变文字；部分浏览器不支持时自动改用云端</div>
        </div>
        <Toggle checked={settings.browserStt} onChange={(v) => setSettings({ browserStt: v })} />
      </div>
    </div>
  );
}

// ================================================================
// Generation parameters (LLM tuning)
// ================================================================
function GenParamsCard() {
  const settings = useStore((s) => s.settings);
  const setSettings = useStore((s) => s.setSettings);
  const gen = settings.genParams ?? { temperature: 0.8, maxTokens: 4096, contextTurns: 12 };
  return (
    <div className="card">
      <h3>
        <Icon name="refresh" size={16} /> 生成参数
        <span className="hint">对聊天与记忆整理生效</span>
      </h3>
      <SliderRow
        label="温度"
        desc="越高越有创造力，越低越严谨稳定"
        value={gen.temperature}
        min={0}
        max={2}
        step={0.1}
        format={(v) => v.toFixed(1)}
        onChange={(v) => setSettings({ genParams: { ...gen, temperature: v } })}
      />
      <SliderRow
        label="回复长度上限"
        desc="单次回复的最大 Token 数"
        value={gen.maxTokens}
        min={512}
        max={16384}
        step={512}
        format={(v) => `${v}`}
        onChange={(v) => setSettings({ genParams: { ...gen, maxTokens: v } })}
      />
      <SliderRow
        label="上下文轮数"
        desc="逐字携带的最近对话轮数，越大越连贯、消耗越多"
        value={gen.contextTurns}
        min={4}
        max={30}
        step={1}
        format={(v) => `${v} 轮`}
        onChange={(v) => setSettings({ genParams: { ...gen, contextTurns: v } })}
      />
      <div className="set-row" style={{ borderBottom: "none" }}>
        <div className="info">
          <div className="t">消息字号</div>
          <div className="d">聊天气泡的文字大小</div>
        </div>
        <div className="chips">
          {[14, 15, 16].map((n) => (
            <button key={n} className={`chip ${settings.fontSize === n ? "on" : ""}`} onClick={() => setSettings({ fontSize: n })}>
              {n === 14 ? "小" : n === 15 ? "中" : "大"}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ================================================================
// User profile (injected into every agent's memory of you)
// ================================================================
function ProfileCard() {
  const settings = useStore((s) => s.settings);
  const setSettings = useStore((s) => s.setSettings);
  return (
    <div className="card">
      <h3>
        <Icon name="user" size={16} /> 关于你
        <span className="hint">所有智能体都会记得这些</span>
      </h3>
      <div className="field">
        <label>怎么称呼你</label>
        <input className="input" value={settings.userName} onChange={(e) => setSettings({ userName: e.target.value })} placeholder="如：小雪" />
      </div>
      <div className="field" style={{ marginBottom: 0 }}>
        <label>自我介绍（可选）</label>
        <textarea
          className="input"
          rows={3}
          value={settings.userProfile}
          onChange={(e) => setSettings({ userProfile: e.target.value })}
          placeholder="比如你的职业、兴趣、正在忙的事…智能体会把它当作对你的初始了解"
        />
      </div>
    </div>
  );
}

// ================================================================
// Backup
// ================================================================
function DataCard() {
  const backup = useStore((s) => s.backup);
  const restore = useStore((s) => s.restore);
  return (
    <div className="card">
      <h3>
        <Icon name="book" size={16} /> 数据与备份
      </h3>
      <div className="set-row" style={{ borderBottom: "none" }}>
        <div className="info">
          <div className="t">隐私</div>
          <div className="d">对话、记忆、API Key 全部只存于本机设备，不经过任何第三方服务器</div>
        </div>
      </div>
      <div className="row">
        <button className="btn" onClick={() => backup()}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <Icon name="download" size={15} /> 导出备份
          </span>
        </button>
        <label className="btn" style={{ textAlign: "center" }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <Icon name="upload" size={15} /> 导入备份
          </span>
          <input
            type="file"
            accept="application/json"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) {
                useStore
                  .getState()
                  .askConfirm({
                    title: "导入备份",
                    message: "导入将覆盖当前所有数据（对话、智能体、记忆、设置），确定继续？",
                    confirmText: "覆盖导入",
                    danger: true,
                  })
                  .then((ok) => ok && restore(f));
              }
              e.target.value = "";
            }}
          />
        </label>
      </div>
    </div>
  );
}

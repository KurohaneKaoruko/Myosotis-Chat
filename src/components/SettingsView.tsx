import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { useStore } from "../store";
import { db } from "../lib/db";
import { listRemoteModels } from "../lib/api";
import { friendlyError } from "../lib/utils";
import { Modal, Icon, SelectBox, Toggle, SliderRow } from "./ui";
import { DEFAULT_SETTINGS, type PromptTemplate } from "../types";
import type { ModelRole, Protocol, Provider, ThemeId, ThemeMode } from "../types";
import { t, tf, dateLocale } from "../i18n";
import type { Dict } from "../i18n/zh-CN";

const PROTOCOL_LABELS: Record<Protocol, keyof Dict> = {
  openai: "protoOpenai",
  anthropic: "protoAnthropic",
  gemini: "protoGemini",
};

const TEMPLATE_GROUPS: { labelKey: keyof Dict; items: { name: string; protocol: Protocol; baseUrl: string }[] }[] = [
  {
    labelKey: "groupHot",
    items: [
      { name: "DeepSeek", protocol: "openai", baseUrl: "https://api.deepseek.com/v1" },
      { name: "OpenAI", protocol: "openai", baseUrl: "https://api.openai.com/v1" },
      { name: "Anthropic", protocol: "anthropic", baseUrl: "https://api.anthropic.com" },
      { name: "Gemini", protocol: "gemini", baseUrl: "https://generativelanguage.googleapis.com" },
      { name: "MiniMax", protocol: "openai", baseUrl: "https://api.minimax.chat/v1" },
      { name: "SiliconFlow", protocol: "openai", baseUrl: "https://api.siliconflow.cn/v1" },
      { name: "Kimi", protocol: "openai", baseUrl: "https://api.moonshot.cn/v1" },
      { name: "Zhipu", protocol: "openai", baseUrl: "https://open.bigmodel.cn/api/paas/v4" },
    ],
  },
  {
    labelKey: "groupCn",
    items: [
      { name: "Tongyi Qianwen", protocol: "openai", baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1" },
      { name: "Tencent Hunyuan", protocol: "openai", baseUrl: "https://api.hunyuan.cloud.tencent.com/v1" },
      { name: "iFlytek Spark", protocol: "openai", baseUrl: "https://spark-api-open.xf-yun.com/v1" },
      { name: "Baichuan", protocol: "openai", baseUrl: "https://api.baichuan-ai.com/v1" },
      { name: "01.AI", protocol: "openai", baseUrl: "https://api.lingyiwanwu.com/v1" },
    ],
  },
  {
    labelKey: "groupIntl",
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
    labelKey: "groupLocal",
    items: [
      { name: "Ollama", protocol: "openai", baseUrl: "http://localhost:11434/v1" },
      { name: "LM Studio", protocol: "openai", baseUrl: "http://localhost:1234/v1" },
    ],
  },
];

const ROLE_ROWS: { role: ModelRole; labelKey: keyof Dict; descKey: keyof Dict }[] = [
  { role: "chat", labelKey: "roleChat", descKey: "roleChatDesc" },
  { role: "vision", labelKey: "roleVision", descKey: "roleVisionDesc" },
  { role: "embedding", labelKey: "roleEmbed", descKey: "roleEmbedDesc" },
  { role: "tts", labelKey: "roleTts", descKey: "roleTtsDesc" },
  { role: "stt", labelKey: "roleStt", descKey: "roleSttDesc" },
];

const THEMES: { id: ThemeId; nameKey: keyof Dict; colors: string }[] = [
  { id: "mono", nameKey: "themeMono", colors: "linear-gradient(135deg,#17181d,#5a6172)" },
  { id: "azure", nameKey: "themeAzure", colors: "linear-gradient(135deg,#3b82f6,#6366f1)" },
  { id: "violet", nameKey: "themeViolet", colors: "linear-gradient(135deg,#8b5cf6,#d946ef)" },
  { id: "rose", nameKey: "themeRose", colors: "linear-gradient(135deg,#f43f5e,#fb7185)" },
  { id: "forest", nameKey: "themeForest", colors: "linear-gradient(135deg,#10b981,#14b8a6)" },
  { id: "amber", nameKey: "themeAmber", colors: "linear-gradient(135deg,#f59e0b,#f97316)" },
  { id: "ink", nameKey: "themeInk", colors: "linear-gradient(135deg,#475569,#334155)" },
];

export default function SettingsView() {
  return (
    <div className="page">
      <div className="page-inner">
        <div className="page-title">
          {t("settingsTitle")}
          <span className="desc" style={{ fontWeight: 400 }}>
            {t("settingsDesc")}
          </span>
        </div>
        <ProvidersCard />
        <DefaultModelsCard />
        <GenParamsCard />
        <AppearanceCard />
        <VoiceCard />
        <PromptCard />
        <ProfileCard />
        <BackupCard />
        <DataCard />
        <div className="card" style={{ textAlign: "center", color: "var(--text-3)", fontSize: 12 }}>
          {t("aboutLine")}
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
        <Icon name="key" size={16} /> {t("secProviders")}
        <span className="hint">{t("keysLocal")}</span>
      </h3>

      {providers.length === 0 && (
        <div style={{ color: "var(--text-3)", fontSize: 13, marginBottom: 12, padding: "14px", background: "var(--surface-2)", borderRadius: 10, textAlign: "center" }}>
          {t("noProviders")}
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
                {p.name} <span style={{ fontWeight: 400, fontSize: 11, color: "var(--text-3)" }}>{t(PROTOCOL_LABELS[p.protocol])}</span>
              </div>
              <div className="meta">
                {p.baseUrl} · {tf("nModels", { n: count })}
              </div>
            </div>
            <button className="icon-btn" title={t("manageModels")} onClick={() => setEditing(p)}>
              <Icon name="settings" size={17} />
            </button>
            <button
              className="icon-btn danger"
              title={t("commonDelete")}
              onClick={() => {
                useStore
                  .getState()
                  .askConfirm({
                    title: t("deleteProviderTitle"),
                    message: tf("deleteProviderMsg", { name: p.name }),
                    confirmText: t("commonDelete"),
                    danger: true,
                  })
                  .then((ok) => { if (ok) removeProvider(p.id); });
              }}
            >
              <Icon name="trash" size={17} />
            </button>
          </div>
        );
      })}

      <button className="btn primary" style={{ width: "100%" }} onClick={() => setEditing("new")}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <Icon name="plus" size={16} /> {t("addProvider")}
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

  const applyTemplate = (tpl: (typeof TEMPLATE_GROUPS)[number]["items"][number]) => {
    setProtocol(tpl.protocol);
    setBaseUrl(tpl.baseUrl);
    if (!name) setName(tpl.name);
  };

  const saveAndFetch = async () => {
    if (!name.trim() || !baseUrl.trim()) {
      showToast(t("needNameAndUrl"), "error");
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
      showToast(tf("fetchOk", { n: list.length }), "success");
    } catch (e) {
      showToast(`${friendlyError(e)}\n${t("savedCanManual")}`, "error");
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
      showToast(t("pickFirst"), "error");
      return;
    }
    await addModels(provider.id, Array.from(picked), []);
    showToast(tf("addedN", { n: picked.size }), "success");
    onClose();
  };

  const manualAdd = async () => {
    const n = manualName.trim();
    if (!n) return;
    if (!provider) {
      // create provider first if somehow missing
      const p = await addProvider({ name: name.trim() || t("customProvider"), protocol, baseUrl: baseUrl.trim() || placeholder, apiKey: apiKey.trim() });
      await addModels(p.id, [n], []);
    } else {
      await addModels(provider.id, [n], []);
    }
    setManualName("");
    showToast(t("modelAdded"), "success");
  };

  return (
    <Modal title={provider ? tf("manageProvider", { name: provider.name }) : t("addProviderTitle")} onClose={onClose}>
      {!provider && (
        <div className="field">
          <label>{t("quickPick")}</label>
          {TEMPLATE_GROUPS.map((group) => (
            <div key={group.labelKey} style={{ marginBottom: 8 }}>
              <div style={{ fontSize: 11, color: "var(--text-3)", margin: "4px 0" }}>{t(group.labelKey)}</div>
              <div className="chips">
                {group.items.map((tpl) => (
                  <button key={tpl.name} className={`chip ${baseUrl === tpl.baseUrl ? "on" : ""}`} onClick={() => applyTemplate(tpl)}>
                    {tpl.name}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="field">
        <label>{t("protocol")}</label>
        <div className="chips">
          {(Object.keys(PROTOCOL_LABELS) as Protocol[]).map((pr) => (
            <button key={pr} className={`chip ${protocol === pr ? "on" : ""}`} onClick={() => setProtocol(pr)}>
              {t(PROTOCOL_LABELS[pr])}
            </button>
          ))}
        </div>
      </div>

      <div className="row">
        <div className="field">
          <label>{t("providerName")}</label>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder={t("providerNamePh")} />
        </div>
        <div className="field">
          <label>{t("apiKey")}</label>
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
              {showKey ? t("hideKey") : t("showKey")}
            </button>
          </div>
        </div>
      </div>

      <div className="field">
        <label>{t("baseUrl")}</label>
        <input className="input" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder={placeholder} />
        <div className="desc">{t("baseUrlDesc")}</div>
      </div>

      <button className="btn primary" style={{ width: "100%" }} onClick={saveAndFetch} disabled={loading}>
        {loading ? t("connecting") : t("saveAndFetch")}
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
              {t("noModelsFound")}
            </div>
          )}
          <div className="row" style={{ marginTop: 10 }}>
            <input
              className="input"
              value={manualName}
              onChange={(e) => setManualName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && manualAdd()}
              placeholder={t("manualModelPh")}
            />
            <button className="btn" style={{ flex: "0 0 auto" }} onClick={manualAdd}>
              {t("add")}
            </button>
          </div>
          {picked.size > 0 && (
            <button className="btn primary" style={{ width: "100%", marginTop: 10 }} onClick={confirmPick}>
              {tf("addSelected", { n: picked.size })}
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
  const ROLE_LABELS: Record<string, keyof Dict> = { chat: "roleShortChat", vision: "roleShortVision", embedding: "roleShortEmbed", tts: "roleShortTts", stt: "roleShortStt" };
  return (
    <>
      <div className="section-label" style={{ paddingTop: 14 }}>{t("existingModels")}</div>
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
                title={tf(m.roles.includes(r) ? "roleTipOn" : "roleTipOff", { role: t(ROLE_LABELS[r]) })}
                onClick={() => {
                  const roles = m.roles.includes(r) ? m.roles.filter((x) => x !== r) : [...m.roles, r];
                  if (!roles.length) return;
                  updateModel(m.id, { roles });
                }}
              >
                {t(ROLE_LABELS[r])}
              </button>
            ))}
          </div>
          <button className="icon-btn danger" style={{ width: 28, height: 28 }} onClick={() => removeModel(m.id)} title={t("deleteModelTitle")}>
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
        <Icon name="chat" size={16} /> {t("secDefaultModels")}
        <span className="hint">{t("byUsage")}</span>
      </h3>
      {models.length === 0 && <div style={{ color: "var(--text-3)", fontSize: 13 }}>{t("addModelsFirst")}</div>}
      {ROLE_ROWS.map((row) => {
        const options = models.filter((m) => m.roles.includes(row.role));
        return (
          <div key={row.role} className="set-row">
            <div className="info">
              <div className="t">{t(row.labelKey)}</div>
              <div className="d">{t(row.descKey)}</div>
            </div>
            <SelectBox
              value={settings.defaults[row.role]}
              onChange={(v) => setDefault(row.role, v)}
              options={options.map((m) => ({ value: m.id, label: `${m.label} · ${providerName(m.providerId)}` }))}
              placeholder={t("unset")}
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
        <Icon name="image" size={16} /> {t("secAppearance")}
      </h3>
      <div className="field">
        <label>{t("themeColor")}</label>
        <div className="swatches">
          {THEMES.map((th) => (
            <div
              key={th.id}
              className={`swatch ${settings.themeId === th.id ? "on" : ""}`}
              style={{ background: th.colors }}
              title={t(th.nameKey)}
              onClick={() => setSettings({ themeId: th.id })}
            />
          ))}
        </div>
      </div>
      <div className="field">
        <label>{t("lightDark")}</label>
        <div className="chips">
          {(["light", "dark", "auto"] as ThemeMode[]).map((m) => (
            <button key={m} className={`chip ${settings.themeMode === m ? "on" : ""}`} onClick={() => setSettings({ themeMode: m })}>
              {m === "light" ? t("lightMode") : m === "dark" ? t("darkMode") : t("followSystem")}
            </button>
          ))}
        </div>
      </div>
      <div className="field" style={{ marginBottom: 0 }}>
        <label>{t("chatBg")}</label>
        <div className="chips">
          {[
            { id: "none", labelKey: "bgNone" as const },
            { id: "aurora", labelKey: "bgAurora" as const },
            { id: "mesh", labelKey: "bgMesh" as const },
          ].map((w) => (
            <button key={w.id} className={`chip ${settings.wallpaper === w.id ? "on" : ""}`} onClick={() => setSettings({ wallpaper: w.id })}>
              {t(w.labelKey)}
            </button>
          ))}
        </div>
      </div>
      <div className="field" style={{ marginBottom: 0 }}>
        <label>{t("bubbleStyle")}</label>
        <div className="chips">
          <button
            className={`chip ${(settings.bubbleStyle ?? "modern") === "modern" ? "on" : ""}`}
            onClick={() => setSettings({ bubbleStyle: "modern" })}
          >
            {t("bubbleModern")}
          </button>
          <button
            className={`chip ${settings.bubbleStyle === "classic" ? "on" : ""}`}
            onClick={() => setSettings({ bubbleStyle: "classic" })}
          >
            {t("bubbleClassic")}
          </button>
        </div>
      </div>
      <div className="field" style={{ marginBottom: 0 }}>
        <label>{t("uiLanguage")}</label>
        <div className="chips">
          <button
            className={`chip ${settings.language === "zh-CN" ? "on" : ""}`}
            onClick={() => setSettings({ language: "zh-CN" })}
          >
            简体中文
          </button>
          <button
            className={`chip ${settings.language === "en" ? "on" : ""}`}
            onClick={() => setSettings({ language: "en" })}
          >
            English
          </button>
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
        <Icon name="speaker" size={16} /> {t("secVoice")}
      </h3>
      <div className="set-row">
        <div className="info">
          <div className="t">{t("useSysTts")}</div>
          <div className="d">{t("useSysTtsDesc")}</div>
        </div>
        <Toggle checked={settings.browserTts} onChange={(v) => setSettings({ browserTts: v })} />
      </div>
      <div className="set-row">
        <div className="info">
          <div className="t">{t("useSysStt")}</div>
          <div className="d">{t("useSysSttDesc")}</div>
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
        <Icon name="refresh" size={16} /> {t("secGenParams")}
        <span className="hint">{t("genHint")}</span>
      </h3>
      <SliderRow
        label={t("temperature")}
        desc={t("temperatureDesc")}
        value={gen.temperature}
        min={0}
        max={2}
        step={0.1}
        format={(v) => v.toFixed(1)}
        onChange={(v) => setSettings({ genParams: { ...gen, temperature: v } })}
      />
      <SliderRow
        label={t("maxTokens")}
        desc={t("maxTokensDesc")}
        value={gen.maxTokens}
        min={512}
        max={16384}
        step={512}
        format={(v) => `${v}`}
        onChange={(v) => setSettings({ genParams: { ...gen, maxTokens: v } })}
      />
      <SliderRow
        label={t("contextTurns")}
        desc={t("contextTurnsDesc")}
        value={gen.contextTurns}
        min={4}
        max={30}
        step={1}
        format={(v) => tf("turns", { n: v })}
        onChange={(v) => setSettings({ genParams: { ...gen, contextTurns: v } })}
      />
      <div className="set-row" style={{ borderBottom: "none" }}>
        <div className="info">
          <div className="t">{t("msgFontSize")}</div>
          <div className="d">{t("fontSizeDesc")}</div>
        </div>
        <div className="chips">
          {[14, 15, 16].map((n) => (
            <button key={n} className={`chip ${settings.fontSize === n ? "on" : ""}`} onClick={() => setSettings({ fontSize: n })}>
              {n === 14 ? t("small") : n === 15 ? t("medium") : t("large")}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ================================================================
// WebDAV backup & restore
// ================================================================
function BackupCard() {
  const settings = useStore((s) => s.settings);
  const setSettings = useStore((s) => s.setSettings);
  const showToast = useStore((s) => s.showToast);
  const askConfirm = useStore((s) => s.askConfirm);
  const wd = settings.webdav ?? DEFAULT_SETTINGS.webdav;
  const [busy, setBusy] = useState<"backup" | "list" | "restore" | null>(null);
  const [backups, setBackups] = useState<{ name: string; modifiedAt: Date | null }[] | null>(null);
  const [selFile, setSelFile] = useState<string | null>(null);

  const upd = (patch: Partial<typeof wd>) => setSettings({ webdav: { ...wd, ...patch } });
  const cfg = () => ({
    url: wd.url,
    username: wd.username,
    password: wd.appPassword,
    directory: wd.directory,
  });

  const doBackup = async () => {
    if (!wd.url.trim()) {
      showToast(t("needUrl"), "error");
      return;
    }
    setBusy("backup");
    try {
      const { webdavBackup } = await import("../lib/backup");
      const f = await webdavBackup(cfg(), { encrypt: wd.encrypt, backupPassword: wd.backupPassword });
      localStorage.setItem("myosotis.lastAutoBackup", String(Date.now()));
      showToast(tf("backupOk", { file: f }), "success");
      const { webdavListBackups } = await import("../lib/backup");
      setBackups(await webdavListBackups(cfg()));
    } catch (e: any) {
      showToast(friendlyError(e), "error");
    } finally {
      setBusy(null);
    }
  };

  const doList = async () => {
    setBusy("list");
    try {
      const { webdavListBackups } = await import("../lib/backup");
      const list = await webdavListBackups(cfg());
      setBackups(list);
      setSelFile(list[0]?.name ?? null);
      if (!list.length) showToast(t("noBackupFiles"));
    } catch (e: any) {
      showToast(friendlyError(e), "error");
    } finally {
      setBusy(null);
    }
  };

  const doRestore = async () => {
    if (!selFile) {
      showToast(t("pickFileFirst"), "error");
      return;
    }
    const confirmed = await askConfirm({
      title: t("restoreTitle"),
      message: tf("restoreMsg", {
        file: selFile,
        extra: wd.encrypt ? t("restoreEncryptedNote") : "",
      }),
      confirmText: t("restoreBtn"),
      danger: true,
    });
    if (!confirmed) return;
    setBusy("restore");
    try {
      const { webdavRestore } = await import("../lib/backup");
      await webdavRestore(cfg(), selFile, wd.backupPassword || undefined);
      showToast(t("restoreDoneReload"), "success");
      setTimeout(() => location.reload(), 900);
    } catch (e: any) {
      showToast(friendlyError(e), "error");
      setBusy(null);
    }
  };

  return (
    <div className="card">
      <h3>
        <Icon name="upload" size={16} /> {t("secWebdav")}
        <span className="hint">{t("webdavHint")}</span>
      </h3>
      <div className="field">
        <label>{t("serverUrl")}</label>
        <input
          className="input"
          value={wd.url}
          onChange={(e) => upd({ url: e.target.value })}
          placeholder={t("serverUrlPh")}
        />
      </div>
      <div className="row">
        <div className="field">
          <label>{t("account")}</label>
          <input className="input" value={wd.username} onChange={(e) => upd({ username: e.target.value })} autoComplete="off" />
        </div>
        <div className="field">
          <label>{t("appPassword")}</label>
          <input
            className="input"
            type="password"
            value={wd.appPassword}
            onChange={(e) => upd({ appPassword: e.target.value })}
            autoComplete="off"
          />
        </div>
      </div>
      <div className="field">
        <label>{t("backupDir")}</label>
        <input className="input" value={wd.directory} onChange={(e) => upd({ directory: e.target.value })} placeholder="/Myosotis" />
      </div>
      <div className="set-row">
        <div className="info">
          <div className="t">{t("encryptBackup")}</div>
          <div className="d">{t("encryptDesc")}</div>
        </div>
        <Toggle checked={wd.encrypt} onChange={(v) => upd({ encrypt: v })} />
      </div>
      {wd.encrypt && (
        <div className="field">
          <label>{t("backupPassword")}</label>
          <input
            className="input"
            type="password"
            value={wd.backupPassword}
            onChange={(e) => upd({ backupPassword: e.target.value })}
            placeholder={t("backupPasswordPh")}
            autoComplete="new-password"
          />
          <div className="desc">{t("backupPasswordWarn")}</div>
        </div>
      )}
      <div className="field">
        <label>{t("autoBackup")}</label>
        <div className="chips">
          {(
            [
              ["off", "autoOff"],
              ["daily", "autoDaily"],
              ["weekly", "autoWeekly"],
            ] as const
          ).map(([v, key]) => (
            <button key={v} className={`chip ${wd.autoBackup === v ? "on" : ""}`} onClick={() => upd({ autoBackup: v })}>
              {t(key)}
            </button>
          ))}
        </div>
        <div className="desc">{t("autoDesc")}</div>
      </div>

      <div className="row">
        <button className="btn primary" onClick={doBackup} disabled={busy !== null}>
          {busy === "backup" ? t("backupInProgress") : t("backupNow")}
        </button>
        <button className="btn" onClick={doList} disabled={busy !== null || !wd.url.trim()}>
          {busy === "list" ? t("fetching") : t("viewCloudBackups")}
        </button>
      </div>

      {backups && (
        <div className="field" style={{ marginTop: 12, marginBottom: 0 }}>
          <label>{t("cloudBackups")}</label>
          <SelectBox
            value={selFile}
            onChange={(v) => setSelFile(v)}
            options={backups.map((b) => ({
              value: b.name,
              label: `${b.name}${b.modifiedAt ? ` · ${b.modifiedAt.toLocaleString(dateLocale())}` : ""}`,
            }))}
            placeholder={t("pickBackup")}
          />
          <button className="btn danger" style={{ marginTop: 8 }} onClick={doRestore} disabled={busy !== null || !selFile}>
            {busy === "restore" ? t("restoring") : t("restoreFromSelected")}
          </button>
        </div>
      )}
    </div>
  );
}

// ================================================================
// Quick commands (prompt templates triggered by "/trigger")
// ================================================================
function PromptCard() {
  const showToast = useStore((s) => s.showToast);
  const askConfirm = useStore((s) => s.askConfirm);
  const prompts = useLiveQuery(() => db.prompts.toArray(), []) ?? [];
  const [editing, setEditing] = useState<PromptTemplate | "new" | null>(null);

  return (
    <div className="card">
      <h3>
        <Icon name="zap" size={16} /> {t("secQuickCmds")}
        <span className="hint">{t("quickHint")}</span>
      </h3>
      {prompts.length === 0 && (
        <div style={{ color: "var(--text-3)", fontSize: 13, marginBottom: 10 }}>
          {t("quickEmpty")}
        </div>
      )}
      {prompts.map((p) => (
        <div key={p.id} className="provider-card">
          <div className="logo" style={{ background: "var(--accent-soft)", color: "var(--accent)" }}>
            /
          </div>
          <div className="info">
            <div className="name">/{p.trigger}</div>
            <div className="meta">{p.content.slice(0, 60)}</div>
          </div>
          <button className="icon-btn" title={t("editMsg")} onClick={() => setEditing(p)}>
            <Icon name="edit" size={17} />
          </button>
          <button
            className="icon-btn danger"
            title={t("commonDelete")}
            onClick={() => {
              askConfirm({
                title: t("deleteCmdTitle"),
                message: tf("deleteCmdMsg", { trigger: p.trigger }),
                confirmText: t("commonDelete"),
                danger: true,
              }).then((ok) => {
                if (ok) db.prompts.delete(p.id);
              });
            }}
          >
            <Icon name="trash" size={17} />
          </button>
        </div>
      ))}
      <button className="btn primary" style={{ width: "100%" }} onClick={() => setEditing("new")}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <Icon name="plus" size={16} /> {t("newCmd")}
        </span>
      </button>

      {editing && (
        <PromptEditor
          prompt={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          showToast={showToast}
        />
      )}
    </div>
  );
}

function PromptEditor({
  prompt,
  onClose,
  showToast,
}: {
  prompt: PromptTemplate | null;
  onClose: () => void;
  showToast: (t: string, k?: "info" | "error" | "success") => void;
}) {
  const [trigger, setTrigger] = useState(prompt?.trigger ?? "");
  const [content, setContent] = useState(prompt?.content ?? "");

  const save = async () => {
    const trig = trigger.trim().replace(/^\//, "").replace(/\s+/g, "");
    if (!trig || !content.trim()) {
      showToast(t("cmdNeedBoth"), "error");
      return;
    }
    if (prompt) {
      await db.prompts.update(prompt.id, { trigger: trig, content: content.trim() });
    } else {
      await db.prompts.add({
        id: `prm_${Math.random().toString(36).slice(2, 12)}`,
        trigger: trig,
        content: content.trim(),
        createdAt: Date.now(),
      });
    }
    showToast(t("saved"), "success");
    onClose();
  };

  return (
    <Modal
      title={prompt ? t("editCmd") : t("newCmd")}
      onClose={onClose}
      footer={
        <>
          <button className="btn ghost" onClick={onClose}>
            {t("commonCancel")}
          </button>
          <button className="btn primary" onClick={save}>
            {t("commonSave")}
          </button>
        </>
      }
    >
      <div className="field">
        <label>{t("cmdTrigger")}</label>
        <input className="input" value={trigger} onChange={(e) => setTrigger(e.target.value)} placeholder={t("cmdTriggerPh")} autoFocus />
      </div>
      <div className="field" style={{ marginBottom: 0 }}>
        <label>{t("cmdContent")}</label>
        <textarea
          className="input"
          rows={4}
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder={t("cmdContentPh")}
        />
      </div>
    </Modal>
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
        <Icon name="user" size={16} /> {t("secProfile")}
        <span className="hint">{t("profileHint")}</span>
      </h3>
      <div className="field">
        <label>{t("howToCallYou")}</label>
        <input className="input" value={settings.userName} onChange={(e) => setSettings({ userName: e.target.value })} placeholder={t("yourNamePh")} />
      </div>
      <div className="field" style={{ marginBottom: 0 }}>
        <label>{t("selfIntro")}</label>
        <textarea
          className="input"
          rows={3}
          value={settings.userProfile}
          onChange={(e) => setSettings({ userProfile: e.target.value })}
          placeholder={t("selfIntroPh")}
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
        <Icon name="book" size={16} /> {t("secData")}
      </h3>
      <div className="set-row" style={{ borderBottom: "none" }}>
        <div className="info">
          <div className="t">{t("privacy")}</div>
          <div className="d">{t("privacyDesc")}</div>
        </div>
      </div>
      <div className="row">
        <button className="btn" onClick={() => backup()}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <Icon name="download" size={15} /> {t("exportBackup")}
          </span>
        </button>
        <label className="btn" style={{ textAlign: "center" }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <Icon name="upload" size={15} /> {t("importBackup")}
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
                    title: t("importConfirmTitle"),
                    message: t("importConfirmMsg"),
                    confirmText: t("overwriteImport"),
                    danger: true,
                  })
                  .then((ok) => { if (ok) restore(f); });
              }
              e.target.value = "";
            }}
          />
        </label>
      </div>
    </div>
  );
}

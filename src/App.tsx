import { useEffect } from "react";
import { useStore, applyTheme } from "./store";
import Sidebar from "./components/Sidebar";
import ChatView from "./components/ChatView";
import AgentsView from "./components/AgentsView";
import MemoryView from "./components/MemoryView";
import SettingsView from "./components/SettingsView";
import AgentEditor from "./components/AgentEditor";
import { Icon, type IconName } from "./components/ui";

export default function App() {
  const ready = useStore((s) => s.ready);
  const view = useStore((s) => s.view);
  const providers = useStore((s) => s.providers);
  const settings = useStore((s) => s.settings);
  const toast = useStore((s) => s.toast);
  const sidebarOpen = useStore((s) => s.sidebarOpen);
  const init = useStore((s) => s.init);

  useEffect(() => {
    init();
  }, [init]);

  useEffect(() => {
    applyTheme(settings);
  }, [settings.themeId, settings.themeMode, settings]);

  if (!ready) {
    return (
      <div className="splash">
        <img src="logo.png" alt="" />
        <div>Myosotis</div>
      </div>
    );
  }

  if (!settings.onboardingDone && providers.length === 0) {
    return <Onboarding />;
  }

  return (
    <div className={`app ${view !== "chat" ? "no-sidebar" : ""}`}>
      <Sidebar />
      {sidebarOpen && <div className="sidebar-mask" onClick={() => useStore.getState().setSidebar(false)} />}
      <main className="main" data-wallpaper={settings.wallpaper}>
        {view === "chat" && <ChatView />}
        {view === "agents" && <AgentsView />}
        {view === "memory" && <MemoryView />}
        {view === "settings" && <SettingsView />}
      </main>
      <AgentEditor />
      {toast && <div className={`toast ${toast.kind}`}>{toast.text}</div>}
      <TabBar />
    </div>
  );
}

// ----------------------------------------------------------------
// Mobile bottom tab bar (hidden on desktop via CSS)
// ----------------------------------------------------------------
const TABS: { view: string; icon: IconName; label: string }[] = [
  { view: "chat", icon: "chat", label: "聊天" },
  { view: "agents", icon: "agents", label: "伙伴" },
  { view: "memory", icon: "memory", label: "记忆" },
  { view: "settings", icon: "settings", label: "设置" },
];

function TabBar() {
  const view = useStore((s) => s.view);
  const setView = useStore((s) => s.setView);
  const setSidebar = useStore((s) => s.setSidebar);
  return (
    <nav className="tabbar">
      {TABS.map((t) => (
        <button
          key={t.view}
          className={`nav-item ${view === t.view ? "active" : ""}`}
          onClick={() => {
            setView(t.view as any);
            if (t.view === "chat") setSidebar(true); // mobile: show conversation list
          }}
        >
          <Icon name={t.icon} />
          {t.label}
        </button>
      ))}
    </nav>
  );
}

// ----------------------------------------------------------------
// First-launch welcome
// ----------------------------------------------------------------
function Onboarding() {
  const setSettings = useStore((s) => s.setSettings);
  const setView = useStore((s) => s.setView);
  const finish = (go: "settings" | "chat") => {
    setSettings({ onboardingDone: true });
    setView(go);
  };
  return (
    <div className="app">
      <main className="main">
        <div className="onboard">
          <div className="onboard-card">
            <img className="logo" src="logo.png" alt="Myosotis" />
            <h1>Myosotis</h1>
            <div className="sub">
              一朵永不忘记你的 AI 伙伴。
              <br />
              它记得你说过的一切，而这一切只保存在你自己的设备上。
            </div>
            <div className="steps">
              <div className="step">
                <div className="n">1</div>
                <div>
                  <div className="t">添加一个大模型</div>
                  <div className="d">填入任意一家服务商的 API Key，只需一次</div>
                </div>
              </div>
              <div className="step">
                <div className="n">2</div>
                <div>
                  <div className="t">挑选你的伙伴</div>
                  <div className="d">内置多种性格，也可以自由创建专属人设</div>
                </div>
              </div>
              <div className="step">
                <div className="n">3</div>
                <div>
                  <div className="t">开始聊天</div>
                  <div className="d">它会自然地记住你的喜好、经历与约定</div>
                </div>
              </div>
            </div>
            <button className="btn primary" style={{ width: "100%", padding: "13px" }} onClick={() => finish("settings")}>
              开始配置（约 1 分钟）
            </button>
            <button
              className="btn ghost"
              style={{ width: "100%", marginTop: 10 }}
              onClick={() => finish("chat")}
            >
              先逛逛
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}

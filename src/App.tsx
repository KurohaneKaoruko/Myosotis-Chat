import { useEffect } from "react";
import { Toaster } from "sonner";
import { setLanguage } from "./i18n";
import { useStore, applyTheme } from "./store";
import Rail from "./components/Rail";
import Sidebar from "./components/Sidebar";
import ChatView from "./components/ChatView";
import MemoryView from "./components/MemoryView";
import SettingsView from "./components/SettingsView";
import AgentEditor from "./components/AgentEditor";
import TitleBar from "./components/TitleBar";
import { ConfirmHost, Icon, Tip, TipFor, type IconName } from "./components/ui";
import { t } from "./i18n";

export default function App() {
  const ready = useStore((s) => s.ready);
  const view = useStore((s) => s.view);
  const providers = useStore((s) => s.providers);
  const settings = useStore((s) => s.settings);
  const sidebarOpen = useStore((s) => s.sidebarOpen);
  const init = useStore((s) => s.init);

  useEffect(() => {
    init();
  }, [init]);

  useEffect(() => {
    applyTheme(settings);
  }, [settings.themeId, settings.themeMode, settings]);

  // message font size as CSS var + i18n language sync + bubble style
  useEffect(() => {
    document.documentElement.style.setProperty("--msg-font", (settings.fontSize ?? 15) + "px");
    document.documentElement.dataset.bubble = settings.bubbleStyle ?? "modern";
    setLanguage(settings.language ?? "zh-CN");
  }, [settings.fontSize, settings.language, settings.bubbleStyle]);

  // global shortcuts: Ctrl/Cmd+K focuses search
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        useStore.getState().setView("chat");
        useStore.getState().setSidebar(true);
        requestAnimationFrame(() => {
          document.querySelector<HTMLInputElement>(".search-box input")?.focus();
        });
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  // Android back gesture (and browser back): close overlays one by one
  useEffect(() => {
    const push = () => history.pushState({ myosotis: 1 }, "");
    push(); // sentinel
    const onPop = () => {
      const s = useStore.getState();
      if (s.confirmOptions) {
        s.resolveConfirm(false);
        push();
      } else if (s.editingAgentId) {
        s.setEditingAgentId(null);
        push();
      } else if (s.sidebarOpen) {
        s.setSidebar(false);
        push();
      }
      // nothing open: allow default behavior (app exit on Android)
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const dark =
    settings.themeMode === "dark" ||
    (settings.themeMode === "auto" && matchMedia("(prefers-color-scheme: dark)").matches);

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
    <Tip.Provider delayDuration={350}>
      <div className="app-root">
        <TitleBar />
      <div className={`app ${view !== "chat" ? "no-sidebar" : ""}`} key={settings.language}>
        <Rail />
        <Sidebar />
        {sidebarOpen && <div className="sidebar-mask" onClick={() => useStore.getState().setSidebar(false)} />}
          <main className="main" data-wallpaper={settings.wallpaper} key={view}>
            {view === "chat" && <ChatView />}
            {view === "memory" && <MemoryView />}
            {view === "settings" && <SettingsView />}
          </main>
          <AgentEditor />
          <TabBar />
          <ConfirmHostBridge />
        </div>
        <Toaster
          position="top-center"
          theme={dark ? "dark" : "light"}
          toastOptions={{
            style: {
              background: "var(--surface)",
              color: "var(--text)",
              border: "1px solid var(--border)",
              boxShadow: "var(--shadow-lg)",
              borderRadius: "13px",
              fontSize: "13px",
            },
          }}
        />
      </div>
    </Tip.Provider>
  );
}

// ----------------------------------------------------------------
// Confirm dialog host (driven by store.askConfirm)
// ----------------------------------------------------------------
function ConfirmHostBridge() {
  const options = useStore((s) => s.confirmOptions);
  const resolve = useStore((s) => s.resolveConfirm);
  return <ConfirmHost options={options} onResolve={resolve} />;
}

// ----------------------------------------------------------------
// Mobile bottom tab bar (hidden on desktop via CSS)
// ----------------------------------------------------------------
const TABS: { view: string; icon: IconName; labelKey: "navChat" | "navMemory" | "navSettings" }[] = [
  { view: "chat", icon: "chat", labelKey: "navChat" },
  { view: "memory", icon: "memory", labelKey: "navMemory" },
  { view: "settings", icon: "settings", labelKey: "navSettings" },
];

function TabBar() {
  const view = useStore((s) => s.view);
  const setView = useStore((s) => s.setView);
  const setSidebar = useStore((s) => s.setSidebar);
  return (
    <nav className="tabbar">
      {TABS.map((tab) => (
        <button
          key={tab.view}
          className={`nav-item ${view === tab.view ? "active" : ""}`}
          onClick={() => {
            setView(tab.view as any);
            if (tab.view === "chat") setSidebar(true); // mobile: show conversation list
          }}
        >
          <Icon name={tab.icon} />
          {t(tab.labelKey)}
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
            <h1>{t("obTitle")}</h1>
            <div className="sub">
              {t("obSlogan")}
              <br />
              {t("obSub")}
            </div>
            <div className="steps">
              <div className="step">
                <div className="n">1</div>
                <div>
                  <div className="t">{t("obStep1")}</div>
                  <div className="d">{t("obStep1d")}</div>
                </div>
              </div>
              <div className="step">
                <div className="n">2</div>
                <div>
                  <div className="t">{t("obStep2")}</div>
                  <div className="d">{t("obStep2d")}</div>
                </div>
              </div>
              <div className="step">
                <div className="n">3</div>
                <div>
                  <div className="t">{t("obStep3")}</div>
                  <div className="d">{t("obStep3d")}</div>
                </div>
              </div>
            </div>
            <button className="btn primary" style={{ width: "100%", padding: "13px" }} onClick={() => finish("settings")}>
              {t("obCta")}
            </button>
            <button
              className="btn ghost"
              style={{ width: "100%", marginTop: 10 }}
              onClick={() => finish("chat")}
            >
              {t("obBrowse")}
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}

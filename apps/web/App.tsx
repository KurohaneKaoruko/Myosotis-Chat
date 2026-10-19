import { useEffect, useState } from "react";
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
import LoginView from "./components/LoginView";
import { ConfirmHost, Icon, Tip, TipFor, type IconName } from "./components/ui";
import { t } from "./i18n";
import { fetchMe } from "./lib/auth";
import { getDbMode, setDbMode, isHubHosted } from "./lib/db";

export default function App() {
  const ready = useStore((s) => s.ready);
  const view = useStore((s) => s.view);
  const providers = useStore((s) => s.providers);
  const settings = useStore((s) => s.settings);
  const sidebarOpen = useStore((s) => s.sidebarOpen);
  const init = useStore((s) => s.init);
  // hub mode gate: null = deciding, false = show login, true = session ok
  const [hubAuthed, setHubAuthed] = useState<boolean | null>(null);

  // decide the gate before any data loading
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const hubHosted = await isHubHosted();
      if (cancelled) return;
      if (!hubHosted) {
        setHubAuthed(true); // pure local app, no gate
        return;
      }
      try {
        await fetchMe();
        if (!cancelled) setHubAuthed(true);
      } catch {
        if (!cancelled) setHubAuthed(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // kicked out mid-session (session expired / logged out elsewhere)
  useEffect(() => {
    const onUnauth = async () => {
      if (getDbMode() !== "remote") return;
      setHubAuthed(false);
      useStore.setState({ ready: false });
    };
    window.addEventListener("myo:unauthorized", onUnauth);
    return () => window.removeEventListener("myo:unauthorized", onUnauth);
  }, []);

  useEffect(() => {
    if (hubAuthed) init();
  }, [init, hubAuthed]);

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

  // edge-swipe back: drag from the left edge to reopen the conversation list
  useEffect(() => {
    if (!("ontouchstart" in window)) return;
    let startX = 0;
    let startY = 0;
    let tracking = false;
    const onStart = (e: TouchEvent) => {
      const touch = e.touches[0];
      startX = touch.clientX;
      startY = touch.clientY;
      tracking = startX < 28;
    };
    const onEnd = (e: TouchEvent) => {
      if (!tracking) return;
      tracking = false;
      const touch = e.changedTouches[0];
      const dx = touch.clientX - startX;
      const dy = touch.clientY - startY;
      // horizontal swipe to the right, long enough, mostly horizontal
      if (dx > 70 && Math.abs(dy) < 50) {
        const st = useStore.getState();
        if (!st.sidebarOpen) st.setSidebar(true);
      }
    };
    window.addEventListener("touchstart", onStart, { passive: true });
    window.addEventListener("touchend", onEnd, { passive: true });
    return () => {
      window.removeEventListener("touchstart", onStart);
      window.removeEventListener("touchend", onEnd);
    };
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
    window.addEventListener("popstate", onPop);    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const dark =
    settings.themeMode === "dark" ||
    (settings.themeMode === "auto" && matchMedia("(prefers-color-scheme: dark)").matches);

  if (hubAuthed === null || (!ready && hubAuthed !== false)) {
    if (hubAuthed === null) {
      return (
        <div className="splash">
          <img src="logo.png" alt="" />
          <div>Myosotis</div>
        </div>
      );
    }
  }

  if (hubAuthed === false) {
    return (
      <>
        <LoginView
          onLoggedIn={() => {
            useStore.setState({ ready: false });
            setHubAuthed(true);
          }}
        />
        <Toaster position="top-center" />
      </>
    );
  }

  if (!ready) {
    return (
      <div className="splash">
        <img src="logo.png" alt="" />
        <div>Myosotis</div>
      </div>
    );
  }

  if (!settings.onboardingDone && providers.length === 0 && getDbMode() !== "remote") {
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
  // subscribe so the unread dot reacts to live events
  const convos = useStore((s) => s.convos);
  const unread = convos.reduce((n, c) => n + (c.unread ?? 0), 0);
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
          {tab.view === "chat" && unread > 0 && <span className="tab-dot" />}
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

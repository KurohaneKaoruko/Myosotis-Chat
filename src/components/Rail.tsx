import { useStore } from "../store";
import { Icon, TipFor, type IconName } from "./ui";

const RAIL_ITEMS: { view: string; icon: IconName; label: string }[] = [
  { view: "chat", icon: "chat", label: "聊天" },
  { view: "agents", icon: "agents", label: "智能体" },
  { view: "memory", icon: "memory", label: "记忆" },
  { view: "settings", icon: "settings", label: "设置" },
];

/** Narrow icon rail, QQNT-style. Desktop only (hidden on mobile via CSS). */
export default function Rail() {
  const view = useStore((s) => s.view);
  const setView = useStore((s) => s.setView);
  const userName = useStore((s) => s.settings.userName);

  return (
    <nav className="rail">
      <div className="rail-logo" data-tauri-drag-region>
        <img src="logo.png" alt="Myosotis" />
      </div>
      <div className="rail-items">
        {RAIL_ITEMS.map((t) => (
          <TipFor key={t.view} text={t.label}>
            <button className={`rail-btn ${view === t.view ? "active" : ""}`} onClick={() => setView(t.view as any)}>
              <Icon name={t.icon} size={21} />
              <i className="rail-dot" />
            </button>
          </TipFor>
        ))}
      </div>
      <div className="rail-foot">
        <TipFor text={userName ? `${userName} · 关于你` : "关于你"}>
          <button className="rail-user" onClick={() => setView("settings")}>
            {userName?.trim()?.slice(0, 1) || "我"}
          </button>
        </TipFor>
      </div>
    </nav>
  );
}

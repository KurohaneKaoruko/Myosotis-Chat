import { useStore } from "../store";
import { Icon, TipFor, type IconName } from "./ui";
import { t } from "../i18n";

const RAIL_ITEMS: { view: string; icon: IconName; labelKey: "navChat" | "navMemory" | "navSettings" }[] = [
  { view: "chat", icon: "chat", labelKey: "navChat" },
  { view: "memory", icon: "memory", labelKey: "navMemory" },
  { view: "settings", icon: "settings", labelKey: "navSettings" },
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
        {RAIL_ITEMS.map((it) => (
          <TipFor key={it.view} text={t(it.labelKey)}>
            <button className={`rail-btn ${view === it.view ? "active" : ""}`} onClick={() => setView(it.view as any)}>
              <Icon name={it.icon} size={21} />
              <i className="rail-dot" />
            </button>
          </TipFor>
        ))}
      </div>
      <div className="rail-foot">
        <TipFor text={userName ? `${userName} · ${t("aboutYou")}` : t("aboutYou")}>
          <button className="rail-user" onClick={() => setView("settings")}>
            {userName?.trim()?.slice(0, 1) || t("me")}
          </button>
        </TipFor>
      </div>
    </nav>
  );
}

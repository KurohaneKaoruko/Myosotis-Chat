import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { isTauri } from "../lib/utils";

/**
 * Frameless window title bar (desktop Tauri only).
 * Drag anywhere on the bar; standard min / max / close buttons on the right.
 */
export default function TitleBar() {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    if (!isTauri()) return;
    const win = getCurrentWindow();
    let unlisten: (() => void) | null = null;
    let alive = true;
    win
      .isMaximized()
      .then((m) => alive && setMaximized(m))
      .catch(() => {});
    win.onResized(async () => {
      try {
        setMaximized(await win.isMaximized());
      } catch {}
    }).then((fn) => {
      if (alive) unlisten = fn;
      else fn();
    });
    return () => {
      alive = false;
      unlisten?.();
    };
  }, []);

  if (!isTauri()) return null;
  const win = getCurrentWindow();

  return (
    <div className="titlebar" data-tauri-drag-region>
      <div className="tb-left" data-tauri-drag-region>
        <img src="logo.png" alt="" data-tauri-drag-region />
        <span data-tauri-drag-region>Myosotis</span>
      </div>
      <div className="tb-actions">
        <button className="tb-btn" title="最小化" onClick={() => win.minimize()}>
          <svg width="11" height="11" viewBox="0 0 11 11">
            <path d="M1.5 5.5h8" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
          </svg>
        </button>
        <button className="tb-btn" title={maximized ? "还原" : "最大化"} onClick={() => win.toggleMaximize()}>
          {maximized ? (
            <svg width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="currentColor" strokeWidth="1.1">
              <path d="M2.5 4V2.5h4M8.5 7v1.5h-4" strokeLinecap="round" />
              <rect x="1.5" y="4" width="5.5" height="5.5" rx="1" />
              <rect x="4" y="1.5" width="5.5" height="5.5" rx="1" />
            </svg>
          ) : (
            <svg width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="currentColor" strokeWidth="1.1">
              <rect x="1.5" y="1.5" width="8" height="8" rx="1.2" />
            </svg>
          )}
        </button>
        <button className="tb-btn tb-close" title="关闭" onClick={() => win.close()}>
          <svg width="11" height="11" viewBox="0 0 11 11">
            <path d="M1.8 1.8l7.4 7.4M9.2 1.8L1.8 9.2" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
          </svg>
        </button>
      </div>
    </div>
  );
}

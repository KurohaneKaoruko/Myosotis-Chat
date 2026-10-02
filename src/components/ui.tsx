import type { ReactNode } from "react";
import type { Agent } from "../types";

// ============================================================
// Tiny icon set (stroke style, consistent 24x24 grid)
// ============================================================
const P = (d: string, key?: string) => <path key={key} d={d} />;

const paths: Record<string, ReactNode> = {
  chat: (
    <>
      {P("M21 11.5a8.4 8.4 0 0 1-8.5 8.4 8.6 8.6 0 0 1-3.7-.8L3 21l1.9-5.3a8.4 8.4 0 1 1 16.1-4.2z")}
    </>
  ),
  agents: (
    <>
      {P("M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8z")}
      {P("M4 21c0-3.3 3.6-6 8-6s8 2.7 8 6", "b")}
    </>
  ),
  memory: (
    <>
      {P("M12 3a2 2 0 0 1 2 2v.5a2 2 0 0 0 2.7 1.9 2 2 0 0 1 2.5 2.9 2 2 0 0 0 .5 3.2 2 2 0 0 1-1.4 3.6 2 2 0 0 0-1.9 2.7 2 2 0 0 1-3.3 1.8 2 2 0 0 0-3.2 0 2 2 0 0 1-3.3-1.8 2 2 0 0 0-1.9-2.7 2 2 0 0 1-1.4-3.6 2 2 0 0 0 .5-3.2 2 2 0 0 1 2.5-2.9A2 2 0 0 0 10 5.5V5a2 2 0 0 1 2-2z")}
      {P("M12 8v8", "x")}
      {P("M8 12h8", "y")}
    </>
  ),
  settings: (
    <>
      {P("M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z")}
      {P(
        "M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.9 2.9l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.9-2.9l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.9-2.9l.1.1a1.7 1.7 0 0 0 1.9.3h.1a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5h.1a1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.9 2.9l-.1.1a1.7 1.7 0 0 0-.3 1.9v.1a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z",
        "g"
      )}
    </>
  ),
  plus: P("M12 5v14M5 12h14"),
  send: P("M4.5 12 20 4.5 15 20l-3.6-5.4L4.5 12z"),
  stop: P("M7 7h10v10H7z"),
  mic: (
    <>
      {P("M12 15a3.5 3.5 0 0 0 3.5-3.5V6a3.5 3.5 0 1 0-7 0v5.5A3.5 3.5 0 0 0 12 15z")}
      {P("M5.5 11.5a6.5 6.5 0 0 0 13 0", "b")}
      {P("M12 18v3", "c")}
    </>
  ),
  image: (
    <>
      {P("M4 5.5A1.5 1.5 0 0 1 5.5 4h13A1.5 1.5 0 0 1 20 5.5v13a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18.5z")}
      {P("m5 16 4.5-4.5 3 3L15.5 12l3.5 3.5", "b")}
      {P("M9.2 9.2h.01", "c")}
    </>
  ),
  copy: (
    <>
      {P("M9 9h10v12H9z")}
      {P("M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1", "b")}
    </>
  ),
  refresh: (
    <>
      {P("M21 12a9 9 0 1 1-2.6-6.3")}
      {P("M21 3v6h-6", "b")}
    </>
  ),
  speaker: (
    <>
      {P("M4 9.5v5h3.5L13 19V5L7.5 9.5z")}
      {P("M16.5 8.5a5 5 0 0 1 0 7", "b")}
      {P("M19 6a8.5 8.5 0 0 1 0 12", "c")}
    </>
  ),
  trash: (
    <>
      {P("M4 7h16")}
      {P("M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2", "b")}
      {P("M6 7l1 13a1 1 0 0 0 1 .9h8a1 1 0 0 0 1-.9L18 7", "c")}
      {P("M10 11v6M14 11v6", "d")}
    </>
  ),
  pin: P("M12 17v5M8 3h8l-1 7 3 3H6l3-3z"),
  edit: P("M4 20h4L20.5 7.5a2.1 2.1 0 0 0-3-3L5 17z"),
  x: P("M6 6l12 12M18 6 6 18"),
  back: P("M15 5l-7 7 7 7"),
  check: P("M4.5 12.5 10 18 19.5 6.5"),
  menu: P("M4 7h16M4 12h16M4 17h16"),
  down: P("M6 9l6 6 6-6"),
  user: (
    <>
      {P("M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8z")}
      {P("M5 21a7 7 0 0 1 14 0", "b")}
    </>
  ),
  key: (
    <>
      {P("M14.5 9.5a4.5 4.5 0 1 0-4.8 4.48L4 19.7V21h2.3l.7-.7V19h1.6l.7-.7V17h1.7l1.1-1.1a4.5 4.5 0 0 0 6.9-3.8 4.5 4.5 0 0 0-4.5-4.5z")}
    </>
  ),
  download: (
    <>
      {P("M12 4v11")}
      {P("m7 11 5 5 5-5", "b")}
      {P("M4 20h16", "c")}
    </>
  ),
  upload: (
    <>
      {P("M12 16V5")}
      {P("m7 9 5-5 5 5", "b")}
      {P("M4 20h16", "c")}
    </>
  ),
  book: (
    <>
      {P("M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5z")}
      {P("M4 20.5A2.5 2.5 0 0 1 6.5 18H20v3H6.5", "b")}
    </>
  ),
};

export type IconName = keyof typeof paths;

export function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {paths[name]}
    </svg>
  );
}

// ============================================================
// Avatar with agent hue
// ============================================================
export function Avatar({ agent, size = 42, radius }: { agent: Agent; size?: number; radius?: number }) {
  const style: React.CSSProperties = {
    width: size,
    height: size,
    borderRadius: radius ?? Math.round(size * 0.32),
    background: `linear-gradient(135deg, hsl(${agent.hue} 70% 55%), hsl(${(agent.hue + 40) % 360} 70% 45%))`,
    fontSize: Math.round(size * 0.52),
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  };
  return (
    <div className="ava" style={style}>
      {agent.emoji}
    </div>
  );
}

// ============================================================
// Modal shell
// ============================================================
export function Modal({
  title,
  onClose,
  children,
  footer,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="modal-mask" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-head">
          <h3>{title}</h3>
          <button className="icon-btn" onClick={onClose} aria-label="关闭">
            <Icon name="x" />
          </button>
        </div>
        {children}
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

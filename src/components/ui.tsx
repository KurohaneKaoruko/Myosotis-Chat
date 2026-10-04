import type { ReactNode } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import * as Select from "@radix-ui/react-select";
import * as Switch from "@radix-ui/react-switch";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import * as Tooltip from "@radix-ui/react-tooltip";
import * as Slider from "@radix-ui/react-slider";
import type { Agent } from "../types";
import { t } from "../i18n";

// ============================================================
// Tiny icon set (stroke style, consistent 24x24 grid)
// ============================================================
const P = (d: string, key?: string) => <path key={key} d={d} />;

const paths: Record<string, ReactNode> = {
  chat: P("M21 11.5a8.4 8.4 0 0 1-8.5 8.4 8.6 8.6 0 0 1-3.7-.8L3 21l1.9-5.3a8.4 8.4 0 1 1 16.1-4.2z"),
  agents: (
    <>
      {P("M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8z")}
      {P("M4 21c0-3.3 3.6-6 8-6s8 2.7 8 6", "b")}
    </>
  ),
  memory: (
    <>
      <circle cx="12" cy="12" r="3" />
      {P("M12 16.5A4.5 4.5 0 1 1 7.5 12 4.5 4.5 0 1 1 12 7.5a4.5 4.5 0 1 1 4.5 4.5 4.5 4.5 0 1 1-4.5 4.5")}
      {P("M12 7.5V9", "p1")}
      {P("M7.5 12H9", "p2")}
      {P("M16.5 12H15", "p3")}
      {P("M12 17.5V16", "p4")}
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
  dots: (
    <>
      {P("M5 12h.01")}
      {P("M12 12h.01")}
      {P("M19 12h.01")}
    </>
  ),
  user: (
    <>
      {P("M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8z")}
      {P("M5 21a7 7 0 0 1 14 0", "b")}
    </>
  ),
  key: P("M14.5 9.5a4.5 4.5 0 1 0-4.8 4.48L4 19.7V21h2.3l.7-.7V19h1.6l.7-.7V17h1.7l1.1-1.1a4.5 4.5 0 0 0 6.9-3.8 4.5 4.5 0 0 0-4.5-4.5z"),
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
  search: (
    <>
      {P("M10.5 18a7.5 7.5 0 1 0 0-15 7.5 7.5 0 0 0 0 15z")}
      {P("m16 16 5 5", "b")}
    </>
  ),
  broom: (
    <>
      {P("M14 3l7 7")}
      {P("M9 14 4 19l1 1 5-5", "b")}
      {P("M10 4l10 10-4 4L6 8z", "c")}
    </>
  ),
  zap: P("M13 2 4 14h6l-1 8 9-12h-6z"),
  headphones: (
    <>
      {P("M4 14v-2a8 8 0 0 1 16 0v2")}
      {P("M4 14h2a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1H4z", "b")}
      {P("M20 14h-2a1 1 0 0 0-1 1v4a1 1 0 0 0 1 1h2z", "c")}
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
      strokeWidth={name === "dots" ? 3 : 1.8}
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
// Modal (Radix Dialog): ESC / backdrop close, focus trap, a11y
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
    <Dialog.Root open onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="modal-mask" />
        <Dialog.Content className="modal" onInteractOutside={(e) => e.preventDefault()}>
          <div className="modal-head">
            <Dialog.Title>{title}</Dialog.Title>
            <button className="icon-btn" onClick={onClose} aria-label={t("commonClose")}>
              <Icon name="x" />
            </button>
          </div>
          {children}
          {footer && <div className="modal-foot">{footer}</div>}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

// prompt-style small modal
export function PromptModal({
  title,
  label,
  initial,
  onConfirm,
  onClose,
  confirmText = t("commonConfirm"),
}: {
  title: string;
  label: string;
  initial?: string;
  onConfirm: (value: string) => void;
  onClose: () => void;
  confirmText?: string;
}) {
  return (
    <Modal title={title} onClose={onClose} footer={
      <>
        <button className="btn ghost" onClick={onClose}>{t("commonCancel")}</button>
        <button className="btn primary" onClick={() => onConfirm((document.getElementById("prompt-input") as HTMLInputElement)?.value ?? "")}>
          {confirmText}
        </button>
      </>
    }>
      <div className="field" style={{ marginBottom: 0 }}>
        <label>{label}</label>
        <input id="prompt-input" className="input" defaultValue={initial} autoFocus
          onKeyDown={(e) => { if (e.key === "Enter") onConfirm((e.target as HTMLInputElement).value); }} />
      </div>
    </Modal>
  );
}

// styled replacement for window.confirm — host mounts once, store drives it
export function ConfirmHost({
  options,
  onResolve,
}: {
  options: { title: string; message: string; confirmText?: string; danger?: boolean } | null;
  onResolve: (ok: boolean) => void;
}) {
  if (!options) return null;
  return (
    <Dialog.Root open onOpenChange={(o) => !o && onResolve(false)}>
      <Dialog.Portal>
        <Dialog.Overlay className="modal-mask" />
        <Dialog.Content className="modal confirm-modal" onInteractOutside={(e) => e.preventDefault()}>
          <Dialog.Title style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>{options.title}</Dialog.Title>
          <Dialog.Description style={{ fontSize: 13.5, color: "var(--text-2)", lineHeight: 1.7, whiteSpace: "pre-wrap" }}>
            {options.message}
          </Dialog.Description>
          <div className="modal-foot">
            <button className="btn ghost" onClick={() => onResolve(false)}>
              {t("commonCancel")}
            </button>
            <button
              className={`btn ${options.danger ? "danger confirm-danger" : "primary"}`}
              autoFocus
              onClick={() => onResolve(true)}
            >
              {options.confirmText ?? t("commonConfirm")}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

// slider (Radix) with label
export function SliderRow({
  label,
  desc,
  value,
  min,
  max,
  step,
  format,
  onChange,
}: {
  label: string;
  desc?: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format?: (v: number) => string;
  onChange: (v: number) => void;
}) {
  return (
    <div className="set-row">
      <div className="info">
        <div className="t">{label}</div>
        {desc && <div className="d">{desc}</div>}
      </div>
      <div className="slider-cell">
        <span className="slider-val">{format ? format(value) : value}</span>
        <Slider.Root
          className="slider"
          value={[value]}
          min={min}
          max={max}
          step={step}
          onValueChange={([v]) => onChange(v)}
        >
          <Slider.Track className="slider-track">
            <Slider.Range className="slider-range" />
          </Slider.Track>
          <Slider.Thumb className="slider-thumb" aria-label={label} />
        </Slider.Root>
      </div>
    </div>
  );
}

// ============================================================
// Select (Radix Select), styled to match .input
// ============================================================
const NONE = "__none__";

export function SelectBox({
  value,
  onChange,
  options,
  placeholder = t("pleaseSelect"),
  style,
}: {
  value: string | null;
  onChange: (v: string | null) => void;
  options: { value: string; label: string }[];
  placeholder?: string;
  style?: React.CSSProperties;
}) {
  return (
    <Select.Root value={value ?? NONE} onValueChange={(v) => onChange(v === NONE ? null : v)}>
      <Select.Trigger className="select input" style={style} aria-label={placeholder}>
        <Select.Value placeholder={placeholder} />
        <Select.Icon className="select-caret">
          <Icon name="down" size={15} />
        </Select.Icon>
      </Select.Trigger>
      <Select.Portal>
        <Select.Content className="rd-content" position="popper" sideOffset={6}>
          <Select.Viewport className="rd-viewport">
            <Select.Item className="rd-item" value={NONE}>
              <Select.ItemText>{placeholder}</Select.ItemText>
              <Select.ItemIndicator className="rd-indicator">
                <Icon name="check" size={13} />
              </Select.ItemIndicator>
            </Select.Item>
            {options.map((o) => (
              <Select.Item className="rd-item" key={o.value} value={o.value}>
                <Select.ItemText>{o.label}</Select.ItemText>
                <Select.ItemIndicator className="rd-indicator">
                  <Icon name="check" size={13} />
                </Select.ItemIndicator>
              </Select.Item>
            ))}
          </Select.Viewport>
        </Select.Content>
      </Select.Portal>
    </Select.Root>
  );
}

// ============================================================
// Switch (Radix)
// ============================================================
export function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <Switch.Root className={`toggle ${checked ? "on" : ""}`} checked={checked} onCheckedChange={onChange}>
      <Switch.Thumb className="toggle-thumb" />
    </Switch.Root>
  );
}

// ============================================================
// Dropdown menu (Radix)
// ============================================================
export type MenuItemSpec =
  | {
      label: string;
      icon?: IconName;
      danger?: boolean;
      onClick: () => void;
    }
  | "separator";

export function Menu({
  trigger,
  items,
  align = "end",
}: {
  trigger: ReactNode;
  items: MenuItemSpec[];
  align?: "start" | "center" | "end";
}) {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>{trigger}</DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content className="dd-content" sideOffset={6} align={align}>
          {items.map((item, i) =>
            item === "separator" ? (
              <DropdownMenu.Separator key={i} className="dd-sep" />
            ) : (
              <DropdownMenu.Item key={i} className={`dd-item ${item.danger ? "danger" : ""}`} onSelect={item.onClick}>
                {item.icon && <Icon name={item.icon} size={15} />}
                {item.label}
              </DropdownMenu.Item>
            )
          )}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

// ============================================================
// Tooltip (Radix) — mount <Tip.Provider> once at app root
// ============================================================
export const Tip = {
  Provider: Tooltip.Provider,
  Tip: function TipInner({ text, children }: { text: string; children: ReactNode }) {
    return (
      <Tooltip.Root delayDuration={350}>
        <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content className="tip" sideOffset={6}>
            {text}
            <Tooltip.Arrow className="tip-arrow" />
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    );
  },
};

export function TipFor({ text, children }: { text: string; children: ReactNode }) {
  return <Tip.Tip text={text}>{children}</Tip.Tip>;
}

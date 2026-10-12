import { useState } from "react";
import { Modal, SelectBox } from "./ui";
import { useStore } from "../store";
import { t } from "../i18n";
import type { GroupParticipant, ParticipantMode } from "../types";

/**
 * Create or edit a multi-agent group chat: pick participants, set each one's
 * receive/reply policy, and order who speaks first.
 */
export default function GroupEditor({
  convoId,
  onClose,
}: {
  /** null = create a new group; otherwise edit this conversation */
  convoId: string | null;
  onClose: () => void;
}) {
  const agents = useStore((s) => s.agents);
  const convos = useStore((s) => s.convos);
  const createGroupConversation = useStore((s) => s.createGroupConversation);
  const updateGroupConversation = useStore((s) => s.updateGroupConversation);
  const showToast = useStore((s) => s.showToast);

  const existing = convoId ? convos.find((c) => c.id === convoId) ?? null : null;
  const [title, setTitle] = useState(existing?.title ?? "");
  const [picked, setPicked] = useState<string[]>(
    existing ? (existing.participants ?? []).map((p) => p.agentId) : []
  );
  const [modes, setModes] = useState<Record<string, { receive: ParticipantMode; reply: ParticipantMode }>>(
    Object.fromEntries(
      (existing?.participants ?? []).map((p) => [p.agentId, { receive: p.receiveMode, reply: p.replyMode }])
    )
  );

  const modeOf = (id: string) =>
    modes[id] ?? { receive: "all" as ParticipantMode, reply: "all" as ParticipantMode };
  const setMode = (id: string, patch: Partial<{ receive: ParticipantMode; reply: ParticipantMode }>) =>
    setModes((m) => ({ ...m, [id]: { ...modeOf(id), ...patch } }));

  const toggle = (id: string) =>
    setPicked((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const move = (id: string, dir: -1 | 1) =>
    setPicked((prev) => {
      const i = prev.indexOf(id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });

  const save = async () => {
    if (picked.length < 2) {
      showToast(t("groupNeedTwo"), "error");
      return;
    }
    const participants: GroupParticipant[] = picked.map((agentId, i) => {
      const m = modeOf(agentId);
      return { agentId, receiveMode: m.receive, replyMode: m.reply, sortOrder: i };
    });
    if (existing) {
      await updateGroupConversation(existing.id, {
        title: title.trim() || existing.title,
        participants,
      });
    } else {
      await createGroupConversation(title, participants);
      showToast(t("groupCreated"), "success");
    }
    onClose();
  };

  const MODE_OPTIONS = [
    { value: "all", label: t("modeAll") },
    { value: "mention", label: t("modeMention") },
  ];

  return (
    <Modal
      title={existing ? t("groupEdit") : t("newGroupBtn")}
      onClose={onClose}
      footer={
        <>
          <button className="btn ghost" onClick={onClose}>
            {t("commonCancel")}
          </button>
          <button className="btn primary" onClick={save}>
            {existing ? t("commonSave") : t("groupCreate")}
          </button>
        </>
      }
    >
      <div className="field">
        <label>{t("groupTitle")}</label>
        <input
          className="input"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={t("groupTitlePh")}
        />
      </div>

      <div className="field" style={{ marginBottom: 0 }}>
        <label>{t("groupParticipants")}</label>
        <div className="desc" style={{ marginBottom: 8 }}>{t("groupPickAgents")}</div>
        {agents.length === 0 && <div className="desc">{t("noAgents")}</div>}
        {agents.map((a) => {
          const on = picked.includes(a.id);
          const idx = picked.indexOf(a.id);
          const m = modeOf(a.id);
          return (
            <div key={a.id} className={`group-pick ${on ? "on" : ""}`}>
              <div className="gp-head">
                <button className={`checkbox ${on ? "on" : ""}`} onClick={() => toggle(a.id)}>
                  {on && "✓"}
                </button>
                <div
                  className="ava"
                  style={{
                    width: 26,
                    height: 26,
                    fontSize: 14,
                    borderRadius: 9,
                    background: `linear-gradient(135deg, hsl(${a.hue} 70% 55%), hsl(${(a.hue + 40) % 360} 70% 45%))`,
                  }}
                >
                  {a.emoji}
                </div>
                <span className="gp-name">{a.name}</span>
                {on && (
                  <div className="gp-order">
                    <span className="gp-idx">#{idx + 1}</span>
                    <button className="icon-btn" style={{ width: 24, height: 24 }} disabled={idx <= 0} onClick={() => move(a.id, -1)} title={t("groupMoveUp")}>
                      ↑
                    </button>
                    <button
                      className="icon-btn"
                      style={{ width: 24, height: 24 }}
                      disabled={idx >= picked.length - 1}
                      onClick={() => move(a.id, 1)}
                      title={t("groupMoveDown")}
                    >
                      ↓
                    </button>
                  </div>
                )}
              </div>
              {on && (
                <div className="gp-modes">
                  <span className="gp-mode-label">{t("groupReceive")}</span>
                  <SelectBox
                    value={m.receive}
                    onChange={(v) => setMode(a.id, { receive: (v as ParticipantMode) ?? "all" })}
                    options={MODE_OPTIONS}
                    style={{ maxWidth: 130 }}
                  />
                  <span className="gp-mode-label">{t("groupReply")}</span>
                  <SelectBox
                    value={m.reply}
                    onChange={(v) => setMode(a.id, { reply: (v as ParticipantMode) ?? "all" })}
                    options={MODE_OPTIONS}
                    style={{ maxWidth: 130 }}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Modal>
  );
}

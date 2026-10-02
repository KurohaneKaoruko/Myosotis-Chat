import { useEffect, useState } from "react";
import { useStore } from "../store";
import { db } from "../lib/db";
import { MEMORY_KINDS, type MemoryItem, type MemoryKind } from "../types";
import { Modal, Icon, Avatar } from "./ui";

export default function MemoryView() {
  const agents = useStore((s) => s.agents);
  const memoryAgentFilter = useStore((s) => s.memoryAgentFilter);
  const [filter, setFilter] = useState<string>(memoryAgentFilter ?? "all");
  const [list, setList] = useState<MemoryItem[]>([]);
  const [editing, setEditing] = useState<MemoryItem | "new" | null>(null);

  const load = async () => {
    const all =
      filter === "all" ? await db.memories.toArray() : await db.memories.where("agentId").equals(filter).toArray();
    all.sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt);
    setList(all);
  };

  useEffect(() => {
    load();
  }, [filter]);

  const agentOf = (id: string) => agents.find((a) => a.id === id);
  const kindInfo = (k: MemoryKind) => MEMORY_KINDS.find((x) => x.id === k) ?? MEMORY_KINDS[0];

  return (
    <div className="page">
      <div className="page-inner">
        <div className="page-title">
          记忆花园
          <span className="desc" style={{ fontWeight: 400 }}>
            伙伴们记住的一切，尽收眼底
          </span>
        </div>

        <div className="card" style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <div style={{ fontSize: 28 }}>🌸</div>
          <div style={{ fontSize: 13, color: "var(--text-2)", flex: 1 }}>
            伙伴会自动从对话中记住你的喜好、经历与约定。每条记忆都可以修改、置顶或删除——<b>你对自己的信息拥有完全的控制权</b>。
            配置「记忆检索模型」后，回忆会找得更准。
          </div>
          <button className="btn primary sm" onClick={() => setEditing("new")}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
              <Icon name="plus" size={14} /> 手动添加
            </span>
          </button>
        </div>

        <div className="chips">
          <button className={`chip ${filter === "all" ? "on" : ""}`} onClick={() => setFilter("all")}>
            全部（{list.length}）
          </button>
          {agents.map((a) => (
            <button key={a.id} className={`chip ${filter === a.id ? "on" : ""}`} onClick={() => setFilter(a.id)}>
              {a.emoji} {a.name}
            </button>
          ))}
        </div>

        {list.length === 0 ? (
          <div className="mem-empty">
            <div style={{ fontSize: 40, marginBottom: 8 }}>🌱</div>
            还没有记忆。多和伙伴聊聊，或手动种下一颗种子。
          </div>
        ) : (
          list.map((m) => {
            const agent = agentOf(m.agentId);
            return (
              <div key={m.id} className={`mem-card ${m.pinned ? "pinned" : ""}`}>
                <div className="ic">{kindInfo(m.kind).icon}</div>
                <div className="bd">
                  <div className="tx">{m.content}</div>
                  <div className="ft">
                    <span className="kind">{kindInfo(m.kind).label}</span>
                    <span className="imp">{"★".repeat(m.importance)}</span>
                    {agent && (
                      <span>
                        {agent.emoji} {agent.name}
                      </span>
                    )}
                    <span>{m.hitCount > 0 ? `被想起 ${m.hitCount} 次` : ""}</span>
                  </div>
                </div>
                <div className="ops">
                  <button className="icon-btn" title={m.pinned ? "取消置顶" : "置顶（永远记住）"} onClick={() => useStore.getState().updateMemory(m.id, { pinned: !m.pinned }).then(load)}>
                    <Icon name="pin" size={15} />
                  </button>
                  <button className="icon-btn" title="编辑" onClick={() => setEditing(m)}>
                    <Icon name="edit" size={15} />
                  </button>
                  <button
                    className="icon-btn danger"
                    title="忘记"
                    onClick={() => {
                      if (confirm("让伙伴忘掉这条记忆？")) useStore.getState().deleteMemory(m.id).then(load);
                    }}
                  >
                    <Icon name="trash" size={15} />
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>

      {editing && (
        <MemoryEditor
          memory={editing === "new" ? null : editing}
          defaultAgentId={filter !== "all" ? filter : agents[0]?.id}
          onClose={() => {
            setEditing(null);
            load();
          }}
        />
      )}
    </div>
  );
}

function MemoryEditor({
  memory,
  defaultAgentId,
  onClose,
}: {
  memory: MemoryItem | null;
  defaultAgentId?: string;
  onClose: () => void;
}) {
  const agents = useStore((s) => s.agents);
  const addMemory = useStore((s) => s.addMemory);
  const updateMemory = useStore((s) => s.updateMemory);
  const [content, setContent] = useState(memory?.content ?? "");
  const [kind, setKind] = useState<MemoryKind>(memory?.kind ?? "fact");
  const [importance, setImportance] = useState(memory?.importance ?? 3);
  const [agentId, setAgentId] = useState(memory?.agentId ?? defaultAgentId ?? "");

  const save = async () => {
    if (!content.trim() || !agentId) return;
    if (memory) {
      await updateMemory(memory.id, { content: content.trim(), kind, importance });
    } else {
      await addMemory({ agentId, content: content.trim(), kind, importance, embedding: null });
    }
    onClose();
  };

  return (
    <Modal
      title={memory ? "编辑记忆" : "种下一颗记忆"}
      onClose={onClose}
      footer={
        <>
          <button className="btn ghost" onClick={onClose}>
            取消
          </button>
          <button className="btn primary" onClick={save}>
            保存
          </button>
        </>
      }
    >
      <div className="field">
        <label>内容</label>
        <textarea
          className="input"
          rows={3}
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="如：用户养了一只叫「团子」的橘猫"
          autoFocus
        />
      </div>
      <div className="field">
        <label>属于哪位伙伴</label>
        <select className="select input" value={agentId} onChange={(e) => setAgentId(e.target.value)}>
          {agents.map((a) => (
            <option key={a.id} value={a.id}>
              {a.emoji} {a.name}
            </option>
          ))}
        </select>
      </div>
      <div className="row">
        <div className="field">
          <label>类型</label>
          <select className="select input" value={kind} onChange={(e) => setKind(e.target.value as MemoryKind)}>
            {MEMORY_KINDS.map((k) => (
              <option key={k.id} value={k.id}>
                {k.icon} {k.label}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>重要度</label>
          <select className="select input" value={importance} onChange={(e) => setImportance(Number(e.target.value))}>
            {[1, 2, 3, 4, 5].map((n) => (
              <option key={n} value={n}>
                {"★".repeat(n)}（{n}）
              </option>
            ))}
          </select>
        </div>
      </div>
    </Modal>
  );
}

import { useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { useStore } from "../store";
import { db } from "../lib/db";
import { MEMORY_KINDS, type MemoryItem, type MemoryKind } from "../types";
import { Modal, Icon, SelectBox } from "./ui";

type CleanupCandidate = MemoryItem & { __ageDays: number };

const CLEANUP_DAYS = 90;

function isCleanupCandidate(m: MemoryItem): boolean {
  const last = m.lastHitAt ?? m.createdAt;
  return Date.now() - last > CLEANUP_DAYS * 86400000 && m.importance <= 2 && !m.pinned;
}

export default function MemoryView() {
  const agents = useStore((s) => s.agents);
  const showToast = useStore((s) => s.showToast);
  const askConfirm = useStore((s) => s.askConfirm);
  const [filter, setFilter] = useState<string>("all");
  const [query, setQuery] = useState("");
  const [kindFilter, setKindFilter] = useState<MemoryKind | "all">("all");
  const [minImportance, setMinImportance] = useState(0);
  const [cleanupMode, setCleanupMode] = useState(false);
  const [cleanupIds, setCleanupIds] = useState<string[]>([]);
  const [editing, setEditing] = useState<MemoryItem | "new" | null>(null);

  const all = useLiveQuery(() => db.memories.toArray(), []) ?? [];

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    let items = all;
    if (!cleanupMode) {
      if (query.trim()) items = items.filter((m) => m.content.toLowerCase().includes(q));
      if (kindFilter !== "all") items = items.filter((m) => m.kind === kindFilter);
      if (minImportance > 0) items = items.filter((m) => m.importance >= minImportance);
    } else {
      items = items
        .filter(isCleanupCandidate)
        .map((m) => ({ ...m, __ageDays: Math.floor((Date.now() - (m.lastHitAt ?? m.createdAt)) / 86400000) }));
      setCleanupIds((prev) => prev.filter((id) => items.some((m) => m.id === id)));
    }
    return [...items].sort(
      (a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt
    );
  }, [all, query, kindFilter, minImportance, cleanupMode]);

  const agentOf = (id: string) => agents.find((a) => a.id === id);
  const kindInfo = (k: MemoryKind) => MEMORY_KINDS.find((x) => x.id === k) ?? MEMORY_KINDS[0];

  const toggleScope = (m: MemoryItem) => {
    const next = m.scope === "global" ? "agent" : "global";
    useStore.getState().updateMemory(m.id, { scope: next });
    showToast(next === "global" ? "已设为全局记忆（所有智能体可见）" : "已设为私有记忆", "success");
  };

  const exportMemories = async () => {
    const items = filter === "all" ? all : all.filter((m) => m.agentId === filter);
    if (!items.length) {
      showToast("没有可导出的记忆", "error");
      return;
    }
    const payload = {
      format: "myosotis-memories",
      version: 1,
      exportedAt: Date.now(),
      memories: items,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `myosotis-memories-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    showToast(`已导出 ${items.length} 条记忆`, "success");
  };

  const importMemories = async (file: File) => {
    try {
      const data = JSON.parse(await file.text());
      if (data?.format !== "myosotis-memories" || !Array.isArray(data.memories)) {
        throw new Error("bad format");
      }
      const existing = new Set((await db.memories.toArray()).map((m) => m.content));
      let added = 0;
      let skipped = 0;
      const now = Date.now();
      for (const raw of data.memories) {
        const content = String(raw.content ?? "").trim();
        if (!content || content.length > 200) {
          skipped++;
          continue;
        }
        if (existing.has(content)) {
          skipped++;
          continue;
        }
        existing.add(content);
        await db.memories.add({
          id: `mem_${Math.random().toString(36).slice(2, 12)}`,
          agentId: agents.some((a) => a.id === raw.agentId) ? raw.agentId : (agents[0]?.id ?? ""),
          content,
          kind: MEMORY_KINDS.some((k) => k.id === raw.kind) ? raw.kind : "fact",
          importance: Math.max(1, Math.min(5, Number(raw.importance) || 2)),
          embedding: null,
          pinned: !!raw.pinned,
          scope: raw.scope === "global" ? "global" : "agent",
          hitCount: 0,
          createdAt: Number(raw.createdAt) || now,
          updatedAt: now,
        });
        added++;
      }
      showToast(`导入完成：新增 ${added} 条，跳过重复/无效 ${skipped} 条`, "success");
    } catch {
      showToast("导入失败：文件格式不正确，已有记忆未受影响", "error");
    }
  };

  return (
    <div className="page">
      <div className="page-inner">
        <div className="page-title">
          记忆花园
          <span className="desc" style={{ fontWeight: 400 }}>
            智能体们记住的一切，尽收眼底
          </span>
        </div>

        <div className="card" style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <div style={{ fontSize: 28 }}>🌸</div>
          <div style={{ fontSize: 13, color: "var(--text-2)", flex: 1, minWidth: 200 }}>
            智能体会自动从对话中记住你的喜好、经历与约定。每条记忆都可以修改、置顶或删除——
            <b>你对自己的信息拥有完全的控制权</b>。配置「记忆检索模型」后，回忆会找得更准。
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button className="btn sm" onClick={exportMemories} title="导出为 JSON">
              <Icon name="download" size={14} /> 导出
            </button>
            <label className="btn sm" style={{ cursor: "pointer" }} title="从 JSON 导入">
              <Icon name="upload" size={14} /> 导入
              <input
                type="file"
                accept="application/json"
                hidden
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) importMemories(f);
                  e.target.value = "";
                }}
              />
            </label>
            <button
              className={`btn sm ${cleanupMode ? "primary" : ""}`}
              onClick={() => {
                setCleanupMode(!cleanupMode);
                setCleanupIds([]);
              }}
            >
              <Icon name="broom" size={14} /> 清理候选
            </button>
            <button className="btn primary sm" onClick={() => setEditing("new")}>
              <Icon name="plus" size={14} /> 手动添加
            </button>
          </div>
        </div>

        {!cleanupMode && (
          <>
            <div className="search-box" style={{ margin: 0 }}>
              <Icon name="search" size={15} />
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索记忆内容…" />
            </div>
            <div className="chips">
              <button className={`chip ${filter === "all" ? "on" : ""}`} onClick={() => setFilter("all")}>
                全部智能体
              </button>
              {agents.map((a) => (
                <button key={a.id} className={`chip ${filter === a.id ? "on" : ""}`} onClick={() => setFilter(a.id)}>
                  {a.emoji} {a.name}
                </button>
              ))}
            </div>
            <div className="chips">
              <button className={`chip ${kindFilter === "all" ? "on" : ""}`} onClick={() => setKindFilter("all")}>
                全部类型
              </button>
              {MEMORY_KINDS.map((k) => (
                <button
                  key={k.id}
                  className={`chip ${kindFilter === k.id ? "on" : ""}`}
                  onClick={() => setKindFilter(kindFilter === k.id ? "all" : k.id)}
                >
                  {k.icon} {k.label}
                </button>
              ))}
              <span style={{ width: 8 }} />
              {[0, 3, 4].map((n) => (
                <button
                  key={n}
                  className={`chip ${minImportance === n ? "on" : ""}`}
                  onClick={() => setMinImportance(n)}
                >
                  {n === 0 ? "任意重要度" : `★≥${n}`}
                </button>
              ))}
            </div>
          </>
        )}

        {cleanupMode && (
          <div className="card" style={{ borderColor: "var(--danger)" }}>
            <h3 style={{ color: "var(--danger)" }}>
              <Icon name="broom" size={16} /> 清理候选（{list.length} 条）
            </h3>
            <div style={{ fontSize: 12.5, color: "var(--text-3)", marginBottom: 10 }}>
              以下记忆超过 {CLEANUP_DAYS} 天未被想起且重要度 ≤2。删除需确认， pinned 记忆不会出现。
            </div>
            <div className="chips" style={{ marginBottom: 8 }}>
              <button className="chip" onClick={() => setCleanupIds(list.map((m) => m.id))}>
                全选
              </button>
              <button className="chip" onClick={() => setCleanupIds([])}>
                清空选择
              </button>
              <button
                className="btn sm danger"
                disabled={!cleanupIds.length}
                onClick={() => {
                  askConfirm({
                    title: "批量删除记忆",
                    message: `确定删除选中的 ${cleanupIds.length} 条低价值记忆？此操作不可恢复。`,
                    confirmText: "删除",
                    danger: true,
                  }).then(async (ok) => {
                    if (!ok) return;
                    await db.memories.bulkDelete(cleanupIds);
                    setCleanupIds([]);
                    showToast("清理完成", "success");
                  });
                }}
              >
                删除所选（{cleanupIds.length}）
              </button>
            </div>
            {list.length === 0 && (
              <div className="mem-empty" style={{ padding: "20px 0" }}>
                🌿 没有需要清理的记忆，花园很干净。
              </div>
            )}
          </div>
        )}

        {list.length === 0 && !cleanupMode ? (
          <div className="mem-empty">
            <div style={{ fontSize: 40, marginBottom: 8 }}>🌱</div>
            还没有匹配的记忆。多和你的智能体聊聊，或手动种下一颗种子。
          </div>
        ) : (
          list.map((m) => {
            const agent = agentOf(m.agentId);
            const ageDays = Math.floor((Date.now() - (m.lastHitAt ?? m.createdAt)) / 86400000);
            const isCandidate = cleanupMode && cleanupIds.includes(m.id);
            return (
              <div
                key={m.id}
                className={`mem-card ${m.pinned ? "pinned" : ""} ${isCandidate ? "selected" : ""}`}
                onClick={cleanupMode ? () => setCleanupIds((p) => (p.includes(m.id) ? p.filter((x) => x !== m.id) : [...p, m.id])) : undefined}
                style={cleanupMode ? { cursor: "pointer" } : undefined}
              >
                <div className="ic">{cleanupMode ? (isCandidate ? "☑️" : "⬜") : kindInfo(m.kind).icon}</div>
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
                    {m.scope === "global" && <span className="kind">🌐 全局</span>}
                    <span>{m.lastHitAt ? `${ageDays} 天前想起` : "从未想起"}</span>
                  </div>
                </div>
                {!cleanupMode && (
                  <div className="ops">
                    <button
                      className="icon-btn"
                      title={m.pinned ? "取消置顶" : "置顶（永远记住）"}
                      onClick={() => useStore.getState().updateMemory(m.id, { pinned: !m.pinned })}
                    >
                      <Icon name="pin" size={15} />
                    </button>
                    <button
                      className="icon-btn"
                      title={m.scope === "global" ? "改为私有" : "设为全局（所有智能体可见）"}
                      onClick={() => toggleScope(m)}
                      style={{ fontSize: 13, fontWeight: 700 }}
                    >
                      {m.scope === "global" ? "🌐" : "🔒"}
                    </button>
                    <button className="icon-btn" title="编辑" onClick={() => setEditing(m)}>
                      <Icon name="edit" size={15} />
                    </button>
                    <button
                      className="icon-btn danger"
                      title="忘记"
                      onClick={() => {
                        askConfirm({
                          title: "忘掉这条记忆",
                          message: `让智能体忘掉：\n「${m.content.slice(0, 60)}」？`,
                          confirmText: "忘掉",
                          danger: true,
                        }).then((ok) => {
                          if (ok) useStore.getState().deleteMemory(m.id);
                        });
                      }}
                    >
                      <Icon name="trash" size={15} />
                    </button>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {editing && (
        <MemoryEditor
          memory={editing === "new" ? null : editing}
          defaultAgentId={filter !== "all" ? filter : agents[0]?.id}
          onClose={() => setEditing(null)}
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
  memory: import("../types").MemoryItem | null;
  defaultAgentId?: string;
  onClose: () => void;
}) {
  const agents = useStore((s) => s.agents);
  const addMemory = useStore((s) => s.addMemory);
  const updateMemory = useStore((s) => s.updateMemory);
  const [content, setContent] = useState(memory?.content ?? "");
  const [kind, setKind] = useState<MemoryKind>(memory?.kind ?? "fact");
  const [importance, setImportance] = useState(String(memory?.importance ?? 3));
  const [agentId, setAgentId] = useState(memory?.agentId ?? defaultAgentId ?? "");
  const [scope, setScope] = useState<"agent" | "global">(memory?.scope ?? "agent");

  const save = async () => {
    if (!content.trim() || !agentId) return;
    if (memory) {
      await updateMemory(memory.id, {
        content: content.trim(),
        kind,
        importance: Number(importance),
        scope,
        ...(memory.agentId !== agentId ? { agentId } : {}),
      });
    } else {
      await addMemory({
        agentId,
        content: content.trim(),
        kind,
        importance: Number(importance),
        embedding: null,
        scope,
      });
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
        <label>属于哪个智能体</label>
        <SelectBox
          value={agentId || null}
          onChange={(v) => setAgentId(v ?? "")}
          options={agents.map((a) => ({ value: a.id, label: `${a.emoji} ${a.name}` }))}
          placeholder="选择智能体"
        />
      </div>
      <div className="field">
        <label>作用域</label>
        <div className="chips">
          <button className={`chip ${scope === "agent" ? "on" : ""}`} onClick={() => setScope("agent")}>
            🔒 仅该智能体
          </button>
          <button className={`chip ${scope === "global" ? "on" : ""}`} onClick={() => setScope("global")}>
            🌐 全局共享
          </button>
        </div>
      </div>
      <div className="row">
        <div className="field">
          <label>类型</label>
          <SelectBox
            value={kind}
            onChange={(v) => setKind((v ?? "fact") as MemoryKind)}
            options={MEMORY_KINDS.map((k) => ({ value: k.id, label: `${k.icon} ${k.label}` }))}
            placeholder="类型"
          />
        </div>
        <div className="field">
          <label>重要度</label>
          <SelectBox
            value={importance}
            onChange={(v) => setImportance(v ?? "3")}
            options={[1, 2, 3, 4, 5].map((n) => ({ value: String(n), label: `${"★".repeat(n)}（${n}）` }))}
            placeholder="重要度"
          />
        </div>
      </div>
    </Modal>
  );
}

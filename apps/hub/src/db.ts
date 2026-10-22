// ================================================================
// Hub SQLite store (node:sqlite) + core StoragePort implementation.
// One file, one database, WAL mode, prepared statements cached.
// ================================================================
import { DatabaseSync } from "node:sqlite";
import { setStorage, type StoragePort } from "@myosotis/core";
import type { ChatMessage, Conversation, MemoryItem } from "@myosotis/core";

export interface HubUser {
  id: string;
  username: string;
  /** scrypt hash: salt:hash */
  passwordHash: string;
  totpSecret: string | null;
  createdAt: number;
}

export class HubDB {
  private db: DatabaseSync;

  constructor(file: string) {
    this.db = new DatabaseSync(file);
    this.db.exec("PRAGMA journal_mode=WAL");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        username TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        totp_secret TEXT,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        last_seen_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
      CREATE TABLE IF NOT EXISTS providers (
        id TEXT PRIMARY KEY, user_id TEXT NOT NULL, data TEXT NOT NULL, created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS models (
        id TEXT PRIMARY KEY, user_id TEXT NOT NULL, provider_id TEXT NOT NULL, data TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS agents (
        id TEXT PRIMARY KEY, user_id TEXT NOT NULL, data TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY, user_id TEXT NOT NULL, agent_id TEXT NOT NULL, data TEXT NOT NULL, updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_convos_user ON conversations(user_id, updated_at DESC);
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL, user_id TEXT NOT NULL, created_at INTEGER NOT NULL, data TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_msgs_convo ON messages(conversation_id, created_at);
      CREATE TABLE IF NOT EXISTS memories (
        id TEXT PRIMARY KEY, agent_id TEXT NOT NULL, user_id TEXT NOT NULL, updated_at INTEGER NOT NULL, data TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_mems_agent ON memories(agent_id);
      CREATE INDEX IF NOT EXISTS idx_mems_user ON memories(user_id);
      CREATE TABLE IF NOT EXISTS prompts (
        id TEXT PRIMARY KEY, user_id TEXT NOT NULL, data TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS scenarios (
        id TEXT PRIMARY KEY, user_id TEXT NOT NULL, agent_id TEXT NOT NULL, data TEXT NOT NULL, updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS settings (
        user_id TEXT PRIMARY KEY, data TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS channel_bindings (
        platform TEXT NOT NULL, channel_user_id TEXT NOT NULL,
        user_id TEXT NOT NULL, agent_id TEXT NOT NULL,
        PRIMARY KEY (platform, channel_user_id)
      );
      CREATE TABLE IF NOT EXISTS hub_meta (
        key TEXT PRIMARY KEY, value TEXT NOT NULL
      );
    `);
  }

  close() {
    this.db.close();
  }

  /** raw handle for modules that need ad-hoc prepared statements */
  get raw(): DatabaseSync {
    return this.db;
  }

  // ---------------- users & sessions ----------------
  createUser(u: HubUser) {
    this.db
      .prepare("INSERT INTO users (id, username, password_hash, totp_secret, created_at) VALUES (?,?,?,?,?)")
      .run(u.id, u.username, u.passwordHash, u.totpSecret ?? null, u.createdAt);
  }

  getUserByUsername(username: string): HubUser | undefined {
    const row = this.db.prepare("SELECT * FROM users WHERE username = ?").get(username) as any;
    return row ? this.rowToUser(row) : undefined;
  }

  getUser(id: string): HubUser | undefined {
    const row = this.db.prepare("SELECT * FROM users WHERE id = ?").get(id) as any;
    return row ? this.rowToUser(row) : undefined;
  }

  userCount(): number {
    return Number((this.db.prepare("SELECT COUNT(*) AS n FROM users").get() as any).n);
  }

  updateUser(id: string, patch: { passwordHash?: string; totpSecret?: string | null }) {
    if (patch.passwordHash !== undefined)
      this.db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(patch.passwordHash, id);
    if (patch.totpSecret !== undefined)
      this.db.prepare("UPDATE users SET totp_secret = ? WHERE id = ?").run(patch.totpSecret, id);
  }

  private rowToUser(row: any): HubUser {
    return {
      id: row.id,
      username: row.username,
      passwordHash: row.password_hash,
      totpSecret: row.totp_secret ?? null,
      createdAt: row.created_at,
    };
  }

  // ---------------- sessions ----------------
  createSession(s: { id: string; userId: string; createdAt: number; expiresAt: number }) {
    this.db
      .prepare("INSERT INTO sessions (id, user_id, created_at, expires_at, last_seen_at) VALUES (?,?,?,?,?)")
      .run(s.id, s.userId, s.createdAt, s.expiresAt, s.createdAt);
  }

  getSession(id: string): { id: string; userId: string; expiresAt: number } | undefined {
    const row = this.db.prepare("SELECT * FROM sessions WHERE id = ?").get(id) as any;
    if (!row) return undefined;
    if (row.expires_at < Date.now()) {
      this.db.prepare("DELETE FROM sessions WHERE id = ?").run(id);
      return undefined;
    }
    this.db.prepare("UPDATE sessions SET last_seen_at = ? WHERE id = ?").run(Date.now(), id);
    return { id: row.id, userId: row.user_id, expiresAt: row.expires_at };
  }

  deleteSession(id: string) {
    this.db.prepare("DELETE FROM sessions WHERE id = ?").run(id);
  }

  deleteExpiredSessions() {
    this.db.prepare("DELETE FROM sessions WHERE expires_at < ?").run(Date.now());
  }

  // ---------------- generic per-user JSON tables ----------------
  private table(s: string) {
    if (!/^[a-z_]+$/.test(s)) throw new Error("bad table");
    return s;
  }

  putJson(table: string, id: string, userId: string, data: unknown, extra?: Record<string, string | number>) {
    const t = this.table(table);
    // settings is keyed by user_id directly (no separate id column)
    if (t === "settings") {
      this.db
        .prepare("INSERT INTO settings (user_id, data) VALUES (?,?) ON CONFLICT(user_id) DO UPDATE SET data = excluded.data")
        .run(userId, JSON.stringify(data));
      return;
    }
    const cols = ["id", "user_id", "data", ...Object.keys(extra ?? {})];
    const vals: (string | number)[] = [id, userId, JSON.stringify(data), ...Object.values(extra ?? {})];
    const ph = cols.map(() => "?").join(",");
    const upd = cols.filter((c) => c !== "id" && c !== "user_id").map((c) => `${c} = excluded.${c}`).join(", ");
    this.db
      .prepare(`INSERT INTO ${t} (${cols.join(",")}) VALUES (${ph}) ON CONFLICT(id) DO UPDATE SET ${upd}`)
      .run(...vals);
  }

  getJson<T>(table: string, id: string): T | undefined {
    const keyCol = table === "settings" ? "user_id" : "id";
    const row = this.db.prepare(`SELECT data FROM ${this.table(table)} WHERE ${keyCol} = ?`).get(id) as any;
    return row ? (JSON.parse(row.data) as T) : undefined;
  }

  deleteJson(table: string, id: string) {
    const keyCol = table === "settings" ? "user_id" : "id";
    this.db.prepare(`DELETE FROM ${this.table(table)} WHERE ${keyCol} = ?`).run(id);
  }

  listJson<T>(table: string, userId: string, orderBy?: string): T[] {
    const order = orderBy ? ` ORDER BY ${orderBy}` : "";
    const rows = this.db.prepare(`SELECT data FROM ${this.table(table)} WHERE user_id = ?${order}`).all(userId) as any[];
    return rows.map((r) => JSON.parse(r.data) as T);
  }


  // ---------------- memories (typed helpers for the core port) -----
  listMemoriesForUser(userId: string): MemoryItem[] {
    return this.listJson<MemoryItem>("memories", userId);
  }

  // ---------------- unread counts ----------------
  /**
   * Number of assistant messages newer than the conversation's
   * lastReadAt. Used for the red badge in the conversation list.
   */
  unreadCount(userId: string, convoId: string, lastReadAt: number): number {
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS n FROM messages
         WHERE conversation_id = ? AND user_id = ? AND created_at > ?
           AND json_extract(data, '$.role') = 'assistant'`
      )
      .get(convoId, userId, lastReadAt) as any;
    return Number(row?.n ?? 0);
  }

  // ---------------- full-text search across messages ----------------
  /**
   * Search the user's whole message history.
   * Returns the matching messages (newest first) plus the conversation
   * they belong to, so the UI can show "message · chat" results.
   */
  searchMessages(
    userId: string,
    term: string,
    limit = 50
  ): Array<{ message: ChatMessage; conversationId: string; conversationTitle: string }> {
    const like = `%${term.toLowerCase()}%`;
    const rows = this.db
      .prepare(
        `SELECT data, conversation_id FROM messages
         WHERE user_id = ? AND lower(json_extract(data, '$.content')) LIKE ?
         ORDER BY created_at DESC LIMIT ?`
      )
      .all(userId, like, limit) as any[];
    const out: Array<{ message: ChatMessage; conversationId: string; conversationTitle: string }> = [];
    for (const r of rows) {
      const convo = this.getJson<Conversation>("conversations", r.conversation_id);
      out.push({
        message: JSON.parse(r.data) as ChatMessage,
        conversationId: r.conversation_id,
        conversationTitle: convo?.title ?? "",
      });
    }
    return out;
  }

  // ---------------- channel bindings ----------------
  getBinding(platform: string, channelUserId: string): { userId: string; agentId: string } | undefined {
    const row = this.db
      .prepare("SELECT user_id, agent_id FROM channel_bindings WHERE platform = ? AND channel_user_id = ?")
      .get(platform, channelUserId) as any;
    return row ? { userId: row.user_id, agentId: row.agent_id } : undefined;
  }

  putBinding(platform: string, channelUserId: string, userId: string, agentId: string) {
    this.db
      .prepare(
        `INSERT INTO channel_bindings (platform, channel_user_id, user_id, agent_id) VALUES (?,?,?,?)
         ON CONFLICT(platform, channel_user_id) DO UPDATE SET user_id = excluded.user_id, agent_id = excluded.agent_id`
      )
      .run(platform, channelUserId, userId, agentId);
  }

  deleteBinding(platform: string, channelUserId: string) {
    this.db.prepare("DELETE FROM channel_bindings WHERE platform = ? AND channel_user_id = ?").run(platform, channelUserId);
  }

  listBindings(userId: string): Array<{ platform: string; channelUserId: string; agentId: string }> {
    return (this.db
      .prepare("SELECT platform, channel_user_id, agent_id FROM channel_bindings WHERE user_id = ?")
      .all(userId) as any[]).map((r) => ({ platform: r.platform, channelUserId: r.channel_user_id, agentId: r.agent_id }));
  }

  // ---------------- meta ----------------
  getMeta(key: string): string | undefined {
    const row = this.db.prepare("SELECT value FROM hub_meta WHERE key = ?").get(key) as any;
    return row?.value;
  }

  setMeta(key: string, value: string) {
    this.db.prepare("INSERT INTO hub_meta (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, value);
  }
}

// ---------------------------------------------------------------
// core StoragePort over the hub database.
// Memory retrieval is per-user (multi-tenant isolation: an agent
// belongs to exactly one user, memories never cross accounts).
// ---------------------------------------------------------------
export function installStoragePort(db: HubDB, getUserId: () => string | null): void {
  const dbRaw = db.raw;
  const port: StoragePort = {
    async listMemories(agentId?: string): Promise<MemoryItem[]> {
      const uidv = getUserId();
      if (!uidv) return [];
      const all = db.listMemoriesForUser(uidv);
      return agentId ? all.filter((m) => m.agentId === agentId) : all;
    },
    async saveMemory(item: MemoryItem): Promise<void> {
      const uidv = getUserId();
      if (!uidv) throw new Error("not authenticated");
      db.putJson("memories", item.id, uidv, item, { agent_id: item.agentId, updated_at: item.updatedAt });
    },
    async touchMemories(ids: string[], at: number): Promise<void> {
      const uidv = getUserId();
      if (!uidv) return;
      const stmt = dbRaw.prepare("UPDATE memories SET data = json_set(data, '$.lastHitAt', ?, '$.hitCount', json_extract(data,'$.hitCount') + 1) WHERE user_id = ? AND id = ?");
      for (const id of ids) stmt.run(at, uidv, id);
    },
    async getConversation(id: string): Promise<Conversation | undefined> {
      return db.getJson<Conversation>("conversations", id);
    },
    async saveConversation(c: Conversation): Promise<void> {
      const uidv = getUserId();
      if (!uidv) throw new Error("not authenticated");
      db.putJson("conversations", c.id, uidv, c, { agent_id: c.agentId, updated_at: c.updatedAt });
    },
  };
  setStorage(port);
}

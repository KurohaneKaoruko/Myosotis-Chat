// ================================================================
// OneBot v11 channel manager — owns the adapter lifecycle and
// exposes runtime configuration (so the web UI can change the WS
// address without restarting the hub).
// ================================================================
import { createOnebotAdapter, type OnebotConfig } from "./adapter-onebot.ts";
import type { HubDB } from "./db.ts";
import type { Agent, ModelConfig, Provider, Settings } from "@myosotis/core";

export interface OnebotRuntimeConfig extends OnebotConfig {
  enabled: boolean;
}

export class ChannelManager {
  private adapter: ReturnType<typeof createOnebotAdapter> | null = null;
  private cfg: OnebotRuntimeConfig;
  private db: HubDB;
  private loadEntities: (userId: string, agentId: string) => {
    userId: string;
    agent: Agent;
    settings: Settings;
    models: ModelConfig[];
    providers: Provider[];
  } | null;

  constructor(
    db: HubDB,
    loadEntities: (userId: string, agentId: string) => {
      userId: string;
      agent: Agent;
      settings: Settings;
      models: ModelConfig[];
      providers: Provider[];
    } | null
  ) {
    this.db = db;
    this.loadEntities = loadEntities;
    this.cfg = {
      enabled: process.env.ONEBOT_ENABLED === "1",
      mode: (process.env.ONEBOT_MODE as "forward" | "reverse") ?? "reverse",
      url: process.env.ONEBOT_URL,
      token: process.env.ONEBOT_TOKEN,
      listenPort: Number(process.env.ONEBOT_LISTEN_PORT ?? 8081),
      accessToken: process.env.ONEBOT_ACCESS_TOKEN,
      streaming: process.env.ONEBOT_STREAMING !== "0",
    };
  }

  /** apply persisted runtime config (per-hub, admin level) */
  async init() {
    const saved = this.db.getMeta("onebot:config");
    if (saved) {
      try {
        this.cfg = { ...this.cfg, ...JSON.parse(saved) };
      } catch {}
    }
    if (this.cfg.enabled) this.start();
  }

  get config(): OnebotRuntimeConfig {
    return { ...this.cfg };
  }

  status() {
    return {
      ...this.cfg,
      running: !!this.adapter,
      connected: this.adapter?.isConnected() ?? false,
    };
  }

  async update(patch: Partial<OnebotRuntimeConfig>) {
    this.cfg = { ...this.cfg, ...patch };
    this.db.setMeta("onebot:config", JSON.stringify(this.cfg));
    this.restart();
    return this.status();
  }

  start() {
    if (this.adapter) return;
    this.adapter = createOnebotAdapter(this.db, this.cfg, { loadEntities: this.loadEntities });
    this.adapter.start();
  }

  stop() {
    this.adapter?.stop();
    this.adapter = null;
  }

  restart() {
    this.stop();
    if (this.cfg.enabled) this.start();
  }
}

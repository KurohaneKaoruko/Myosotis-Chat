// ================================================================
// Storage backend switch.
//
//   local  — original Dexie/IndexedDB, fully offline (default when
//            no hub is configured; also the Tauri mobile fallback)
//   remote — the Myosotis Hub server: auth + shared storage + SSE
//
// Both implement the same table surface, so store.ts never knows
// which one is active.
// ================================================================
import { db as localDB } from "./db-local";
import { exportAll as localExportAll, importAll as localImportAll } from "./db-local";
import { db as remoteDB } from "./db-remote";

export type DbMode = "local" | "remote";

const MODE_KEY = "myosotis.dbMode";

// ---------------------------------------------------------------
// Hub detection: when the page is served by a Myosotis hub (same
// origin exposes /api/health), remote mode is the default. Explicit
// user choice in localStorage always wins.
// ---------------------------------------------------------------
let hubProbed: boolean | null = null;

/** Is this page being served by a hub? (cached probe) */
export async function isHubHosted(): Promise<boolean> {
  if (hubProbed !== null) return hubProbed;
  if (location.protocol === "file:") return (hubProbed = false);
  const chosen = localStorage.getItem(MODE_KEY);
  if (chosen) return (hubProbed = chosen === "remote");
  try {
    const res = await fetch("/api/health", { headers: { accept: "application/json" } });
    const body = await res.json().catch(() => null);
    hubProbed = !!(res.ok && (body as any)?.name === "myosotis-hub");
  } catch {
    hubProbed = false;
  }
  return hubProbed;
}

export function getDbMode(): DbMode {
  const chosen = localStorage.getItem(MODE_KEY);
  if (chosen === "local" || chosen === "remote") return chosen;
  // not chosen yet: remote when hub-hosted was detected, else local
  return hubProbed === true ? "remote" : "local";
}

export function setDbMode(mode: DbMode) {
  localStorage.setItem(MODE_KEY, mode);
}

function active() {
  return getDbMode() === "remote" ? remoteDB : localDB;
}

// the app-wide `db` — a façade over whichever backend is active
export const db = new Proxy({} as typeof localDB, {
  get(_t, prop: string) {
    const target = active() as any;
    const v = target[prop];
    return typeof v === "function" ? v.bind(target) : v;
  },
});

/**
 * API base: same-origin by default (hub-hosted web app), or an explicit
 * hub URL when the desktop/mobile shell points at a remote server.
 */
export function apiBase(): string {
  const explicit = (window as any).__MYO_API_BASE__ || localStorage.getItem("myosotis.hubUrl") || "";
  return explicit.replace(/\/+$/, "");
}

// re-exports so existing imports keep working
export { localDB, remoteDB };
export async function exportAll(): Promise<Blob> {
  if (getDbMode() === "remote") {
    const data = await remoteDB.bootstrap();
    return new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  }
  return localExportAll();
}

export async function importAll(file: File): Promise<void> {
  if (getDbMode() === "remote") {
    const data = JSON.parse(await file.text());
    // restore every collection through the remote tables
    const { providers, models, agents, prompts, scenarios, conversations, memories } = data;
    await Promise.all([
      remoteDB.providers.bulkAdd(providers ?? []),
      remoteDB.models.bulkAdd(models ?? []),
      remoteDB.agents.bulkAdd(agents ?? []),
      remoteDB.prompts.bulkAdd(prompts ?? []),
      remoteDB.scenarios.bulkAdd(scenarios ?? []),
      remoteDB.conversations.bulkAdd(conversations ?? []),
      remoteDB.memories.bulkAdd(memories ?? []),
    ]);
    return;
  }
  return localImportAll(file);
}

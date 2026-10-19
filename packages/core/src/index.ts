// ============================================================
// @myosotis/core — shared kernel used by every host
// (web app, hub server, desktop shell, channel adapters).
// Pure TypeScript: no DOM, no Dexie, no node built-ins.
// Hosts install their storage/i18n ports at boot.
// ============================================================
export * from "./types.ts";
export * from "./ports.ts";
export * from "./utils.ts";
export * from "./model-client.ts";
export * from "./memory.ts";
export * from "./group.ts";

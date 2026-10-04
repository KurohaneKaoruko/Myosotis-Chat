// Minimal WebDAV client: just what backups need (PUT / GET / PROPFIND / MKCOL).
// No third-party dependency; works against common servers (坚果云, Nextcloud, InfiniCloud...).

import type { Provider } from "../types";
import { trimUrl } from "./utils";
import { t, tf } from "../i18n";

export interface WebDavConfig {
  url: string; // e.g. https://dav.jianguoyun.com/dav/
  username: string;
  password: string; // app-specific password
  directory: string; // e.g. /Myosotis
}

export class WebDavError extends Error {
  status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.status = status;
  }
}

function authHeader(cfg: WebDavConfig): Record<string, string> {
  return { Authorization: "Basic " + btoa(`${cfg.username}:${cfg.password}`) };
}

function fullUrl(cfg: WebDavConfig, path: string): string {
  const base = trimUrl(cfg.url);
  const dir = cfg.directory ? "/" + cfg.directory.replace(/^\/+|\/+$/g, "") : "";
  const p = path.startsWith("/") ? path : "/" + path;
  const raw = `${base}${dir}${p}`;
  // collapse duplicate slashes in the path only — never touch "https://"
  return raw.replace(/^(https?:)\/{2,}/i, "$1//").replace(/([^:/])\/{2,}/g, "$1/");
}

export async function davMkdir(cfg: WebDavConfig, dir: string): Promise<void> {
  // 405 = already exists, which is fine
  try {
    const res = await fetch(fullUrl(cfg, dir), {
      method: "MKCOL",
      headers: authHeader(cfg),
    });
    if (!res.ok && res.status !== 405) {
      throw new WebDavError(tf("davMkcolFail", { s: res.status }), res.status);
    }
  } catch (e) {
    if (e instanceof WebDavError) throw e;
    throw new WebDavError(t("davConnFail"));
  }
}

export async function davPut(cfg: WebDavConfig, path: string, content: string): Promise<void> {
  const res = await fetch(fullUrl(cfg, path), {
    method: "PUT",
    headers: { ...authHeader(cfg), "Content-Type": "application/json" },
    body: content,
  });
  if (!res.ok) {
    throw new WebDavError(tf("davUploadFail", { s: res.status }), res.status);
  }
}

export async function davGet(cfg: WebDavConfig, path: string): Promise<string> {
  const res = await fetch(fullUrl(cfg, path), {
    method: "GET",
    headers: authHeader(cfg),
  });
  if (res.status === 404) throw new WebDavError(t("davNotFound"), 404);
  if (!res.ok) throw new WebDavError(tf("davDownloadFail", { s: res.status }), res.status);
  return res.text();
}

export interface DavEntry {
  name: string;
  modifiedAt: Date | null;
}

export interface DavEntry {
  name: string;
  modifiedAt: Date | null;
}

/**
 * Regex-based PROPFIND parser: avoids DOMParser (unavailable in node/non-DOM
 * environments) and tolerates different namespace prefixes used by servers
 * (<d:response>, <D:response>, <response>...).
 */
export function parsePropfind(xml: string): DavEntry[] {
  const entries: DavEntry[] = [];
  const responseRe = /<(?:[\w-]+:)?response\b[\s\S]*?<\/(?:[\w-]+:)?response>/g;
  for (const match of xml.matchAll(responseRe)) {
    const block = match[0];
    if (/<(?:[\w-]+:)?collection\s*\/?>/.test(block)) continue; // skip directories
    const get = (tag: string): string => {
      const m = new RegExp(`<(?:[\\w-]+:)?${tag}[^>]*>([\\s\\S]*?)</(?:[\\w-]+:)?${tag}>`).exec(block);
      return m ? m[1].trim() : "";
    };
    let name = get("displayname");
    if (!name) {
      const href = get("href");
      name = decodeURIComponent(href).replace(/\/+$/, "").split("/").pop() ?? "";
    }
    if (!name) continue;
    const modified = get("getlastmodified");
    entries.push({ name, modifiedAt: modified ? new Date(modified) : null });
  }
  return entries;
}

export async function davList(cfg: WebDavConfig, dir: string): Promise<DavEntry[]> {
  const res = await fetch(fullUrl(cfg, dir), {
    method: "PROPFIND",
    headers: { ...authHeader(cfg), Depth: "1", "Content-Type": "application/xml" },
    body: `<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:displayname/><d:getlastmodified/><d:resourcetype/></d:prop></d:propfind>`,
  });
  if (!res.ok) {
    throw new WebDavError(tf("davListFail", { s: res.status }), res.status);
  }
  const xml = await res.text();
  return parsePropfind(xml).filter((e) => e.name.endsWith(".json"));
}

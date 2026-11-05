// ================================================================
// Image uploads.
//
// Local mode keeps data URLs in IndexedDB (fully offline).
// Hub mode uploads the bytes once and keeps only the URL in the
// message — the database stays small and pages load faster.
//
// Hub URLs (/uploads/…) are signed: every GET needs ?exp=&sig=…,
// so the client batch-signs a page of paths once (one request) and
// caches the results. Unsigned bare paths from old messages still
// render — they go through the same sign endpoint at render time.
// ================================================================
import { apiBase } from "./db";

/** data URL → hub URL (identity for local mode) */
export async function uploadImage(dataUrl: string): Promise<string> {
  if (!dataUrl.startsWith("data:")) return dataUrl;
  const base = apiBase();
  if (!base) return dataUrl; // local mode: keep the data URL

  const res = await fetch(`${base}/api/upload`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ data: dataUrl }),
  });
  if (!res.ok) throw new Error(`upload failed (${res.status})`);
  const body = await res.json();
  if (!body?.url) throw new Error("upload failed");
  // keep the relative path in the message (portable across hosts);
  // it is resolved to a signed absolute URL at render time
  return body.path ?? body.url;
}

// ----------------------------------------------------------------
// signed URL resolution
// ----------------------------------------------------------------

const UPLOAD_PREFIX = "/uploads/";
/** signed URLs are refreshed two days before they actually expire */
const REFRESH_SLACK_DAYS = 2;

/** path (or absolute URL) → bare file name, or null when not an upload */
function uploadName(src: string): string | null {
  const at = src.lastIndexOf(UPLOAD_PREFIX);
  if (at < 0) return null;
  const name = src.slice(at + UPLOAD_PREFIX.length).split(/[?#]/)[0];
  return /^[a-f0-9]{8,64}\.(png|jpe?g|webp|gif|bmp|avif)$/i.test(name) ? name : null;
}

/** signedUrl → { path, expiresAt(ms) } */
function parseSigned(signedUrl: string): { path: string; expiresAt: number } | null {
  const q = signedUrl.indexOf("?");
  if (q < 0) return null;
  const path = signedUrl.slice(0, q);
  const params = new URLSearchParams(signedUrl.slice(q + 1));
  const exp = Number(params.get("exp"));
  return Number.isFinite(exp) ? { path, expiresAt: exp * 1000 } : null;
}

// one cache per hub origin; survives route changes inside the session
const signedCache = new Map<string, { url: string; expiresAt: number }>();
// in-flight batch requests keyed by hub origin, so concurrent renders
// of one page coalesce into a single /api/uploads/sign call
let inFlight: Promise<void> | null = null;
let inFlightBase = "";

async function signBatch(base: string, paths: string[]): Promise<void> {
  const res = await fetch(`${base}/api/uploads/sign`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ paths }),
  });
  if (!res.ok) throw new Error(`sign failed (${res.status})`);
  const body = await res.json();
  const signed = (body?.signed ?? {}) as Record<string, string>;
  for (const [path, url] of Object.entries(signed)) {
    const parsed = parseSigned(url);
    if (parsed) signedCache.set(path, { url, expiresAt: parsed.expiresAt });
  }
}

/** bare /uploads/<name> path from any stored form (relative or absolute) */
function canonicalPath(src: string): string | null {
  const name = uploadName(src);
  if (!name) return null;
  return UPLOAD_PREFIX + name;
}

/**
 * Sync lookup used at render time: returns the signed absolute URL when
 * a fresh signature is cached, null when one needs to be fetched (or
 * signing failed — the caller hides the image instead of erroring).
 */
export function signedImageUrlSync(src: string): string | null {
  const path = canonicalPath(src);
  if (!path) return null; // not a hub upload (data URL etc.) — caller uses src as-is
  const hit = signedCache.get(path);
  if (hit && hit.expiresAt - Date.now() > REFRESH_SLACK_DAYS * 86400_000) {
    return absolutize(hit.url);
  }
  return null;
}

function absolutize(url: string): string {
  const base = apiBase();
  return base ? base + url : url;
}

/**
 * Collect every bare /uploads/ path in a page of messages, ask the hub
 * to sign them in one request, warm the cache. Safe to call
 * redundantly — it coalesces concurrent calls and skips cached paths.
 */
export async function ensureSignedImages(messages: Array<{ images?: string[] } | undefined>): Promise<void> {
  const base = apiBase();
  if (!base) return; // local mode: images are data URLs, nothing to sign
  const wanted = new Set<string>();
  for (const m of messages ?? []) {
    for (const img of m?.images ?? []) {
      const path = canonicalPath(img);
      if (!path) continue;
      const hit = signedCache.get(path);
      if (!hit || hit.expiresAt - Date.now() <= REFRESH_SLACK_DAYS * 86400_000) wanted.add(path);
    }
  }
  if (!wanted.size) return;
  // coalesce: while one batch is in flight, later callers wait on it
  // and re-check the cache instead of firing a second request
  if (inFlight && inFlightBase === base) {
    await inFlight.catch(() => {});
    if (!wanted.size) return;
  }
  const paths = [...wanted];
  inFlightBase = base;
  inFlight = signBatch(base, paths);
  try {
    await inFlight;
  } catch {
    // network/auth hiccup: images render unsigned on the next successful pass
  } finally {
    inFlight = null;
    inFlightBase = "";
  }
}

/** upload every image of a message; returns the message with URLs */
export async function uploadImages(images: string[] | undefined): Promise<string[] | undefined> {
  if (!images?.length) return images;
  const out: string[] = [];
  for (const img of images) {
    try {
      out.push(await uploadImage(img));
    } catch {
      out.push(img); // keep the original so the message still sends
    }
  }
  return out;
}

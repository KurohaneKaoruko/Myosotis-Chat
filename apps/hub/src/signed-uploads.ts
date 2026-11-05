// ================================================================
// Signed upload URLs.
//
// /uploads/ files used to be fully public: the names are 128-bit
// content hashes (not guessable), but real URLs leak through message
// sync, browser history and Referer headers. Every request now needs
// an HMAC signature over (name|exp) with a per-install secret:
//
//   /uploads/<name>?exp=<unix-seconds>&sig=<hex>
//
// The secret lives in hub_meta (generated on first use, never sent to
// clients). Legitimate clients obtain signed URLs per page of messages
// via POST /api/uploads/sign — the endpoint only signs paths that
// actually appear in the signed-in tenant's messages, so a signed-in
// account cannot mint URLs for arbitrary hashes.
//
// Signed responses are content-addressed (immutable files) so they
// may be public-cached aggressively; unsigned requests are 403 +
// no-store so the denial itself is never cached by intermediaries.
// ================================================================
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { HubDB } from "./db.ts";

export const SIGN_META_KEY = "upload_signing_key";
/** signed URLs live 30 days; the client cache refreshes them earlier */
export const SIGN_TTL_DAYS = 30;
/** safety cap for one batch-sign call (a page of messages never has more) */
export const SIGN_MAX_BATCH = 200;

/** the canonical on-disk name: content hash + short extension */
export const UPLOAD_NAME_RE = /^[a-f0-9]{8,64}\.(png|jpe?g|webp|gif|bmp|avif)$/i;

/** the public path prefix as stored inside message JSON */
export const UPLOAD_PATH_PREFIX = "/uploads/";

let cachedKey: Buffer | null = null;

/**
 * The per-install HMAC key: created once, persisted in hub_meta,
 * reused forever (rotating it would invalidate every cached URL at
 * once — acceptable on rotation, so no auto-rotation).
 */
export function signingKey(db: HubDB): Buffer {
  if (cachedKey) return cachedKey;
  let key = db.getMeta(SIGN_META_KEY);
  if (!key || !/^[0-9a-f]{32,128}$/i.test(key)) {
    key = randomBytes(32).toString("hex");
    db.setMeta(SIGN_META_KEY, key);
  }
  cachedKey = Buffer.from(key, "hex");
  return cachedKey;
}

/** hex HMAC-SHA256 over "name|exp" (exp in unix seconds) */
export function signName(name: string, exp: number, key: Buffer): string {
  return createHmac("sha256", key).update(`${name}|${exp}`).digest("hex");
}

/** constant-time comparison of the presented signature */
export function signatureValid(name: string, exp: number, sig: string, key: Buffer): boolean {
  const expected = Buffer.from(signName(name, exp, key), "hex");
  const presented = Buffer.from(sig, "hex");
  if (presented.length !== expected.length) return false;
  return timingSafeEqual(presented, expected);
}

/** build one signed public URL ("/uploads/<name>?exp=…&sig=…") */
export function signUploadPath(path: string, key: Buffer, nowMs = Date.now()): string {
  const name = path.slice(UPLOAD_PATH_PREFIX.length);
  const exp = Math.floor(nowMs / 1000) + SIGN_TTL_DAYS * 86400;
  return `${UPLOAD_PATH_PREFIX}${name}?exp=${exp}&sig=${signName(name, exp, key)}`;
}

/**
 * Sign a batch of paths for one tenant. Every path must be a
 * well-formed /uploads/ name AND occur in at least one of that
 * user's messages — signing is an ownership check, not an oracle
 * for brute-forcing hashes one guess at a time.
 *
 * Returns a map { requestedPath → signedUrl }; unknown/foreign paths
 * are simply absent from the map (the client falls back to hiding
 * the image rather than erroring the whole page).
 */
export function signUploadPathsForUser(
  db: HubDB,
  userId: string,
  paths: string[]
): { signed: Record<string, string>; ttlDays: number } {
  const key = signingKey(db);
  const signed: Record<string, string> = {};
  for (const p of new Set(paths.slice(0, SIGN_MAX_BATCH))) {
    if (typeof p !== "string" || !p.startsWith(UPLOAD_PATH_PREFIX)) continue;
    const name = p.slice(UPLOAD_PATH_PREFIX.length);
    if (!UPLOAD_NAME_RE.test(name)) continue;
    // ownership: the file name must appear in one of this tenant's
    // messages. Message JSON stores the full path in quotes
    // ("/uploads/<name>" — or the absolute OneBot variant), so the
    // name always sits right before a closing quote; match `name"`.
    const row = db.raw
      .prepare(
        `SELECT COUNT(*) AS n FROM messages
         WHERE user_id = ? AND json_extract(data, '$.images') LIKE ?`
      )
      .get(userId, `%${name}"%`) as { n: number | bigint };
    if (!Number(row.n)) continue;
    signed[p] = signUploadPath(p, key);
  }
  return { signed, ttlDays: SIGN_TTL_DAYS };
}

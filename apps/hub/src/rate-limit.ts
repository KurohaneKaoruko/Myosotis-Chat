// ================================================================
// Login rate limiting — in-process sliding window, keyed by username
// and by client IP independently. No new storage dependency: a Map
// with lazy expiry is enough (single-process hub; a restart resets
// state, which is acceptable for a login gate — scrypt stays the real
// defence).
//
// Design:
//   • Only FAILED attempts consume budget. Successful logins clear
//     the username streak, so a real user (or a household behind one
//     NAT re-logging in on five devices) can never lock themselves
//     out; brute force is defined by failures, not traffic.
//   • username key: MYO_LOGIN_RATE_MAX failures per window (default
//     5/min) — the online brute-force path against one account.
//   • ip key: a wider budget (default ×4) — caps username spray while
//     tolerating shared egress IPs.
//   • Lockout: when a key's budget runs out it enters a backoff box
//     and EVERY attempt is refused — including the correct password —
//     until the backoff expires. Backoff doubles per continued
//     offence: 30s → 1m → 2m … capped at 15m.
//   • Sliding window (timestamp ring), not fixed buckets: no "wait for
//     the minute to flip" artefact.
//   • Expired locks and stale windows clear lazily; a periodic sweep
//     drops idle entries so the maps cannot grow unbounded.
//   • The clock is injectable and the knobs are env-tunable so tests
//     can shrink windows instead of sleeping through real ones.
// ================================================================
import type { FastifyRequest } from "fastify";

export interface LoginRateLimitOptions {
  /** failed attempts per username inside the window (default 5) */
  maxPerUser?: number;
  /** multiplier for the per-IP failure budget (default 4 → 20) */
  ipMultiplier?: number;
  /** sliding window size in ms (default 60_000) */
  windowMs?: number;
  /** first lockout duration in ms (default 30_000) */
  lockoutMs?: number;
  /** backoff cap in ms (default 15 * 60_000) */
  maxLockoutMs?: number;
  /** injectable clock — Date.now by default */
  now?: () => number;
  /** kill switch (MYO_LOGIN_RATE_LIMIT=0) */
  disabled?: boolean;
}

interface KeyState {
  /** timestamps of failed attempts still inside the window */
  hits: number[];
  /** absolute time until which every attempt is refused; 0 = open */
  lockedUntil: number;
  /** duration of the most recent lock — doubled on the next offence */
  lockMs: number;
}

const SWEEP_EVERY = 128;

export class LoginRateLimiter {
  private users = new Map<string, KeyState>();
  private ips = new Map<string, KeyState>();
  private readonly opts;
  private calls = 0;

  constructor(options: LoginRateLimitOptions = {}) {
    this.opts = {
      maxPerUser: options.maxPerUser ?? 5,
      ipMultiplier: options.ipMultiplier ?? 4,
      windowMs: options.windowMs ?? 60_000,
      lockoutMs: options.lockoutMs ?? 30_000,
      maxLockoutMs: options.maxLockoutMs ?? 15 * 60_000,
      now: options.now ?? (() => Date.now()),
      disabled: options.disabled ?? false,
    };
  }

  /** test/integration hook: forget all state */
  reset() {
    this.users.clear();
    this.ips.clear();
  }

  /**
   * Gateway before the handler. Returns null when the attempt may
   * proceed; when locked returns the seconds the client should wait
   * (Retry-After). Never records anything — that is fail()/success().
   */
  check(username: string, ip: string): { retryAfterSec: number } | null {
    if (this.opts.disabled) return null;
    const t = this.opts.now();
    const user = this.state(this.users, this.key(username));
    const ipState = this.state(this.ips, ip);

    this.expire(user, t);
    this.expire(ipState, t);

    const lockedUntil = Math.max(user.lockedUntil, ipState.lockedUntil);
    if (lockedUntil > t) {
      return { retryAfterSec: Math.max(1, Math.ceil((lockedUntil - t) / 1000)) };
    }

    if (++this.calls % SWEEP_EVERY === 0) this.sweep(t);
    return null;
  }

  /** record a failed attempt; engages the backoff box when over budget */
  fail(username: string, ip: string): void {
    if (this.opts.disabled) return;
    const t = this.opts.now();
    const user = this.state(this.users, this.key(username));
    const ipState = this.state(this.ips, ip);
    this.expire(user, t);
    this.expire(ipState, t);
    // locked keys refuse at check() before the handler runs — nothing
    // to record here, and re-locking inside a lockout would silently
    // extend the backoff without any real attempt getting through
    if (user.lockedUntil > t || ipState.lockedUntil > t) return;
    user.hits.push(t);
    ipState.hits.push(t);
    this.prune(user);
    this.prune(ipState);

    if (user.hits.length >= this.opts.maxPerUser) this.lock(user);
    if (ipState.hits.length >= this.opts.maxPerUser * this.opts.ipMultiplier) this.lock(ipState);
  }

  /** record a successful login: the account owner is back — clear their streak */
  success(username: string, _ip: string): void {
    if (this.opts.disabled) return;
    this.users.delete(this.key(username));
    // the ip entry recovers through the window; deleting it here would
    // let one valid account reset an attacker's spray budget
  }

  private key(username: string): string {
    return username.trim().slice(0, 64).toLowerCase();
  }

  private state(map: Map<string, KeyState>, key: string): KeyState {
    let s = map.get(key);
    if (!s) {
      s = { hits: [], lockedUntil: 0, lockMs: 0 };
      map.set(key, s);
    }
    return s;
  }

  /** an expired lock reopens the key; the window resumes sliding */
  private expire(s: KeyState, t: number) {
    if (s.lockedUntil > 0 && s.lockedUntil <= t) s.lockedUntil = 0;
  }

  private prune(s: KeyState) {
    if (s.lockedUntil > 0) return; // inside backoff: window frozen
    const cut = this.opts.now() - this.opts.windowMs;
    while (s.hits.length && s.hits[0] <= cut) s.hits.shift();
  }

  private lock(s: KeyState) {
    const t = this.opts.now();
    s.lockMs = Math.min(s.lockMs ? s.lockMs * 2 : this.opts.lockoutMs, this.opts.maxLockoutMs);
    s.lockedUntil = t + s.lockMs;
  }

  /** drop entries idle beyond window + backoff cap so maps stay bounded */
  private sweep(now: number) {
    const idle = this.opts.windowMs + this.opts.maxLockoutMs;
    for (const [k, s] of this.users) {
      if (s.lockedUntil <= now && now - (s.hits.at(-1) ?? 0) > idle) this.users.delete(k);
    }
    for (const [k, s] of this.ips) {
      if (s.lockedUntil <= now && now - (s.hits.at(-1) ?? 0) > idle) this.ips.delete(k);
    }
  }
}

/** best-effort client IP — Fastify resolves X-Forwarded-For per trustProxy */
export function clientIp(req: FastifyRequest): string {
  return (req as any).ip ?? "unknown";
}

/**
 * Fastify preHandler: refuses locked keys with 429 + Retry-After
 * before the login handler ever runs. Mount on /api/auth/login only.
 */
export function loginRateLimitHook(limiter: LoginRateLimiter) {
  return async (req: any, res: any) => {
    const body = req.body ?? {};
    const username = typeof body.username === "string" ? body.username : "";
    const verdict = limiter.check(username, clientIp(req));
    if (verdict) {
      res.header("Retry-After", String(verdict.retryAfterSec));
      return res.status(429).send({ error: "rate-limited", retryAfter: verdict.retryAfterSec });
    }
  };
}

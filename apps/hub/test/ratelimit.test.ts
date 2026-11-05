// Rate limit regression test: /api/auth/login must throttle brute
// force, keyed by username AND ip, without locking out legitimate
// users or the rest of the test suite.
//
//   • negative path: after 5 failures the CORRECT password is refused
//     with 429 + Retry-After (lockout is account-level, not secret-level)
//   • positive path: once the lockout expires login recovers — exercised
//     against a dedicated limiter with an injectable clock, so no sleeping
//   • success clears the username streak (real users never trip this)
//
// The HTTP part uses a throwaway account so other suites sharing the
// hub stay untouched; unit part is pure in-process.
//
//   node --experimental-strip-types test/ratelimit.test.ts
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { API, login } from "./fixtures.ts";
import { LoginRateLimiter } from "../src/rate-limit.ts";
import { hashPassword } from "../src/auth.ts";

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean, detail = "") {
  if (cond) {
    pass++;
    console.log(`  ✅ ${name}`);
  } else {
    fail++;
    console.log(`  ❌ ${name} ${detail}`);
  }
}

async function postLogin(body: Record<string, unknown>) {
  return fetch(`${API}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** create a dedicated account so suite-shared usernames never hit the limiter */
function createTestUser(username: string, password: string): boolean {
  const dataDir = process.env.MYO_DATA_DIR;
  if (!dataDir) return false;
  const db = new DatabaseSync(path.join(dataDir, "hub.db"));
  try {
    db.prepare(
      "INSERT OR IGNORE INTO users (id, username, password_hash, totp_secret, created_at) VALUES (?,?,?,?,?)"
    ).run(`usr_${username}`, username, hashPassword(password), null, Date.now());
  } finally {
    db.close();
  }
  return true;
}

// ----------------------------------------------------------------
// unit: the limiter itself, clock injected — no real waiting
// ----------------------------------------------------------------
function unitTests() {
  console.log("== 1. limiter unit (injectable clock) ==");

  let t = 1_000_000;
  const clock = () => t;
  const rl = new LoginRateLimiter({ now: clock });

  // negative path: budget 5/min → the 5th failure engages the lock,
  // the 6th attempt is refused EVEN WITH THE CORRECT PASSWORD (the
  // hub checks the lock before verifyPassword)
  for (let i = 0; i < 5; i++) {
    rl.check("alice", "10.0.0.1");
    rl.fail("alice", "10.0.0.1");
  }
  const locked = rl.check("alice", "10.0.0.1");
  ok("locked once budget exhausted", !!locked, JSON.stringify(locked));
  ok("retry-after within lockout bounds", !!locked && locked.retryAfterSec > 0 && locked.retryAfterSec <= 30, JSON.stringify(locked));

  // lockout refuses even the correct password — the hub calls check()
  // before verifyPassword, so this is exactly the negative path
  ok("lock refuses all attempts (correct password too)", !!rl.check("alice", "10.0.0.1"));

  // positive path: walk the clock past the 30s backoff → recovered
  t += 30_001;
  ok("window slides after lockout expiry", rl.check("alice", "10.0.0.1") === null);

  // backoff doubling: after the first lockout expires, exhausting the
  // budget again must engage a doubled (60s) lock
  for (let i = 0; i < 6; i++) {
    if (rl.check("alice", "10.0.0.1")) break;
    rl.fail("alice", "10.0.0.1");
  }
  const locked2 = rl.check("alice", "10.0.0.1");
  ok("second lockout doubles to 60s", !!locked2 && locked2.retryAfterSec > 30 && locked2.retryAfterSec <= 60, JSON.stringify(locked2));
  t += 60_001;
  ok("recovers after doubled lockout", rl.check("alice", "10.0.0.1") === null);

  // sliding window: 4 failures at T, at T+90s the first four have slid
  // out of the 60s window — 4 fresh failures never reach the budget
  const rl2 = new LoginRateLimiter({ now: clock, lockoutMs: 60_000 });
  for (let i = 0; i < 4; i++) {
    rl2.check("bob", "10.0.0.2");
    rl2.fail("bob", "10.0.0.2");
  }
  t += 90_000;
  for (let i = 0; i < 4; i++) {
    const v = rl2.check("bob", "10.0.0.2");
    if (v) break;
    rl2.fail("bob", "10.0.0.2");
  }
  ok("sliding window forgets expired failures", rl2.check("bob", "10.0.0.2") === null);

  // success clears the username streak
  const rl3 = new LoginRateLimiter({ now: clock });
  for (let i = 0; i < 4; i++) {
    rl3.fail("carol", "10.0.0.3");
  }
  rl3.success("carol", "10.0.0.3");
  for (let i = 0; i < 4; i++) rl3.fail("carol", "10.0.0.3");
  ok("successful login resets the failure streak", rl3.check("carol", "10.0.0.3") === null);

  // keys are independent: the IP budget locking does not touch other
  // users behind the same IP…
  const rl4 = new LoginRateLimiter({ now: clock });
  for (let i = 0; i < 6; i++) rl4.fail("dave", "10.0.0.4");
  ok("locked user does not spill to another user", rl4.check("erin", "10.0.0.4") === null);
  // …but the SAME account from another IP must stay locked — that is
  // the whole point: rotating IPs must not bypass an account lockout
  ok("locked account stays locked from another ip", !!rl4.check("dave", "10.0.0.5"));
  ok("uninvolved user on that other ip is fine", rl4.check("grace", "10.0.0.5") === null);

  // disabled kill switch
  const rlOff = new LoginRateLimiter({ now: clock, disabled: true });
  for (let i = 0; i < 50; i++) rlOff.fail("frank", "10.0.0.6");
  ok("disabled limiter never locks", rlOff.check("frank", "10.0.0.6") === null);
}

// ----------------------------------------------------------------
// http: real endpoint, throwaway account
// ----------------------------------------------------------------
async function httpTests() {
  console.log("== 2. http endpoint (throwaway account) ==");

  const { cookie } = await login(); // suite's own account must stay clean
  if (!cookie) throw new Error("login failed");

  const user = `rl-${Date.now().toString(36)}`;
  const password = "test12345";
  if (!createTestUser(user, password)) {
    console.log("  ⏭ skipped (manual hub mode, cannot insert user)");
    return;
  }

  // burn the budget on wrong passwords
  let saw429 = false;
  let retryAfter = "";
  for (let i = 0; i < 8; i++) {
    const res = await postLogin({ username: user, password: "nope" });
    if (res.status === 429) {
      saw429 = true;
      retryAfter = res.headers.get("retry-after") ?? "";
      break;
    }
  }
  ok("wrong-password flood eventually hits 429", saw429);
  ok("429 carries numeric Retry-After header", /^\d+$/.test(retryAfter), retryAfter);

  // negative path: the CORRECT password is refused while locked
  const goodWhileLocked = await postLogin({ username: user, password });
  ok("correct password refused while locked (429)", goodWhileLocked.status === 429);
  const body = await goodWhileLocked.json().catch(() => ({} as any));
  ok("429 body carries rate-limited error code", body.error === "rate-limited", JSON.stringify(body));

  // the flood must not have touched other accounts: main login works
  const again = await login();
  ok("other accounts unaffected (per-key, not global)", !!again.cookie);

  // suite hygiene: the throwaway account stays locked (window is the
  // real 60s one here), but that never blocks other suites — they use
  // different usernames, and the limiter keys per username.
}

unitTests();
await httpTests();

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

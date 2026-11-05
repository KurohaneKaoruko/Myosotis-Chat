import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { createHmac } from "node:crypto";
import { API, MOCK_API, login, api, seedBasics, resetLog, chatPrompt } from "./fixtures.ts";
import { hashPassword } from "../src/auth.ts";

// Verifies the image pipeline: upload → message stores only the URL →
// the file is served back through a signed URL. Also checks
// content-addressed dedupe and the signature guard rails (expiry,
// tampering, cross-tenant, not-in-any-message).

// 1×1 red PNG
const PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

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

/** direct-DB user insert (mirrors guards/isolation suites) */
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

async function main() {
  const { cookie } = await login();
  if (!cookie) throw new Error("login failed");
  await seedBasics(cookie);

  // upload
  const up = await api(cookie, "/api/upload", { method: "POST", body: JSON.stringify({ data: PNG }) });
  console.log("[test] upload →", JSON.stringify(up));
  if (!up.url) throw new Error("upload failed");

  // dedupe: same bytes → same url
  const up2 = await api(cookie, "/api/upload", { method: "POST", body: JSON.stringify({ data: PNG }) });
  ok("identical images dedupe", up2.url === up.url, `${up.url} vs ${up2.url}`);

  // unsigned access is now refused (this is the whole point)
  const bare = await fetch(API + up.path);
  ok("bare /uploads/ path refused", bare.status === 403, `got ${bare.status}`);
  ok("403 response is no-store", (bare.headers.get("cache-control") ?? "").includes("no-store"));

  // signing only works for paths that appear in one of my messages —
  // a freshly uploaded file is not in any message yet
  const early = await api(cookie, "/api/uploads/sign", {
    method: "POST",
    body: JSON.stringify({ paths: [up.path] }),
  });
  ok("not-in-any-message path is not signed", !early.signed?.[up.path], JSON.stringify(early));

  // a message with the image stores only the URL
  const convo = await api(cookie, "/api/conversations", {
    method: "POST",
    body: JSON.stringify({ agentId: "ag1", title: "图片消息" }),
  });
  resetLog();
  const chat = await fetch(`${API}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ conversationId: convo.id, text: "看图", images: [up.path] }),
  });
  await chat.text();
  const messages = await api(cookie, `/api/conversations/${convo.id}/messages`);
  const withImage = messages.find((m: any) => m.images?.length);
  const stored = withImage?.images?.[0] ?? "";
  ok("message stores the URL", stored.startsWith("/uploads/"), stored.slice(0, 40));
  ok("no base64 left in the message", !stored.startsWith("data:"));

  // batch-sign: the referenced path (and nothing else) comes back signed
  const signRes = await fetch(`${API}/api/uploads/sign`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ paths: [up.path, "/uploads/deadbeefdeadbeefdeadbeefdeadbeef.png", "/etc/passwd"] }),
  });
  const sign = await signRes.json();
  ok("sign endpoint 200", signRes.status === 200, `got ${signRes.status}`);
  const signedUrl = sign.signed?.[up.path];
  ok("referenced path signed", typeof signedUrl === "string" && signedUrl.includes("exp=") && signedUrl.includes("sig="), JSON.stringify(sign));
  ok("unknown hash not signed", !sign.signed?.["/uploads/deadbeefdeadbeefdeadbeefdeadbeef.png"]);
  ok("non-uploads path not signed", !sign.signed?.["/etc/passwd"]);
  ok("ttl reported (30d)", sign.ttlDays === 30, JSON.stringify(sign.ttlDays));

  // signed access works, and is cacheable
  const res = await fetch(API + signedUrl);
  const buf = Buffer.from(await res.arrayBuffer());
  ok("signed image served", res.status === 200 && buf.length > 0, `${res.status}, ${buf.length} bytes`);
  ok("content-type is the image", res.headers.get("content-type") === "image/png", res.headers.get("content-type") ?? "");
  const cc = res.headers.get("cache-control") ?? "";
  ok("signed response public long-cache", cc.includes("public") && cc.includes("immutable"), cc);

  // tampered signature → 403
  const tampered = signedUrl.replace(/sig=[0-9a-f]{8}/, (m) => `${m.slice(0, 4)}00000000`);
  const bad = await fetch(API + tampered);
  ok("tampered signature 403", bad.status === 403, `got ${bad.status}`);

  // expired signature → 403 (craft a valid sig over a stale exp)
  const name = up.path.slice("/uploads/".length);
  const staleExp = Math.floor(Date.now() / 1000) - 10;
  // read the signing key straight out of the test hub's DB to prove
  // expiry (not signature validity) is what rejects this URL
  const dataDir = process.env.MYO_DATA_DIR;
  let staleUrl = "";
  if (dataDir) {
    const sdb = new DatabaseSync(path.join(dataDir, "hub.db"));
    try {
      const keyValue = (sdb.prepare("SELECT value FROM hub_meta WHERE key = ?").get("upload_signing_key") as any)?.value;
      if (keyValue) {
        const staleSig = createHmac("sha256", Buffer.from(keyValue, "hex")).update(`${name}|${staleExp}`).digest("hex");
        staleUrl = `${up.path}?exp=${staleExp}&sig=${staleSig}`;
      }
    } finally {
      sdb.close();
    }
  }
  if (staleUrl) {
    const stale = await fetch(API + staleUrl);
    ok("expired signature 403", stale.status === 403, `got ${stale.status}`);
  } else {
    // manual hub (no MYO_DATA_DIR): lie about exp with a garbage sig —
    // still 403, just not proving the *expiry* branch specifically
    const stale = await fetch(API + `${up.path}?exp=${staleExp}&sig=${"ab".repeat(32)}`);
    ok("stale exp with bad sig 403", stale.status === 403, `got ${stale.status}`);
    console.log("  ⚠️  no MYO_DATA_DIR — expiry checked via bad-sig only");
  }

  // path traversal is refused (format check happens before file lookup)
  const trav = await fetch(`${API}/uploads/..%2F..%2Fhub.db`);
  ok("path traversal refused", trav.status === 403 || trav.status === 404, `got ${trav.status}`);

  // cross-tenant: another account cannot sign my paths
  const credsB = { username: `upload-other-${Date.now().toString(36)}`, password: "test12345" };
  if (process.env.MYO_DATA_DIR) createTestUser(credsB.username, credsB.password);
  let resB = await fetch(`${API}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(credsB),
  });
  if (resB.status === 401) {
    // manual mode without MYO_DATA_DIR: self-register works only when
    // this hub has no users yet — otherwise skip gracefully
    await fetch(`${API}/api/auth/setup`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(credsB),
    });
    resB = await fetch(`${API}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(credsB),
    });
  }
  const cookieB = (resB.headers.get("set-cookie") || "").split(";")[0];
  if (!cookieB) {
    console.log("  ⚠️  cannot create a second account — skipping cross-tenant signing checks");
  } else {
    const cross = await api(cookieB, "/api/uploads/sign", {
      method: "POST",
      body: JSON.stringify({ paths: [up.path] }),
    });
    ok("cross-tenant signing refused", !cross.signed?.[up.path], JSON.stringify(cross));
    // and B's own view of the same file is still 403 without a signature of their own
    const crossGet = await fetch(API + signedUrl);
    // note: the URL itself is bearer-proof for its TTL — A leaked nothing,
    // but B reusing A's URL works (capability semantics); the guard is that
    // B cannot *mint* URLs for paths they don't own
    ok("foreign user cannot mint a signature", cross.ttlDays === 30 && Object.keys(cross.signed ?? {}).length === 0, JSON.stringify(cross));
  }

  // unauthenticated signing is rejected
  const anon = await fetch(`${API}/api/uploads/sign`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ paths: [up.path] }),
  });
  ok("anonymous sign request 401", anon.status === 401, `got ${anon.status}`);

  // a big-but-legal image (≈6MB of PNG bytes) must pass the server's own
  // body parser — the Fastify default (1MiB) would 413 it before the
  // upload size check ever runs (regression: bodyLimit < MAX_UPLOAD_BYTES)
  const bigBlob = Buffer.alloc(6 * 1024 * 1024, 0x89);
  const bigPNG =
    "data:image/png;base64," +
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==" +
    bigBlob.toString("base64");
  const bigRes = await fetch(`${API}/api/upload`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ data: bigPNG }),
  });
  const big = await bigRes.json().catch(() => ({ raw: "not-json" }));
  ok("~8MB body upload accepted", bigRes.status === 200 && !!big.url, `status=${bigRes.status}, ${(big.url ?? JSON.stringify(big)).slice(0, 40)}`);
  if (big.path) {
    // put it in a message, then sign + HEAD it back
    await fetch(`${API}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ conversationId: convo.id, text: "大图", images: [big.path] }),
    });
    const bigSign = await api(cookie, "/api/uploads/sign", {
      method: "POST",
      body: JSON.stringify({ paths: [big.path] }),
    });
    const head = await fetch(API + bigSign.signed?.[big.path], { method: "HEAD" });
    ok("big image served back (signed HEAD)", head.status === 200, `got ${head.status}`);
  }

  // an oversized body (base64 past MAX_UPLOAD_BYTES * 1.4) must still be
  // rejected by the hub's own limit — and with 413, not a parse error
  const hugePNG =
    "data:image/png;base64," +
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==" +
    Buffer.alloc(12 * 1024 * 1024, 0x89).toString("base64");
  const hugeRes = await fetch(`${API}/api/upload`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ data: hugePNG }),
  });
  ok("oversized upload still 413", hugeRes.status === 413, `got ${hugeRes.status}`);

  // the model receives the image (vision round-trip): with the test
  // passing an already-stored /uploads/ path, persistImage passes it
  // through and the model gets exactly that URL in the user turn
  const prompt = await chatPrompt("看图");
  ok("model received the image reference", prompt.includes("c414"), prompt.slice(0, 80));
  void MOCK_API;

  process.exit(fail ? 1 : 0);
}

main().catch((e) => {
  console.error("FAILED:", e.message);
  process.exit(1);
});

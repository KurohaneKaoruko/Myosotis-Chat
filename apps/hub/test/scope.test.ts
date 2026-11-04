// Storage-scope regression test: the memory engine must stay bound to
// the right tenant while chat turns interleave.
//
// The old implementation kept the current user in a module-level slot
// that every request overwrote — a slow turn from account A would read
// account B's memories (and vice versa). Turn handlers now enter an
// AsyncLocalStorage scope (runWithUser), so this suite hammers two
// accounts with concurrent turns and asserts strict isolation:
// every turn's system prompt carries the owner's memory and never the
// other account's, and auto-extraction lands in the speaker's account.
//
//   node --experimental-strip-types test/scope.test.ts
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { API, MOCK_API, login, api, seedBasics, resetLog } from "./fixtures.ts";
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

async function secondAccount() {
  const creds = { username: `scope-other-${Date.now().toString(36)}`, password: "test12345" };
  if (process.env.MYO_DATA_DIR) createTestUser(creds.username, creds.password);
  let res = await fetch(`${API}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(creds),
  });
  if (res.status === 401) {
    await fetch(`${API}/api/auth/setup`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(creds),
    });
    res = await fetch(`${API}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(creds),
    });
  }
  const cookie = (res.headers.get("set-cookie") || "").split(";")[0];
  if (!cookie) throw new Error("second account login failed (need MYO_DATA_DIR)");
  return cookie;
}

async function turn(cookie: string, convoId: string, text: string) {
  const res = await fetch(`${API}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ conversationId: convoId, text }),
  });
  await res.text(); // drain the SSE stream
}

async function main() {
  await resetLog();
  const tag = Date.now().toString(36);
  const markerA = `独有记忆甲${tag}`;
  const markerB = `独有记忆乙${tag}`;
  // personas act as prompt-ownership tags: the mock's prompt log is
  // global, so only a persona tells us which account a prompt serves
  const personaA = `你是甲的伙伴${tag}`;
  const personaB = `你是乙的伙伴${tag}`;

  const a = await login();
  if (!a.ok || !a.cookie) throw new Error("login A failed");
  await seedBasics(a.cookie);
  const cookieB = await secondAccount();
  if (!cookieB) throw new Error("account B unavailable (need MYO_DATA_DIR)");
  // NOTE: /api/data/:id rows are global-id — a second account PUTting a
  // fixture id that A already owns is (by design) rejected to protect
  // the first owner. B therefore seeds its own ids (pB/mB/agB) and its
  // own per-user-keyed settings.
  const seedB: Array<[string, any]> = [
    ["/api/data/providers/pB", { id: "pB", name: "MockB", protocol: "openai", baseUrl: `${MOCK_API}/v1`, apiKey: "sk-test", createdAt: 1 }],
    ["/api/data/models/mB", { id: "mB", name: "mock-chat", providerId: "pB", label: "Mock", roles: ["chat", "vision", "embedding"] }],
    ["/api/data/agents/agB", {
      id: "agB", name: "乙樱", emoji: "🌼", hue: 40, persona: personaB,
      greeting: "你好", suggestions: [], memoryEnabled: true, models: {}, createdAt: 1, updatedAt: 1,
    }],
  ];
  for (const [path, body] of seedB) {
    const r = await api(cookieB, path, { method: "PUT", body: JSON.stringify(body) });
    if (!r.ok) throw new Error(`seed B ${path} failed: ${JSON.stringify(r)}`);
  }
  const sb = await api(cookieB, "/api/data/settings", {
    method: "PUT",
    body: JSON.stringify({ defaults: { chat: "mB", vision: "mB", embedding: "mB" } }),
  });
  if (!sb.ok) throw new Error("seed B settings failed");
  // A keeps the fixture ids but tags its agent persona
  const sa = await api(a.cookie, "/api/data/agents/ag1", {
    method: "PUT",
    body: JSON.stringify({
      id: "ag1", name: "甲樱", emoji: "🌸", hue: 330, persona: personaA,
      greeting: "你好", suggestions: [], memoryEnabled: true, models: {}, createdAt: 1, updatedAt: 1,
    }),
  });
  if (!sa.ok) throw new Error("seed A persona failed");

  // one pinned private memory per account
  await api(a.cookie, "/api/data/memories/mem_scope_a", {
    method: "PUT",
    body: JSON.stringify({
      id: "mem_scope_a", agentId: "ag1", content: markerA, kind: "fact",
      importance: 5, embedding: null, pinned: true, hitCount: 0,
      scope: "agent", createdAt: 1, updatedAt: 1,
    }),
  });
  await api(cookieB, "/api/data/memories/mem_scope_b", {
    method: "PUT",
    body: JSON.stringify({
      id: "mem_scope_b", agentId: "agB", content: markerB, kind: "fact",
      importance: 5, embedding: null, pinned: true, hitCount: 0,
      scope: "agent", createdAt: 1, updatedAt: 1,
    }),
  });

  const convoA = await api(a.cookie, "/api/conversations", {
    method: "POST",
    body: JSON.stringify({ agentId: "ag1", title: "作用域测试A" }),
  });
  const convoB = await api(cookieB, "/api/conversations", {
    method: "POST",
    body: JSON.stringify({ agentId: "agB", title: "作用域测试B" }),
  });
  if (!convoA.id || !convoB.id) throw new Error("conversation setup failed");

  console.log("== 1. interleaved concurrent turns ==");
  // A and B turn simultaneously. Turn 3 of each account triggers memory
  // extraction (MEMORY_EXTRACT_EVERY) while the other account's turn is
  // still in flight — the exact race the old shared slot lost.
  const rounds = 3;
  await Promise.all(
    Array.from({ length: rounds }, (_, i) =>
      Promise.all([
        turn(a.cookie, convoA.id, `甲第${i}轮：聊聊`),
        turn(cookieB, convoB.id, `乙第${i}轮：聊聊`),
      ])
    )
  );
  ok(`${rounds} rounds of interleaved turns completed`, true);

  console.log("== 2. prompts carry only the owner's memory ==");
  const log = (await (await fetch(`${MOCK_API}/prompt-log`)).json()) as string[];
  const promptsWithA = log.filter((p) => p.includes(personaA));
  const promptsWithB = log.filter((p) => p.includes(personaB));
  ok("A's turns recorded with memory section",
    promptsWithA.length >= rounds && promptsWithA.every((p) => p.includes("长期记忆")),
    `got ${promptsWithA.length}`);
  ok("B's turns recorded with memory section",
    promptsWithB.length >= rounds && promptsWithB.every((p) => p.includes("长期记忆")),
    `got ${promptsWithB.length}`);
  ok("A's prompts carry A's memory",
    promptsWithA.length > 0 && promptsWithA.every((p) => p.includes(markerA)));
  ok("B's prompts carry B's memory",
    promptsWithB.length > 0 && promptsWithB.every((p) => p.includes(markerB)));
  ok("B's prompts never leak A's memory",
    promptsWithB.every((p) => !p.includes(markerA)),
    `${promptsWithB.filter((p) => p.includes(markerA)).length} leaked`);
  ok("A's prompts never leak B's memory",
    promptsWithA.every((p) => !p.includes(markerB)),
    `${promptsWithA.filter((p) => p.includes(markerB)).length} leaked`);

  console.log("== 3. memories stay in their own account ==");
  const memsA = await api(a.cookie, "/api/memories");
  const memsB = await api(cookieB, "/api/memories");
  ok("A sees only its own pinned memory",
    Array.isArray(memsA) && memsA.some((m: any) => m.id === "mem_scope_a") && !memsA.some((m: any) => m.id === "mem_scope_b"));
  ok("B sees only its own pinned memory",
    Array.isArray(memsB) && memsB.some((m: any) => m.id === "mem_scope_b") && !memsB.some((m: any) => m.id === "mem_scope_a"));

  // the concurrent turn-3 extractions must land in the speaker's account
  // (the mock derives the fact from the transcript's first "用户: " line)
  await new Promise((r) => setTimeout(r, 1500)); // extraction is fire-and-forget
  const freshA = await api(a.cookie, "/api/memories");
  const freshB = await api(cookieB, "/api/memories");
  ok("A's extraction saved under A",
    Array.isArray(freshA) && freshA.some((m: any) => String(m.content).includes("自动记忆:甲第0轮")),
    JSON.stringify(freshA?.map((m: any) => m.content)));
  ok("B's extraction saved under B",
    Array.isArray(freshB) && freshB.some((m: any) => String(m.content).includes("自动记忆:乙第0轮")),
    JSON.stringify(freshB?.map((m: any) => m.content)));
  ok("A's tenant never receives B's extraction",
    !(Array.isArray(freshA) && freshA.some((m: any) => String(m.content).includes("乙第"))));
  ok("B's tenant never receives A's extraction",
    !(Array.isArray(freshB) && freshB.some((m: any) => String(m.content).includes("甲第"))));

  // teardown: remove everything this suite created so later suites start
  // from a clean tenant. This matters: the mock embedding keys on the
  // input's first character, so a leftover "自动记忆:甲第0轮…" would make
  // isolation's own extraction dedup-hit (cosine 1) and silently add
  // nothing — a false failure with no product bug behind it.
  try {
    for (const [cookie, pinned] of [[a.cookie, "mem_scope_a"], [cookieB, "mem_scope_b"]] as const) {
      const mems = await api(cookie, "/api/memories");
      if (!Array.isArray(mems)) continue;
      for (const m of mems) {
        if (m.id === pinned || String(m.content).startsWith("自动记忆:")) {
          await api(cookie, `/api/data/memories/${m.id}`, { method: "DELETE" });
        }
      }
    }
  } catch (e) {
    console.log(`  ⚠️ teardown failed: ${(e as Error).message}`);
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

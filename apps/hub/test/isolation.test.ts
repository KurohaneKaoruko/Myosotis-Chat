// Multi-tenant isolation + cross-device sync contract test.
//
//   1. one account can never read, overwrite or delete another
//      account's agents / conversations / messages / memories
//   2. mutations broadcast the SSE events the web client relies on:
//      settings PUT → "settings", conversation PUT/DELETE →
//      "conversation" / "clear-conversation"
//   3. auto-extracted memories are broadcast as "memory" events
//
//   node --experimental-strip-types test/isolation.test.ts
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { API, login, api, seedBasics, resetLog } from "./fixtures.ts";
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

/**
 * The hub only self-registers its FIRST account, so a second tenant for
 * isolation testing is inserted straight into the throwaway database.
 * run-all.ts points MYO_DATA_DIR at a temp dir — never the real data/.
 * Without it (manual HUB_API mode) the suite skips itself.
 */
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

/** subscribe to the SSE stream and collect parsed data frames */
async function subscribe(cookie: string): Promise<{ events: any[]; stop: () => void }> {
  const events: any[] = [];
  const ctrl = new AbortController();
  const res = await fetch(`${API}/api/events`, {
    headers: { cookie, accept: "text/event-stream" },
    signal: ctrl.signal,
  });
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let stopped = false;
  (async () => {
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done || stopped) break;
        for (const line of decoder.decode(value, { stream: true }).split("\n")) {
          if (line.startsWith("data: ")) {
            try { events.push(JSON.parse(line.slice(6))); } catch {}
          }
        }
      }
    } catch {}
  })();
  // give the subscriber a moment to attach
  await new Promise((r) => setTimeout(r, 300));
  return {
    events,
    stop: () => {
      stopped = true;
      try { reader.cancel().catch(() => {}); } catch {}
      ctrl.abort();
    },
  };
}

async function waitFor(events: any[], type: string, timeoutMs = 8000): Promise<any | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const hit = events.find((e) => e.type === type);
    if (hit) return hit;
    await new Promise((r) => setTimeout(r, 100));
  }
  return null;
}

async function main() {
  await resetLog();
  console.log("== 1. two accounts ==");
  const a = await login();
  if (!a.ok) throw new Error("login A failed");
  await seedBasics(a.cookie);
  // account B: fresh username — inserted into the throwaway DB directly
  // (the hub only self-registers its first account over HTTP)
  const credsB = { username: "isolation-other", password: "test12345" };
  if (process.env.MYO_DATA_DIR) createTestUser(credsB.username, credsB.password);
  let res = await fetch(`${API}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(credsB),
  });
  if (res.status === 401) {
    // manual mode without MYO_DATA_DIR: self-register works only when
    // this hub has no users yet — otherwise skip gracefully
    await fetch(`${API}/api/auth/setup`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(credsB),
    });
    res = await fetch(`${API}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(credsB),
    });
  }
  const cookieB = (res.headers.get("set-cookie") || "").split(";")[0];
  if (!cookieB) {
    console.log("  ⚠️  cannot create a second account on this hub — skipping isolation suite (login status " + res.status + ", MYO_DATA_DIR=" + (process.env.MYO_DATA_DIR ?? "unset") + ")");
    console.log(`\n${pass} passed, ${fail} failed`);
    return;
  }
  ok("account B signed in", !!cookieB);
  const bootB = await (await fetch(`${API}/api/data`, { headers: { cookie: cookieB } })).json();
  ok("B starts empty", (bootB.agents ?? []).length === 0);

  console.log("== 2. agents are private ==");
  // A owns ag1 (seedBasics). B must not see, overwrite or delete it.
  const dataB = await api(cookieB, "/api/data");
  ok("B cannot list A's agent", !dataB.agents?.some((x: any) => x.id === "ag1"));

  const hijack = await api(cookieB, "/api/data/agents/ag1", {
    method: "PUT",
    body: JSON.stringify({ id: "ag1", name: "被劫持", persona: "x" }),
  });
  ok("B cannot overwrite A's agent (404)", hijack.status === 404 || hijack.error === "not-found", JSON.stringify(hijack).slice(0, 80));

  const steal = await api(cookieB, "/api/data/agents/ag1", { method: "DELETE" });
  ok("B cannot delete A's agent (404)", steal.status === 404 || steal.error === "not-found", JSON.stringify(steal).slice(0, 80));

  const agentA = await api(a.cookie, "/api/data");
  const ag1 = agentA.agents?.find((x: any) => x.id === "ag1");
  ok("A's agent untouched", ag1?.name === "小樱", `name=${ag1?.name}`);

  // B creates its own agent + conversation to probe message routes
  await api(cookieB, "/api/data/agents/agB", {
    method: "PUT",
    body: JSON.stringify({
      id: "agB", name: "乙", emoji: "🌳", hue: 100, persona: "你是乙",
      greeting: "hi", suggestions: [], memoryEnabled: true, models: {}, createdAt: 9, updatedAt: 9,
    }),
  });

  console.log("== 3. conversations & messages are private ==");
  const convoA = await api(a.cookie, "/api/conversations", {
    method: "POST",
    body: JSON.stringify({ agentId: "ag1", title: "A的会话" }),
  });
  ok("A created a conversation", !!convoA.id);

  // seed one message through the upsert endpoint
  await api(a.cookie, `/api/conversations/${convoA.id}/messages`, {
    method: "POST",
    body: JSON.stringify({ id: "msgA1", conversationId: convoA.id, role: "user", content: "只有A能看到", createdAt: 1 }),
  });

  const msgsB = await api(cookieB, `/api/conversations/${convoA.id}/messages`);
  ok("B cannot read A's messages (404)", msgsB.status === 404 || msgsB.error === "not-found", JSON.stringify(msgsB).slice(0, 80));

  const editB = await api(cookieB, `/api/conversations/${convoA.id}/messages/msgA1`, {
    method: "PUT",
    body: JSON.stringify({ content: "被B篡改" }),
  });
  ok("B cannot edit A's message (404)", editB.status === 404 || editB.error === "not-found", JSON.stringify(editB).slice(0, 80));

  const delB = await api(cookieB, `/api/conversations/${convoA.id}/messages/msgA1`, { method: "DELETE" });
  ok("B cannot delete A's message (404)", delB.status === 404 || delB.error === "not-found", JSON.stringify(delB).slice(0, 80));

  const chatB = await fetch(`${API}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: cookieB },
    body: JSON.stringify({ conversationId: convoA.id, text: "越权聊天" }),
  });
  ok("B cannot chat in A's conversation (404)", chatB.status === 404, `status=${chatB.status}`);
  await chatB.text().catch(() => {});

  const readB = await api(cookieB, `/api/conversations/${convoA.id}/read`, { method: "POST", body: "{}" });
  ok("B cannot mark A's conversation read (404)", readB.status === 404 || readB.error === "not-found", JSON.stringify(readB).slice(0, 80));

  const delConvoB = await api(cookieB, `/api/conversations/${convoA.id}`, { method: "DELETE" });
  ok("B cannot delete A's conversation (404)", delConvoB.status === 404 || delConvoB.error === "not-found", JSON.stringify(delConvoB).slice(0, 80));

  const convoStill = await api(a.cookie, `/api/conversations/${convoA.id}/messages`);
  ok("A's messages intact", Array.isArray(convoStill) && convoStill.some((m: any) => m.content === "只有A能看到"));

  console.log("== 4. memories & channel bindings are private ==");
  await api(a.cookie, "/api/data/memories/memIso", {
    method: "PUT",
    body: JSON.stringify({
      id: "memIso", agentId: "ag1", content: "A的私密记忆", kind: "fact",
      importance: 5, embedding: null, pinned: false, hitCount: 0, scope: "agent", createdAt: 1, updatedAt: 1,
    }),
  });
  const memsB = await api(cookieB, "/api/memories");
  ok("B cannot list A's memories", !Array.isArray(memsB) || !memsB.some((m: any) => m.id === "memIso"));

  const bindB = await api(cookieB, "/api/channels/onebot", {
    method: "PUT",
    body: JSON.stringify({ platformUserId: "user:777", agentId: "ag1" }),
  });
  ok("B cannot bind A's agent (404)", bindB.status === 404 || bindB.error === "no-agent", JSON.stringify(bindB).slice(0, 80));

  // A binds its own agent; B must not remove that binding
  await api(a.cookie, "/api/channels/onebot", {
    method: "PUT",
    body: JSON.stringify({ platformUserId: "user:888", agentId: "ag1" }),
  });
  const unbindB = await api(cookieB, "/api/channels/onebot/user%3A888", { method: "DELETE" });
  ok("B cannot remove A's binding (404)", unbindB.status === 404 || unbindB.error === "not-found", JSON.stringify(unbindB).slice(0, 80));
  const bindingsA = await api(a.cookie, "/api/channels");
  ok("A's binding survives", bindingsA.bindings?.some((b: any) => b.channelUserId === "user:888"));

  console.log("== 5. sync events: settings & conversations ==");
  const subA = await subscribe(a.cookie);

  await api(a.cookie, "/api/data/settings", {
    method: "PUT",
    body: JSON.stringify({ userName: "同步测试" }),
  });
  const settingsEvt = await waitFor(subA.events, "settings");
  ok("settings PUT broadcasts settings event", !!settingsEvt);

  const patched = await api(a.cookie, `/api/data/conversations/${convoA.id}`, {
    method: "PUT",
    body: JSON.stringify({ ...convoA, archived: true, tags: ["sync"] }),
  });
  ok("conversation PUT ok", patched.ok !== false);
  const convoEvt = await waitFor(subA.events, "conversation");
  ok("conversation PUT broadcasts conversation event", !!convoEvt && convoEvt.conversation?.archived === true, JSON.stringify(convoEvt).slice(0, 100));

  const del = await api(a.cookie, `/api/data/conversations/${convoA.id}`, { method: "DELETE" });
  ok("conversation DELETE ok", del.ok !== false);
  const clearEvt = await waitFor(subA.events, "clear-conversation");
  ok("conversation DELETE broadcasts clear-conversation", !!clearEvt && clearEvt.conversationId === convoA.id);
  subA.stop();

  console.log("== 6. auto-extracted memories broadcast ==");
  // 3 turns → extraction fires on the 3rd (MEMORY_EXTRACT_EVERY); the
  // mock answers extraction prompts with a JSON array containing
  // "自动记忆:" facts
  const convo2 = await api(a.cookie, "/api/conversations", {
    method: "POST",
    body: JSON.stringify({ agentId: "ag1", title: "自动记忆测试" }),
  });
  const sub2 = await subscribe(a.cookie);
  for (let i = 1; i <= 3; i++) {
    const r = await fetch(`${API}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: a.cookie },
      body: JSON.stringify({ conversationId: convo2.id, text: `第${i}轮：我喜欢蓝色，我的生日是${i}月` }),
    });
    await r.text();
  }
  const memEvt = await waitFor(sub2.events, "memory", 10000);
  ok("extraction broadcasts memory event", !!memEvt && String(memEvt.memory?.content ?? "").includes("自动记忆"), JSON.stringify(memEvt).slice(0, 120));
  sub2.stop();

  const memsA = await api(a.cookie, "/api/memories");
  const auto = Array.isArray(memsA) ? memsA.filter((m: any) => String(m.content).includes("自动记忆")) : [];
  ok("extracted memory persisted", auto.length >= 1);

  console.log("== 7. story mode never extracts ==");
  // a scenario + story conversation: extraction must stay off
  await api(a.cookie, "/api/data/scenarios/sc1", {
    method: "PUT",
    body: JSON.stringify({
      id: "sc1", agentId: "ag1", name: "异世界",
      worldSetting: "魔法大陆", openingStory: "你在森林里醒来",
      events: [], plotPrompts: [], createdAt: 1, updatedAt: 1,
    }),
  });
  const storyConvo = await api(a.cookie, "/api/conversations", {
    method: "POST",
    body: JSON.stringify({ agentId: "ag1", title: "剧情", kind: "direct" }),
  });
  await api(a.cookie, `/api/data/conversations/${storyConvo.id}`, {
    method: "PUT",
    body: JSON.stringify({ ...storyConvo, mode: "story", scenarioId: "sc1" }),
  });
  await resetLog();
  for (let i = 1; i <= 4; i++) {
    const r = await fetch(`${API}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: a.cookie },
      body: JSON.stringify({ conversationId: storyConvo.id, text: `剧情第${i}轮：我捡到了魔法石` }),
    });
    await r.text();
  }
  // give any (wrongly scheduled) extraction time to land
  await new Promise((r2) => setTimeout(r2, 1500));
  const memsAfter = await api(a.cookie, "/api/memories");
  const storyMems = Array.isArray(memsAfter)
    ? memsAfter.filter((m: any) => String(m.content).includes("魔法石"))
    : [];
  ok("story mode extracted nothing", storyMems.length === 0, JSON.stringify(storyMems).slice(0, 120));

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

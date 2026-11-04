// Guards regression test: message routes must respect conversation
// membership, and OneBot channel ids must not be silently taken over.
//
//   node --experimental-strip-types test/guards.test.ts
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { API, MOCK_API, login, api, seedBasics, resetLog, chatPrompt } from "./fixtures.ts";
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
  const creds = { username: `guards-other-${Date.now().toString(36)}`, password: "test12345" };
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
  if (!cookie) throw new Error("second account login failed");
  return cookie;
}

async function main() {
  const a = await login();
  if (!a.ok || !a.cookie) throw new Error("login A failed");
  await seedBasics(a.cookie);
  const cookieB = await secondAccount();
  // unique ids: the scope suite (which runs before this one) owns the
  // plain pB/mB/agB ids, and data rows are global-id
  const tag = Date.now().toString(36);
  const agentB = `gagB${tag}`;
  const channelB = `9${tag}9`;

  const convoA = await api(a.cookie, "/api/conversations", {
    method: "POST",
    body: JSON.stringify({ agentId: "ag1", title: "守卫测试A" }),
  });
  const convoB = await api(a.cookie, "/api/conversations", {
    method: "POST",
    body: JSON.stringify({ agentId: "ag1", title: "守卫测试B" }),
  });
  if (!convoA.id || !convoB.id) throw new Error("conversation setup failed");

  console.log("== 1. message routes respect conversation membership ==");
  // put a user message into convo A through the normal chat flow
  const chat = await fetch(`${API}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: a.cookie },
    body: JSON.stringify({ conversationId: convoA.id, text: "守卫测试消息" }),
  });
  await chat.text(); // drain the SSE stream
  const msgs = await api(a.cookie, `/api/conversations/${convoA.id}/messages`);
  const target = Array.isArray(msgs) ? msgs.find((m: any) => m.role === "user") : null;
  if (!target?.id) throw new Error("chat turn produced no user message");

  // PUT to a *different* conversation's URL must not move the message
  const move = await fetch(`${API}/api/conversations/${convoB.id}/messages/${target.id}`, {
    method: "PUT",
    headers: { "content-type": "application/json", cookie: a.cookie },
    body: JSON.stringify({ content: "被搬运了" }),
  });
  ok("PUT cannot move a message to another conversation",
    move.status === 404, `status=${move.status}`);
  const after = await api(a.cookie, `/api/conversations/${convoA.id}/messages`);
  const still = Array.isArray(after) ? after.find((m: any) => m.id === target.id) : null;
  ok("message stays in its own conversation", !!still && still.content === "守卫测试消息");

  // POST upsert must not hijack a message living in another conversation
  const hijack = await fetch(`${API}/api/conversations/${convoB.id}/messages`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: a.cookie },
    body: JSON.stringify({ ...target, content: "被劫持了" }),
  });
  ok("POST upsert cannot hijack a foreign conversation's message",
    hijack.status === 400 || hijack.status === 404, `status=${hijack.status}`);
  const afterHijack = await api(a.cookie, `/api/conversations/${convoA.id}/messages`);
  const intact = Array.isArray(afterHijack) ? afterHijack.find((m: any) => m.id === target.id) : null;
  ok("original message content intact", !!intact && intact.content === "守卫测试消息");

  // DELETE with the wrong conversation id must refuse
  const wrongDel = await fetch(`${API}/api/conversations/${convoB.id}/messages/${target.id}`, {
    method: "DELETE",
    headers: { cookie: a.cookie },
  });
  ok("DELETE with wrong conversation id refused", wrongDel.status === 404, `status=${wrongDel.status}`);
  const survivor = await api(a.cookie, `/api/conversations/${convoA.id}/messages`);
  ok("message survives wrong-conversation DELETE",
    Array.isArray(survivor) && survivor.some((m: any) => m.id === target.id));

  // the honest paths must still work
  const edit = await api(a.cookie, `/api/conversations/${convoA.id}/messages/${target.id}`, {
    method: "PUT",
    body: JSON.stringify({ content: "守卫测试消息（已编辑）" }),
  });
  const edited = await api(a.cookie, `/api/conversations/${convoA.id}/messages`);
  ok("legit PUT still works",
    edit.ok !== false && Array.isArray(edited) && edited.find((m: any) => m.id === target.id)?.content === "守卫测试消息（已编辑）");

  console.log("== 2. onebot binding cannot be silently taken over ==");
  // B seeds its own agent first (its binding attempt must pass the
  // agent-ownership check and fail on the takeover check instead)
  const seedB = await api(cookieB, `/api/data/agents/${agentB}`, {
    method: "PUT",
    body: JSON.stringify({
      id: agentB, name: "乙樱", emoji: "🌼", hue: 40, persona: "乙",
      greeting: "你好", suggestions: [], memoryEnabled: true, models: {}, createdAt: 1, updatedAt: 1,
    }),
  });
  if (!seedB.ok) throw new Error("seed B agent failed");

  // A binds its channel id to its agent
  const bindA = await api(a.cookie, "/api/channels/onebot", {
    method: "PUT",
    body: JSON.stringify({ platformUserId: channelB, agentId: "ag1" }),
  });
  ok("A binds its channel id", bindA.ok !== false, JSON.stringify(bindA));

  // B binding the same channel id must be rejected (409)
  const steal = await fetch(`${API}/api/channels/onebot`, {
    method: "PUT",
    headers: { "content-type": "application/json", cookie: cookieB },
    body: JSON.stringify({ platformUserId: channelB, agentId: agentB }),
  });
  ok("B cannot bind someone else's channel id", steal.status === 409, `status=${steal.status}`);
  const bindingsA = await api(a.cookie, "/api/channels");
  const owner = Array.isArray(bindingsA?.bindings)
    ? bindingsA.bindings.find((b: any) => b.channelUserId === channelB)
    : null;
  ok("binding still owned by A", !!owner && owner.agentId === "ag1", JSON.stringify(owner));

  // the explicit replace flow still works
  const del = await fetch(`${API}/api/channels/onebot/${channelB}`, {
    method: "DELETE",
    headers: { cookie: cookieB },
  });
  ok("DELETE on a foreign binding is refused", del.status === 404, `status=${del.status}`);
  // …and the replace flag (documented takeover path) works
  const takeover = await api(cookieB, "/api/channels/onebot", {
    method: "PUT",
    body: JSON.stringify({ platformUserId: channelB, agentId: agentB, replace: true }),
  });
  ok("explicit replace:true takes the binding over", takeover.ok !== false, JSON.stringify(takeover));
  const bindingsAfter = await api(a.cookie, "/api/channels");
  ok("A no longer lists the binding after explicit replace",
    Array.isArray(bindingsAfter?.bindings) && !bindingsAfter.bindings.some((b: any) => b.channelUserId === channelB));

  // cleanup: unbind so other suites are unaffected
  await api(cookieB, `/api/channels/onebot/${channelB}`, { method: "DELETE" });

  console.log("== 3. story mode must not inject another tenant's scenario ==");
  // A owns a secret scenario; B points its own story conversation at it
  await api(a.cookie, "/api/data/scenarios/scn_secret", {
    method: "PUT",
    body: JSON.stringify({
      id: "scn_secret", agentId: "ag1", name: "密卷",
      worldSetting: "绝密世界设定机密标记XYZ。",
      openingStory: "绝密开场。",
      events: [{ id: "ev_s", name: "密事", trigger: "密钥", content: "绝密事件内容。" }],
      plotPrompts: [], createdAt: 1, updatedAt: 1,
    }),
  });
  // B needs its own provider/model/settings, otherwise its turn fails with
  // no-model and never produces a prompt at all (the test would lie)
  const pB = `pB${tag}`, mB = `mB${tag}`;
  await api(cookieB, `/api/data/providers/${pB}`, {
    method: "PUT",
    body: JSON.stringify({ id: pB, name: "MockB", protocol: "openai", baseUrl: `${MOCK_API}/v1`, apiKey: "sk-test", createdAt: 1 }),
  });
  await api(cookieB, `/api/data/models/${mB}`, {
    method: "PUT",
    body: JSON.stringify({ id: mB, name: "mock-chat-b", providerId: pB, label: "MockB", roles: ["chat", "vision", "embedding"] }),
  });
  await api(cookieB, "/api/data/settings", {
    method: "PUT",
    body: JSON.stringify({ defaults: { chat: mB, vision: mB, embedding: mB } }),
  });
  const storyB = await api(cookieB, "/api/conversations", {
    method: "POST",
    body: JSON.stringify({ agentId: agentB, title: "乙的剧情" }),
  });
  await api(cookieB, `/api/data/conversations/${storyB.id}`, {
    method: "PUT",
    body: JSON.stringify({ ...storyB, mode: "story", scenarioId: "scn_secret" }),
  });
  await resetLog();
  await fetch(`${API}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: cookieB },
    body: JSON.stringify({ conversationId: storyB.id, text: "开始这个故事" }),
  }).then((r) => r.text());
  const bTurn = await chatPrompt("乙");
  // the persona reaches the system prompt, so a non-empty hit proves the
  // turn actually ran against the mock — the test cannot silently pass
  ok("control: B's turn actually ran", bTurn.includes("乙"), "no prompt reached the mock");
  ok("foreign scenario content never reaches the model",
    bTurn.length > 0 && !bTurn.includes("机密标记XYZ") && !bTurn.includes("绝密开场"));

  console.log("== 4. OneBot hub config: secrets masked, never clobbered by masks ==");
  const REAL_TOKEN = "hub-secret-token-xyz";
  await api(a.cookie, "/api/channels/onebot/config", {
    method: "PUT",
    body: JSON.stringify({ enabled: false, token: REAL_TOKEN, accessToken: REAL_TOKEN }),
  });
  const cfg1 = await api(a.cookie, "/api/channels");
  ok("GET /api/channels never leaks the hub token",
    cfg1.onebot?.token === "••••••" && cfg1.onebot?.accessToken === "••••••",
    JSON.stringify(cfg1.onebot));
  // the UI round-trip: putting the masked value back must keep the real one
  await api(a.cookie, "/api/channels/onebot/config", {
    method: "PUT",
    body: JSON.stringify({ enabled: false, token: "••••••", accessToken: "••••••" }),
  });
  const cfg2 = await api(a.cookie, "/api/channels");
  ok("masked echo-back does not clobber the stored secret", cfg2.onebot?.token === "••••••");
  const leak2 = JSON.stringify(cfg2);
  ok("second read still masked (real secret never in any response)", !leak2.includes(REAL_TOKEN));
  // restore: off and secretless so other suites / the dev hub are unaffected
  await api(a.cookie, "/api/channels/onebot/config", {
    method: "PUT",
    body: JSON.stringify({ enabled: false, token: "", accessToken: "" }),
  });

  console.log("== 5. message JSON conversationId must match the URL ==");
  // POST with a body pointing somewhere else must be rejected outright
  const mismatch = await fetch(`${API}/api/conversations/${convoA.id}/messages`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: a.cookie },
    body: JSON.stringify({ id: `msgMis${tag}`, conversationId: convoB.id, role: "user", content: "错链", createdAt: 1 }),
  });
  ok("POST with mismatched JSON conversationId rejected (400)", mismatch.status === 400, `status=${mismatch.status}`);
  // PUT must not let the body rewrite the conversation the message lives in
  const rewrite = await fetch(`${API}/api/conversations/${convoA.id}/messages/${target.id}`, {
    method: "PUT",
    headers: { "content-type": "application/json", cookie: a.cookie },
    body: JSON.stringify({ conversationId: convoB.id }),
  });
  const afterRewrite = await api(a.cookie, `/api/conversations/${convoA.id}/messages`);
  ok("PUT cannot rewrite a message's conversation via the body",
    Array.isArray(afterRewrite) && afterRewrite.some((m: any) => m.id === target.id));
  // the honest POST path (body agrees with the URL) still works
  const honestId = `msgHonest${tag}`;
  const honest = await api(a.cookie, `/api/conversations/${convoA.id}/messages`, {
    method: "POST",
    body: JSON.stringify({ id: honestId, conversationId: convoA.id, role: "user", content: "正常链路", createdAt: 1 }),
  });
  const honestList = await api(a.cookie, `/api/conversations/${convoA.id}/messages`);
  ok("honest POST still persists",
    honest.ok !== false && Array.isArray(honestList) && honestList.some((m: any) => m.id === honestId && m.conversationId === convoA.id));

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
  process.exit(0);
}

main().catch((e) => {
  console.error("FAILED:", e.message);
  process.exit(1);
});

// End-to-end smoke test for the hub: auth, data sync, SSE chat, the
// absence of agent-tool endpoints, static assets and uploads.
//
//   node --experimental-strip-types test/smoke.test.ts
import { API, login, api, seedBasics } from "./fixtures.ts";

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

async function main() {
  console.log("== 1. health & bootstrap ==");
  const health = await (await fetch(`${API}/api/health`)).json();
  ok("health ok", health.ok === true);
  const boot = await (await fetch(`${API}/api/bootstrap`)).json();
  ok("bootstrap reachable", typeof boot.needsSetup === "boolean");

  console.log("== 2. auth ==");
  const { cookie } = await login();
  ok("signed in", !!cookie);
  const bad = await (
    await fetch(`${API}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "nightx", password: "definitely-wrong" }),
    })
  ).json();
  ok("wrong password rejected", bad.error === "bad-credentials");
  const anon = await fetch(`${API}/api/data`);
  ok("unauthenticated blocked", anon.status === 401);

  console.log("== 3. data sync ==");
  await seedBasics(cookie);
  const data = await api(cookie, "/api/data");
  ok("agent synced", !!data.agents?.find((a: any) => a.id === "ag1"));
  ok("model synced", !!data.models?.find((m: any) => m.id === "m1"));
  ok("settings synced", data.settings?.defaults?.chat === "m1");
  ok("memories in payload", Array.isArray(data.memories));

  console.log("== 4. SSE chat ==");
  const convo = await api(cookie, "/api/conversations", {
    method: "POST",
    body: JSON.stringify({ agentId: "ag1", title: "冒烟测试" }),
  });
  const res = await fetch(`${API}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ conversationId: convo.id, text: "你好，我叫夜，喜欢编程" }),
  });
  const text = await res.text();
  ok("streaming deltas", text.includes("event: delta"));
  ok("assistant message", text.includes("event: message"));
  ok("done event", text.includes("event: done"));
  const messages = await api(cookie, `/api/conversations/${convo.id}/messages`);
  ok("messages persisted", Array.isArray(messages) && messages.length === 2);

  console.log("== 5. no agent-tool surface ==");
  const tools = await fetch(`${API}/api/tools`, { headers: { cookie } });
  ok("tools endpoint removed", tools.status === 404);
  const toolRun = await fetch(`${API}/api/tools/claude/run`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ prompt: "x" }),
  });
  ok("tool run endpoint removed", toolRun.status === 404);

  console.log("== 6. static assets ==");
  const index = await fetch(`${API}/`);
  const html = await index.text();
  ok("index served", index.status === 200);
  ok("spa html", html.includes('id="root"'));
  const assetMatch = /src="\/assets\/([^"]+\.js)"/.exec(html);
  ok("js asset referenced", !!assetMatch);
  if (assetMatch) {
    const asset = await fetch(`${API}/assets/${assetMatch[1]}`);
    ok("js mime", (asset.headers.get("content-type") ?? "").includes("javascript"));
  }

  console.log("== 7. uploads ==");
  const up = await api(cookie, "/api/upload", {
    method: "POST",
    body: JSON.stringify({
      data: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    }),
  });
  ok("upload works", !!up.path);
  if (up.path) {
    const img = await fetch(API + up.path);
    ok("upload served", img.status === 200);
  }

  console.log(`\nPASS=${pass} FAIL=${fail}`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("FAILED:", e.message);
  process.exit(1);
});

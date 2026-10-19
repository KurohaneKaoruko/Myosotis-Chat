// Realtime sync test: client A subscribes to /api/events, client B
// sends a message — A must receive the event.
const API = "http://127.0.0.1:8791";

async function login() {
  const res = await fetch(`${API}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "nightx", password: "test12345" }),
  });
  const cookie = (res.headers.get("set-cookie") || "").split(";")[0];
  return { cookie, ok: res.ok };
}

async function api(cookie: string, path: string, init?: RequestInit) {
  const res = await fetch(API + path, {
    ...init,
    headers: { "content-type": "application/json", cookie, ...(init?.headers ?? {}) },
  });
  return res.json();
}

async function main() {
  const a = await login();
  const b = await login();
  if (!a.ok || !b.ok) throw new Error("login failed");
  console.log("[test] both clients logged in");

  // A: subscribe to the event stream
  const events: any[] = [];
  const ctrl = new AbortController();
  const es = await fetch(`${API}/api/events`, {
    headers: { cookie: a.cookie, accept: "text/event-stream" },
    signal: ctrl.signal,
  });
  console.log("[test] client A subscribed, status", es.status);
  const reader = es.body!.getReader();
  const decoder = new TextDecoder();
  (async () => {
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        for (const line of chunk.split("\n")) {
          if (line.startsWith("data: ")) {
            try { events.push(JSON.parse(line.slice(6))); } catch {}
          }
        }
      }
    } catch {}
  })();

  // B: create a conversation and send a message
  const convo = await api(b.cookie, "/api/conversations", {
    method: "POST",
    body: JSON.stringify({ agentId: "ag1", title: "实时同步测试" }),
  });
  console.log("[test] client B created conversation", convo.id);

  // B sends a message (streamed)
  const chat = await fetch(`${API}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: b.cookie },
    body: JSON.stringify({ conversationId: convo.id, text: "来自设备B的消息" }),
  });
  await chat.text();
  console.log("[test] client B sent the message");

  // give the event stream a moment
  await new Promise((r) => setTimeout(r, 1200));
  ctrl.abort();

  const types = events.map((e) => e.type);
  console.log("[test] client A received events:", JSON.stringify(types));
  const msgEvent = events.find((e) => e.type === "message");
  const convoEvent = events.find((e) => e.type === "conversation");

  const checks: Array<[string, boolean]> = [
    ["message event delivered", !!msgEvent],
    ["message content correct", msgEvent?.message?.content?.includes("来自设备B的消息") === true],
    ["conversation event delivered", !!convoEvent],
    ["conversation id matches", convoEvent?.conversation?.id === convo.id],
  ];
  for (const [name, ok] of checks) console.log(`  ${ok ? "✅" : "❌"} ${name}`);

  // unread badge: A's conversation list should now show 1 unread
  const data = await api(a.cookie, "/api/data");
  const c = data.conversations.find((x: any) => x.id === convo.id);
  console.log(`  ${c?.unread === 1 ? "✅" : "❌"} unread badge computed (got ${c?.unread})`);

  // A marks it read → badge clears
  await api(a.cookie, `/api/conversations/${convo.id}/read`, { method: "POST", body: "{}" });
  const data2 = await api(a.cookie, "/api/data");
  const c2 = data2.conversations.find((x: any) => x.id === convo.id);
  console.log(`  ${c2?.unread === 0 ? "✅" : "❌"} badge cleared after read (got ${c2?.unread})`);

  process.exit(checks.every(([, ok]) => ok) && c?.unread === 1 && c2?.unread === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("FAILED:", e.message);
  process.exit(1);
});

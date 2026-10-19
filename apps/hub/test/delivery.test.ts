// Verifies the message delivery lifecycle over the hub API:
//   user message persisted → echoed back immediately (not after the turn)
//   exactly one copy of the user message
//   assistant reply persisted
const API = "http://127.0.0.1:8791";

async function login() {
  const res = await fetch(`${API}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "nightx", password: "test12345" }),
  });
  return (res.headers.get("set-cookie") || "").split(";")[0];
}

async function api(cookie: string, path: string, init?: RequestInit) {
  const res = await fetch(API + path, {
    ...init,
    headers: { "content-type": "application/json", cookie, ...(init?.headers ?? {}) },
  });
  return res.json();
}

async function main() {
  const cookie = await login();
  if (!cookie) throw new Error("login failed");

  const convo = await api(cookie, "/api/conversations", {
    method: "POST",
    body: JSON.stringify({ agentId: "ag1", title: "送达状态测试" }),
  });

  // watch the event order of one turn
  const order: string[] = [];
  let userEchoAt = 0;
  const t0 = Date.now();

  const chat = await fetch(`${API}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ conversationId: convo.id, text: "送达状态测试内容" }),
  });
  const reader = chat.body!.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buf.indexOf("\n\n")) >= 0) {
      const frame = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      for (const line of frame.split("\n")) {
        if (line.startsWith("event: ")) {
          const ev = line.slice(7).trim();
          order.push(ev);
          if (ev === "user") userEchoAt = Date.now() - t0;
        }
      }
    }
  }

  const messages = await api(cookie, `/api/conversations/${convo.id}/messages`);
  const userMsgs = messages.filter((m: any) => m.role === "user");
  const aiMsgs = messages.filter((m: any) => m.role === "assistant");

  const checks: Array<[string, boolean, string]> = [
    ["user echoed before the turn finished", order.indexOf("user") < order.indexOf("message"), `order=${order.join(">")}`],
    ["exactly one user message", userMsgs.length === 1, `got ${userMsgs.length}`],
    ["exactly one assistant message", aiMsgs.length === 1, `got ${aiMsgs.length}`],
    ["user message content preserved", userMsgs[0]?.content === "送达状态测试内容", userMsgs[0]?.content],
    ["assistant message persisted", !!aiMsgs[0]?.content, "empty"],
  ];
  for (const [name, ok, detail] of checks) console.log(`  ${ok ? "✅" : "❌"} ${name} (${detail})`);
  console.log(`  ℹ️ user echo arrived after ${userEchoAt}ms`);

  process.exit(checks.every(([, ok]) => ok) ? 0 : 1);
}

main().catch((e) => {
  console.error("FAILED:", e.message);
  process.exit(1);
});

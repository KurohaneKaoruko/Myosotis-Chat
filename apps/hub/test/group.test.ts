// Group chat (multi-agent round table) on the hub: participants answer
// in order, each one sees the previous replies, and every reply is
// attributed to its own agent.
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
  const { cookie } = await login();
  if (!cookie) throw new Error("login failed");
  await seedBasics(cookie);

  // a second companion
  await api(cookie, "/api/data/agents/ag2", {
    method: "PUT",
    body: JSON.stringify({
      id: "ag2", name: "知夏", emoji: "🌺", hue: 340, persona: "你是知夏，温柔体贴",
      greeting: "你好呀", suggestions: [], memoryEnabled: true, models: {}, createdAt: 2, updatedAt: 2,
    }),
  });

  // a group conversation: both reply to every message
  const convo = await api(cookie, "/api/conversations", {
    method: "POST",
    body: JSON.stringify({
      agentId: "",
      title: "圆桌",
      kind: "group",
      participants: [
        { agentId: "ag1", receiveMode: "all", replyMode: "all", sortOrder: 0 },
        { agentId: "ag2", receiveMode: "all", replyMode: "all", sortOrder: 1 },
      ],
    }),
  });
  ok("group conversation created", !!convo.id);

  // run one group turn and collect the SSE frames
  const res = await fetch(`${API}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ conversationId: convo.id, text: "大家觉得今天怎么样" }),
  });
  const raw = await res.text();

  // every frame has a name
  const frames = raw.split("\n\n").filter((f) => f.includes("event:"));
  const deltas = frames.filter((f) => f.includes("event: delta"));
  const messages = frames.filter((f) => f.includes("event: message"));
  ok("group turn produced deltas", deltas.length >= 2, `got ${deltas.length}`);
  ok("group turn produced two assistant messages", messages.length === 2, `got ${messages.length}`);

  // each delta frame carries the speaking agent
  const agentIds = new Set<string>();
  for (const f of deltas) {
    const m = /"agentId":"([^"]+)"/.exec(f);
    if (m) agentIds.add(m[1]);
  }
  ok("deltas attributed to both agents", agentIds.size === 2, [...agentIds].join(","));

  // the stored messages must be attributed too
  const stored = await api(cookie, `/api/conversations/${convo.id}/messages`);
  const aiMsgs = stored.filter((m: any) => m.role === "assistant");
  ok("two replies stored", aiMsgs.length === 2, `got ${aiMsgs.length}`);
  ok("replies keep their agent", new Set(aiMsgs.map((m: any) => m.agentId)).size === 2);
  ok("user message stored", stored.filter((m: any) => m.role === "user").length === 1);

  // the second agent must see the first one's reply in its context
  // (the mock echoes the last user message; instead we check the prompt)
  const { chatPrompt } = await import("./fixtures.ts");
  const prompt = await chatPrompt("你是知夏");
  ok("second agent got a group-framed system prompt", prompt.includes("群聊场景"));

  console.log(`\nPASS=${pass} FAIL=${fail}`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("FAILED:", e.message);
  process.exit(1);
});

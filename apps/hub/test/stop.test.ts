import { API, MOCK_API, login, api, seedBasics, promptLog, resetLog, chatPrompt } from "./fixtures.ts";

// Verifies that "stop generation" actually aborts the upstream call:
// the slow mock reports how many streams were cut short vs completed.
const SLOW = "http://127.0.0.1:9912/v1";



async function main() {
  const { cookie } = await login();
  if (!cookie) throw new Error("login failed");
  await seedBasics(cookie);

  // point the chat model at the slow mock
  await api(cookie, "/api/data/providers/pslow", {
    method: "PUT",
    body: JSON.stringify({ id: "pslow", name: "Slow", protocol: "openai", baseUrl: SLOW, apiKey: "sk", createdAt: 1 }),
  });
  await api(cookie, "/api/data/models/mslow", {
    method: "PUT",
    body: JSON.stringify({ id: "mslow", name: "slow", providerId: "pslow", label: "Slow", roles: ["chat"] }),
  });
  await api(cookie, "/api/data/settings", {
    method: "PUT",
    body: JSON.stringify({ defaults: { chat: "mslow" } }),
  });

  const convo = await api(cookie, "/api/conversations", {
    method: "POST",
    body: JSON.stringify({ agentId: "ag1", title: "停止测试" }),
  });

  // start a turn, then stop it after 1.5s
  const chat = await fetch(`${API}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ conversationId: convo.id, text: "长回复" }),
  });
  const reader = chat.body!.getReader();
  const decoder = new TextDecoder();
  let seen = "";
  chat.body!.cancel().catch(() => {});
  const pump = (async () => {
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        seen += decoder.decode(value, { stream: true });
      }
    } catch {}
  })();

  await new Promise((r) => setTimeout(r, 1500));
  const stopRes = await api(cookie, "/api/chat/stop", {
    method: "POST",
    body: JSON.stringify({ conversationId: convo.id }),
  });
  console.log("[test] stop response:", JSON.stringify(stopRes));

  await new Promise((r) => setTimeout(r, 2500));
  const stats = await (await fetch("http://127.0.0.1:9912/stats")).json();
  console.log("[test] mock stats:", JSON.stringify(stats));
  console.log("[test] stream received:", seen.includes("chunk") ? "some chunks" : "no chunks");
  void pump;

  const ok = stats.aborted >= 1 && stopRes.stopped === true;
  console.log(`  ${ok ? "✅" : "❌"} upstream call aborted by stop (aborted=${stats.aborted}, completed=${stats.completed})`);
  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.error("FAILED:", e.message);
  process.exit(1);
});

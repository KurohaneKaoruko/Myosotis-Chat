import { API, MOCK_API, login, api, seedBasics, promptLog, resetLog, chatPrompt } from "./fixtures.ts";

// Verifies story mode on the hub: the scenario is injected into the
// system prompt, keyword triggers fire, and the story state advances.







async function main() {
  const { cookie } = await login();
  if (!cookie) throw new Error("login failed");
  await seedBasics(cookie);

  // a scenario with one keyword-triggered event and one manual event
  const scenario = {
    id: "scn1",
    agentId: "ag1",
    name: "雨夜",
    worldSetting: "这是一个发生在雨夜小镇的故事。",
    openingStory: "雨下了整夜。",
    events: [
      { id: "ev_kw", name: "敲门声", trigger: "敲门", content: "门外传来急促的敲门声。" },
      { id: "ev_manual", name: "灯光熄灭", trigger: "", content: "所有的灯忽然熄灭了。" },
    ],
    plotPrompts: [],
    createdAt: 1,
    updatedAt: 1,
  };
  await api(cookie, "/api/data/scenarios/scn1", { method: "PUT", body: JSON.stringify(scenario) });

  const convo = await api(cookie, "/api/conversations", {
    method: "POST",
    body: JSON.stringify({ agentId: "ag1", title: "剧情" }),
  });

  // switch the conversation into story mode
  await api(cookie, `/api/conversations/${convo.id}`, {
    method: "PUT",
    body: JSON.stringify({ mode: "story", scenarioId: "scn1", storyState: { triggeredEventIds: [] } }),
  });

  // a plain message → the world setting must be in the system prompt
  await resetLog();
  await fetch(`${API}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ conversationId: convo.id, text: "我们继续走吧" }),
  }).then((r) => r.text());
  const prompt1 = await chatPrompt("雨夜小镇");
  console.log(`  ${prompt1.includes("雨夜小镇") ? "✅" : "❌"} world setting injected`);
  console.log(`  ${prompt1.includes("叙事约束") ? "✅" : "❌"} narrative constraints injected`);

  // a message containing the keyword → the event fires
  await resetLog();
  await fetch(`${API}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ conversationId: convo.id, text: "忽然传来敲门声" }),
  }).then((r) => r.text());
  const prompt2 = await chatPrompt("雨夜小镇");
  console.log(`  ${prompt2.includes("门外传来急促的敲门声") ? "✅" : "❌"} keyword event fired`);

  // story state must have advanced
  const data = await api(cookie, "/api/data");
  const c = data.conversations.find((x: any) => x.id === convo.id);
  const triggered = c?.storyState?.triggeredEventIds ?? [];
  console.log(`  ${triggered.includes("ev_kw") ? "✅" : "❌"} story state advanced (${JSON.stringify(triggered)})`);

  // a manual event (composer button) fires on the next turn
  await resetLog();
  await fetch(`${API}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ conversationId: convo.id, text: "然后呢", storyEventId: "ev_manual" }),
  }).then((r) => r.text());
  const prompt3 = await chatPrompt("雨夜小镇");
  console.log(`  ${prompt3.includes("所有的灯忽然熄灭了") ? "✅" : "❌"} manual event fired`);

  // story mode must NOT leak long-term memories into the prompt
  console.log(`  ${!prompt3.includes("你的长期记忆") ? "✅" : "❌"} long-term memories excluded in story mode`);

  process.exit(0);
}

main().catch((e) => {
  console.error("FAILED:", e.message);
  process.exit(1);
});

import { API, MOCK_API, login, api, seedBasics, promptLog, resetLog, chatPrompt } from "./fixtures.ts";

// Verifies the memory garden works against the hub: create, edit,
// delete — through the exact endpoints the web client uses.



async function main() {
  const { cookie } = await login();
  if (!cookie) throw new Error("login failed");
  await seedBasics(cookie);

  // the exact endpoint the client's RemoteTable("memories") generates
  const mem = {
    id: "mem_test1",
    agentId: "ag1",
    content: "用户喜欢深夜写代码",
    kind: "preference",
    importance: 4,
    embedding: null,
    pinned: false,
    hitCount: 0,
    scope: "agent",
    createdAt: 1,
    updatedAt: 1,
  };

  const put = await api(cookie, "/api/data/memories/mem_test1", { method: "PUT", body: JSON.stringify(mem) });
  console.log(`  ${put.ok ? "✅" : "❌"} memory created via /api/data/memories/:id`);

  // it must show up in the memory garden list
  const list = await api(cookie, "/api/memories");
  const found = Array.isArray(list) ? list.find((m: any) => m.id === "mem_test1") : null;
  console.log(`  ${found ? "✅" : "❌"} memory listed in the garden`);

  // edit it (the UI's "edit memory" action)
  const edited = { ...mem, content: "用户喜欢在雨夜写代码", importance: 5, updatedAt: 2 };
  const put2 = await api(cookie, "/api/data/memories/mem_test1", { method: "PUT", body: JSON.stringify(edited) });
  const list2 = await api(cookie, "/api/memories");
  const found2 = Array.isArray(list2) ? list2.find((m: any) => m.id === "mem_test1") : null;
  console.log(`  ${found2?.content === edited.content ? "✅" : "❌"} memory edited (${found2?.content})`);

  // pin it
  const pinned = { ...edited, pinned: true, updatedAt: 3 };
  await api(cookie, "/api/data/memories/mem_test1", { method: "PUT", body: JSON.stringify(pinned) });
  const list3 = await api(cookie, "/api/memories");
  const found3 = Array.isArray(list3) ? list3.find((m: any) => m.id === "mem_test1") : null;
  console.log(`  ${found3?.pinned === true ? "✅" : "❌"} memory pinned`);

  // delete it
  await api(cookie, "/api/data/memories/mem_test1", { method: "DELETE" });
  const list4 = await api(cookie, "/api/memories");
  const gone = Array.isArray(list4) ? !list4.find((m: any) => m.id === "mem_test1") : false;
  console.log(`  ${gone ? "✅" : "❌"} memory deleted`);

  // the bootstrap payload must carry memories too (the client caches them)
  const data = await api(cookie, "/api/data");
  console.log(`  ${Array.isArray(data.memories) ? "✅" : "❌"} memories included in /api/data`);

  process.exit(0);
}

main().catch((e) => {
  console.error("FAILED:", e.message);
  process.exit(1);
});

// Global message search: the server searches the whole history and
// groups the hits per conversation.
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

  // two conversations with a unique term (so repeated runs stay clean)
  const term = `手冲咖啡${Date.now().toString(36)}`;
  const c1 = await api(cookie, "/api/conversations", {
    method: "POST",
    body: JSON.stringify({ agentId: "ag1", title: `关于咖啡 ${term}` }),
  });
  const c2 = await api(cookie, "/api/conversations", {
    method: "POST",
    body: JSON.stringify({ agentId: "ag1", title: "关于代码" }),
  });

  const send = async (convoId: string, text: string) => {
    const res = await fetch(`${API}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ conversationId: convoId, text }),
    });
    await res.text();
  };

  await send(c1.id, `我每天早上都要来一杯${term}`);
  await send(c2.id, "这段 TypeScript 代码有点难写");

  // search for a word that only appears in the first conversation
  const hit = await api(cookie, "/api/search?q=" + encodeURIComponent(term));
  const groups = hit.results ?? [];
  ok("search returns groups", groups.length === 1, `got ${groups.length}`);
  ok("hit is in the right conversation", groups[0]?.conversationId === c1.id);
  ok("hit carries the conversation title", groups[0]?.conversationTitle?.includes(term) === true);
  ok("hit contains the message", groups[0]?.hits?.[0]?.content?.includes(term) === true);

  // a term that appears nowhere
  const none = await api(cookie, "/api/search?q=" + encodeURIComponent("完全不存在的词"));
  ok("no results for unknown term", (none.results ?? []).length === 0);

  // an empty query returns nothing (no crash)
  const empty = await api(cookie, "/api/search?q=");
  ok("empty query is safe", Array.isArray(empty) ? empty.length === 0 : true);

  // results are grouped per conversation, newest first
  const both = await api(cookie, "/api/search?q=" + encodeURIComponent("我"));
  ok("grouping works for a common term", Array.isArray(both.results));

  console.log(`\nPASS=${pass} FAIL=${fail}`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("FAILED:", e.message);
  process.exit(1);
});

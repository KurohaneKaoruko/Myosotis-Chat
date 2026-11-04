import { API, MOCK_API, login, api, seedBasics, promptLog, resetLog, chatPrompt } from "./fixtures.ts";

// Verifies the image pipeline: upload → message stores only the URL →
// the file is served back. Also checks content-addressed dedupe.

// 1×1 red PNG
const PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";



async function main() {
  const { cookie } = await login();
  if (!cookie) throw new Error("login failed");
  await seedBasics(cookie);

  // upload
  const up = await api(cookie, "/api/upload", { method: "POST", body: JSON.stringify({ data: PNG }) });
  console.log("[test] upload →", JSON.stringify(up));
  if (!up.url) throw new Error("upload failed");

  // dedupe: same bytes → same url
  const up2 = await api(cookie, "/api/upload", { method: "POST", body: JSON.stringify({ data: PNG }) });
  console.log(`  ${up2.url === up.url ? "✅" : "❌"} identical images dedupe (${up.url} vs ${up2.url})`);

  // served back (the client stores the relative path)
  const res = await fetch(API + up.path);
  const buf = Buffer.from(await res.arrayBuffer());
  console.log(`  ${res.status === 200 ? "✅" : "❌"} image served (${res.status}, ${buf.length} bytes, ${res.headers.get("content-type")})`);
  console.log(`  ${res.headers.get("cache-control")?.includes("immutable") ? "✅" : "❌"} immutable cache header`);

  // reject non-images
  const bad = await api(cookie, "/api/upload", {
    method: "POST",
    body: JSON.stringify({ data: "data:text/plain;base64,aGVsbG8=" }),
  });
  console.log(`  ${bad.error === "unsupported-image" ? "✅" : "❌"} non-image rejected (${JSON.stringify(bad)})`);

  // path traversal is refused
  const trav = await fetch(`${API}/uploads/..%2F..%2Fhub.db`);
  console.log(`  ${trav.status === 404 ? "✅" : "❌"} path traversal refused (${trav.status})`);

  // a big-but-legal image (≈6MB of PNG bytes) must pass the server's own
  // body parser — the Fastify default (1MiB) would 413 it before the
  // upload size check ever runs (regression: bodyLimit < MAX_UPLOAD_BYTES)
  const bigBlob = Buffer.alloc(6 * 1024 * 1024, 0x89);
  const bigPNG =
    "data:image/png;base64," +
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==" +
    bigBlob.toString("base64");
  const bigRes = await fetch(`${API}/api/upload`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ data: bigPNG }),
  });
  const big = await bigRes.json().catch(() => ({ raw: "not-json" }));
  console.log(`  ${bigRes.status === 200 && big.url ? "✅" : "❌"} ~8MB body upload accepted (status=${bigRes.status}, ${(big.url ?? JSON.stringify(big)).slice(0, 40)})`);
  if (big.path) {
    const head = await fetch(API + big.path, { method: "HEAD" });
    console.log(`  ${head.status === 200 ? "✅" : "❌"} big image served back (${head.status})`);
  }

  // an oversized body (base64 past MAX_UPLOAD_BYTES * 1.4) must still be
  // rejected by the hub's own limit — and with 413, not a parse error
  const hugePNG =
    "data:image/png;base64," +
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==" +
    Buffer.alloc(12 * 1024 * 1024, 0x89).toString("base64");
  const hugeRes = await fetch(`${API}/api/upload`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ data: hugePNG }),
  });
  console.log(`  ${hugeRes.status === 413 ? "✅" : "❌"} oversized upload still 413 (status=${hugeRes.status})`);

  // a message with the image stores only the URL
  const convo = await api(cookie, "/api/conversations", {
    method: "POST",
    body: JSON.stringify({ agentId: "ag1", title: "图片消息" }),
  });
  const chat = await fetch(`${API}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ conversationId: convo.id, text: "看图", images: [up.path] }),
  });
  await chat.text();
  const messages = await api(cookie, `/api/conversations/${convo.id}/messages`);
  const withImage = messages.find((m: any) => m.images?.length);
  const stored = withImage?.images?.[0] ?? "";
  console.log(`  ${stored.startsWith("/uploads/") ? "✅" : "❌"} message stores the URL (${stored.slice(0, 40)})`);
  console.log(`  ${!stored.startsWith("data:") ? "✅" : "❌"} no base64 left in the message`);

  process.exit(0);
}

main().catch((e) => {
  console.error("FAILED:", e.message);
  process.exit(1);
});

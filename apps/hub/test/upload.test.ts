// Verifies the image pipeline: upload → message stores only the URL →
// the file is served back. Also checks content-addressed dedupe.
const API = "http://127.0.0.1:8791";

// 1×1 red PNG
const PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

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

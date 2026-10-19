// Verification for crypto.ts and webdav.ts request construction.
import { encryptText, decryptText } from "../src/lib/crypto.ts";
import { davPut, davGet, davList, davMkdir } from "../src/lib/webdav.ts";

async function main() {
  // ---- crypto roundtrip ----
  const secret = JSON.stringify({ hello: "世界", n: 42 });
  const payload = await encryptText(secret, "pw-123");
  const round = await decryptText(payload, "pw-123");
  console.log("CRYPTO roundtrip :", round === secret ? "OK" : "FAIL");
  let wrongRejected = false;
  try {
    await decryptText(payload, "wrong");
  } catch {
    wrongRejected = true;
  }
  console.log("CRYPTO wrong-pw  :", wrongRejected ? "OK (rejected)" : "FAIL");

  // ---- webdav request construction (mock fetch) ----
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), method: init?.method, auth: init?.headers?.Authorization?.slice(0, 10) });
    if (init?.method === "PROPFIND") {
      return new Response(
        `<?xml version="1.0"?><d:multistatus xmlns:d="DAV:">
        <d:response><d:href>/dav/Myosotis/</d:href></d:response>
        <d:response><d:href>/dav/Myosotis/myosotis-backup-2026-10-04.json</d:href>
          <d:propstat><d:prop><d:getlastmodified>Mon, 04 Oct 2026 01:00:00 GMT</d:getlastmodified></d:prop></d:propstat></d:response>
      </d:multistatus>`,
        { status: 207 }
      );
    }
    if (init?.method === "GET") return new Response('{"magic":"myosotis-backup"}', { status: 200 });
    return new Response(null, { status: 201 });
  };

  const cfg = { url: "https://dav.example.com/dav/", username: "u", password: "p", directory: "/Myosotis" };
  await davMkdir(cfg, "/");
  await davPut(cfg, "test.json", "{}");
  const text = await davGet(cfg, "/Myosotis/test.json");
  const list = await davList(cfg, "/Myosotis");

  console.log("MKCOL url  :", calls[0].url === "https://dav.example.com/dav/Myosotis" ? "OK" : "FAIL " + calls[0].url);
  console.log("PUT  url   :", calls[1].url.endsWith("/dav/Myosotis/test.json") ? "OK" : "FAIL " + calls[1].url);
  console.log("AUTH header:", calls[1].auth === "Basic dTpw" ? "OK" : "FAIL " + calls[1].auth);
  console.log("GET  text  :", text.includes("myosotis-backup") ? "OK" : "FAIL");
  console.log("LIST parse :", list.length === 1 && list[0].name.endsWith(".json") ? "OK" : "FAIL " + JSON.stringify(list));
}

main().catch((e) => {
  console.error("FAILED:", e?.message ?? e);
  process.exit(1);
});

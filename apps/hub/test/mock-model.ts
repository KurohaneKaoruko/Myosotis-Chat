// Mock model server for the hub test suite.
//
// Speaks just enough OpenAI-compatible protocol for the tests:
//   POST /v1/chat/completions  — SSE stream (or one JSON blob)
//   POST /v1/embeddings        — a tiny deterministic vector
//   GET  /v1/models            — model listing
//   GET  /prompt-log           — every system prompt the mock received
//   POST /reset-log            — clear the prompt log
//   GET  /stats                — how many streams completed / were aborted
//
// Two knobs the stop test relies on:
//   ?slow=1 on the base url (or model name "slow") → streams one
//   chunk per 500ms so the turn can be aborted mid-flight.
import http from "node:http";

const PORT = Number(process.env.MOCK_PORT ?? 9911);

/** every system prompt received since the last reset (newest last) */
const promptLog: string[] = [];
/** stream accounting for the stop test */
let completed = 0;
let aborted = 0;

function body(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let out = "";
    req.on("data", (d) => (out += d));
    // a client that vanishes mid-request never fires "end" — resolve then
    req.on("close", () => resolve(out));
    req.on("end", () => resolve(out));
  });
}

function sse(res: http.ServerResponse, event: string, data: unknown) {
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function startMock(port: number): http.Server {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);
    const path = url.pathname;

  // ---- test introspection endpoints ----
  if (path === "/prompt-log") {
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify(promptLog));
  }
  if (path === "/reset-log") {
    promptLog.length = 0;
    res.writeHead(200, { "content-type": "application/json" });
    return res.end('{"ok":true}');
  }
  if (path === "/stats") {
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify({ completed, aborted }));
  }

  // ---- OpenAI-compatible model listing ----
  if (path.endsWith("/models")) {
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify({ data: [{ id: "mock-chat" }, { id: "slow" }] }));
  }

  // ---- OpenAI-compatible embeddings ----
  if (path.endsWith("/embeddings")) {
    const raw = await body(req);
    let input = "";
    try {
      input = JSON.parse(raw).input ?? "";
    } catch {}
    // deterministic small vector: derived from the first characters
    const vec = [0.1 + (input.charCodeAt(0) % 32) / 100, 0.5, -0.2, 0.9, 0.3];
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify({ data: [{ embedding: vec }] }));
  }

  // ---- OpenAI-compatible chat completions (SSE or JSON) ----
  if (path.endsWith("/chat/completions")) {
    const raw = await body(req);
    let parsed: any = {};
    try {
      parsed = JSON.parse(raw);
    } catch {}
    const messages: any[] = Array.isArray(parsed.messages) ? parsed.messages : [];
    const system = messages.find((m) => m.role === "system");
    if (system?.content) promptLog.push(String(system.content));

    const slow = /(^|[-_])slow|slow$/.test(String(parsed.model ?? "")) || url.searchParams.has("slow");
    const userText = [...messages].reverse().find((m) => m.role === "user");
    const reply = `收到：${typeof userText?.content === "string" ? userText.content.slice(0, 30) : "你好"}`;

    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    });

    // non-streaming: one blob then close
    if (parsed.stream === false) {
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: reply } }] })}\n\n`);
      res.end();
      completed++;
      return;
    }

    // streaming: a few quick chunks, then (for slow mocks) a long tail
    let i = 0;
    res.on("close", () => {
      // the response socket closed before [DONE] — the hub cancelled
      // the upstream call (stop-generation) or went away
      if (!res.writableEnded) aborted++;
    });
    const chunk = () => {
      if (res.writableEnded || res.destroyed) return;
      if (i < 3) {
        sse(res, "delta", { choices: [{ delta: { content: `chunk${i} ` } }] });
        i++;
        setTimeout(chunk, slow ? 500 : 10);
        return;
      }
      if (slow) {
        // long tail: keep streaming until the client goes away
        sse(res, "delta", { choices: [{ delta: { content: "tail " } }] });
        setTimeout(chunk, 500);
        return;
      }
      sse(res, "delta", { choices: [{ delta: { content: reply } }] });
      res.write("data: [DONE]\n\n");
      res.end();
      completed++;
    };
    chunk();
    return;
  }

  res.writeHead(404, { "content-type": "application/json" });
  res.end('{"error":{"message":"mock: not found"}}');
  });

  return server;
}

/** every mock shares one prompt log / stats, so the tests can hit either port */
const primary = startMock(PORT);
primary.listen(PORT, "127.0.0.1", () => {
  console.log(`[mock-model] listening on http://127.0.0.1:${PORT}`);
});

// The stop test points a provider at PORT+1 with model name "slow";
// run a second identical server there so the suite needs no extra setup.
const slowTwin = startMock(PORT + 1);
slowTwin.listen(PORT + 1, "127.0.0.1", () => {
  console.log(`[mock-model] slow twin on http://127.0.0.1:${PORT + 1}`);
});


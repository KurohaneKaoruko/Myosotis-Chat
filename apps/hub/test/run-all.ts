// Runs the whole hub test suite. Self-contained: this script starts
// the mock model server (:9911/:9912) and a throwaway hub (:8791,
// data in a temp dir — your real data/ is never touched), runs every
// suite, then shuts everything down.
//
//   pnpm --filter @myosotis/hub test
//
// The HUB_API / MOCK_API / MYO_DATA_DIR env vars still win, so a
// manually started hub can be tested the old way:
//   HUB_API=http://127.0.0.1:8791 node test/run-all.ts
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const SUITES = [
  "smoke",
  "realtime",
  "delivery",
  "stop",
  "upload",
  "memory",
  "story",
  "group",
  "search",
  "scope",
  "guards",
  "isolation",
];

const API = process.env.HUB_API ?? "";
const MOCK_API = process.env.MOCK_API ?? "";

/** wait until a http endpoint answers (or timeout) */
async function waitReady(url: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(1000) });
      if (res.ok || res.status === 404) return true;
    } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

function run(suite: string): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      ["--experimental-strip-types", "--no-warnings", path.join(here, `${suite}.test.ts`)],
      {
        stdio: ["ignore", "pipe", "pipe"],
        env: {
          ...process.env,
          HUB_API: API || process.env.HUB_API || "http://127.0.0.1:8791",
          MOCK_API: MOCK_API || process.env.MOCK_API || "http://127.0.0.1:9911",
          // suites (isolation) may need to insert extra test users into
          // the throwaway database
          MYO_DATA_DIR: managedDataDir ?? process.env.MYO_DATA_DIR,
        },
      }
    );
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    child.on("close", (code) => resolve({ code: code ?? 1, out }));
  });
}

let managedDataDir: string | null = null;
const managed: import("node:child_process").ChildProcess[] = [];

function stopManaged() {
  for (const c of managed) {
    try {
      c.kill("SIGTERM");
    } catch {}
  }
  managed.length = 0;
  if (managedDataDir) {
    try {
      rmSync(managedDataDir, { recursive: true, force: true });
    } catch {}
    managedDataDir = null;
  }
}

// ------------------------------------------------------------ setup
if (!API) {
  // mock model server
  const mock = spawn(
    process.execPath,
    ["--experimental-strip-types", "--no-warnings", path.join(here, "mock-model.ts")],
    { stdio: ["ignore", "pipe", "pipe"] }
  );
  managed.push(mock);
  mock.stderr.on("data", (d) => process.stderr.write(`[mock] ${d}`));

  // throwaway hub on :8791 with a temp data dir
  managedDataDir = mkdtempSync(path.join(tmpdir(), "myosotis-test-"));
  const hub = spawn(
    process.execPath,
    ["--experimental-strip-types", "--no-warnings", path.join(here, "../src/index.ts")],
    {
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        PORT: "8791",
        HOST: "127.0.0.1",
        MYO_DATA_DIR: managedDataDir,
        MYO_WEB_DIST: path.join(here, "../../web/dist"),
      },
    }
  );
  managed.push(hub);
  hub.stderr.on("data", (d) => process.stderr.write(`[hub] ${d}`));

  const mockUp = await waitReady("http://127.0.0.1:9911/stats", 10_000);
  const hubUp = await waitReady("http://127.0.0.1:8791/api/health", 15_000);
  if (!mockUp || !hubUp) {
    console.error("managed servers did not come up — aborting");
    stopManaged();
    process.exit(1);
  }
}

process.on("exit", stopManaged);
process.on("SIGINT", () => {
  stopManaged();
  process.exit(130);
});

// ------------------------------------------------------------- run
let failed = 0;
for (const suite of SUITES) {
  const { code, out } = await run(suite);
  const pass = (out.match(/✅/g) ?? []).length;
  const bad = (out.match(/❌/g) ?? []).length;
  const status = code === 0 ? "✅" : "❌";
  console.log(`${status} ${suite.padEnd(9)} ${pass} passed, ${bad} failed`);
  if (code !== 0) {
    failed++;
    console.log(out.split("\n").filter((l) => l.includes("❌") || l.includes("Error") || l.includes("FAILED")).join("\n"));
  }
  // a suite that ran zero assertions is suspicious (crashed early?) — show why
  if (pass === 0) console.log(out.trim());
}
console.log(failed === 0 ? "\nAll suites green." : `\n${failed} suite(s) failed.`);
stopManaged();
process.exit(failed === 0 ? 0 : 1);

// Ephemeral runner: same orchestration as run-all.ts but on ports that
// do not collide with other sessions' test servers (9911/9912/8791 are
// taken on this box). Mock pair 9941/9942, hub 8793.
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const SUITES = [
  "smoke", "realtime", "delivery", "stop", "upload", "memory",
  "story", "group", "search", "scope", "guards", "isolation", "ratelimit",
];
const API = "http://127.0.0.1:8793";
const MOCK = "http://127.0.0.1:9941";

function wait(url) {
  return (async () => {
    for (let i = 0; i < 100; i++) {
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(1000) });
        if (res.ok || res.status === 404) return true;
      } catch {}
      await new Promise((r) => setTimeout(r, 200));
    }
    return false;
  })();
}

const dataDir = mkdtempSync("/tmp/opencode/hubfinal-");
const kids = [];
const mock = spawn(process.execPath, ["--experimental-strip-types", "--no-warnings", path.join(here, "mock-model.ts")], {
  env: { ...process.env, MOCK_PORT: "9941" }, stdio: "inherit",
});
kids.push(mock);
const hub = spawn(process.execPath, ["--experimental-strip-types", "--no-warnings", path.join(here, "../src/index.ts")], {
  env: { ...process.env, MYO_DATA_DIR: dataDir, MYO_WEB_DIST: "/home/nightx/projects/Myosotis-Chat/apps/web/dist", PORT: "8793", HOST: "127.0.0.1" },
  stdio: "inherit",
});
kids.push(hub);

const upMock = await wait(`${MOCK}/stats`);
const upHub = await wait(`${API}/api/health`);
let failed = false;
if (!upMock || !upHub) {
  console.error("managed servers did not come up — aborting");
  failed = true;
} else {
  for (const s of SUITES) {
    const code = await new Promise((resolve) => {
      const c = spawn(process.execPath, ["--experimental-strip-types", "--no-warnings", path.join(here, `${s}.test.ts`)], {
        stdio: ["ignore", "inherit", "inherit"],
        env: { ...process.env, HUB_API: API, MOCK_API: MOCK, MYO_DATA_DIR: dataDir },
      });
      c.on("close", (x) => resolve(x ?? 1));
    });
    if (code !== 0) {
      console.error(`suite ${s} exited ${code}`);
      failed = true;
    }
  }
}
for (const k of kids) { try { k.kill("SIGTERM"); } catch {} }
try { rmSync(dataDir, { recursive: true, force: true }); } catch {}
process.exit(failed ? 1 : 0);

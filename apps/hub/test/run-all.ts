// Runs the whole hub test suite against a running hub + mock model.
//
//   pnpm --filter @myosotis/hub test
//
// Requires: the hub on :8791 and the mock model server on :9911.
import { spawn } from "node:child_process";
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
];

function run(suite: string): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      ["--experimental-strip-types", "--no-warnings", path.join(here, `${suite}.test.ts`)],
      { stdio: ["ignore", "pipe", "pipe"] }
    );
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    child.on("close", (code) => resolve({ code: code ?? 1, out }));
  });
}

let failed = 0;
for (const suite of SUITES) {
  const { code, out } = await run(suite);
  const pass = (out.match(/✅/g) ?? []).length;
  const bad = (out.match(/❌/g) ?? []).length;
  const status = code === 0 ? "✅" : "❌";
  console.log(`${status} ${suite.padEnd(9)} ${pass} passed, ${bad} failed`);
  if (code !== 0) {
    failed++;
    console.log(out.split("\n").filter((l) => l.includes("❌") || l.includes("Error")).join("\n"));
  }
}
console.log(failed === 0 ? "\nAll suites green." : `\n${failed} suite(s) failed.`);
process.exit(failed === 0 ? 0 : 1);

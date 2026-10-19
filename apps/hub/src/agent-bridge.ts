// ================================================================
// Agent-tool bridge — spawn coding-agent CLIs (claude, codex, gemini,
// qwen-code, droid, aider …) as child processes and surface them in
// Myosotis as special "tool agents".
//
// The bridge is deliberately thin: we do NOT re-implement agent
// internals. We run the CLI with a PTY-ish pipe, forward its stdout
// into the chat as assistant messages, and relay user messages to
// its stdin. Provider keys live in each CLI's own login/config; the
// hub only orchestrates.
// ================================================================
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { uid, now } from "@myosotis/core";
import type { ChatMessage } from "@myosotis/core";

export interface AgentToolSpec {
  id: string; // "claude" | "codex" | …
  label: string;
  /** spawn argv template; {prompt} is replaced by the user turn */
  args: string[];
  /** require the binary to exist, checked at startup */
  binary: string;
  cwd?: string;
  /** parse CLI stdout into chat-friendly chunks */
  plain?: boolean;
  hint?: string;
}

export const AGENT_TOOLS: AgentToolSpec[] = [
  {
    id: "claude",
    label: "Claude Code",
    binary: "claude",
    args: ["--print", "--verbose", "{prompt}"],
    hint: "Anthropic 官方编码 Agent（需要 claude login）",
  },
  {
    id: "codex",
    label: "Codex CLI",
    binary: "codex",
    args: ["exec", "--json", "{prompt}"],
    hint: "OpenAI 官方编码 Agent（需要 codex login）",
  },
  {
    id: "gemini",
    label: "Gemini CLI",
    binary: "gemini",
    args: ["--prompt", "{prompt}"],
    hint: "Google 官方编码 Agent",
  },
  {
    id: "qwen-code",
    label: "Qwen Code",
    binary: "qwen",
    args: ["--prompt", "{prompt}"],
    hint: "Qwen 编码 Agent",
  },
  {
    id: "aider",
    label: "Aider",
    binary: "aider",
    args: ["--yes-always", "--no-auto-commits", "--message", "{prompt}"],
    hint: "开源 pair-programming Agent",
  },
];

export interface BridgeEvents {
  onDelta?: (text: string) => void;
  onExit?: (code: number | null) => void;
}

export class AgentBridge {
  private proc: ChildProcessWithoutNullStreams | null = null;
  private spec: AgentToolSpec;
  private cwd: string;

  constructor(spec: AgentToolSpec, cwd: string) {
    this.spec = spec;
    this.cwd = cwd;
  }

  get busy() {
    return !!this.proc;
  }

  /**
   * Run one turn. Resolves with the full text output when the CLI
   * exits. `onDelta` fires per line for a streaming feel.
   */
  run(prompt: string, events: BridgeEvents = {}): Promise<{ text: string; code: number | null }> {
    if (this.proc) return Promise.resolve({ text: "上一条任务仍在运行中…", code: null });
    const argv = this.spec.args.map((a) => a.replace("{prompt}", prompt));
    return new Promise((resolve) => {
      let text = "";
      let proc: ChildProcessWithoutNullStreams;
      try {
        proc = spawn(this.spec.binary, argv, {
          cwd: this.cwd,
          env: { ...process.env, NO_COLOR: "1", TERM: "dumb" },
        }) as ChildProcessWithoutNullStreams;
      } catch (e) {
        resolve({ text: `无法启动 ${this.spec.binary}：${e}`, code: null });
        return;
      }
      this.proc = proc;
      proc.stdout.setEncoding("utf8");
      proc.stderr.setEncoding("utf8");
      const onChunk = (d: string) => {
        text += d;
        events.onDelta?.(d);
      };
      proc.stdout.on("data", onChunk);
      proc.stderr.on("data", onChunk);
      proc.on("error", (e) => {
        this.proc = null;
        resolve({ text: text + `\n[启动失败] ${e.message}`, code: null });
      });
      proc.on("close", (code) => {
        this.proc = null;
        events.onExit?.(webExit(code));
        resolve({ text, code });
      });
    });
  }

  kill() {
    this.proc?.kill("SIGTERM");
    this.proc = null;
  }
}

function webExit(code: number | null) {
  return code;
}

/** probe which tools are installed on the hub host */
export async function probeTools(): Promise<Array<{ id: string; label: string; available: boolean; hint?: string }>> {
  const { execFile } = await import("node:child_process");
  const results = await Promise.all(
    AGENT_TOOLS.map(
      (t) =>
        new Promise<{ id: string; label: string; available: boolean; hint?: string }>((res) => {
          execFile("which", [t.binary], (err) =>
            res({ id: t.id, label: t.label, available: !err, hint: t.hint })
          );
        })
    )
  );
  return results;
}

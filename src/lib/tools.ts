/**
 * Tool registry untuk ReAct Agentic Workflow.
 *
 * Local tools jalan di browser. Bridge tools call ke Aurora Agent Bridge.
 */

import type { BridgeConfig } from "./store";
import {
  bridgeExec,
  bridgeGit,
  bridgeMetrics,
  bridgeRead,
  bridgeTail,
  bridgeWrite,
  bridgeReady,
  bridgeDiff,
  bridgeServices,
  bridgeProcesses,
  bridgeJournal,
} from "./bridge";

export interface ToolDefinition {
  name: string;
  description: string;
  inputHint: string;
  /** When true, the tool mutates state on the server. */
  mutating?: boolean;
  run: (input: string, ctx: ToolContext) => Promise<string> | string;
}

export interface ToolContext {
  bridge: BridgeConfig;
}

function safeCalc(expr: string): string {
  if (!/^[\d\s+\-*/().,%]+$/.test(expr)) {
    return "Error: expression contains disallowed characters.";
  }
  try {
    const result = Function(`"use strict"; return (${expr.replace(/,/g, ".")});`)();
    if (typeof result !== "number" || !Number.isFinite(result)) {
      return "Error: not a finite number.";
    }
    return String(result);
  } catch (e) {
    return `Error: ${e instanceof Error ? e.message : "calc failed"}`;
  }
}

const localTools: ToolDefinition[] = [
  {
    name: "get_time",
    description: "Return the current local date and time.",
    inputHint: "(any string, ignored)",
    run: () => new Date().toLocaleString(undefined, { dateStyle: "full", timeStyle: "long" }),
  },
  {
    name: "calculator",
    description: "Evaluate a basic math expression. Supports + - * / ( ) and decimals.",
    inputHint: "e.g. 23 * (4 + 7) / 2",
    run: (input) => safeCalc(input),
  },
];

/** Tools that hit the user's server via Aurora Agent Bridge. */
const bridgeTools: ToolDefinition[] = [
  {
    name: "server_metrics",
    description:
      "Return live CPU%, RAM, load avg, and disk usage from the user's server. Call this first when diagnosing performance.",
    inputHint: "(any, ignored)",
    run: async (_input, { bridge }) => {
      const m = await bridgeMetrics(bridge);
      return JSON.stringify(m, null, 2);
    },
  },
  {
    name: "list_services",
    description: "List all systemd services with their state. Use to find failed/inactive services.",
    inputHint: "(any, ignored)",
    run: async (_input, { bridge }) => {
      const r = await bridgeServices(bridge);
      const failed = (r.services ?? []).filter((s) => s.active === "failed");
      const head = `${r.services?.length ?? 0} services, ${failed.length} failed`;
      const lines = (r.services ?? [])
        .slice(0, 50)
        .map((s) => `${s.name.padEnd(40)} ${s.active}/${s.sub}  ${s.description}`)
        .join("\n");
      return `${head}\n${lines}${r.error ? `\nERROR: ${r.error}` : ""}`;
    },
  },
  {
    name: "top_processes",
    description: "Top processes by CPU. Use to find what's eating resources.",
    inputHint: '"15"  (number of processes, default 15)',
    run: async (input, { bridge }) => {
      const n = Math.max(1, Math.min(50, Number(input.trim()) || 15));
      const r = await bridgeProcesses(bridge, n);
      const lines = (r.processes ?? [])
        .map((p) => `${String(p.pid).padStart(6)} ${p.cpu.toFixed(1).padStart(5)}% ${p.mem.toFixed(1).padStart(5)}%  ${p.comm}  ${p.args}`)
        .join("\n");
      return `PID    CPU%  MEM%  COMMAND\n${lines}`;
    },
  },
  {
    name: "get_logs",
    description: "Fetch recent journalctl logs. Filter by unit (e.g. nginx.service) or omit for all.",
    inputHint: '{"unit":"nginx.service","lines":100}  or  {"lines":50}',
    run: async (input, { bridge }) => {
      let parsed: { unit?: string; lines?: number };
      try { parsed = JSON.parse(input); } catch { parsed = { unit: input.trim() }; }
      const r = await bridgeJournal(bridge, { unit: parsed.unit, lines: parsed.lines ?? 100 });
      return r.content || "(no logs)";
    },
  },
  {
    name: "server_exec",
    description:
      "Run a shell command on the server (sh -c). Subject to safe-mode allow-list if enabled. Use for diagnostics: git status, docker ps, ls -la, tail logs. Returns stdout, stderr, exit code.",
    inputHint: "the shell command verbatim, e.g. `systemctl status myapp`",
    run: async (input, { bridge }) => {
      const r = await bridgeExec(bridge, input);
      if (r.blocked) {
        return `🛑 BLOCKED: ${r.reason}\n(switch bridge to free mode if you need this)`;
      }
      return [
        `exit=${r.code} duration=${r.durationMs}ms${r.timedOut ? " (timed out)" : ""}`,
        r.stdout && `--- stdout ---\n${r.stdout}`,
        r.stderr && `--- stderr ---\n${r.stderr}`,
      ]
        .filter(Boolean)
        .join("\n");
    },
  },
  {
    name: "read_file",
    description: "Read a file from the project root on the server. ALWAYS call before write_file.",
    inputHint: "relative path, e.g. `src/app.ts` or `package.json`",
    run: async (input, { bridge }) => {
      const r = await bridgeRead(bridge, input.trim());
      return `(${r.size} bytes)\n${r.content}`;
    },
  },
  {
    name: "diff_file",
    description:
      "Preview a write WITHOUT applying it. Returns a unified diff. ALWAYS call before write_file so the user can review.",
    inputHint: '{"path":"src/x.ts","content":"…"}',
    run: async (input, { bridge }) => {
      let parsed: { path?: string; content?: string };
      try { parsed = JSON.parse(input); } catch { return "Error: input must be JSON {path, content}"; }
      if (!parsed.path || typeof parsed.content !== "string") return "Error: path & content required";
      const r = await bridgeDiff(bridge, parsed.path, parsed.content);
      if (!r.diff) return "(no changes)";
      return `(file ${r.exists ? "exists" : "is new"})\n${r.diff}`;
    },
  },
  {
    name: "write_file",
    description:
      "Overwrite a file AND auto-commit it to git. ⚠ Mutating: use only after diff_file shows the intended change.",
    inputHint: '{"path":"src/x.ts","content":"…","message":"fix: bug"}',
    mutating: true,
    run: async (input, { bridge }) => {
      let parsed: { path?: string; content?: string; message?: string };
      try { parsed = JSON.parse(input); } catch { return "Error: input must be valid JSON"; }
      if (!parsed.path || typeof parsed.content !== "string") return "Error: path & content required";
      const r = await bridgeWrite(bridge, {
        path: parsed.path,
        content: parsed.content,
        commit: true,
        message: parsed.message,
      });
      return `Wrote ${r.bytes} bytes. git commit exit=${r.commitCode ?? "n/a"}\n${r.commitStdout ?? ""}`;
    },
  },
  {
    name: "git",
    description: "Run a git command on the project repo.",
    inputHint: '["status"]  or  ["log","--oneline","-10"]',
    run: async (input, { bridge }) => {
      let args: string[];
      try {
        args = JSON.parse(input);
        if (!Array.isArray(args)) throw new Error("not array");
      } catch {
        return "Error: input must be a JSON array of git arguments.";
      }
      const r = await bridgeGit(bridge, args);
      return `exit=${r.code}\n${r.stdout}`;
    },
  },
  {
    name: "tail_log",
    description: "Tail the last N lines of a log file.",
    inputHint: '{"path":"/var/log/syslog","lines":100}',
    run: async (input, { bridge }) => {
      let parsed: { path?: string; lines?: number };
      try { parsed = JSON.parse(input); } catch { parsed = { path: input.trim() }; }
      if (!parsed.path) return "Error: path required.";
      const r = await bridgeTail(bridge, parsed.path, parsed.lines ?? 200);
      return r.content || "(empty)";
    },
  },
];

export function getActiveTools(bridge: BridgeConfig): ToolDefinition[] {
  if (bridgeReady(bridge)) return [...localTools, ...bridgeTools];
  return localTools;
}

export function getToolByName(name: string, bridge: BridgeConfig): ToolDefinition | undefined {
  const n = name.trim().toLowerCase();
  return getActiveTools(bridge).find((t) => t.name === n);
}

export function buildToolsManual(bridge: BridgeConfig): string {
  return getActiveTools(bridge)
    .map((t) => `- ${t.name}${t.mutating ? " ⚠mutating" : ""}: ${t.description}\n    Input: ${t.inputHint}`)
    .join("\n");
}

export function buildReactSystemPrompt(bridge: BridgeConfig, autoContext?: string): string {
  const ready = bridgeReady(bridge);
  return `You are an agentic SRE assistant that follows the ReAct (Reasoning + Acting) protocol.

${ready
    ? "You ARE connected to the user's server via the Aurora Agent Bridge. Prefer real evidence (metrics, command output, file contents) over speculation."
    : "⚠ The Aurora Agent Bridge is NOT configured. You only have local tools (math, time). Tell the user to configure the bridge in Settings to give you server access."}

${autoContext ? `\n--- Live server snapshot ---\n${autoContext}\n--- end snapshot ---\n` : ""}
Available tools:
${buildToolsManual(bridge)}

For EVERY user message respond using this exact format, one block per step:

Thought: <reasoning, 1-2 sentences>
Action: <tool_name from the list, or "none">
Action Input: <input string for the tool, or "-" if Action is none>

After Action (other than "none"), STOP. The system runs the tool and returns:

Observation: <tool result>

Continue with another Thought / Action / Action Input cycle as needed. When done:

Thought: <final reasoning>
Final Answer: <markdown answer to the user>

Hard rules:
- Always start with "Thought:".
- Before write_file you MUST call diff_file FIRST in an earlier step so the user can preview.
- For diagnostics, prefer server_metrics + list_services + top_processes + get_logs over guessing.
- Never invent Observations.
- Cite concrete evidence in the Final Answer (command output, file lines, exit codes).`;
}

/**
 * Tool registry untuk ReAct Agentic Workflow.
 *
 * Tool tipe "local" jalan di browser (calculator, get_time).
 * Tool tipe "bridge" call ke Aurora Agent Bridge (server_exec, read_file, ...).
 * Bridge tools dynamic — hanya muncul di prompt saat bridge enabled & configured.
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
} from "./bridge";

export interface ToolDefinition {
  name: string;
  description: string;
  inputHint: string;
  /** When true, the tool mutates state on the server (write_file, git commit). */
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
    description: "Return the current local date and time. Use only when the user asks for time/date.",
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
    description: "Return live CPU%, RAM, load avg, and disk usage from the user's server. Call this first when diagnosing performance.",
    inputHint: "(any, ignored)",
    run: async (_input, { bridge }) => {
      const m = await bridgeMetrics(bridge);
      return JSON.stringify(m, null, 2);
    },
  },
  {
    name: "server_exec",
    description:
      "Run a shell command on the server (sh -c). Use for diagnostics: `git status`, `systemctl status nginx`, `docker ps`, `ls -la`, `tail -n 50 /var/log/...`. Returns stdout, stderr, exit code.",
    inputHint: "the shell command verbatim, e.g. `systemctl status myapp`",
    run: async (input, { bridge }) => {
      const r = await bridgeExec(bridge, input);
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
    description: "Read a file from the project root on the server. Use BEFORE proposing any edit.",
    inputHint: "relative path, e.g. `src/app.ts` or `package.json`",
    run: async (input, { bridge }) => {
      const r = await bridgeRead(bridge, input.trim());
      return `(${r.size} bytes)\n${r.content}`;
    },
  },
  {
    name: "write_file",
    description:
      "Overwrite a file on the server with new content AND auto-commit it to git. ⚠ Mutating: only use after read_file confirms what to change. Input is JSON: {\"path\":\"src/x.ts\",\"content\":\"...\",\"message\":\"fix: ...\"}",
    inputHint: '{"path":"src/x.ts","content":"...","message":"fix: bug"}',
    mutating: true,
    run: async (input, { bridge }) => {
      let parsed: { path?: string; content?: string; message?: string };
      try {
        parsed = JSON.parse(input);
      } catch {
        return "Error: input must be valid JSON with keys path, content, message.";
      }
      if (!parsed.path || typeof parsed.content !== "string") {
        return "Error: 'path' and 'content' are required.";
      }
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
    description: "Run a git command on the project repo. Input is JSON array of args, e.g. [\"log\",\"--oneline\",\"-10\"] or [\"diff\",\"HEAD~1\"].",
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
    description: "Tail the last N lines of a log file (or any file). Input JSON: {\"path\":\"/var/log/x.log\",\"lines\":200}",
    inputHint: '{"path":"/var/log/syslog","lines":100}',
    run: async (input, { bridge }) => {
      let parsed: { path?: string; lines?: number };
      try {
        parsed = JSON.parse(input);
      } catch {
        // fall back to plain string path
        parsed = { path: input.trim() };
      }
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

export function buildReactSystemPrompt(bridge: BridgeConfig): string {
  const ready = bridgeReady(bridge);
  return `You are an agentic SRE assistant that follows the ReAct (Reasoning + Acting) protocol.

${ready
    ? "You ARE connected to the user's server via the Aurora Agent Bridge. Prefer real evidence (metrics, command output, file contents) over speculation."
    : "⚠ The Aurora Agent Bridge is NOT configured. You only have local tools (math, time). Tell the user to configure the bridge in Settings to give you server access."}

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
- Before write_file, you MUST read_file first in an earlier step.
- For diagnostics, prefer server_metrics + server_exec over guessing.
- Never invent Observations.
- Cite concrete evidence in the Final Answer (command output, file lines, exit codes).`;
}

/**
 * Internal tool registry untuk Agentic Workflow.
 * Setiap tool punya nama, deskripsi (untuk system prompt), dan handler.
 * AI akan memilih tool via format ReAct: `Action: tool_name` + `Action Input: ...`.
 */

export interface ToolDefinition {
  name: string;
  description: string;
  inputHint: string;
  run: (input: string) => Promise<string> | string;
}

function safeCalc(expr: string): string {
  // Hanya izinkan angka, operator dasar, kurung, dan titik/spasi.
  if (!/^[\d\s+\-*/().,%]+$/.test(expr)) {
    return "Error: expression contains disallowed characters.";
  }
  try {
    // eslint-disable-next-line no-new-func
    const result = Function(`"use strict"; return (${expr.replace(/,/g, ".")});`)();
    if (typeof result !== "number" || !Number.isFinite(result)) {
      return "Error: not a finite number.";
    }
    return String(result);
  } catch (e) {
    return `Error: ${e instanceof Error ? e.message : "calc failed"}`;
  }
}

export const tools: ToolDefinition[] = [
  {
    name: "get_time",
    description: "Returns the current local date and time. Use when the user asks for the time, date, or day.",
    inputHint: "(no input needed, pass 'now')",
    run: () => {
      const d = new Date();
      return d.toLocaleString(undefined, {
        dateStyle: "full",
        timeStyle: "long",
      });
    },
  },
  {
    name: "calculator",
    description: "Evaluates a basic math expression. Supports + - * / ( ) and decimals.",
    inputHint: "e.g. 23 * (4 + 7) / 2",
    run: (input) => safeCalc(input),
  },
  {
    name: "fetch_url",
    description:
      "Fetches a URL via HTTP GET and returns the first ~1500 chars of the response body (text or JSON). Use for live data or local files served via http://.",
    inputHint: "https://example.com/api",
    run: async (input) => {
      const url = input.trim().replace(/^["']|["']$/g, "");
      try {
        const res = await fetch(url);
        const text = await res.text();
        const trimmed = text.length > 1500 ? text.slice(0, 1500) + "…[truncated]" : text;
        return `HTTP ${res.status} ${res.statusText}\n${trimmed}`;
      } catch (e) {
        return `Error: ${e instanceof Error ? e.message : "fetch failed"}`;
      }
    },
  },
];

export function getToolByName(name: string): ToolDefinition | undefined {
  const n = name.trim().toLowerCase();
  return tools.find((t) => t.name === n);
}

export function buildToolsManual(): string {
  return tools
    .map((t) => `- ${t.name}: ${t.description} Input: ${t.inputHint}`)
    .join("\n");
}

export const REACT_SYSTEM_PROMPT = `You are an agentic AI assistant that follows the ReAct (Reasoning + Acting) protocol.

You have access to the following tools:
${buildToolsManual()}

For EVERY user message you MUST respond using this exact format, one block per step:

Thought: <your reasoning about what to do next>
Action: <tool_name from the list above, or "none">
Action Input: <input string for the tool, or "-" if Action is none>

After you emit an Action (other than "none"), STOP and wait. The system will execute the tool and return:

Observation: <tool result>

You may then continue with another Thought / Action / Action Input cycle. When you have enough information, end with:

Thought: <final reasoning>
Final Answer: <the answer to the user, in markdown>

Rules:
- Always start with "Thought:".
- Use a tool only when it genuinely helps (math, current time, fetching data). For chit-chat or general knowledge, go straight to Action: none and produce a Final Answer in the next turn (or in the same response after one Thought).
- Never invent Observations — only the system produces them.
- Keep Thoughts concise (1-2 sentences).
- The Final Answer is the only thing the user sees rendered as the main reply.`;

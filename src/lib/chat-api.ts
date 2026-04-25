import type { ChatMessage, ReActStep, BridgeConfig } from "./store";
import type { ProviderConfig } from "./store";
import { getToolByName, buildReactSystemPrompt } from "./tools";
import { proxyFetch, normalizeBaseUrl } from "./proxy";

/** Strip well-known endpoint suffixes a user might paste into the Base URL,
 * but PRESERVE the OpenAI `/v1` prefix because all OpenAI-compatible endpoints
 * are scoped under /v1. */
function normalizeProviderBase(provider: ProviderConfig): string {
  if (provider.provider === "openai") {
    return normalizeBaseUrl(provider.apiUrl, [
      "/v1/chat/completions",
      "/chat/completions",
      "/v1/completions",
      "/completions",
      "/v1/models",
      "/models",
    ]);
  }
  // Ollama: strip any /api/* leaf
  return normalizeBaseUrl(provider.apiUrl, [
    "/api/chat",
    "/api/tags",
    "/api/generate",
    "/api",
  ]);
}

interface ChatParams {
  provider: ProviderConfig;
  bridge: BridgeConfig;
  systemPrompt: string;
  messages: ChatMessage[];
  /** When true, run a ReAct agentic loop with tool calling. */
  agentic?: boolean;
  /** Maximum recent messages to send (short-term memory window). */
  maxContextMessages?: number;
  /** Streaming-style callback as ReAct steps are produced. */
  onStep?: (step: ReActStep) => void;
}

export interface AgentResult {
  finalAnswer: string;
  steps: ReActStep[];
}

interface OAIMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

async function rawCompletion(
  provider: ProviderConfig,
  fullMessages: OAIMessage[],
  stop?: string[],
): Promise<string> {
  const base = normalizeProviderBase(provider);
  const headers = {
    "Content-Type": "application/json",
    ...(provider.apiKey ? { Authorization: `Bearer ${provider.apiKey}` } : {}),
  };

  if (provider.provider === "ollama") {
    const res = await proxyFetch(base, "/api/chat", {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: provider.model,
        messages: fullMessages,
        stream: false,
        options: stop ? { stop } : undefined,
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Ollama ${res.status}: ${text.slice(0, 200) || res.statusText}`);
    }
    const data = (await res.json()) as { message?: { content?: string } };
    return data.message?.content ?? "";
  }

  const res = await proxyFetch(base, "/chat/completions", {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: provider.model,
      messages: fullMessages,
      stream: false,
      stop,
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`API ${res.status}: ${text.slice(0, 200) || res.statusText}`);
  }
  const data = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  return data.choices?.[0]?.message?.content ?? "";
}

/** Parse a single ReAct chunk emitted by the model. */
function parseReActChunk(text: string): {
  thought?: string;
  action?: string;
  actionInput?: string;
  finalAnswer?: string;
} {
  const grab = (label: string): string | undefined => {
    const re = new RegExp(`${label}\\s*:\\s*([\\s\\S]*?)(?=\\n(?:Thought|Action|Action Input|Observation|Final Answer)\\s*:|$)`, "i");
    const m = text.match(re);
    return m ? m[1].trim() : undefined;
  };
  return {
    thought: grab("Thought"),
    action: grab("Action"),
    actionInput: grab("Action Input"),
    finalAnswer: grab("Final Answer"),
  };
}

/**
 * Runs a ReAct loop: model emits Thought/Action/Action Input → we execute the
 * tool → feed back Observation → repeat until Final Answer (or max iterations).
 */
async function runAgenticLoop({
  provider,
  bridge,
  systemPrompt,
  messages,
  maxContextMessages = 20,
  onStep,
}: ChatParams): Promise<AgentResult> {
  const trimmedHistory = messages.slice(-maxContextMessages);
  const baseMessages: OAIMessage[] = [
    { role: "system", content: `${buildReactSystemPrompt(bridge)}\n\n--- User-defined system prompt ---\n${systemPrompt}` },
    ...trimmedHistory.map((m): OAIMessage => ({
      role: m.role === "system" ? "system" : (m.role as "user" | "assistant"),
      content: m.content,
    })),
  ];

  const scratchpad: string[] = [];
  const steps: ReActStep[] = [];
  const maxIter = 5;

  for (let i = 0; i < maxIter; i++) {
    const convo: OAIMessage[] = [...baseMessages];
    if (scratchpad.length) {
      convo.push({ role: "assistant", content: scratchpad.join("\n") });
      convo.push({
        role: "user",
        content: "Continue. Emit the next Thought / Action / Action Input, or Final Answer.",
      });
    }

    const raw = await rawCompletion(provider, convo, ["\nObservation:"]);
    const parsed = parseReActChunk(raw);

    if (parsed.finalAnswer) {
      const step: ReActStep = { thought: parsed.thought };
      if (step.thought) {
        steps.push(step);
        onStep?.(step);
      }
      return { finalAnswer: parsed.finalAnswer, steps };
    }

    const action = (parsed.action ?? "none").trim();
    const actionInput = parsed.actionInput ?? "";
    const step: ReActStep = {
      thought: parsed.thought,
      action,
      actionInput,
    };

    // No tool requested → ask the model to give the Final Answer next.
    if (!action || action.toLowerCase() === "none") {
      scratchpad.push(raw.trim());
      scratchpad.push("Observation: (no tool used — produce the Final Answer now)");
      step.observation = "(no tool used)";
      steps.push(step);
      onStep?.(step);
      continue;
    }

    const tool = getToolByName(action, bridge);
    let observation: string;
    if (!tool) {
      observation = `Error: unknown tool "${action}".`;
    } else {
      try {
        observation = await Promise.resolve(tool.run(actionInput, { bridge }));
      } catch (e) {
        observation = `Error: ${e instanceof Error ? e.message : "tool failed"}`;
      }
    }
    step.observation = observation;
    steps.push(step);
    onStep?.(step);

    scratchpad.push(raw.trim());
    scratchpad.push(`Observation: ${observation}`);
  }

  return {
    finalAnswer:
      "_(Agent reached max iterations without producing a final answer. Try rephrasing.)_",
    steps,
  };
}

/**
 * Calls the configured provider. When `agentic` is true, runs the ReAct loop
 * with tool calling. Otherwise sends a plain chat completion. Falls back to a
 * mock response when the URL is unset or still the placeholder.
 */
export async function chatCompletion(params: ChatParams): Promise<AgentResult> {
  const { provider, systemPrompt, messages, agentic, maxContextMessages = 20 } = params;
  const trimmed = provider.apiUrl?.trim();

  if (!trimmed || trimmed.startsWith("https://your-tunnel")) {
    await new Promise((r) => setTimeout(r, 500));
    const last = messages[messages.length - 1]?.content ?? "";
    return {
      finalAnswer: `**Demo response** — configure your API URL in Settings to connect to your real model.\n\nYou said: _${last}_`,
      steps: [],
    };
  }

  if (agentic) {
    return runAgenticLoop(params);
  }

  const trimmedHistory = messages.slice(-maxContextMessages);
  const fullMessages: OAIMessage[] = [
    { role: "system", content: systemPrompt },
    ...trimmedHistory.map((m): OAIMessage => ({
      role: m.role === "system" ? "system" : (m.role as "user" | "assistant"),
      content: m.content,
    })),
  ];
  const text = await rawCompletion(provider, fullMessages);
  return { finalAnswer: text || "(empty response)", steps: [] };
}

export interface TestConnectionResult {
  ok: boolean;
  message: string;
  latencyMs?: number;
  models?: string[];
}

/**
 * Verifies connectivity to the provider. For Ollama hits /api/tags. For
 * OpenAI-compatible hits /models. Returns a structured result.
 */
export async function testConnection(
  provider: ProviderConfig,
): Promise<TestConnectionResult> {
  const trimmed = provider.apiUrl?.trim();
  if (!trimmed) {
    return { ok: false, message: "API URL is empty" };
  }
  if (trimmed.startsWith("https://your-tunnel")) {
    return { ok: false, message: "Replace the placeholder URL first" };
  }

  const base = normalizeProviderBase(provider);
  const start = performance.now();
  const headers = provider.apiKey ? { Authorization: `Bearer ${provider.apiKey}` } : {};

  try {
    const path = provider.provider === "ollama" ? "/api/tags" : "/models";
    const res = await proxyFetch(base, path, { headers });
    const latencyMs = Math.round(performance.now() - start);
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      return {
        ok: false,
        message: `HTTP ${res.status} ${res.statusText}${t ? ` — ${t.slice(0, 140)}` : ""}`,
        latencyMs,
      };
    }
    const data = await res.json();
    const models =
      provider.provider === "ollama"
        ? ((data as { models?: { name: string }[] }).models ?? []).map((m) => m.name)
        : ((data as { data?: { id: string }[] }).data ?? []).map((m) => m.id);
    return {
      ok: true,
      message: `Connected · ${models.length} model${models.length === 1 ? "" : "s"}`,
      latencyMs,
      models,
    };
  } catch (err) {
    const latencyMs = Math.round(performance.now() - start);
    const message = err instanceof Error ? err.message : "Network error";
    return { ok: false, message, latencyMs };
  }
}

import type { ChatMessage, ReActStep, BridgeConfig, MemoryContext, SafetyConfig } from "./store";
import type { ProviderConfig } from "./store";
import { getToolByName, buildReactSystemPrompt } from "./tools";
import { proxyFetch, normalizeBaseUrl } from "./proxy";
import { bridgeMetrics, bridgeServices, bridgeReady } from "./bridge";

/** Strip well-known endpoint suffixes a user might paste into the Base URL. */
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
  agentic?: boolean;
  maxContextMessages?: number;
  safety?: SafetyConfig;
  /** Inject live health summary as auto-context. */
  autoContext?: boolean;
  /** Memories for RAG injection. */
  memories?: MemoryContext[];
  /** Streaming-style callback as ReAct steps are produced. */
  onStep?: (step: ReActStep, iter: number) => void;
  /** AbortSignal to cancel mid-loop. */
  signal?: AbortSignal;
  /**
   * Hook called BEFORE a mutating tool runs. Return true to proceed, false to abort.
   * Implementations typically open a confirmation modal and resolve when user clicks.
   */
  onMutationConfirm?: (info: { tool: string; input: string }) => Promise<boolean>;
}

export interface AgentResult {
  finalAnswer: string;
  steps: ReActStep[];
  iterations: number;
  cancelled?: boolean;
}

interface OAIMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

async function rawCompletion(
  provider: ProviderConfig,
  fullMessages: OAIMessage[],
  stop?: string[],
  signal?: AbortSignal,
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
      signal,
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
    signal,
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

/** Fetch live health snapshot for auto-context injection. Soft-fails. */
async function buildAutoContext(bridge: BridgeConfig): Promise<string> {
  if (!bridgeReady(bridge)) return "";
  try {
    const [m, s] = await Promise.allSettled([bridgeMetrics(bridge), bridgeServices(bridge)]);
    const parts: string[] = [];
    if (m.status === "fulfilled") {
      const v = m.value;
      parts.push(
        `host=${v.hostname ?? "?"} cpu=${v.cpuPercent ?? "?"}% ram=${v.memPercent ?? "?"}% (${v.memUsedMB}/${v.memTotalMB}MB) load1=${v.load1 ?? "?"}`,
      );
    }
    if (s.status === "fulfilled") {
      const failed = (s.value.services ?? []).filter((x) => x.active === "failed");
      if (failed.length > 0) {
        parts.push(
          `failed services (${failed.length}): ${failed.slice(0, 5).map((x) => x.name).join(", ")}`,
        );
      } else {
        parts.push(`all systemd services healthy`);
      }
    }
    return parts.join("\n");
  } catch {
    return "";
  }
}

/** Naive keyword-based RAG: pick top-K memories matching tokens in the user query. */
function selectRelevantMemories(query: string, memories: MemoryContext[], k = 3): MemoryContext[] {
  if (!memories || memories.length === 0) return [];
  const tokens = query
    .toLowerCase()
    .split(/[^a-z0-9_]+/)
    .filter((t) => t.length > 2);
  if (tokens.length === 0) return [];
  const scored = memories.map((m) => {
    const hay = `${m.title} ${m.content} ${m.tags.join(" ")}`.toLowerCase();
    const score = tokens.reduce((acc, t) => acc + (hay.includes(t) ? 1 : 0), 0);
    return { m, score };
  });
  return scored
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, k)
    .map((x) => x.m);
}

async function runAgenticLoop(params: ChatParams): Promise<AgentResult> {
  const {
    provider,
    bridge,
    systemPrompt,
    messages,
    maxContextMessages = 20,
    safety,
    autoContext,
    memories,
    onStep,
    signal,
    onMutationConfirm,
  } = params;

  const trimmedHistory = messages.slice(-maxContextMessages);
  const lastUser = [...messages].reverse().find((m) => m.role === "user")?.content ?? "";

  const ctx = autoContext ? await buildAutoContext(bridge) : "";
  const relevant = memories ? selectRelevantMemories(lastUser, memories, 3) : [];
  const memBlock = relevant.length
    ? "\n\n--- Relevant memories ---\n" +
      relevant.map((m) => `# ${m.title}\n${m.content}`).join("\n\n") +
      "\n--- end memories ---\n"
    : "";

  const baseMessages: OAIMessage[] = [
    {
      role: "system",
      content: `${buildReactSystemPrompt(bridge, ctx)}${memBlock}\n\n--- User-defined system prompt ---\n${systemPrompt}`,
    },
    ...trimmedHistory.map((m): OAIMessage => ({
      role: m.role === "system" ? "system" : (m.role as "user" | "assistant"),
      content: m.content,
    })),
  ];

  const scratchpad: string[] = [];
  const steps: ReActStep[] = [];
  const maxIter = Math.max(2, Math.min(20, safety?.maxIterations ?? 8));
  let iter = 0;

  for (iter = 0; iter < maxIter; iter++) {
    if (signal?.aborted) {
      return { finalAnswer: "_(cancelled by user)_", steps, iterations: iter, cancelled: true };
    }
    const convo: OAIMessage[] = [...baseMessages];
    if (scratchpad.length) {
      convo.push({ role: "assistant", content: scratchpad.join("\n") });
      convo.push({
        role: "user",
        content: "Continue. Emit the next Thought / Action / Action Input, or Final Answer.",
      });
    }

    const raw = await rawCompletion(provider, convo, ["\nObservation:"], signal);
    const parsed = parseReActChunk(raw);

    if (parsed.finalAnswer) {
      const step: ReActStep = { thought: parsed.thought };
      if (step.thought) {
        steps.push(step);
        onStep?.(step, iter);
      }
      return { finalAnswer: parsed.finalAnswer, steps, iterations: iter + 1 };
    }

    const action = (parsed.action ?? "none").trim();
    const actionInput = parsed.actionInput ?? "";
    const step: ReActStep = { thought: parsed.thought, action, actionInput };

    if (!action || action.toLowerCase() === "none") {
      scratchpad.push(raw.trim());
      scratchpad.push("Observation: (no tool used — produce the Final Answer now)");
      step.observation = "(no tool used)";
      steps.push(step);
      onStep?.(step, iter);
      continue;
    }

    const tool = getToolByName(action, bridge);
    let observation: string;
    if (!tool) {
      observation = `Error: unknown tool "${action}".`;
    } else {
      // Confirmation gate for mutating tools
      if (tool.mutating && onMutationConfirm) {
        const ok = await onMutationConfirm({ tool: tool.name, input: actionInput });
        if (!ok) {
          observation = "🛑 User declined this mutation. Try a non-destructive alternative.";
          step.observation = observation;
          steps.push(step);
          onStep?.(step, iter);
          scratchpad.push(raw.trim());
          scratchpad.push(`Observation: ${observation}`);
          continue;
        }
      }
      try {
        observation = await Promise.resolve(tool.run(actionInput, { bridge }));
      } catch (e) {
        observation = `Error: ${e instanceof Error ? e.message : "tool failed"}`;
      }
    }
    step.observation = observation;
    steps.push(step);
    onStep?.(step, iter);

    scratchpad.push(raw.trim());
    scratchpad.push(`Observation: ${observation}`);
  }

  return {
    finalAnswer:
      `_(Agent reached max iterations (${maxIter}) without producing a final answer. Try rephrasing or raise the limit in Settings.)_`,
    steps,
    iterations: iter,
  };
}

export async function chatCompletion(params: ChatParams): Promise<AgentResult> {
  const { provider, systemPrompt, messages, agentic, maxContextMessages = 20, signal } = params;
  const trimmed = provider.apiUrl?.trim();

  if (!trimmed || trimmed.startsWith("https://your-tunnel")) {
    await new Promise((r) => setTimeout(r, 400));
    const last = messages[messages.length - 1]?.content ?? "";
    return {
      finalAnswer: `**Demo response** — configure your API URL in Settings to connect to your real model.\n\nYou said: _${last}_`,
      steps: [],
      iterations: 0,
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
  const text = await rawCompletion(provider, fullMessages, undefined, signal);
  return { finalAnswer: text || "(empty response)", steps: [], iterations: 1 };
}

export interface TestConnectionResult {
  ok: boolean;
  message: string;
  latencyMs?: number;
  models?: string[];
}

export async function testConnection(
  provider: ProviderConfig,
): Promise<TestConnectionResult> {
  const trimmed = provider.apiUrl?.trim();
  if (!trimmed) return { ok: false, message: "API URL is empty" };
  if (trimmed.startsWith("https://your-tunnel")) return { ok: false, message: "Replace the placeholder URL first" };

  const base = normalizeProviderBase(provider);
  const start = performance.now();
  const headers: Record<string, string> = provider.apiKey ? { Authorization: `Bearer ${provider.apiKey}` } : {};

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

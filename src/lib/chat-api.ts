import type { ChatMessage } from "./store";
import type { ProviderConfig } from "./store";

interface ChatParams {
  provider: ProviderConfig;
  systemPrompt: string;
  messages: ChatMessage[];
}

function normalizeUrl(url: string) {
  return url.trim().replace(/\/$/, "");
}

/**
 * Calls the configured provider's chat endpoint. Supports OpenAI-compatible
 * (/chat/completions) and Ollama (/api/chat). Falls back to a mock response
 * when the URL is unset or still the placeholder.
 */
export async function chatCompletion({
  provider,
  systemPrompt,
  messages,
}: ChatParams): Promise<string> {
  const trimmed = provider.apiUrl?.trim();
  if (!trimmed || trimmed.startsWith("https://your-tunnel")) {
    await new Promise((r) => setTimeout(r, 700));
    const last = messages[messages.length - 1]?.content ?? "";
    return `**Demo response** — configure your API URL in Settings to connect to your real model.\n\nYou said: _${last}_`;
  }

  const base = normalizeUrl(trimmed);
  const fullMessages = [
    { role: "system" as const, content: systemPrompt },
    ...messages.map((m) => ({ role: m.role, content: m.content })),
  ];

  if (provider.provider === "ollama") {
    const res = await fetch(`${base}/api/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(provider.apiKey ? { Authorization: `Bearer ${provider.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: provider.model,
        messages: fullMessages,
        stream: false,
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Ollama error ${res.status}: ${text || res.statusText}`);
    }
    const data = (await res.json()) as { message?: { content?: string } };
    return data.message?.content ?? "(empty response)";
  }

  // OpenAI-compatible
  const res = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(provider.apiKey ? { Authorization: `Bearer ${provider.apiKey}` } : {}),
    },
    body: JSON.stringify({
      model: provider.model,
      messages: fullMessages,
      stream: false,
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`API error ${res.status}: ${text || res.statusText}`);
  }
  const data = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  return data.choices?.[0]?.message?.content ?? "(empty response)";
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
  provider: ProviderConfig
): Promise<TestConnectionResult> {
  const trimmed = provider.apiUrl?.trim();
  if (!trimmed) {
    return { ok: false, message: "API URL is empty" };
  }
  if (trimmed.startsWith("https://your-tunnel")) {
    return { ok: false, message: "Replace the placeholder URL first" };
  }

  const base = normalizeUrl(trimmed);
  const start = performance.now();

  try {
    if (provider.provider === "ollama") {
      const res = await fetch(`${base}/api/tags`, {
        headers: provider.apiKey
          ? { Authorization: `Bearer ${provider.apiKey}` }
          : {},
      });
      const latencyMs = Math.round(performance.now() - start);
      if (!res.ok) {
        const t = await res.text().catch(() => "");
        return {
          ok: false,
          message: `HTTP ${res.status} ${res.statusText}${t ? ` — ${t.slice(0, 120)}` : ""}`,
          latencyMs,
        };
      }
      const data = (await res.json()) as { models?: { name: string }[] };
      const models = (data.models ?? []).map((m) => m.name);
      return {
        ok: true,
        message: `Connected · ${models.length} model${models.length === 1 ? "" : "s"} available`,
        latencyMs,
        models,
      };
    }

    // OpenAI-compatible
    const res = await fetch(`${base}/models`, {
      headers: provider.apiKey
        ? { Authorization: `Bearer ${provider.apiKey}` }
        : {},
    });
    const latencyMs = Math.round(performance.now() - start);
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      return {
        ok: false,
        message: `HTTP ${res.status} ${res.statusText}${t ? ` — ${t.slice(0, 120)}` : ""}`,
        latencyMs,
      };
    }
    const data = (await res.json()) as { data?: { id: string }[] };
    const models = (data.data ?? []).map((m) => m.id);
    return {
      ok: true,
      message: `Connected · ${models.length} model${models.length === 1 ? "" : "s"} available`,
      latencyMs,
      models,
    };
  } catch (err) {
    const latencyMs = Math.round(performance.now() - start);
    const message =
      err instanceof Error ? err.message : "Network error (CORS or unreachable)";
    return { ok: false, message, latencyMs };
  }
}

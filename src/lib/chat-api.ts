import type { ChatMessage } from "./store";

interface ChatParams {
  apiUrl: string;
  apiKey: string;
  model: string;
  systemPrompt: string;
  messages: ChatMessage[];
}

/**
 * Calls an OpenAI-compatible chat completions endpoint (works with
 * llama.cpp server, OpenAI, OpenRouter, etc.). Falls back to a mock
 * response when no apiUrl is configured.
 */
export async function chatCompletion({
  apiUrl,
  apiKey,
  model,
  systemPrompt,
  messages,
}: ChatParams): Promise<string> {
  const trimmed = apiUrl?.trim();
  if (!trimmed || trimmed.startsWith("https://your-tunnel")) {
    // Mock for first-run experience
    await new Promise((r) => setTimeout(r, 900));
    const last = messages[messages.length - 1]?.content ?? "";
    return `**Demo response** — configure your API URL in Settings to connect to your real model.\n\nYou said: _${last}_`;
  }

  const url = trimmed.replace(/\/$/, "") + "/chat/completions";
  const body = {
    model,
    messages: [
      { role: "system", content: systemPrompt },
      ...messages.map((m) => ({ role: m.role, content: m.content })),
    ],
    stream: false,
  };

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    },
    body: JSON.stringify(body),
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

import { create } from "zustand";
import { persist } from "zustand/middleware";

export type ChatRole = "user" | "assistant" | "system";

export interface ReActStep {
  thought?: string;
  action?: string;
  actionInput?: string;
  observation?: string;
}

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  createdAt: number;
  steps?: ReActStep[];
}

export interface MemoryContext {
  id: string;
  title: string;
  content: string;
  tags: string[];
  createdAt: number;
}

export type ModelMode = "local" | "cloud";
export type ProviderType = "openai" | "ollama";

export interface ProviderConfig {
  provider: ProviderType;
  apiUrl: string;
  apiKey: string;
  model: string;
}

export interface BridgeConfig {
  /** Base URL of Agent Bridge over Tailscale (e.g. http://my-server:8787 or http://100.x.x.x:8787). */
  baseUrl: string;
  /** Optional bearer token. Leave empty when running behind Tailscale (auth handled by WireGuard). */
  token: string;
  /** Master switch — when off, server tools are hidden from the AI. */
  enabled: boolean;
}

interface Settings {
  local: ProviderConfig;
  cloud: ProviderConfig;
  bridge: BridgeConfig;
  systemPrompt: string;
  /** Number of recent messages sent back to the model as short-term memory. */
  maxContextMessages: number;
  /** Enable ReAct agentic workflow (Thought/Action/Observation/Final Answer). */
  agenticMode: boolean;
}

interface AppState {
  settings: Settings;
  updateSettings: (patch: Partial<Settings>) => void;
  updateProvider: (mode: ModelMode, patch: Partial<ProviderConfig>) => void;
  updateBridge: (patch: Partial<BridgeConfig>) => void;

  mode: ModelMode;
  setMode: (m: ModelMode) => void;

  messages: ChatMessage[];
  addMessage: (msg: ChatMessage) => void;
  updateLastAssistant: (content: string) => void;
  clearChat: () => void;

  memories: MemoryContext[];
  addMemory: (m: Omit<MemoryContext, "id" | "createdAt">) => void;
  removeMemory: (id: string) => void;
}

const DEFAULT_SRE_PROMPT = `You are a Site Reliability Engineer assistant connected to the user's own server via the Aurora Agent Bridge.

Your job:
- Diagnose problems on the server (services down, high CPU/RAM, failing builds, log errors).
- Read project source code, understand it, and propose fixes.
- When confident, write the fix back via the write_file tool with commit=true so changes are version-controlled.
- Always inspect before mutating: read the file, run a relevant command (git status, ls, tail of a log) before writing.
- Quote concrete evidence (a log line, a file snippet, a command exit code) — never hand-wave.
- Be terse. Markdown headings + code blocks. No filler.`;

const defaultSettings: Settings = {
  local: {
    provider: "ollama",
    apiUrl: "http://localhost:11434",
    apiKey: "",
    model: "llama3.1:8b",
  },
  cloud: {
    provider: "openai",
    apiUrl: "",
    apiKey: "",
    model: "gpt-4o-mini",
  },
  bridge: {
    baseUrl: "",
    token: "",
    enabled: false,
  },
  systemPrompt: DEFAULT_SRE_PROMPT,
  maxContextMessages: 20,
  agenticMode: true,
};

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      settings: defaultSettings,
      updateSettings: (patch) =>
        set((s) => ({ settings: { ...s.settings, ...patch } })),
      updateProvider: (mode, patch) =>
        set((s) => ({
          settings: {
            ...s.settings,
            [mode]: { ...s.settings[mode], ...patch },
          },
        })),
      updateBridge: (patch) =>
        set((s) => ({
          settings: { ...s.settings, bridge: { ...s.settings.bridge, ...patch } },
        })),

      mode: "local",
      setMode: (mode) => set({ mode }),

      messages: [],
      addMessage: (msg) => set((s) => ({ messages: [...s.messages, msg] })),
      updateLastAssistant: (content) =>
        set((s) => {
          const msgs = [...s.messages];
          for (let i = msgs.length - 1; i >= 0; i--) {
            if (msgs[i].role === "assistant") {
              msgs[i] = { ...msgs[i], content };
              break;
            }
          }
          return { messages: msgs };
        }),
      clearChat: () => set({ messages: [] }),

      memories: [],
      addMemory: (m) =>
        set((s) => ({
          memories: [
            { ...m, id: crypto.randomUUID(), createdAt: Date.now() },
            ...s.memories,
          ],
        })),
      removeMemory: (id) =>
        set((s) => ({ memories: s.memories.filter((x) => x.id !== id) })),
    }),
    {
      name: "ai-assistant-store",
      version: 4,
      migrate: (persisted: any, version) => {
        if (!persisted) return persisted;
        if (version < 2 && persisted.settings) {
          const old = persisted.settings;
          persisted.settings = {
            local: {
              provider: "openai",
              apiUrl: old.apiUrl ?? defaultSettings.local.apiUrl,
              apiKey: old.apiKey ?? "",
              model: old.localModel ?? defaultSettings.local.model,
            },
            cloud: {
              provider: "openai",
              apiUrl: old.apiUrl ?? defaultSettings.cloud.apiUrl,
              apiKey: old.apiKey ?? "",
              model: old.cloudModel ?? defaultSettings.cloud.model,
            },
            systemPrompt: old.systemPrompt ?? defaultSettings.systemPrompt,
            maxContextMessages: defaultSettings.maxContextMessages,
            agenticMode: defaultSettings.agenticMode,
          };
        }
        if (version < 3 && persisted.settings) {
          persisted.settings.maxContextMessages ??= defaultSettings.maxContextMessages;
          persisted.settings.agenticMode ??= defaultSettings.agenticMode;
        }
        if (version < 4 && persisted.settings) {
          persisted.settings.bridge ??= defaultSettings.bridge;
          // Drop the placeholder cloud URL from the old default.
          if (persisted.settings.cloud?.apiUrl?.startsWith("https://your-tunnel")) {
            persisted.settings.cloud.apiUrl = "";
          }
        }
        return persisted;
      },
      partialize: (s) => ({
        settings: s.settings,
        mode: s.mode,
        memories: s.memories,
        messages: s.messages,
      }),
    }
  )
);

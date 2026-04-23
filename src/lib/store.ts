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

interface Settings {
  local: ProviderConfig;
  cloud: ProviderConfig;
  systemPrompt: string;
  /** Number of recent messages sent back to the model as short-term memory. */
  maxContextMessages: number;
  /** Enable ReAct agentic workflow (Thought/Action/Observation/Final Answer). */
  agenticMode: boolean;
}

interface AppState {
  // Settings
  settings: Settings;
  updateSettings: (patch: Partial<Settings>) => void;
  updateProvider: (mode: ModelMode, patch: Partial<ProviderConfig>) => void;

  // Mode
  mode: ModelMode;
  setMode: (m: ModelMode) => void;

  // Chat
  messages: ChatMessage[];
  addMessage: (msg: ChatMessage) => void;
  updateLastAssistant: (content: string) => void;
  clearChat: () => void;

  // Memory
  memories: MemoryContext[];
  addMemory: (m: Omit<MemoryContext, "id" | "createdAt">) => void;
  removeMemory: (id: string) => void;
}

const seedMemories: MemoryContext[] = [
  {
    id: "m1",
    title: "User Preferences",
    content: "Prefers concise answers, dark UI, weekly status reports on Fridays.",
    tags: ["profile", "preferences"],
    createdAt: Date.now() - 86400000 * 3,
  },
  {
    id: "m2",
    title: "Project: Aurora Dashboard",
    content: "Internal monitoring tool — uses Cloudflare Tunnels and a self-hosted Llama.cpp server.",
    tags: ["project", "infra"],
    createdAt: Date.now() - 86400000 * 1,
  },
  {
    id: "m3",
    title: "Meeting notes — Q2 planning",
    content: "Focus on automation, reduce manual triage by 40%. Owner: Alex.",
    tags: ["meeting", "planning"],
    createdAt: Date.now() - 3600000 * 5,
  },
];

const defaultSettings: Settings = {
  local: {
    provider: "ollama",
    apiUrl: "http://localhost:11434",
    apiKey: "",
    model: "llama3.1:8b",
  },
  cloud: {
    provider: "openai",
    apiUrl: "https://your-tunnel.example.com/v1",
    apiKey: "",
    model: "gpt-4o-mini",
  },
  systemPrompt:
    "You are a helpful, concise personal AI assistant. Use markdown when useful.",
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

      memories: seedMemories,
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
      version: 3,
      migrate: (persisted: any, version) => {
        if (!persisted) return persisted;
        if (version < 2 && persisted.settings) {
          // Migrate old flat shape -> new local/cloud providers
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

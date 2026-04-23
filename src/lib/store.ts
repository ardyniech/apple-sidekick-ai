import { create } from "zustand";
import { persist } from "zustand/middleware";

export type ChatRole = "user" | "assistant" | "system";

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  createdAt: number;
}

export interface MemoryContext {
  id: string;
  title: string;
  content: string;
  tags: string[];
  createdAt: number;
}

export type ModelMode = "local" | "cloud";

interface Settings {
  apiUrl: string;
  apiKey: string;
  localModel: string;
  cloudModel: string;
  systemPrompt: string;
}

interface AppState {
  // Settings
  settings: Settings;
  updateSettings: (patch: Partial<Settings>) => void;

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

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      settings: {
        apiUrl: "https://your-tunnel.example.com/v1",
        apiKey: "",
        localModel: "llama-3.1-8b-instruct",
        cloudModel: "gpt-4o-mini",
        systemPrompt:
          "You are a helpful, concise personal AI assistant. Use markdown when useful.",
      },
      updateSettings: (patch) =>
        set((s) => ({ settings: { ...s.settings, ...patch } })),

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
      partialize: (s) => ({
        settings: s.settings,
        mode: s.mode,
        memories: s.memories,
      }),
    }
  )
);

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
  /** Base URL of Agent Bridge (Tailscale MagicDNS, public hostname, …). */
  baseUrl: string;
  /** Optional bearer token. Leave empty when running behind Tailscale. */
  token: string;
  /** Master switch — when off, server tools are hidden from the AI. */
  enabled: boolean;
}

export interface BridgeProfile extends BridgeConfig {
  id: string;
  label: string;
}

/** Per-action confirmation policy. "ask" = always confirm, "auto" = run without prompt. */
export type ConfirmPolicy = "ask" | "auto";

export interface SafetyConfig {
  exec: ConfirmPolicy;
  write: ConfirmPolicy;
  serviceMutate: ConfirmPolicy; // start/stop/restart
  rollback: ConfirmPolicy;
  /** Max ReAct iterations before agent gives up. */
  maxIterations: number;
}

interface Settings {
  local: ProviderConfig;
  cloud: ProviderConfig;
  bridge: BridgeConfig; // active bridge — kept in sync with bridges[activeBridgeId]
  bridges: BridgeProfile[];
  activeBridgeId: string | null;
  systemPrompt: string;
  /** Number of recent messages sent back to the model as short-term memory. */
  maxContextMessages: number;
  /** Enable ReAct agentic workflow. */
  agenticMode: boolean;
  /** Inject live server health summary into every system prompt. */
  injectAutoContext: boolean;
  safety: SafetyConfig;
}

interface AppState {
  settings: Settings;
  updateSettings: (patch: Partial<Settings>) => void;
  updateProvider: (mode: ModelMode, patch: Partial<ProviderConfig>) => void;
  updateBridge: (patch: Partial<BridgeConfig>) => void;
  updateSafety: (patch: Partial<SafetyConfig>) => void;

  // Multi-bridge management
  addBridgeProfile: (label: string) => string;
  removeBridgeProfile: (id: string) => void;
  renameBridgeProfile: (id: string, label: string) => void;
  switchBridgeProfile: (id: string) => void;

  mode: ModelMode;
  setMode: (m: ModelMode) => void;

  messages: ChatMessage[];
  addMessage: (msg: ChatMessage) => void;
  updateLastAssistant: (content: string) => void;
  clearChat: () => void;

  memories: MemoryContext[];
  addMemory: (m: Omit<MemoryContext, "id" | "createdAt">) => void;
  removeMemory: (id: string) => void;

  // Config import/export helpers
  exportConfig: () => string;
  importConfig: (json: string) => { ok: boolean; error?: string };
}

const DEFAULT_SRE_PROMPT = `You are a Site Reliability Engineer assistant connected to the user's own server via the Aurora Agent Bridge.

Your job:
- Diagnose problems on the server (services down, high CPU/RAM, failing builds, log errors).
- Read project source code, understand it, and propose fixes.
- For mutating changes, ALWAYS preview with diff_file FIRST, then write_file with commit=true so changes are version-controlled.
- Always inspect before mutating: read the file, run a relevant command (git status, ls, tail of a log) before writing.
- Quote concrete evidence (a log line, a file snippet, a command exit code) — never hand-wave.
- Be terse. Markdown headings + code blocks. No filler.`;

const defaultBridge: BridgeConfig = {
  baseUrl: "",
  token: "",
  enabled: false,
};

const defaultSafety: SafetyConfig = {
  exec: "ask",
  write: "ask",
  serviceMutate: "ask",
  rollback: "ask",
  maxIterations: 8,
};

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
  bridge: { ...defaultBridge },
  bridges: [],
  activeBridgeId: null,
  systemPrompt: DEFAULT_SRE_PROMPT,
  maxContextMessages: 20,
  agenticMode: true,
  injectAutoContext: true,
  safety: defaultSafety,
};

function syncActiveBridge(s: Settings): Settings {
  if (!s.activeBridgeId) return s;
  const profile = s.bridges.find((b) => b.id === s.activeBridgeId);
  if (!profile) return s;
  return {
    ...s,
    bridge: { baseUrl: profile.baseUrl, token: profile.token, enabled: profile.enabled },
  };
}

export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
      settings: defaultSettings,
      updateSettings: (patch) =>
        set((s) => ({ settings: syncActiveBridge({ ...s.settings, ...patch }) })),
      updateProvider: (mode, patch) =>
        set((s) => ({
          settings: {
            ...s.settings,
            [mode]: { ...s.settings[mode], ...patch },
          },
        })),
      updateBridge: (patch) =>
        set((s) => {
          const newBridge = { ...s.settings.bridge, ...patch };
          // also write back to active profile if any
          let bridges = s.settings.bridges;
          if (s.settings.activeBridgeId) {
            bridges = bridges.map((b) =>
              b.id === s.settings.activeBridgeId ? { ...b, ...patch } : b,
            );
          }
          return { settings: { ...s.settings, bridge: newBridge, bridges } };
        }),
      updateSafety: (patch) =>
        set((s) => ({
          settings: { ...s.settings, safety: { ...s.settings.safety, ...patch } },
        })),

      addBridgeProfile: (label) => {
        const id = crypto.randomUUID();
        set((s) => {
          const profile: BridgeProfile = { id, label, ...defaultBridge };
          const bridges = [...s.settings.bridges, profile];
          return {
            settings: syncActiveBridge({
              ...s.settings,
              bridges,
              activeBridgeId: s.settings.activeBridgeId ?? id,
            }),
          };
        });
        return id;
      },
      removeBridgeProfile: (id) =>
        set((s) => {
          const bridges = s.settings.bridges.filter((b) => b.id !== id);
          let activeBridgeId = s.settings.activeBridgeId;
          if (activeBridgeId === id) activeBridgeId = bridges[0]?.id ?? null;
          return {
            settings: syncActiveBridge({ ...s.settings, bridges, activeBridgeId }),
          };
        }),
      renameBridgeProfile: (id, label) =>
        set((s) => ({
          settings: {
            ...s.settings,
            bridges: s.settings.bridges.map((b) => (b.id === id ? { ...b, label } : b)),
          },
        })),
      switchBridgeProfile: (id) =>
        set((s) => ({
          settings: syncActiveBridge({ ...s.settings, activeBridgeId: id }),
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

      exportConfig: () => {
        const { settings, memories, mode } = get();
        const dump = {
          version: 5,
          exportedAt: new Date().toISOString(),
          settings: {
            ...settings,
            // strip secrets that user may not want to share
          },
          memories,
          mode,
        };
        return JSON.stringify(dump, null, 2);
      },
      importConfig: (json) => {
        try {
          const parsed = JSON.parse(json);
          if (!parsed || typeof parsed !== "object") {
            return { ok: false, error: "Invalid JSON shape" };
          }
          const next: Partial<AppState> = {};
          if (parsed.settings && typeof parsed.settings === "object") {
            next.settings = syncActiveBridge({
              ...defaultSettings,
              ...parsed.settings,
              safety: { ...defaultSafety, ...(parsed.settings.safety ?? {}) },
              bridges: Array.isArray(parsed.settings.bridges) ? parsed.settings.bridges : [],
            });
          }
          if (Array.isArray(parsed.memories)) next.memories = parsed.memories;
          if (parsed.mode === "local" || parsed.mode === "cloud") next.mode = parsed.mode;
          set(next as AppState);
          return { ok: true };
        } catch (e) {
          return { ok: false, error: e instanceof Error ? e.message : "parse failed" };
        }
      },
    }),
    {
      name: "ai-assistant-store",
      version: 5,
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
          persisted.settings.bridge ??= { ...defaultBridge };
          if (persisted.settings.cloud?.apiUrl?.startsWith("https://your-tunnel")) {
            persisted.settings.cloud.apiUrl = "";
          }
        }
        if (version < 5 && persisted.settings) {
          persisted.settings.bridges ??= [];
          persisted.settings.activeBridgeId ??= null;
          persisted.settings.injectAutoContext ??= true;
          persisted.settings.safety ??= { ...defaultSafety };
          // If there's a configured single bridge and no profiles, promote it
          if (
            persisted.settings.bridges.length === 0 &&
            persisted.settings.bridge?.baseUrl
          ) {
            const id = crypto.randomUUID();
            persisted.settings.bridges = [
              {
                id,
                label: "default",
                baseUrl: persisted.settings.bridge.baseUrl,
                token: persisted.settings.bridge.token ?? "",
                enabled: !!persisted.settings.bridge.enabled,
              },
            ];
            persisted.settings.activeBridgeId = id;
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

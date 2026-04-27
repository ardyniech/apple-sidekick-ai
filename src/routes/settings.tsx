import { createFileRoute } from "@tanstack/react-router";
import { AppLayout } from "@/components/AppLayout";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { useAppStore, type ModelMode, type ProviderConfig, type BridgeConfig, type ConfirmPolicy } from "@/lib/store";
import { testConnection, type TestConnectionResult } from "@/lib/chat-api";
import { bridgeHealth } from "@/lib/bridge";
import {
  AlertTriangle,
  CheckCircle2,
  Cloud,
  Cpu,
  Download,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  Plug,
  Plus,
  Save,
  Server,
  Shield,
  Trash2,
  Upload,
  XCircle,
} from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";

export const Route = createFileRoute("/settings")({
  head: () => ({
    meta: [
      { title: "Settings — Aurora" },
      { name: "description", content: "Configure Agent Bridge, model providers, and the agent loop." },
    ],
  }),
  component: SettingsPage,
});

function SettingsPage() {
  const settings = useAppStore((s) => s.settings);
  const updateSettings = useAppStore((s) => s.updateSettings);
  const [draft, setDraft] = useState(settings);

  function save() {
    updateSettings(draft);
    toast.success("Settings saved");
  }
  function patchProvider(mode: ModelMode, p: Partial<ProviderConfig>) {
    setDraft({ ...draft, [mode]: { ...draft[mode], ...p } });
  }
  function patchBridge(p: Partial<BridgeConfig>) {
    setDraft({ ...draft, bridge: { ...draft.bridge, ...p } });
  }

  return (
    <AppLayout title="Settings" subtitle="Bridge, models & agent">
      <div className="mx-auto w-full max-w-3xl space-y-5 p-6">
        <BridgeCard bridge={draft.bridge} onChange={patchBridge} />

        <ProviderCard
          mode="local"
          icon={<Cpu className="h-4 w-4" />}
          title="Local Model"
          subtitle="Ollama, Llama.cpp, or any OpenAI-compatible server on your machine"
          provider={draft.local}
          onChange={(p) => patchProvider("local", p)}
          accent="text-success"
        />

        <ProviderCard
          mode="cloud"
          icon={<Cloud className="h-4 w-4" />}
          title="Cloud Model"
          subtitle="OpenAI, OpenRouter, Ollama Cloud, or your tunneled endpoint"
          provider={draft.cloud}
          onChange={(p) => patchProvider("cloud", p)}
          accent="text-primary"
        />

        <Card className="glass-card p-6">
          <h2 className="text-base font-semibold tracking-tight">System Prompt</h2>
          <p className="text-xs text-muted-foreground">
            Sent as the system message at the start of every conversation. Default is an SRE persona.
          </p>
          <Textarea
            value={draft.systemPrompt}
            onChange={(e) => setDraft({ ...draft, systemPrompt: e.target.value })}
            rows={6}
            className="mt-4 font-mono text-sm"
          />
        </Card>

        <Card className="glass-card p-6">
          <h2 className="text-base font-semibold tracking-tight">Agent & Memory</h2>
          <p className="text-xs text-muted-foreground">
            ReAct loop and short-term memory window.
          </p>

          <div className="mt-5 flex items-start justify-between gap-4 rounded-xl border border-border bg-secondary/30 p-4">
            <div className="space-y-1">
              <Label className="text-sm font-medium">Agentic mode (ReAct)</Label>
              <p className="text-xs text-muted-foreground">
                Thought → Action → Observation → Final Answer. Required for server tools to work.
              </p>
            </div>
            <Switch
              checked={draft.agenticMode}
              onCheckedChange={(v) => setDraft({ ...draft, agenticMode: v })}
            />
          </div>

          <div className="mt-4 space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-sm font-medium">Chat memory window</Label>
              <span className="font-mono text-xs text-muted-foreground">{draft.maxContextMessages} messages</span>
            </div>
            <Input
              type="number"
              min={2}
              max={100}
              value={draft.maxContextMessages}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  maxContextMessages: Math.max(2, Math.min(100, Number(e.target.value) || 20)),
                })
              }
              className="h-9 font-mono text-sm"
            />
          </div>
        </Card>

        <div className="flex justify-end">
          <Button onClick={save} className="h-10 rounded-xl bg-primary text-primary-foreground hover:bg-primary/90">
            <Save className="mr-1.5 h-4 w-4" />
            Save settings
          </Button>
        </div>
      </div>
    </AppLayout>
  );
}

function BridgeCard({
  bridge,
  onChange,
}: {
  bridge: BridgeConfig;
  onChange: (p: Partial<BridgeConfig>) => void;
}) {
  const [showToken, setShowToken] = useState(false);
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string; latencyMs?: number } | null>(null);

  async function runTest() {
    setTesting(true);
    setResult(null);
    const t0 = performance.now();
    try {
      const h = await bridgeHealth(bridge);
      const latencyMs = Math.round(performance.now() - t0);
      setResult({
        ok: true,
        message: `${h.hostname ?? "ok"} · v${h.version} · ${h.os}`,
        latencyMs,
      });
      toast.success(`Bridge healthy on ${h.hostname}`);
    } catch (e) {
      const latencyMs = Math.round(performance.now() - t0);
      const msg = e instanceof Error ? e.message : "failed";
      setResult({ ok: false, message: msg, latencyMs });
      toast.error(`Bridge unreachable: ${msg}`);
    } finally {
      setTesting(false);
    }
  }

  return (
    <Card className="glass-card border-warning/30 p-6">
      <div className="mb-2 flex items-center gap-2.5">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-warning/15 text-warning">
          <Server className="h-4 w-4" />
        </span>
        <div className="flex-1">
          <h2 className="text-base font-semibold tracking-tight">Aurora Agent Bridge</h2>
          <p className="text-xs text-muted-foreground">
            The Go daemon running on YOUR server. Without this, the AI cannot reach your machine.
          </p>
        </div>
        <Switch checked={bridge.enabled} onCheckedChange={(v) => onChange({ enabled: v })} />
      </div>

      {bridge.enabled && !bridge.baseUrl && (
        <div className="mt-4 flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 p-3 text-xs text-warning">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>Enabled but missing Base URL. Server tools won't appear to the AI until it's filled.</span>
        </div>
      )}

      <div className="mt-5 space-y-4">
        <Field label="Base URL (Tailscale address of your server)">
          <Input
            value={bridge.baseUrl}
            onChange={(e) => onChange({ baseUrl: e.target.value })}
            placeholder="http://my-server.tail-scale.ts.net:8787"
            className="font-mono text-sm"
          />
          <p className="text-[11px] text-muted-foreground">
            Tip: paste only the API ROOT — the app appends the right path itself.
            Cloud/public URL works directly. Tailscale 100.x or MagicDNS works only when the Lovable runtime can resolve it (use a public hostname + token if it can't).
          </p>
        </Field>

        <Field label="Bearer token (optional — leave empty when on Tailnet)">
          <div className="relative">
            <KeyRound className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              type={showToken ? "text" : "password"}
              value={bridge.token}
              onChange={(e) => onChange({ token: e.target.value })}
              placeholder="Empty = no auth (Tailscale handles it)"
              className="pl-9 pr-10 font-mono text-sm"
            />
            <button
              type="button"
              onClick={() => setShowToken((s) => !s)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              {showToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Only set if you also expose the agent on a public network. Tailscale already encrypts + authenticates via WireGuard.
          </p>
        </Field>

        <div className="rounded-xl border border-border bg-secondary/30 p-4">
          <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Setup quickstart (Tailscale)</p>
          <pre className="overflow-x-auto rounded-lg bg-background/60 p-3 font-mono text-[11px] text-foreground/80">{`# 1. Install Tailscale on your server (once)
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up

# 2. Install Tailscale on this device too, log in to the same tailnet.

# 3. Build & run the agent (no token needed on Tailnet)
cd agent-bridge && go build -o aurora-agent .
./aurora-agent -addr :8787 -root /path/to/your/project &

# 4. Find your server's tailnet name
tailscale status     # → e.g. my-server.tail-scale.ts.net
# Paste  http://my-server.tail-scale.ts.net:8787  into Base URL above.`}</pre>
        </div>

        <div className="flex flex-wrap items-center gap-3 pt-1">
          <Button
            type="button"
            variant="outline"
            onClick={runTest}
            disabled={testing || !bridge.baseUrl}
            className="h-9 rounded-xl"
          >
            {testing ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Plug className="mr-1.5 h-4 w-4" />}
            {testing ? "Pinging…" : "Test bridge"}
          </Button>
          {result && (
            <div className={`flex items-center gap-1.5 text-xs ${result.ok ? "text-success" : "text-destructive"}`}>
              {result.ok ? <CheckCircle2 className="h-3.5 w-3.5" /> : <XCircle className="h-3.5 w-3.5" />}
              <span>{result.message}</span>
              {typeof result.latencyMs === "number" && (
                <span className="text-muted-foreground">· {result.latencyMs}ms</span>
              )}
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}

function ProviderCard({
  mode,
  icon,
  title,
  subtitle,
  provider,
  onChange,
  accent,
}: {
  mode: ModelMode;
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  provider: ProviderConfig;
  onChange: (p: Partial<ProviderConfig>) => void;
  accent: string;
}) {
  const [showKey, setShowKey] = useState(false);
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<TestConnectionResult | null>(null);

  async function runTest() {
    setTesting(true);
    setResult(null);
    try {
      const r = await testConnection(provider);
      setResult(r);
      if (r.ok) toast.success(`${title}: ${r.message}`);
      else toast.error(`${title}: ${r.message}`);
    } finally {
      setTesting(false);
    }
  }

  const isOllama = provider.provider === "ollama";
  const placeholderUrl = isOllama
    ? mode === "local" ? "http://localhost:11434" : "https://ollama.example.com"
    : "https://api.openai.com/v1";
  const placeholderModel = isOllama ? "llama3.1:8b" : "gpt-4o-mini";

  return (
    <Card className="glass-card p-6">
      <div className="mb-5 flex items-center gap-2.5">
        <span className={`flex h-9 w-9 items-center justify-center rounded-xl bg-primary/15 ${accent}`}>
          {icon}
        </span>
        <div className="flex-1">
          <h2 className="text-base font-semibold tracking-tight">{title}</h2>
          <p className="text-xs text-muted-foreground">{subtitle}</p>
        </div>
      </div>

      <div className="space-y-4">
        <Field label="Provider type">
          <Select
            value={provider.provider}
            onValueChange={(v) => onChange({ provider: v as ProviderConfig["provider"] })}
          >
            <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="ollama">Ollama (/api/chat)</SelectItem>
              <SelectItem value="openai">OpenAI-compatible (/chat/completions)</SelectItem>
            </SelectContent>
          </Select>
        </Field>

        <Field label="Base URL">
          <Input
            value={provider.apiUrl}
            onChange={(e) => onChange({ apiUrl: e.target.value })}
            placeholder={placeholderUrl}
            className="font-mono text-sm"
          />
        </Field>

        <Field label="Model name">
          <Input
            value={provider.model}
            onChange={(e) => onChange({ model: e.target.value })}
            placeholder={placeholderModel}
            className="font-mono text-sm"
          />
        </Field>

        <Field label={isOllama ? "API Key (optional)" : "API Key"}>
          <div className="relative">
            <KeyRound className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              type={showKey ? "text" : "password"}
              value={provider.apiKey}
              onChange={(e) => onChange({ apiKey: e.target.value })}
              placeholder={isOllama ? "Leave blank for local" : "sk-…"}
              className="pl-9 pr-10 font-mono text-sm"
            />
            <button
              type="button"
              onClick={() => setShowKey((s) => !s)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </Field>

        <div className="flex flex-wrap items-center gap-3 pt-1">
          <Button type="button" variant="outline" onClick={runTest} disabled={testing} className="h-9 rounded-xl">
            {testing ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Plug className="mr-1.5 h-4 w-4" />}
            {testing ? "Testing…" : "Test connection"}
          </Button>
          {result && (
            <div className={`flex items-center gap-1.5 text-xs ${result.ok ? "text-success" : "text-destructive"}`}>
              {result.ok ? <CheckCircle2 className="h-3.5 w-3.5" /> : <XCircle className="h-3.5 w-3.5" />}
              <span>{result.message}</span>
              {typeof result.latencyMs === "number" && (
                <span className="text-muted-foreground">· {result.latencyMs}ms</span>
              )}
            </div>
          )}
        </div>

        {result?.ok && result.models && result.models.length > 0 && (
          <div className="rounded-xl border border-border bg-secondary/30 p-3">
            <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Available models</p>
            <div className="flex flex-wrap gap-1.5">
              {result.models.slice(0, 12).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => onChange({ model: m })}
                  className="rounded-md border border-border bg-card px-2 py-0.5 font-mono text-[11px] text-foreground transition-smooth hover:border-primary/50 hover:text-primary"
                >
                  {m}
                </button>
              ))}
              {result.models.length > 12 && (
                <span className="px-1 text-[11px] text-muted-foreground">+{result.models.length - 12} more</span>
              )}
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}

function Field({ label, children }: { label: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <Label className="text-xs font-medium text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

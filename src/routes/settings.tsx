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
import { useAppStore, type ModelMode, type ProviderConfig } from "@/lib/store";
import { testConnection, type TestConnectionResult } from "@/lib/chat-api";
import {
  CheckCircle2,
  Cloud,
  Cpu,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  Plug,
  Save,
  XCircle,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

export const Route = createFileRoute("/settings")({
  head: () => ({
    meta: [
      { title: "Settings — Aurora AI Assistant" },
      {
        name: "description",
        content:
          "Configure your local or cloud model (Ollama / OpenAI-compatible) and verify the connection.",
      },
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

  function patch(mode: ModelMode, p: Partial<ProviderConfig>) {
    setDraft({ ...draft, [mode]: { ...draft[mode], ...p } });
  }

  return (
    <AppLayout title="Settings" subtitle="API & model configuration">
      <div className="mx-auto w-full max-w-3xl space-y-5 p-6">
        <ProviderCard
          mode="local"
          icon={<Cpu className="h-4 w-4" />}
          title="Local Model"
          subtitle="Ollama, Llama.cpp, or any OpenAI-compatible server on your machine"
          provider={draft.local}
          onChange={(p) => patch("local", p)}
          accent="text-success"
        />

        <ProviderCard
          mode="cloud"
          icon={<Cloud className="h-4 w-4" />}
          title="Cloud Model"
          subtitle="OpenAI, OpenRouter, Ollama Cloud, or your tunneled endpoint"
          provider={draft.cloud}
          onChange={(p) => patch("cloud", p)}
          accent="text-primary"
        />

        <Card className="glass-card p-6">
          <h2 className="text-base font-semibold tracking-tight">System Prompt</h2>
          <p className="text-xs text-muted-foreground">
            Sent as the system message at the start of every conversation
          </p>
          <Textarea
            value={draft.systemPrompt}
            onChange={(e) => setDraft({ ...draft, systemPrompt: e.target.value })}
            rows={5}
            className="mt-4 font-mono text-sm"
          />
        </Card>

        <div className="flex justify-end">
          <Button
            onClick={save}
            className="h-10 rounded-xl bg-primary text-primary-foreground hover:bg-primary/90"
          >
            <Save className="mr-1.5 h-4 w-4" />
            Save settings
          </Button>
        </div>
      </div>
    </AppLayout>
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
    ? mode === "local"
      ? "http://localhost:11434"
      : "https://ollama.example.com"
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
            <SelectTrigger className="h-9 text-sm">
              <SelectValue />
            </SelectTrigger>
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
          <p className="text-[11px] text-muted-foreground">
            {isOllama ? (
              <>
                Ollama root URL — endpoints{" "}
                <code className="rounded bg-secondary/60 px-1">/api/chat</code> and{" "}
                <code className="rounded bg-secondary/60 px-1">/api/tags</code> will be used.
              </>
            ) : (
              <>
                Should expose{" "}
                <code className="rounded bg-secondary/60 px-1">/chat/completions</code> and{" "}
                <code className="rounded bg-secondary/60 px-1">/models</code>.
              </>
            )}
          </p>
        </Field>

        <Field label="Model name">
          <Input
            value={provider.model}
            onChange={(e) => onChange({ model: e.target.value })}
            placeholder={placeholderModel}
            className="font-mono text-sm"
          />
        </Field>

        <Field label={isOllama ? "API Key (optional · for Ollama Cloud)" : "API Key"}>
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
          <p className="text-[11px] text-muted-foreground">
            Stored locally in your browser only.
          </p>
        </Field>

        <div className="flex flex-wrap items-center gap-3 pt-1">
          <Button
            type="button"
            variant="outline"
            onClick={runTest}
            disabled={testing}
            className="h-9 rounded-xl"
          >
            {testing ? (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
            ) : (
              <Plug className="mr-1.5 h-4 w-4" />
            )}
            {testing ? "Testing…" : "Test connection"}
          </Button>

          {result && (
            <div
              className={`flex items-center gap-1.5 text-xs ${
                result.ok ? "text-success" : "text-destructive"
              }`}
            >
              {result.ok ? (
                <CheckCircle2 className="h-3.5 w-3.5" />
              ) : (
                <XCircle className="h-3.5 w-3.5" />
              )}
              <span>{result.message}</span>
              {typeof result.latencyMs === "number" && (
                <span className="text-muted-foreground">· {result.latencyMs}ms</span>
              )}
            </div>
          )}
        </div>

        {result?.ok && result.models && result.models.length > 0 && (
          <div className="rounded-xl border border-border bg-secondary/30 p-3">
            <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Available models
            </p>
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
                <span className="px-1 text-[11px] text-muted-foreground">
                  +{result.models.length - 12} more
                </span>
              )}
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}

function Field({
  label,
  children,
}: {
  label: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <Label className="text-xs font-medium text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

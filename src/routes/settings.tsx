import { createFileRoute } from "@tanstack/react-router";
import { AppLayout } from "@/components/AppLayout";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { useAppStore } from "@/lib/store";
import { Cloud, Cpu, Eye, EyeOff, KeyRound, Save, Server } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

export const Route = createFileRoute("/settings")({
  head: () => ({
    meta: [
      { title: "Settings — Aurora AI Assistant" },
      { name: "description", content: "Configure your OpenAI-compatible API endpoint." },
    ],
  }),
  component: SettingsPage,
});

function SettingsPage() {
  const settings = useAppStore((s) => s.settings);
  const updateSettings = useAppStore((s) => s.updateSettings);

  const [draft, setDraft] = useState(settings);
  const [showKey, setShowKey] = useState(false);

  function save() {
    updateSettings(draft);
    toast.success("Settings saved");
  }

  return (
    <AppLayout title="Settings" subtitle="API & model configuration">
      <div className="mx-auto w-full max-w-3xl space-y-5 p-6">
        <Card className="glass-card p-6">
          <div className="mb-5 flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/15 text-primary">
              <Server className="h-4 w-4" />
            </span>
            <div>
              <h2 className="text-base font-semibold tracking-tight">API Endpoint</h2>
              <p className="text-xs text-muted-foreground">
                OpenAI-compatible · Cloudflare Tunnel, Llama.cpp, OpenRouter, etc.
              </p>
            </div>
          </div>

          <div className="space-y-4">
            <Field label="Base URL">
              <Input
                value={draft.apiUrl}
                onChange={(e) => setDraft({ ...draft, apiUrl: e.target.value })}
                placeholder="https://your-tunnel.trycloudflare.com/v1"
                className="font-mono text-sm"
              />
              <p className="text-[11px] text-muted-foreground">
                Should expose <code className="rounded bg-secondary/60 px-1">/chat/completions</code>
              </p>
            </Field>

            <Field label="API Key (optional)">
              <div className="relative">
                <KeyRound className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  type={showKey ? "text" : "password"}
                  value={draft.apiKey}
                  onChange={(e) => setDraft({ ...draft, apiKey: e.target.value })}
                  placeholder="sk-…"
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
                Stored locally in your browser. Leave blank if your endpoint is unauthenticated.
              </p>
            </Field>
          </div>
        </Card>

        <Card className="glass-card p-6">
          <h2 className="text-base font-semibold tracking-tight">Models</h2>
          <p className="text-xs text-muted-foreground">
            Names sent in the <code className="rounded bg-secondary/60 px-1">model</code> field
          </p>

          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <Field
              label={
                <span className="flex items-center gap-1.5">
                  <Cpu className="h-3.5 w-3.5 text-success" /> Local model
                </span>
              }
            >
              <Input
                value={draft.localModel}
                onChange={(e) => setDraft({ ...draft, localModel: e.target.value })}
                placeholder="llama-3.1-8b-instruct"
                className="font-mono text-sm"
              />
            </Field>
            <Field
              label={
                <span className="flex items-center gap-1.5">
                  <Cloud className="h-3.5 w-3.5 text-primary" /> Cloud model
                </span>
              }
            >
              <Input
                value={draft.cloudModel}
                onChange={(e) => setDraft({ ...draft, cloudModel: e.target.value })}
                placeholder="gpt-4o-mini"
                className="font-mono text-sm"
              />
            </Field>
          </div>
        </Card>

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

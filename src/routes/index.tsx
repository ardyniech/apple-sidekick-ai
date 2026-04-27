import { createFileRoute, Link } from "@tanstack/react-router";
import { AppLayout } from "@/components/AppLayout";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  ChevronRight,
  Cloud,
  Cpu,
  HardDrive,
  Loader2,
  MessageSquare,
  Pause,
  Play,
  RefreshCw,
  RotateCcw,
  Search,
  Server,
  ShieldCheck,
  ShieldOff,
  Terminal,
  XCircle,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useAppStore } from "@/lib/store";
import {
  bridgeHealth,
  bridgeJournal,
  bridgeMetrics,
  bridgeProcesses,
  bridgeReady,
  bridgeServiceAction,
  bridgeServices,
  type BridgeHealth,
  type BridgeMetrics,
  type ProcessInfo,
  type ServiceInfo,
} from "@/lib/bridge";
import { testConnection, type TestConnectionResult } from "@/lib/chat-api";
import { requestMutationConfirm } from "@/components/MutationGate";
import { QuickDiagnose } from "@/components/QuickDiagnose";
import { ActionCenter } from "@/components/ActionCenter";
import { JournalStream } from "@/components/JournalStream";
import { DevServerDiagnostics } from "@/components/DevServerDiagnostics";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Dashboard — Aurora" },
      { name: "description", content: "Live server cockpit: services, processes, logs, metrics. No terminal needed." },
    ],
  }),
  component: Dashboard,
});

interface Probe<T> {
  status: "idle" | "loading" | "ok" | "error";
  data?: T;
  error?: string;
  latencyMs?: number;
}

function useProbe<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [state, setState] = useState<Probe<T>>({ status: "idle" });
  const run = useCallback(async () => {
    setState((s) => ({ ...s, status: "loading" }));
    const t0 = performance.now();
    try {
      const data = await fn();
      setState({ status: "ok", data, latencyMs: Math.round(performance.now() - t0) });
    } catch (e) {
      setState({
        status: "error",
        error: e instanceof Error ? e.message : "failed",
        latencyMs: Math.round(performance.now() - t0),
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => {
    run();
  }, [run]);
  return [state, run] as const;
}

function Dashboard() {
  const settings = useAppStore((s) => s.settings);
  const messages = useAppStore((s) => s.messages);
  const memories = useAppStore((s) => s.memories);
  const mode = useAppStore((s) => s.mode);

  const bridge = settings.bridge;
  const ready = bridgeReady(bridge);

  const [health, refreshHealth] = useProbe<BridgeHealth>(
    () => bridgeHealth(bridge),
    [bridge.baseUrl, bridge.token, bridge.enabled],
  );
  const [metrics, refreshMetrics] = useProbe<BridgeMetrics>(
    () => bridgeMetrics(bridge),
    [bridge.baseUrl, bridge.token, bridge.enabled],
  );
  const [model, refreshModel] = useProbe<TestConnectionResult>(
    () => testConnection(mode === "local" ? settings.local : settings.cloud),
    [mode, settings.local, settings.cloud],
  );

  // Auto-refresh metrics every 5s when bridge is reachable
  useEffect(() => {
    if (!ready || health.status !== "ok") return;
    const id = setInterval(() => refreshMetrics(), 5000);
    return () => clearInterval(id);
  }, [ready, health.status, refreshMetrics]);

  const refreshAll = () => {
    refreshHealth();
    refreshMetrics();
    refreshModel();
  };

  return (
    <AppLayout title="Dashboard" subtitle="Server cockpit — click to act, no terminal needed">
      <div className="mx-auto w-full max-w-7xl space-y-6 p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">
            Real-time probes via the same-origin proxy. No mock data.
          </p>
          <Button variant="outline" size="sm" onClick={refreshAll} className="rounded-xl">
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
            Refresh all
          </Button>
        </div>

        {!ready && <BridgeNotConfiguredBanner />}

        {/* Status row */}
        <div className="grid gap-4 md:grid-cols-3">
          <StatusCard
            icon={<Server className="h-4 w-4" />}
            title="Agent Bridge"
            subtitle={bridge.baseUrl || "not configured"}
            probe={health}
            valueRender={(d) => `${d.hostname ?? "ok"} · v${d.version} · ${d.os}`}
          />
          <StatusCard
            icon={mode === "local" ? <Cpu className="h-4 w-4" /> : <Cloud className="h-4 w-4" />}
            title={`${mode === "local" ? "Local" : "Cloud"} Model`}
            subtitle={(mode === "local" ? settings.local : settings.cloud).apiUrl || "not configured"}
            probe={model}
            valueRender={(r) => r.message}
          />
          <Card className="glass-card p-5">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-secondary/60">
                <MessageSquare className="h-4 w-4 text-accent" />
              </span>
              Local state
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <div>
                <div className="font-display text-2xl font-semibold">{messages.length}</div>
                <div className="text-xs text-muted-foreground">messages</div>
              </div>
              <div>
                <div className="font-display text-2xl font-semibold">{memories.length}</div>
                <div className="text-xs text-muted-foreground">memories</div>
              </div>
            </div>
          </Card>
        </div>

        {/* Diagnostics */}
        <DiagnosticsPanel
          health={health}
          model={model}
          metrics={metrics}
          ready={ready}
          onRetry={refreshAll}
        />

        {/* Metrics */}
        <Card className="glass-card p-6">
          <div className="mb-5 flex items-center justify-between">
            <div>
              <h2 className="text-base font-semibold tracking-tight">Server metrics</h2>
              <p className="text-xs text-muted-foreground">
                Live from <code className="rounded bg-secondary/60 px-1">/proc</code> · auto-refresh 5s
              </p>
            </div>
            <ProbeBadge probe={metrics} okLabel="Live" />
          </div>
          {!ready ? (
            <Empty reason="Configure the Agent Bridge in Settings to see real metrics." />
          ) : metrics.status === "error" ? (
            <Empty reason={metrics.error ?? "Failed to fetch"} />
          ) : metrics.status !== "ok" || !metrics.data ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Fetching…
            </div>
          ) : (
            <ServerMetrics data={metrics.data} />
          )}
        </Card>

        {/* Cockpit: quick diagnose, services, actions, processes, live logs */}
        {ready && health.status === "ok" && (
          <>
            <QuickDiagnose />
            <DevServerDiagnostics />
            <ServicesPanel bridge={bridge} />
            <ActionCenter />
            <div className="grid gap-6 lg:grid-cols-2">
              <ProcessesPanel bridge={bridge} />
              <JournalStream />
            </div>
          </>
        )}
      </div>
    </AppLayout>
  );
}

/* ========================= Diagnostics ========================= */

function DiagnosticsPanel({
  health,
  model,
  metrics,
  ready,
  onRetry,
}: {
  health: Probe<BridgeHealth>;
  model: Probe<TestConnectionResult>;
  metrics: Probe<BridgeMetrics>;
  ready: boolean;
  onRetry: () => void;
}) {
  const checks = useMemo(() => {
    const items: { label: string; ok: boolean; detail: string; fix?: string }[] = [];
    items.push({
      label: "Same-origin proxy",
      ok: true,
      detail: "/api/proxy/$ — bypasses CORS & mixed-content from the browser.",
    });
    items.push({
      label: "AI model provider",
      ok: model.status === "ok" && (model.data?.ok ?? false),
      detail:
        model.status === "ok"
          ? model.data?.message ?? "ok"
          : model.status === "error"
            ? model.error ?? "error"
            : "not tested",
      fix:
        model.status === "ok" && model.data?.ok
          ? undefined
          : "Open Settings → Cloud / Local Model. Make sure Base URL points to the API root (e.g. https://api.openai.com/v1) — not /chat/completions. Add API key if cloud.",
    });
    items.push({
      label: "Agent Bridge reachability",
      ok: ready && health.status === "ok",
      detail: !ready
        ? "Bridge disabled or URL empty"
        : health.status === "ok"
          ? `Reachable in ${health.latencyMs ?? "?"}ms`
          : health.error ?? "Unreachable",
      fix:
        ready && health.status !== "ok"
          ? "1) Run aurora-agent on your server. 2) The proxy must be able to reach the URL — use a public hostname or a Tailscale MagicDNS that this device can resolve. Private 100.x addresses are NOT visible to the Lovable runtime."
          : !ready
            ? "Open Settings → Aurora Agent Bridge, toggle it on, and paste the public/MagicDNS URL of your aurora-agent."
            : undefined,
    });
    if (ready) {
      items.push({
        label: "Live metrics feed",
        ok: metrics.status === "ok",
        detail:
          metrics.status === "ok"
            ? `cpu=${metrics.data?.cpuPercent ?? "?"}% ram=${metrics.data?.memPercent ?? "?"}%`
            : metrics.error ?? "—",
      });
    }
    return items;
  }, [ready, health, model, metrics]);

  const okCount = checks.filter((c) => c.ok).length;
  const allOk = okCount === checks.length;

  return (
    <Card className="glass-card p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className={`flex h-9 w-9 items-center justify-center rounded-xl ${allOk ? "bg-success/15 text-success" : "bg-warning/15 text-warning"}`}>
            {allOk ? <CheckCircle2 className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
          </span>
          <div>
            <h2 className="text-base font-semibold tracking-tight">Diagnostics</h2>
            <p className="text-xs text-muted-foreground">
              {okCount}/{checks.length} checks passing
            </p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={onRetry} className="rounded-xl">
          <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
          Run health check
        </Button>
      </div>
      <ul className="space-y-2">
        {checks.map((c) => (
          <li key={c.label} className="rounded-xl border border-border bg-secondary/20 p-3">
            <div className="flex items-start gap-2.5">
              {c.ok ? (
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" />
              ) : (
                <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
              )}
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-sm font-medium">{c.label}</span>
                  <span className="font-mono text-[11px] text-muted-foreground">{c.detail}</span>
                </div>
                {c.fix && (
                  <p className="mt-1.5 text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">How to fix:</span> {c.fix}
                  </p>
                )}
              </div>
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}

/* ========================= Services ========================= */

function ServicesPanel({ bridge }: { bridge: ReturnType<typeof useAppStore.getState>["settings"]["bridge"] }) {
  const [data, setData] = useState<{ services: ServiceInfo[]; error?: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await bridgeServices(bridge));
    } catch (e) {
      setData({ services: [], error: e instanceof Error ? e.message : "failed" });
    } finally {
      setLoading(false);
    }
  }, [bridge]);

  useEffect(() => {
    load();
  }, [load]);

  async function act(name: string, action: "start" | "stop" | "restart") {
    if (action === "stop" || action === "restart") {
      const ok = await requestMutationConfirm({
        kind: "service",
        title: `${action === "stop" ? "Stop" : "Restart"} ${name}?`,
        description: `Will run: systemctl ${action} ${name}`,
        detail: `systemctl ${action} ${name}`,
        destructive: action === "stop",
      });
      if (!ok) return;
    }
    setBusy(`${name}:${action}`);
    try {
      const r = await bridgeServiceAction(bridge, name, action);
      if (r.ok) toast.success(`${action} ${name} ok`);
      else toast.error(`${action} ${name} failed (code ${r.code}): ${r.stdout.slice(0, 120)}`);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "action failed");
    } finally {
      setBusy(null);
    }
  }

  const services = useMemo(() => {
    const list = data?.services ?? [];
    const f = filter.trim().toLowerCase();
    if (!f) return list.slice(0, 50);
    return list.filter((s) => s.name.toLowerCase().includes(f) || s.description.toLowerCase().includes(f)).slice(0, 100);
  }, [data, filter]);

  const failed = (data?.services ?? []).filter((s) => s.active === "failed");

  return (
    <Card className="glass-card p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/15 text-primary">
            <Server className="h-4 w-4" />
          </span>
          <div>
            <h2 className="text-base font-semibold tracking-tight">Services (systemd)</h2>
            <p className="text-xs text-muted-foreground">
              {data?.error ? data.error : `${data?.services.length ?? 0} units · ${failed.length} failed`}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter services…"
              className="h-9 w-44 rounded-xl pl-8 text-xs sm:w-60"
            />
          </div>
          <Button variant="outline" size="sm" onClick={load} disabled={loading} className="rounded-xl">
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          </Button>
        </div>
      </div>

      {data?.error && (
        <div className="mb-3 rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
          {data.error}
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-border">
        <div className="grid grid-cols-12 gap-2 bg-secondary/40 px-3 py-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          <div className="col-span-5">Service</div>
          <div className="col-span-2">State</div>
          <div className="col-span-5 text-right">Actions</div>
        </div>
        <ul className="max-h-[480px] divide-y divide-border overflow-y-auto">
          {services.length === 0 && !loading && (
            <li className="px-3 py-6 text-center text-xs text-muted-foreground">No services match.</li>
          )}
          {services.map((s) => {
            const state = s.active === "active" ? "ok" : s.active === "failed" ? "error" : "warn";
            return (
              <li key={s.name} className="grid grid-cols-12 items-center gap-2 px-3 py-2 hover:bg-secondary/20">
                <div className="col-span-5 min-w-0">
                  <div className="truncate font-mono text-xs font-medium" title={s.name}>{s.name}</div>
                  <div className="truncate text-[11px] text-muted-foreground" title={s.description}>{s.description}</div>
                </div>
                <div className="col-span-2">
                  <Badge
                    variant="secondary"
                    className={`rounded-md font-mono text-[10px] ${
                      state === "ok"
                        ? "border border-success/30 bg-success/15 text-success"
                        : state === "error"
                          ? "border border-destructive/30 bg-destructive/15 text-destructive"
                          : "border border-warning/30 bg-warning/15 text-warning"
                    }`}
                  >
                    {s.active}/{s.sub}
                  </Badge>
                </div>
                <div className="col-span-5 flex justify-end gap-1.5">
                  <ActionBtn
                    onClick={() => act(s.name, "start")}
                    busy={busy === `${s.name}:start`}
                    icon={<Play className="h-3 w-3" />}
                    label="Start"
                  />
                  <ActionBtn
                    onClick={() => act(s.name, "restart")}
                    busy={busy === `${s.name}:restart`}
                    icon={<RotateCcw className="h-3 w-3" />}
                    label="Restart"
                  />
                  <ActionBtn
                    onClick={() => act(s.name, "stop")}
                    busy={busy === `${s.name}:stop`}
                    icon={<Pause className="h-3 w-3" />}
                    label="Stop"
                    danger
                  />
                </div>
              </li>
            );
          })}
        </ul>
      </div>
      <p className="mt-3 text-[11px] text-muted-foreground">
        Actions run <code className="rounded bg-secondary/60 px-1">systemctl &lt;action&gt; &lt;unit&gt;</code> on your server. Aurora-agent must run as root (or a user with sudo for systemctl).
      </p>
    </Card>
  );
}

function ActionBtn({
  onClick,
  busy,
  icon,
  label,
  danger,
}: {
  onClick: () => void;
  busy: boolean;
  icon: React.ReactNode;
  label: string;
  danger?: boolean;
}) {
  return (
    <Button
      type="button"
      size="sm"
      variant="ghost"
      onClick={onClick}
      disabled={busy}
      className={`h-7 gap-1 rounded-md px-2 text-[10px] ${danger ? "text-destructive hover:bg-destructive/10 hover:text-destructive" : "hover:bg-primary/10 hover:text-primary"}`}
    >
      {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : icon}
      <span className="hidden sm:inline">{label}</span>
    </Button>
  );
}

/* ========================= Processes ========================= */

function ProcessesPanel({ bridge }: { bridge: ReturnType<typeof useAppStore.getState>["settings"]["bridge"] }) {
  const [data, setData] = useState<ProcessInfo[] | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await bridgeProcesses(bridge, 12);
      setData(r.processes ?? []);
    } catch {
      setData([]);
    } finally {
      setLoading(false);
    }
  }, [bridge]);

  useEffect(() => {
    load();
    const id = setInterval(load, 8000);
    return () => clearInterval(id);
  }, [load]);

  return (
    <Card className="glass-card p-6">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent/15 text-accent">
            <Cpu className="h-4 w-4" />
          </span>
          <div>
            <h2 className="text-base font-semibold tracking-tight">Top processes</h2>
            <p className="text-xs text-muted-foreground">Highest CPU first · refresh 8s</p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading} className="rounded-xl">
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
        </Button>
      </div>
      <div className="overflow-hidden rounded-xl border border-border">
        <div className="grid grid-cols-12 gap-2 bg-secondary/40 px-3 py-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          <div className="col-span-2">PID</div>
          <div className="col-span-5">Command</div>
          <div className="col-span-2 text-right">CPU%</div>
          <div className="col-span-3 text-right">MEM%</div>
        </div>
        <ul className="max-h-80 divide-y divide-border overflow-y-auto">
          {(data ?? []).map((p) => (
            <li key={p.pid} className="grid grid-cols-12 items-center gap-2 px-3 py-1.5 font-mono text-[11px]">
              <div className="col-span-2">{p.pid}</div>
              <div className="col-span-5 truncate" title={p.args}>{p.comm}</div>
              <div className={`col-span-2 text-right tabular-nums ${p.cpu > 50 ? "text-destructive" : p.cpu > 20 ? "text-warning" : ""}`}>
                {p.cpu.toFixed(1)}
              </div>
              <div className={`col-span-3 text-right tabular-nums ${p.mem > 50 ? "text-destructive" : p.mem > 20 ? "text-warning" : ""}`}>
                {p.mem.toFixed(1)}
              </div>
            </li>
          ))}
          {data && data.length === 0 && (
            <li className="px-3 py-6 text-center text-xs text-muted-foreground">No process data.</li>
          )}
        </ul>
      </div>
    </Card>
  );
}

/* ========================= Journal logs ========================= */

function JournalPanel({ bridge }: { bridge: ReturnType<typeof useAppStore.getState>["settings"]["bridge"] }) {
  const [unit, setUnit] = useState("");
  const [content, setContent] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const r = await bridgeJournal(bridge, { unit: unit.trim() || undefined, lines: 200 });
      setContent(r.content);
      if (r.error) setError(r.error);
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const lines = content.split("\n").slice(-200);

  return (
    <Card className="glass-card p-6">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-warning/15 text-warning">
            <Terminal className="h-4 w-4" />
          </span>
          <div>
            <h2 className="text-base font-semibold tracking-tight">System logs</h2>
            <p className="text-xs text-muted-foreground">journalctl tail · last 200 lines</p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading} className="rounded-xl">
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
        </Button>
      </div>
      <div className="mb-3 flex gap-2">
        <Input
          value={unit}
          onChange={(e) => setUnit(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && load()}
          placeholder="Filter by unit (e.g. nginx.service) — empty = all"
          className="h-9 rounded-xl font-mono text-xs"
        />
        <Button onClick={load} disabled={loading} className="h-9 rounded-xl">
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
      {error && (
        <div className="mb-2 rounded-lg border border-destructive/30 bg-destructive/10 p-2 text-[11px] text-destructive">{error}</div>
      )}
      <div className="max-h-80 overflow-y-auto rounded-xl border border-border bg-background/60 p-3">
        {lines.length === 0 || (lines.length === 1 && !lines[0]) ? (
          <p className="text-xs text-muted-foreground">No log lines.</p>
        ) : (
          <pre className="whitespace-pre-wrap break-all font-mono text-[10.5px] leading-relaxed text-foreground/85">
            {lines.map((l, i) => (
              <div
                key={i}
                className={
                  /\b(error|fail|fatal|panic)\b/i.test(l)
                    ? "text-destructive"
                    : /\bwarn(ing)?\b/i.test(l)
                      ? "text-warning"
                      : ""
                }
              >
                {l}
              </div>
            ))}
          </pre>
        )}
      </div>
    </Card>
  );
}

/* ========================= shared bits ========================= */

function StatusCard<T>({
  icon,
  title,
  subtitle,
  probe,
  valueRender,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  probe: Probe<T>;
  valueRender: (d: T) => string;
}) {
  return (
    <Card className="glass-card p-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-secondary/60 text-primary">
            {icon}
          </span>
          {title}
        </div>
        <ProbeBadge probe={probe} />
      </div>
      <div className="mt-3 truncate font-mono text-xs text-muted-foreground" title={subtitle}>
        {subtitle}
      </div>
      <div className="mt-2 min-h-[2rem] text-sm font-medium">
        {probe.status === "ok" && probe.data
          ? valueRender(probe.data)
          : probe.status === "error"
            ? <span className="text-destructive">{probe.error}</span>
            : probe.status === "loading"
              ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              : <span className="text-muted-foreground">—</span>}
      </div>
      {typeof probe.latencyMs === "number" && (
        <div className="mt-1 font-mono text-[10px] text-muted-foreground">{probe.latencyMs}ms</div>
      )}
    </Card>
  );
}

function ProbeBadge<T>({ probe, okLabel = "OK" }: { probe: Probe<T>; okLabel?: string }) {
  if (probe.status === "ok") {
    return (
      <Badge className="border border-success/30 bg-success/15 text-success hover:bg-success/15">
        <ShieldCheck className="mr-1 h-3 w-3" /> {okLabel}
      </Badge>
    );
  }
  if (probe.status === "error") {
    return (
      <Badge className="border border-destructive/30 bg-destructive/15 text-destructive hover:bg-destructive/15">
        <ShieldOff className="mr-1 h-3 w-3" /> Down
      </Badge>
    );
  }
  if (probe.status === "loading") {
    return <Badge variant="secondary"><Loader2 className="mr-1 h-3 w-3 animate-spin" /> …</Badge>;
  }
  return <Badge variant="secondary">idle</Badge>;
}

function ServerMetrics({ data }: { data: BridgeMetrics }) {
  return (
    <div className="space-y-5">
      {typeof data.cpuPercent === "number" && data.cpuPercent >= 0 && (
        <Bar icon={<Cpu className="h-3.5 w-3.5" />} label="CPU" value={data.cpuPercent} />
      )}
      {typeof data.memPercent === "number" && (
        <Bar
          icon={<HardDrive className="h-3.5 w-3.5" />}
          label={`RAM (${data.memUsedMB}MB / ${data.memTotalMB}MB)`}
          value={data.memPercent}
        />
      )}
      <div className="grid grid-cols-2 gap-3 border-t border-border pt-4 text-xs sm:grid-cols-4">
        <Stat label="Hostname" value={data.hostname ?? "—"} />
        <Stat label="OS" value={data.os ?? "—"} />
        <Stat label="Load 1m" value={data.load1?.toFixed(2) ?? "—"} />
        <Stat label="Uptime" value={fmtUptime(data.uptime)} />
      </div>
      {data.df && (
        <div>
          <div className="mb-1 text-[10px] uppercase tracking-wider text-muted-foreground">Disk (df -P)</div>
          <pre className="overflow-x-auto rounded-lg border border-border bg-background/50 p-3 font-mono text-[11px] text-foreground/80">
            {data.df}
          </pre>
        </div>
      )}
    </div>
  );
}

function fmtUptime(s?: number) {
  if (!s) return "—";
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m`;
}

function Bar({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) {
  const tone = value > 85 ? "text-destructive" : value > 70 ? "text-warning" : "";
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between text-xs">
        <span className="flex items-center gap-1.5 text-muted-foreground">
          {icon}
          {label}
        </span>
        <span className={`font-mono font-medium tabular-nums ${tone}`}>{value.toFixed(1)}%</span>
      </div>
      <Progress value={Math.min(100, Math.max(0, value))} className="h-1.5" />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-0.5 truncate font-mono text-sm font-medium" title={value}>{value}</div>
    </div>
  );
}

function Empty({ reason }: { reason: string }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-secondary/20 px-6 py-10 text-center">
      <Bot className="mb-2 h-6 w-6 text-muted-foreground" />
      <p className="text-sm font-medium">No data</p>
      <p className="mt-1 max-w-sm text-xs text-muted-foreground">{reason}</p>
    </div>
  );
}

function BridgeNotConfiguredBanner() {
  return (
    <Card className="glass-card border-warning/40 bg-warning/5 p-4">
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-warning" />
        <div className="flex-1">
          <p className="text-sm font-medium">Agent Bridge is not configured.</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            The cockpit (services, processes, logs, metrics) needs the Go bridge running on your server. Build it from <code className="rounded bg-secondary/60 px-1">agent-bridge/</code>, then paste its URL in Settings.
          </p>
        </div>
        <Button asChild size="sm" className="shrink-0 rounded-xl">
          <Link to="/settings">Open Settings</Link>
        </Button>
      </div>
    </Card>
  );
}

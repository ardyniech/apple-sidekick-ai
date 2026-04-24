import { createFileRoute } from "@tanstack/react-router";
import { Link } from "@tanstack/react-router";
import { AppLayout } from "@/components/AppLayout";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  AlertTriangle,
  Bot,
  Cloud,
  Cpu,
  HardDrive,
  Link2,
  Loader2,
  MessageSquare,
  RefreshCw,
  Server,
  ShieldCheck,
  ShieldOff,
  Terminal,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useAppStore } from "@/lib/store";
import { bridgeHealth, bridgeMetrics, bridgeReady, type BridgeHealth, type BridgeMetrics } from "@/lib/bridge";
import { testConnection, type TestConnectionResult } from "@/lib/chat-api";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Dashboard — Aurora" },
      { name: "description", content: "Live status of your server, model providers, and agent." },
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
    setState({ status: "loading" });
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

  // Auto-refresh metrics every 5s when bridge is ready
  useEffect(() => {
    if (!ready) return;
    const id = setInterval(() => refreshMetrics(), 5000);
    return () => clearInterval(id);
  }, [ready, refreshMetrics]);

  const refreshAll = () => {
    refreshHealth();
    refreshMetrics();
    refreshModel();
  };

  return (
    <AppLayout title="Dashboard" subtitle="Live server, model and agent status">
      <div className="mx-auto w-full max-w-7xl space-y-6 p-6">
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Real-time probes — no mock data. Refresh to re-check every connection.
          </p>
          <Button variant="outline" size="sm" onClick={refreshAll} className="rounded-xl">
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
            Refresh
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
            valueRender={(d) => `v${d.version} · ${d.os}`}
          />
          <StatusCard
            icon={mode === "local" ? <Cpu className="h-4 w-4" /> : <Cloud className="h-4 w-4" />}
            title={`${mode === "local" ? "Local" : "Cloud"} Model`}
            subtitle={(mode === "local" ? settings.local : settings.cloud).apiUrl || "not configured"}
            probe={model}
            valueRender={(r) => (r.ok ? r.message : r.message)}
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

        {/* Metrics */}
        <Card className="glass-card p-6">
          <div className="mb-5 flex items-center justify-between">
            <div>
              <h2 className="text-base font-semibold tracking-tight">Server metrics</h2>
              <p className="text-xs text-muted-foreground">
                Sourced from <code className="rounded bg-secondary/60 px-1">/proc</code> on your server via Agent Bridge
              </p>
            </div>
            <ProbeBadge probe={metrics} okLabel="Live" />
          </div>
          {!ready ? (
            <EmptyMetrics reason="Configure the Agent Bridge in Settings to see real metrics." />
          ) : metrics.status === "error" ? (
            <EmptyMetrics reason={metrics.error ?? "Failed to fetch"} />
          ) : metrics.status !== "ok" || !metrics.data ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Fetching…
            </div>
          ) : (
            <ServerMetrics data={metrics.data} />
          )}
        </Card>

        {/* Quick links */}
        <div className="grid gap-4 md:grid-cols-2">
          <Card className="glass-card p-6">
            <h3 className="text-sm font-semibold">Next steps</h3>
            <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
              <li className="flex items-start gap-2">
                <Link2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                <span>
                  Run <code className="rounded bg-secondary/60 px-1">aurora-agent</code> on your server (see{" "}
                  <code className="rounded bg-secondary/60 px-1">agent-bridge/README.md</code>) and expose it via Cloudflare Tunnel.
                </span>
              </li>
              <li className="flex items-start gap-2">
                <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-success" />
                <span>Paste the tunnel URL and AURORA_TOKEN into Settings → Agent Bridge.</span>
              </li>
              <li className="flex items-start gap-2">
                <Terminal className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
                <span>Open Chat and ask: "What's running on my server?" — the agent will use server_metrics + server_exec.</span>
              </li>
            </ul>
          </Card>
          <Card className="glass-card p-6">
            <h3 className="text-sm font-semibold">Active capabilities</h3>
            <div className="mt-3 flex flex-wrap gap-1.5">
              <CapBadge ok>get_time</CapBadge>
              <CapBadge ok>calculator</CapBadge>
              <CapBadge ok={ready}>server_metrics</CapBadge>
              <CapBadge ok={ready}>server_exec</CapBadge>
              <CapBadge ok={ready}>read_file</CapBadge>
              <CapBadge ok={ready} mutating>write_file (auto-commit)</CapBadge>
              <CapBadge ok={ready}>git</CapBadge>
              <CapBadge ok={ready}>tail_log</CapBadge>
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              Mutating tools are highlighted. They run only when the agent decides — review the reasoning trace in chat.
            </p>
          </Card>
        </div>
      </div>
    </AppLayout>
  );
}

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
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between text-xs">
        <span className="flex items-center gap-1.5 text-muted-foreground">
          {icon}
          {label}
        </span>
        <span className="font-mono font-medium tabular-nums">{value.toFixed(1)}%</span>
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

function CapBadge({ ok, children, mutating }: { ok: boolean; children: React.ReactNode; mutating?: boolean }) {
  return (
    <Badge
      variant="secondary"
      className={`rounded-md font-mono text-[10px] ${
        ok
          ? mutating
            ? "border border-warning/30 bg-warning/15 text-warning"
            : "border border-success/30 bg-success/15 text-success"
          : "border border-border bg-secondary/40 text-muted-foreground line-through"
      }`}
    >
      {children}
    </Badge>
  );
}

function EmptyMetrics({ reason }: { reason: string }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-secondary/20 px-6 py-10 text-center">
      <Bot className="mb-2 h-6 w-6 text-muted-foreground" />
      <p className="text-sm font-medium">No server data</p>
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
            Without it, the AI cannot reach your server. Build the binary in{" "}
            <code className="rounded bg-secondary/60 px-1">agent-bridge/</code>, run it on your server, expose via tunnel, then configure here.
          </p>
        </div>
        <Button asChild size="sm" className="shrink-0 rounded-xl">
          <Link to="/settings">Open Settings</Link>
        </Button>
      </div>
    </Card>
  );
}

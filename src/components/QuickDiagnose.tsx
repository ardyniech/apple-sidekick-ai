/**
 * Quick Diagnose: one click probes failing services / journal / metrics, then
 * sends a structured report to the AI for a plain-language explanation +
 * fix recommendation. Newbie friendly — no terminal commands, just "Apply fix".
 */
import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Stethoscope, Loader2, AlertTriangle, CheckCircle2, ArrowRight } from "lucide-react";
import { toast } from "sonner";
import { Link } from "@tanstack/react-router";
import { useAppStore } from "@/lib/store";
import {
  bridgeMetrics,
  bridgeServices,
  bridgeJournal,
  type BridgeMetrics,
  type ServiceInfo,
} from "@/lib/bridge";

interface DiagnoseResult {
  metrics?: BridgeMetrics;
  failed: ServiceInfo[];
  errorLines: string[];
  startedAt: number;
  finishedAt: number;
}

function summarizeForAI(r: DiagnoseResult): string {
  const lines: string[] = [];
  lines.push("# Server diagnostics snapshot");
  if (r.metrics) {
    lines.push(
      `Host: ${r.metrics.hostname} (${r.metrics.os}) — uptime ${r.metrics.uptime}s`,
    );
    lines.push(
      `CPU: ${r.metrics.cpuPercent}% · RAM: ${r.metrics.memPercent}% (${r.metrics.memUsedMB}/${r.metrics.memTotalMB}MB) · load1=${r.metrics.load1}`,
    );
    if (r.metrics.df) lines.push("Disk:\n```\n" + r.metrics.df + "\n```");
  }
  if (r.failed.length) {
    lines.push(`\n## Failed services (${r.failed.length})`);
    for (const s of r.failed) {
      lines.push(`- **${s.name}** (${s.active}/${s.sub}) — ${s.description}`);
    }
  } else {
    lines.push("\nNo failed systemd units.");
  }
  if (r.errorLines.length) {
    lines.push(`\n## Recent error/warn log lines`);
    lines.push("```\n" + r.errorLines.slice(-30).join("\n") + "\n```");
  }
  lines.push(
    "\nPlease (1) explain in plain language what is wrong, (2) cite the most likely root cause, (3) propose a concrete fix using available tools (read_file, exec_shell, service_action, write_file with diff_file preview). Do NOT execute mutations without confirmation.",
  );
  return lines.join("\n");
}

export function QuickDiagnose() {
  const settings = useAppStore((s) => s.settings);
  const addMessage = useAppStore((s) => s.addMessage);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<DiagnoseResult | null>(null);

  async function run() {
    setRunning(true);
    setResult(null);
    const startedAt = Date.now();
    try {
      const [m, s, j] = await Promise.allSettled([
        bridgeMetrics(settings.bridge),
        bridgeServices(settings.bridge),
        bridgeJournal(settings.bridge, { lines: 200 }),
      ]);
      const metrics = m.status === "fulfilled" ? m.value : undefined;
      const failed =
        s.status === "fulfilled"
          ? (s.value.services ?? []).filter((x) => x.active === "failed")
          : [];
      const errorLines =
        j.status === "fulfilled"
          ? j.value.content
              .split("\n")
              .filter((l) => /\b(error|fail|fatal|panic|critical|warn(ing)?)\b/i.test(l))
          : [];
      const r: DiagnoseResult = {
        metrics,
        failed,
        errorLines,
        startedAt,
        finishedAt: Date.now(),
      };
      setResult(r);
      toast.success(
        `Diagnose done · ${failed.length} failed · ${errorLines.length} log issues`,
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "diagnose failed");
    } finally {
      setRunning(false);
    }
  }

  function askAI() {
    if (!result) return;
    const content = summarizeForAI(result);
    addMessage({
      id: crypto.randomUUID(),
      role: "user",
      content,
      createdAt: Date.now(),
    });
    toast.success("Sent to AI — open Chat to see analysis");
  }

  const allGood =
    result &&
    result.failed.length === 0 &&
    result.errorLines.length === 0 &&
    (result.metrics?.cpuPercent ?? 0) < 80 &&
    (result.metrics?.memPercent ?? 0) < 85;

  return (
    <Card className="glass-card p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/15 text-primary">
            <Stethoscope className="h-4 w-4" />
          </span>
          <div>
            <h2 className="text-base font-semibold tracking-tight">Quick Diagnose</h2>
            <p className="text-xs text-muted-foreground">
              One click: probe metrics + failed services + recent log errors. Then ask the AI to explain.
            </p>
          </div>
        </div>
        <Button
          onClick={run}
          disabled={running}
          className="rounded-xl bg-primary text-primary-foreground hover:bg-primary/90"
        >
          {running ? (
            <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
          ) : (
            <Stethoscope className="mr-1.5 h-4 w-4" />
          )}
          {running ? "Probing…" : "Run diagnose"}
        </Button>
      </div>

      {result && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            {allGood ? (
              <Badge className="border border-success/30 bg-success/15 text-success hover:bg-success/15">
                <CheckCircle2 className="mr-1 h-3 w-3" /> All systems nominal
              </Badge>
            ) : (
              <Badge className="border border-warning/30 bg-warning/15 text-warning hover:bg-warning/15">
                <AlertTriangle className="mr-1 h-3 w-3" /> Issues detected
              </Badge>
            )}
            <span className="font-mono text-[10px] text-muted-foreground">
              probed in {result.finishedAt - result.startedAt}ms
            </span>
          </div>

          <ul className="space-y-1.5 text-xs">
            <li className="flex justify-between rounded-lg border border-border bg-secondary/20 px-3 py-2">
              <span className="text-muted-foreground">CPU / RAM</span>
              <span className="font-mono">
                {result.metrics?.cpuPercent ?? "?"}% · {result.metrics?.memPercent ?? "?"}%
              </span>
            </li>
            <li className="flex justify-between rounded-lg border border-border bg-secondary/20 px-3 py-2">
              <span className="text-muted-foreground">Failed services</span>
              <span
                className={`font-mono ${result.failed.length ? "text-destructive" : "text-success"}`}
              >
                {result.failed.length}
              </span>
            </li>
            <li className="flex justify-between rounded-lg border border-border bg-secondary/20 px-3 py-2">
              <span className="text-muted-foreground">Log issues (warn/error)</span>
              <span
                className={`font-mono ${result.errorLines.length > 5 ? "text-warning" : ""}`}
              >
                {result.errorLines.length}
              </span>
            </li>
          </ul>

          {result.failed.length > 0 && (
            <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-3">
              <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-destructive">
                Failed units
              </p>
              <ul className="space-y-0.5 font-mono text-[11px]">
                {result.failed.slice(0, 6).map((s) => (
                  <li key={s.name} className="truncate">
                    • {s.name} <span className="text-muted-foreground">— {s.description}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline" size="sm" className="rounded-xl">
              <Link to="/chat" onClick={askAI}>
                Ask AI to explain & fix
                <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
              </Link>
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}

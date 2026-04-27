/**
 * Action Center — 1-click recipes pulled from /actions on the bridge.
 * Newbie-friendly: pretty button per recipe, confirmation for mutating ones,
 * inline output viewer.
 */
import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Wrench,
  Loader2,
  Play,
  Terminal,
  AlertTriangle,
  RefreshCw,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { toast } from "sonner";
import { useAppStore } from "@/lib/store";
import { bridgeActions, bridgeExec, type ActionRecipe, type ExecResult } from "@/lib/bridge";
import { requestMutationConfirm } from "@/components/MutationGate";

const CATEGORY_TONE: Record<string, string> = {
  diagnose: "border-primary/30 bg-primary/10 text-primary",
  git: "border-accent/30 bg-accent/10 text-accent",
  network: "border-warning/30 bg-warning/10 text-warning",
  docker: "border-primary/30 bg-primary/10 text-primary",
  build: "border-success/30 bg-success/10 text-success",
};

export function ActionCenter() {
  const bridge = useAppStore((s) => s.settings.bridge);
  const [recipes, setRecipes] = useState<ActionRecipe[] | null>(null);
  const [execMode, setExecMode] = useState<"free" | "safe">("free");
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState<string | null>(null);
  const [outputs, setOutputs] = useState<Record<string, ExecResult>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const r = await bridgeActions(bridge);
      setRecipes(r.actions);
      setExecMode(r.execMode);
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed");
      setRecipes([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bridge.baseUrl, bridge.token]);

  async function runRecipe(r: ActionRecipe) {
    if (r.mutating) {
      const ok = await requestMutationConfirm({
        kind: "exec",
        title: `Run "${r.title}"?`,
        description: r.description,
        detail: r.cmd,
        destructive: true,
      });
      if (!ok) return;
    }
    setRunning(r.id);
    try {
      const res = await bridgeExec(bridge, r.cmd, { timeout: 60 });
      setOutputs((o) => ({ ...o, [r.id]: res }));
      setExpanded((e) => ({ ...e, [r.id]: true }));
      if (res.blocked) toast.error(`Blocked: ${res.reason}`);
      else if (res.code === 0) toast.success(`${r.title} ✓ (${res.durationMs}ms)`);
      else toast.error(`${r.title} exited ${res.code}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "exec failed");
    } finally {
      setRunning(null);
    }
  }

  const grouped = (recipes ?? []).reduce<Record<string, ActionRecipe[]>>((acc, r) => {
    (acc[r.category] ??= []).push(r);
    return acc;
  }, {});

  return (
    <Card className="glass-card p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-success/15 text-success">
            <Wrench className="h-4 w-4" />
          </span>
          <div>
            <h2 className="text-base font-semibold tracking-tight">Action Center</h2>
            <p className="text-xs text-muted-foreground">
              1-click recipes — diagnose, build, git. No terminal needed.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge
            variant="secondary"
            className={`rounded-md font-mono text-[10px] ${
              execMode === "safe"
                ? "border border-success/30 bg-success/15 text-success"
                : "border border-warning/30 bg-warning/15 text-warning"
            }`}
          >
            exec: {execMode}
          </Badge>
          <Button variant="outline" size="sm" onClick={load} disabled={loading} className="rounded-xl">
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          </Button>
        </div>
      </div>

      {error && (
        <div className="mb-3 flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div className="space-y-4">
        {Object.entries(grouped).map(([cat, list]) => (
          <div key={cat}>
            <p className="mb-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              {cat}
            </p>
            <div className="grid gap-2 sm:grid-cols-2">
              {list.map((r) => (
                <div
                  key={r.id}
                  className="group rounded-xl border border-border bg-secondary/20 p-3 transition-smooth hover:border-primary/40"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="text-sm font-medium">{r.title}</span>
                        {r.mutating && (
                          <Badge
                            variant="secondary"
                            className="border border-warning/30 bg-warning/10 px-1 py-0 text-[9px] uppercase text-warning"
                          >
                            mutates
                          </Badge>
                        )}
                      </div>
                      <p className="mt-0.5 text-xs text-muted-foreground">{r.description}</p>
                      <code className="mt-1 block truncate font-mono text-[10px] text-muted-foreground">
                        $ {r.cmd}
                      </code>
                    </div>
                    <Button
                      size="sm"
                      onClick={() => runRecipe(r)}
                      disabled={running === r.id}
                      className="h-8 shrink-0 rounded-lg"
                    >
                      {running === r.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Play className="h-3.5 w-3.5" />
                      )}
                    </Button>
                  </div>

                  {outputs[r.id] && (
                    <div className="mt-3 rounded-lg border border-border bg-background/60">
                      <button
                        type="button"
                        onClick={() =>
                          setExpanded((e) => ({ ...e, [r.id]: !e[r.id] }))
                        }
                        className="flex w-full items-center justify-between px-2 py-1.5 text-[10px] text-muted-foreground hover:text-foreground"
                      >
                        <span className="flex items-center gap-1.5">
                          <Terminal className="h-3 w-3" />
                          exit {outputs[r.id].code} · {outputs[r.id].durationMs}ms
                        </span>
                        {expanded[r.id] ? (
                          <ChevronUp className="h-3 w-3" />
                        ) : (
                          <ChevronDown className="h-3 w-3" />
                        )}
                      </button>
                      {expanded[r.id] && (
                        <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all border-t border-border px-2 py-2 font-mono text-[10px] text-foreground/80">
                          {outputs[r.id].stdout || outputs[r.id].stderr || "(empty)"}
                        </pre>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
        {recipes && recipes.length === 0 && !error && (
          <p className="text-center text-xs text-muted-foreground">
            No actions available. Bridge may be offline.
          </p>
        )}
      </div>
    </Card>
  );
}

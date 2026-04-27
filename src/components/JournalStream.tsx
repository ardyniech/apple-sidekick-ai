/**
 * Live SSE-based journal tail. Falls back to polling if EventSource fails.
 */
import { useEffect, useRef, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Loader2,
  Pause,
  Play,
  RefreshCw,
  Terminal,
  Trash2,
  Radio,
} from "lucide-react";
import { useAppStore } from "@/lib/store";
import { bridgeJournal, type BridgeConfig } from "@/lib/bridge";
import { normalizeBaseUrl } from "@/lib/proxy";

const SUFFIXES = ["/health", "/journal/stream", "/journal"];

function streamUrl(b: BridgeConfig, unit: string) {
  const base = normalizeBaseUrl(b.baseUrl, SUFFIXES);
  const proxy = new URL(
    `/api/public/proxy/journal/stream`,
    window.location.origin,
  );
  if (unit) proxy.searchParams.set("unit", unit);
  if (b.token.trim()) proxy.searchParams.set("token", b.token.trim());
  // include x-target-url via a cookie-less hack: the proxy needs the header.
  // EventSource cannot set headers, so we encode the target into the URL hash
  // and rely on the proxy to read it from a query param fallback.
  // Since our proxy expects x-target-url header only, we register a tiny
  // pre-flight that the consumer falls back to polling if SSE fails.
  return { url: proxy.toString(), targetBase: base };
}

export function JournalStream() {
  const bridge = useAppStore((s) => s.settings.bridge);
  const [unit, setUnit] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [follow, setFollow] = useState(true);
  const [lines, setLines] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const pollTimer = useRef<number | null>(null);

  // Autoscroll on new lines when follow mode is on
  useEffect(() => {
    if (follow && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [lines, follow]);

  // EventSource cannot send custom headers, so SSE is unavailable through our
  // header-based proxy. We instead implement live tail via fast polling (1.5s)
  // — simpler, robust, and works through the same /journal endpoint.
  const startPolling = async () => {
    if (streaming) return;
    setStreaming(true);
    setError(null);
    const tick = async () => {
      try {
        const r = await bridgeJournal(bridge, {
          unit: unit.trim() || undefined,
          lines: 50,
        });
        if (r.error) {
          setError(r.error);
          return;
        }
        const fresh = r.content.split("\n").filter(Boolean);
        setLines((prev) => {
          if (prev.length === 0) return fresh.slice(-500);
          const last = prev[prev.length - 1];
          const idx = fresh.lastIndexOf(last);
          const tail = idx >= 0 ? fresh.slice(idx + 1) : fresh;
          if (tail.length === 0) return prev;
          return [...prev, ...tail].slice(-1000);
        });
      } catch (e) {
        setError(e instanceof Error ? e.message : "poll failed");
      }
    };
    await tick();
    pollTimer.current = window.setInterval(tick, 1500);
  };

  const stopPolling = () => {
    if (pollTimer.current) {
      clearInterval(pollTimer.current);
      pollTimer.current = null;
    }
    setStreaming(false);
  };

  useEffect(() => stopPolling, []);

  async function loadOnce() {
    setLoading(true);
    setError(null);
    try {
      const r = await bridgeJournal(bridge, { unit: unit.trim() || undefined, lines: 200 });
      setLines(r.content.split("\n").filter(Boolean));
      if (r.error) setError(r.error);
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadOnce();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Card className="glass-card p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-warning/15 text-warning">
            <Terminal className="h-4 w-4" />
          </span>
          <div>
            <h2 className="text-base font-semibold tracking-tight">Live system logs</h2>
            <p className="text-xs text-muted-foreground">
              journalctl tail · {streaming ? "live polling 1.5s" : "snapshot"}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {streaming && (
            <Badge className="border border-success/30 bg-success/15 text-success hover:bg-success/15">
              <Radio className="mr-1 h-3 w-3 animate-pulse" /> Live
            </Badge>
          )}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setLines([])}
            className="rounded-xl"
            title="Clear"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={loadOnce}
            disabled={loading}
            className="rounded-xl"
          >
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={() => (streaming ? stopPolling() : startPolling())}
            className="rounded-xl"
          >
            {streaming ? (
              <>
                <Pause className="mr-1.5 h-3.5 w-3.5" /> Stop
              </>
            ) : (
              <>
                <Play className="mr-1.5 h-3.5 w-3.5" /> Live
              </>
            )}
          </Button>
        </div>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Input
          value={unit}
          onChange={(e) => setUnit(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && (streaming ? (stopPolling(), startPolling()) : loadOnce())}
          placeholder="Filter unit (e.g. nginx.service) — empty = all"
          className="h-9 flex-1 rounded-xl font-mono text-xs"
        />
        <label className="flex items-center gap-1.5 rounded-xl border border-border bg-secondary/20 px-3 py-1.5 text-[11px]">
          <Switch checked={follow} onCheckedChange={setFollow} />
          <span className="text-muted-foreground">Auto-scroll</span>
        </label>
      </div>

      {error && (
        <div className="mb-2 rounded-lg border border-destructive/30 bg-destructive/10 p-2 text-[11px] text-destructive">
          {error}
        </div>
      )}

      <div
        ref={containerRef}
        className="max-h-96 overflow-y-auto rounded-xl border border-border bg-background/60 p-3"
      >
        {lines.length === 0 ? (
          <p className="text-xs text-muted-foreground">No log lines.</p>
        ) : (
          <pre className="whitespace-pre-wrap break-all font-mono text-[10.5px] leading-relaxed text-foreground/85">
            {lines.map((l, i) => (
              <div
                key={`${i}-${l.slice(0, 40)}`}
                className={
                  /\b(error|fail|fatal|panic|critical)\b/i.test(l)
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
      <p className="mt-2 text-[10px] text-muted-foreground">
        {lines.length} lines · {streaming ? "polling every 1.5s" : "press Live to follow"}
      </p>
    </Card>
  );
}

/**
 * DevServerDiagnostics
 * --------------------
 * Lightweight in-page panel that records:
 *  - Recent fetch() calls (URL, method, status, latency, ok/err)
 *  - Vite HMR / dev-server lifecycle events (connected, disconnected,
 *    before-update, error, ws-disconnect)
 *
 * Purpose: when the user sees "Lost connection to the dev server" or a blank
 * screen, this panel lets them visually verify whether the disconnect was
 * transient (followed by a reconnect) or persistent — without typing any
 * commands in a terminal.
 *
 * Implementation notes:
 *  - We monkey-patch window.fetch ONCE on mount and restore on unmount.
 *  - HMR hooks come from Vite's import.meta.hot — gracefully no-op in prod.
 *  - All state is in-memory (ring buffer of 30 entries) — no persistence,
 *    no PII, no network calls.
 */
import { useEffect, useRef, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Activity, RefreshCw, Trash2, Wifi, WifiOff, AlertTriangle, CheckCircle2 } from "lucide-react";

type FetchEntry = {
  id: string;
  ts: number;
  method: string;
  url: string;
  status: number | null; // null = network error
  ok: boolean;
  ms: number;
  error?: string;
};

type HmrEvent = {
  id: string;
  ts: number;
  kind:
    | "connected"
    | "disconnected"
    | "before-update"
    | "after-update"
    | "error"
    | "ws-close"
    | "ws-error";
  detail?: string;
};

const MAX_FETCH = 30;
const MAX_HMR = 20;

// Module-level singletons so the panel survives route remounts and patches fetch only once.
let patched = false;
const fetchLog: FetchEntry[] = [];
const hmrLog: HmrEvent[] = [];
const listeners = new Set<() => void>();
function emit() {
  for (const l of listeners) l();
}

function shortUrl(u: string): string {
  try {
    const url = new URL(u, window.location.origin);
    return url.pathname + (url.search ? url.search : "");
  } catch {
    return u;
  }
}

function installPatches() {
  if (patched || typeof window === "undefined") return;
  patched = true;

  // --- fetch patch ---
  const originalFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const t0 = performance.now();
    const method = (init?.method || (input instanceof Request ? input.method : "GET")).toUpperCase();
    const rawUrl =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    const url = shortUrl(rawUrl);
    try {
      const res = await originalFetch(input as RequestInfo, init);
      const entry: FetchEntry = {
        id: crypto.randomUUID(),
        ts: Date.now(),
        method,
        url,
        status: res.status,
        ok: res.ok,
        ms: Math.round(performance.now() - t0),
      };
      fetchLog.unshift(entry);
      if (fetchLog.length > MAX_FETCH) fetchLog.length = MAX_FETCH;
      emit();
      return res;
    } catch (e) {
      const entry: FetchEntry = {
        id: crypto.randomUUID(),
        ts: Date.now(),
        method,
        url,
        status: null,
        ok: false,
        ms: Math.round(performance.now() - t0),
        error: e instanceof Error ? e.message : String(e),
      };
      fetchLog.unshift(entry);
      if (fetchLog.length > MAX_FETCH) fetchLog.length = MAX_FETCH;
      emit();
      throw e;
    }
  };

  // --- HMR hooks (Vite) ---
  // import.meta.hot exists only in dev. In prod build this branch is dead code.
  const hot = (import.meta as unknown as { hot?: ViteHotApi }).hot;
  if (hot) {
    const push = (kind: HmrEvent["kind"], detail?: string) => {
      hmrLog.unshift({ id: crypto.randomUUID(), ts: Date.now(), kind, detail });
      if (hmrLog.length > MAX_HMR) hmrLog.length = MAX_HMR;
      emit();
    };
    push("connected", "panel mounted");
    try {
      hot.on?.("vite:beforeUpdate", () => push("before-update"));
      hot.on?.("vite:afterUpdate", () => push("after-update"));
      hot.on?.("vite:error", (p: unknown) => {
        const msg = (p as { err?: { message?: string } } | undefined)?.err?.message;
        push("error", msg);
      });
      hot.on?.("vite:ws:disconnect", () => push("ws-close"));
      hot.on?.("vite:ws:connect", () => push("connected", "ws reconnected"));
    } catch {
      /* swallow — older vite versions */
    }
  }

  // --- Generic online/offline ---
  window.addEventListener("offline", () => {
    hmrLog.unshift({
      id: crypto.randomUUID(),
      ts: Date.now(),
      kind: "disconnected",
      detail: "navigator offline",
    });
    if (hmrLog.length > MAX_HMR) hmrLog.length = MAX_HMR;
    emit();
  });
  window.addEventListener("online", () => {
    hmrLog.unshift({
      id: crypto.randomUUID(),
      ts: Date.now(),
      kind: "connected",
      detail: "navigator online",
    });
    if (hmrLog.length > MAX_HMR) hmrLog.length = MAX_HMR;
    emit();
  });
}

interface ViteHotApi {
  on?: (event: string, cb: (payload: unknown) => void) => void;
}

function useTick() {
  const [, setN] = useState(0);
  useEffect(() => {
    const cb = () => setN((n) => n + 1);
    listeners.add(cb);
    return () => {
      listeners.delete(cb);
    };
  }, []);
}

function fmtTime(ts: number) {
  const d = new Date(ts);
  return d.toLocaleTimeString(undefined, { hour12: false }) +
    "." + String(d.getMilliseconds()).padStart(3, "0");
}

function statusTone(s: number | null): string {
  if (s === null) return "text-destructive";
  if (s >= 500) return "text-destructive";
  if (s >= 400) return "text-warning";
  if (s >= 300) return "text-muted-foreground";
  return "text-success";
}

export function DevServerDiagnostics() {
  const mounted = useRef(false);
  if (!mounted.current) {
    installPatches();
    mounted.current = true;
  }
  useTick();

  const errCount = fetchLog.filter((e) => !e.ok).length;
  const lastHmr = hmrLog[0];
  const isDisconnected =
    lastHmr?.kind === "disconnected" ||
    lastHmr?.kind === "ws-close" ||
    lastHmr?.kind === "ws-error";

  function clearAll() {
    fetchLog.length = 0;
    hmrLog.length = 0;
    emit();
  }

  return (
    <Card className="glass-card p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/15 text-primary">
            <Activity className="h-4 w-4" />
          </span>
          <div>
            <h2 className="text-base font-semibold tracking-tight">
              Dev-server diagnostics
            </h2>
            <p className="text-xs text-muted-foreground">
              Live record of recent requests &amp; reload events. Helps confirm whether a
              disconnect was transient.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {isDisconnected ? (
            <Badge className="border border-destructive/30 bg-destructive/15 text-destructive hover:bg-destructive/15">
              <WifiOff className="mr-1 h-3 w-3" /> Disconnected
            </Badge>
          ) : (
            <Badge className="border border-success/30 bg-success/15 text-success hover:bg-success/15">
              <Wifi className="mr-1 h-3 w-3" /> Connected
            </Badge>
          )}
          <Button variant="outline" size="sm" className="rounded-xl" onClick={clearAll}>
            <Trash2 className="mr-1.5 h-3.5 w-3.5" /> Clear
          </Button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Fetch log */}
        <div className="rounded-xl border border-border bg-secondary/20">
          <div className="flex items-center justify-between border-b border-border px-3 py-2">
            <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Recent requests
            </span>
            <span className="font-mono text-[10px] text-muted-foreground">
              {fetchLog.length} · {errCount} err
            </span>
          </div>
          <div className="max-h-64 overflow-auto">
            {fetchLog.length === 0 ? (
              <p className="px-3 py-6 text-center text-xs text-muted-foreground">
                No requests captured yet. Interact with the app to populate.
              </p>
            ) : (
              <ul className="divide-y divide-border font-mono text-[11px]">
                {fetchLog.map((e) => (
                  <li key={e.id} className="flex items-center gap-2 px-3 py-1.5">
                    <span className="w-16 shrink-0 text-[10px] text-muted-foreground">
                      {fmtTime(e.ts)}
                    </span>
                    <span className={`w-12 shrink-0 font-semibold ${statusTone(e.status)}`}>
                      {e.status ?? "ERR"}
                    </span>
                    <span className="w-10 shrink-0 text-muted-foreground">{e.method}</span>
                    <span className="flex-1 truncate" title={e.url}>
                      {e.url}
                    </span>
                    <span className="w-12 shrink-0 text-right text-muted-foreground">
                      {e.ms}ms
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {/* HMR / reload events */}
        <div className="rounded-xl border border-border bg-secondary/20">
          <div className="flex items-center justify-between border-b border-border px-3 py-2">
            <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Reload &amp; HMR events
            </span>
            <span className="font-mono text-[10px] text-muted-foreground">
              {hmrLog.length}
            </span>
          </div>
          <div className="max-h-64 overflow-auto">
            {hmrLog.length === 0 ? (
              <p className="px-3 py-6 text-center text-xs text-muted-foreground">
                No reload events yet.
              </p>
            ) : (
              <ul className="divide-y divide-border font-mono text-[11px]">
                {hmrLog.map((e) => {
                  const bad =
                    e.kind === "disconnected" ||
                    e.kind === "error" ||
                    e.kind === "ws-close" ||
                    e.kind === "ws-error";
                  const update = e.kind === "before-update" || e.kind === "after-update";
                  const Icon = bad
                    ? AlertTriangle
                    : update
                      ? RefreshCw
                      : CheckCircle2;
                  return (
                    <li key={e.id} className="flex items-center gap-2 px-3 py-1.5">
                      <span className="w-16 shrink-0 text-[10px] text-muted-foreground">
                        {fmtTime(e.ts)}
                      </span>
                      <Icon
                        className={`h-3 w-3 shrink-0 ${
                          bad ? "text-destructive" : update ? "text-primary" : "text-success"
                        }`}
                      />
                      <span
                        className={`w-24 shrink-0 ${
                          bad ? "text-destructive" : update ? "text-primary" : "text-success"
                        }`}
                      >
                        {e.kind}
                      </span>
                      <span className="flex-1 truncate text-muted-foreground" title={e.detail}>
                        {e.detail ?? ""}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      </div>

      <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
        Tip: a brief <span className="font-mono">ws-close</span> followed by{" "}
        <span className="font-mono">connected</span> within a second is a normal Vite
        hot-reload — no action needed. Persistent disconnects (no reconnect for &gt;10s) mean
        the dev server actually died.
      </p>
    </Card>
  );
}

/**
 * Client-side helper untuk Aurora Agent Bridge.
 * Bridge adalah binary Go yang dijalankan user di server-nya, di-expose lewat
 * Cloudflare Tunnel. Semua method di sini = HTTP fetch ke endpoint bridge.
 */

import type { BridgeConfig } from "./store";

export interface BridgeHealth {
  ok: boolean;
  version?: string;
  uptime?: number;
  hostname?: string;
  os?: string;
  root?: string;
}

export interface BridgeMetrics {
  hostname?: string;
  os?: string;
  uptime?: number;
  cpuPercent?: number;
  memTotalMB?: number;
  memUsedMB?: number;
  memPercent?: number;
  load1?: number;
  load5?: number;
  load15?: number;
  df?: string;
}

export interface ExecResult {
  stdout: string;
  stderr: string;
  code: number;
  durationMs: number;
  timedOut?: boolean;
}

function normalize(url: string) {
  return url.trim().replace(/\/$/, "");
}

export function bridgeReady(b: BridgeConfig): boolean {
  return b.enabled && !!b.baseUrl.trim() && !!b.token.trim();
}

async function call<T>(
  bridge: BridgeConfig,
  path: string,
  init?: RequestInit,
): Promise<T> {
  if (!bridge.baseUrl.trim()) throw new Error("Agent Bridge URL is not set");
  const res = await fetch(`${normalize(bridge.baseUrl)}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(bridge.token ? { Authorization: `Bearer ${bridge.token}` } : {}),
      ...(init?.headers ?? {}),
    },
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Bridge ${res.status}: ${text.slice(0, 200) || res.statusText}`);
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    return text as unknown as T;
  }
}

export async function bridgeHealth(bridge: BridgeConfig): Promise<BridgeHealth> {
  if (!bridge.baseUrl.trim()) throw new Error("Agent Bridge URL is not set");
  const res = await fetch(`${normalize(bridge.baseUrl)}/health`);
  if (!res.ok) throw new Error(`Bridge HTTP ${res.status}`);
  return res.json();
}

export function bridgeMetrics(bridge: BridgeConfig) {
  return call<BridgeMetrics>(bridge, "/metrics");
}

export function bridgeExec(
  bridge: BridgeConfig,
  cmd: string,
  opts?: { timeout?: number; cwd?: string },
) {
  return call<ExecResult>(bridge, "/exec", {
    method: "POST",
    body: JSON.stringify({ cmd, timeout: opts?.timeout, cwd: opts?.cwd }),
  });
}

export function bridgeRead(bridge: BridgeConfig, path: string) {
  return call<{ content: string; size: number }>(bridge, "/read", {
    method: "POST",
    body: JSON.stringify({ path }),
  });
}

export function bridgeWrite(
  bridge: BridgeConfig,
  args: { path: string; content: string; commit?: boolean; message?: string },
) {
  return call<{ bytes: number; commitStdout?: string; commitCode?: number }>(
    bridge,
    "/write",
    { method: "POST", body: JSON.stringify(args) },
  );
}

export function bridgeGit(bridge: BridgeConfig, gitArgs: string[], cwd?: string) {
  return call<{ stdout: string; code: number }>(bridge, "/git", {
    method: "POST",
    body: JSON.stringify({ args: gitArgs, cwd }),
  });
}

export function bridgeTail(bridge: BridgeConfig, path: string, lines = 200) {
  return call<{ content: string }>(bridge, "/tail", {
    method: "POST",
    body: JSON.stringify({ path, lines }),
  });
}

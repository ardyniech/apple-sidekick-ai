/**
 * Client-side helper for the Aurora Agent Bridge.
 *
 * All HTTP calls go through the same-origin /api/proxy/$ route so the browser
 * doesn't run into CORS / mixed-content. The proxy forwards to bridge.baseUrl
 * (which the user supplies — Tailscale MagicDNS, public hostname, …).
 *
 * Note: when the bridge is on a Tailscale-private 100.x address, the Lovable
 * edge runtime cannot reach it. In that case the user must either:
 *   - expose the bridge via a public DNS / tunnel + token, or
 *   - run the web app from a device on the same Tailnet.
 */

import type { BridgeConfig } from "./store";
import { proxyFetch, normalizeBaseUrl } from "./proxy";

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

export interface ServiceInfo {
  name: string;
  active: string;
  sub: string;
  description: string;
}

export interface ProcessInfo {
  pid: number;
  user: string;
  cpu: number;
  mem: number;
  comm: string;
  args: string;
}

export interface ExecResult {
  stdout: string;
  stderr: string;
  code: number;
  durationMs: number;
  timedOut?: boolean;
}

const BRIDGE_SUFFIXES = [
  "/health",
  "/metrics",
  "/services",
  "/service",
  "/processes",
  "/journal",
  "/exec",
  "/read",
  "/write",
  "/git",
  "/tail",
];

function bridgeBase(b: BridgeConfig): string {
  return normalizeBaseUrl(b.baseUrl, BRIDGE_SUFFIXES);
}

export function bridgeReady(b: BridgeConfig): boolean {
  return b.enabled && !!b.baseUrl.trim();
}

async function call<T>(
  bridge: BridgeConfig,
  path: string,
  init?: RequestInit,
): Promise<T> {
  if (!bridge.baseUrl.trim()) throw new Error("Agent Bridge URL is not set");
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (bridge.token.trim()) headers.Authorization = `Bearer ${bridge.token.trim()}`;
  Object.assign(headers, (init?.headers as Record<string, string>) ?? {});

  const res = await proxyFetch(bridgeBase(bridge), path, { ...init, headers });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Bridge ${res.status}: ${text.slice(0, 240) || res.statusText}`);
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    return text as unknown as T;
  }
}

export async function bridgeHealth(bridge: BridgeConfig): Promise<BridgeHealth> {
  if (!bridge.baseUrl.trim()) throw new Error("Agent Bridge URL is not set");
  const res = await proxyFetch(bridgeBase(bridge), "/health");
  if (!res.ok) throw new Error(`Bridge HTTP ${res.status}`);
  return res.json();
}

export function bridgeMetrics(bridge: BridgeConfig) {
  return call<BridgeMetrics>(bridge, "/metrics");
}

export function bridgeServices(bridge: BridgeConfig) {
  return call<{ services: ServiceInfo[]; error?: string }>(bridge, "/services");
}

export function bridgeServiceAction(
  bridge: BridgeConfig,
  name: string,
  action: "start" | "stop" | "restart" | "status" | "enable" | "disable" | "reload",
) {
  return call<{ ok: boolean; stdout: string; code: number }>(bridge, "/service", {
    method: "POST",
    body: JSON.stringify({ name, action }),
  });
}

export function bridgeProcesses(bridge: BridgeConfig, n = 15) {
  return call<{ processes: ProcessInfo[]; error?: string }>(
    bridge,
    `/processes?n=${n}`,
  );
}

export function bridgeJournal(bridge: BridgeConfig, args: { unit?: string; lines?: number }) {
  return call<{ content: string; error?: string }>(bridge, "/journal", {
    method: "POST",
    body: JSON.stringify(args),
  });
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

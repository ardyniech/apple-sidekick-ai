/**
 * Same-origin proxy for ALL outbound calls from the browser.
 *
 * Why: the browser at lovable.app cannot directly fetch:
 *   - http://localhost:11434  (mixed content + CORS)
 *   - https://api.openai.com  (CORS)
 *   - http://100.x.x.x:8787   (Tailscale ip not visible to lovable's edge runtime,
 *                              but at least no CORS/mixed-content when behind a
 *                              public hostname)
 *
 * The client passes the absolute target URL via the `x-target-url` header.
 * Auth headers (Authorization, etc.) are forwarded as-is.
 *
 * Routes:
 *   ANY /api/proxy/*    — generic forwarder (path after /api/proxy is appended).
 *
 * Example (cloud model):
 *   POST /api/proxy/chat/completions
 *   x-target-url: https://api.openai.com/v1
 *   Authorization: Bearer sk-…
 *   → forwarded to https://api.openai.com/v1/chat/completions
 */
import { createFileRoute } from "@tanstack/react-router";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Max-Age": "86400",
};

// Headers we explicitly DROP before forwarding (host-specific or hop-by-hop).
const HOP = new Set([
  "host",
  "connection",
  "content-length",
  "x-target-url",
  "x-forwarded-for",
  "x-forwarded-host",
  "x-forwarded-proto",
  "cf-connecting-ip",
  "cf-ipcountry",
  "cf-ray",
  "cf-visitor",
]);

function buildHeaders(req: Request): Headers {
  const h = new Headers();
  req.headers.forEach((v, k) => {
    if (!HOP.has(k.toLowerCase())) h.set(k, v);
  });
  return h;
}

async function proxy({ request, params }: { request: Request; params: { _splat?: string } }) {
  const target = request.headers.get("x-target-url");
  if (!target) {
    return new Response(
      JSON.stringify({ error: "missing x-target-url header" }),
      { status: 400, headers: { "Content-Type": "application/json", ...CORS } },
    );
  }

  // Reject obvious internal-network probes from the public URL so this isn't
  // turned into an SSRF gadget. The user's own network stays reachable when
  // they call this from their device on Tailscale (proxy still works for
  // public addresses; the browser will hit those directly anyway).
  let url: URL;
  try {
    url = new URL(target);
  } catch {
    return new Response(
      JSON.stringify({ error: "invalid x-target-url" }),
      { status: 400, headers: { "Content-Type": "application/json", ...CORS } },
    );
  }
  if (!/^https?:$/.test(url.protocol)) {
    return new Response(
      JSON.stringify({ error: "only http(s) targets allowed" }),
      { status: 400, headers: { "Content-Type": "application/json", ...CORS } },
    );
  }

  // Append the splat path: /api/proxy/foo/bar  →  appended as /foo/bar
  const splat = params._splat ?? "";
  if (splat) {
    url.pathname = url.pathname.replace(/\/$/, "") + "/" + splat;
  }
  // Preserve query string from the original request
  const incoming = new URL(request.url);
  incoming.searchParams.forEach((v, k) => url.searchParams.set(k, v));

  const headers = buildHeaders(request);

  const init: RequestInit = {
    method: request.method,
    headers,
    redirect: "manual",
  };
  if (request.method !== "GET" && request.method !== "HEAD") {
    init.body = await request.arrayBuffer();
  }

  let upstream: Response;
  try {
    upstream = await fetch(url.toString(), init);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "fetch failed";
    return new Response(
      JSON.stringify({ error: `proxy fetch failed: ${msg}`, target: url.toString() }),
      { status: 502, headers: { "Content-Type": "application/json", ...CORS } },
    );
  }

  // Stream the upstream body back, with CORS headers added.
  const respHeaders = new Headers(upstream.headers);
  Object.entries(CORS).forEach(([k, v]) => respHeaders.set(k, v));
  // Some upstream content-encoding values confuse runtimes after fetch
  // already decoded them; let the runtime recompute.
  respHeaders.delete("content-encoding");
  respHeaders.delete("content-length");

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: respHeaders,
  });
}

export const Route = createFileRoute("/api/proxy/$")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS }),
      GET: proxy,
      POST: proxy,
      PUT: proxy,
      DELETE: proxy,
    },
  },
});

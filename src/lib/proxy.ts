/**
 * Same-origin proxy helper. The browser cannot fetch arbitrary external URLs
 * (CORS / mixed-content), so all outbound calls go through /api/proxy/$.
 *
 * Usage:
 *   proxyFetch("https://api.openai.com/v1", "/chat/completions", { ... })
 *   →  POST /api/proxy/chat/completions   x-target-url: https://api.openai.com/v1
 */
export async function proxyFetch(
  baseUrl: string,
  pathSuffix: string,
  init: RequestInit & { searchParams?: Record<string, string> } = {},
): Promise<Response> {
  const cleanBase = baseUrl.trim().replace(/\/+$/, "");
  const cleanPath = pathSuffix.replace(/^\/+/, "");
  const proxyUrl = new URL(`/api/proxy/${cleanPath}`, window.location.origin);
  if (init.searchParams) {
    Object.entries(init.searchParams).forEach(([k, v]) => proxyUrl.searchParams.set(k, v));
  }
  const headers = new Headers(init.headers);
  headers.set("x-target-url", cleanBase);
  return fetch(proxyUrl.toString(), { ...init, headers });
}

/**
 * Strip a trailing well-known suffix from a user-pasted base URL so we don't
 * accidentally double the path (e.g. user pastes `…/api/tags`, we then append
 * `/api/tags`, get `…/api/tags/api/tags`).
 */
export function normalizeBaseUrl(url: string, knownSuffixes: string[]): string {
  let u = url.trim().replace(/\/+$/, "");
  for (const s of knownSuffixes) {
    if (u.toLowerCase().endsWith(s.toLowerCase())) {
      u = u.slice(0, -s.length).replace(/\/+$/, "");
      break;
    }
  }
  return u;
}

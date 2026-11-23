// Baseline security headers for every response the Worker sends. Headers a route already set are kept, never duplicated.
// Default policy for a response that sets none: https-only sources, inline code allowed, no plugins, no foreign framing.
const DEFAULT_CSP = "default-src 'self'; script-src 'self' 'unsafe-inline' https:; style-src 'self' 'unsafe-inline' https:; img-src 'self' data: blob: https:; font-src 'self' data: https:; connect-src 'self' https: wss:; media-src 'self' https:; frame-src 'self' https:; worker-src 'self' blob:; object-src 'none'; frame-ancestors 'self' https://analytics.flisk.si; base-uri 'self'; form-action 'self' https:";

// Who may frame a page: itself, and the click heatmap on analytics.flisk.si, which previews the tracked page in an iframe.
const FRAME_ANCESTORS = "frame-ancestors 'self' https://analytics.flisk.si";

const BASELINE: Record<string, string> = {
  "x-content-type-options": "nosniff",
  "strict-transport-security": "max-age=31536000; includeSubDomains",
  "referrer-policy": "strict-origin-when-cross-origin",
  "permissions-policy": "camera=(), microphone=(), geolocation=()",
};

/** Copy of `response` with the baseline headers added where missing and `frame-ancestors` in the CSP. */
export function withSecurityHeaders(response: Response): Response {
  // A new Response, because the headers of fetched or asset responses can be immutable.
  const out = new Response(response.body, response);
  const csp = out.headers.get("content-security-policy");
  // Framing is decided by the CSP's frame-ancestors; a baseline x-frame-options SAMEORIGIN would veto the analytics preview, so only a route's own is kept.
  for (const [name, value] of Object.entries(BASELINE)) if (!out.headers.has(name)) out.headers.set(name, value);
  if (!csp) out.headers.set("content-security-policy", DEFAULT_CSP);
  else if (!/(^|;)\s*frame-ancestors\b/i.test(csp)) out.headers.set("content-security-policy", `${csp}; ${FRAME_ANCESTORS}`);
  return out;
}

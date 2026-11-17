// Sends a problem to traces.flisk.si (flisk-sh/traces): only when a model call failed, hit the daily cap or was slow.
// Never throws, never waits more than 2 s, does nothing until TRACE_KEY is set, and never sends a prompt, answer or key.
export const SLOW_MS = 20_000;

export interface TraceEnv { TRACE_KEY?: string; TRACES?: { fetch(url: string, init: RequestInit): Promise<Response> } }
export interface TraceEvent { route: string; kind: "error" | "slow" | "capped"; why: string; status?: number; ms?: number; model?: string }

export async function sendTrace(env: TraceEnv, event: TraceEvent, fetchImpl: typeof fetch = fetch): Promise<void> {
  if (!env.TRACE_KEY) return;
  try {
    const init: RequestInit = { method: "POST", headers: { authorization: `Bearer ${env.TRACE_KEY}`, "content-type": "application/json" }, body: JSON.stringify(event), signal: AbortSignal.timeout(2000) };
    if (env.TRACES) await env.TRACES.fetch("https://traces.flisk.si/v1/trace", init);
    else await fetchImpl("https://traces.flisk.si/v1/trace", init);
  } catch { /* tracing must never break a request */ }
}

// What a finished model call says about itself, from its status and time alone. A normal call returns [].
export function callEvents(path: string, method: string, status: number, ms: number): TraceEvent[] {
  if (method !== "POST" || path !== "/v1/chat/completions") return [];
  const route = path;
  if (status === 429) return [{ route, kind: "capped", why: "a model call was refused: a daily limit or the neuron budget", status, ms }];
  if (status >= 500) return [{ route, kind: "error", why: `a model call failed with ${status}`, status, ms }];
  if (ms > SLOW_MS) return [{ route, kind: "slow", why: `a model call took ${Math.round(ms / 1000)} s`, status, ms }];
  return [];
}

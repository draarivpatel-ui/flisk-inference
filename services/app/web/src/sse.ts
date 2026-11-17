// Streaming for the /v1 API: Workers AI's server-sent events become OpenAI chat.completion.chunk events, and a
// whole (non-streamed) answer can be sent as the same events when an upstream cannot stream.
export interface StreamUsage { prompt_tokens?: number; completion_tokens?: number }
const enc = new TextEncoder();
const event = (o: unknown) => enc.encode(`data: ${JSON.stringify(o)}\n\n`);
export const SSE_HEADERS = { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache" };

const chunk = (id: string, model: string, delta: Record<string, unknown>, finish: string | null) => ({
  id, object: "chat.completion.chunk", created: Math.floor(Date.now() / 1000), model, choices: [{ index: 0, delta, finish_reason: finish }],
});

/** Turns a Workers AI event stream into OpenAI chunks; the last one carries the usage. */
export function openAiChunks(src: ReadableStream<Uint8Array>, model: string): ReadableStream<Uint8Array> {
  const id = `chatcmpl-${crypto.randomUUID()}`;
  const dec = new TextDecoder();
  let buf = "", usage: StreamUsage = {}, first = true;
  const line = (l: string, ctl: TransformStreamDefaultController<Uint8Array>) => {
    if (!l.startsWith("data:")) return;
    const data = l.slice(5).trim();
    if (!data || data === "[DONE]") return;
    let j: { response?: unknown; usage?: StreamUsage; choices?: Array<{ delta?: { content?: string } }> };
    try { j = JSON.parse(data); } catch { return; }
    if (j.usage) usage = j.usage;
    const text = j.response ?? j.choices?.[0]?.delta?.content;
    if (typeof text !== "string" || !text) return;
    if (first) { ctl.enqueue(event(chunk(id, model, { role: "assistant", content: "" }, null))); first = false; }
    ctl.enqueue(event(chunk(id, model, { content: text }, null)));
  };
  return src.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    transform(part, ctl) {
      buf += dec.decode(part, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const l of lines) line(l.trim(), ctl);
    },
    flush(ctl) {
      if (buf.trim()) line(buf.trim(), ctl);
      if (first) ctl.enqueue(event(chunk(id, model, { role: "assistant", content: "" }, null)));
      ctl.enqueue(event(chunk(id, model, {}, "stop")));
      const u = { prompt_tokens: usage.prompt_tokens ?? 0, completion_tokens: usage.completion_tokens ?? 0 };
      ctl.enqueue(event({ ...chunk(id, model, {}, null), choices: [], usage: { ...u, total_tokens: u.prompt_tokens + u.completion_tokens } }));
      ctl.enqueue(enc.encode("data: [DONE]\n\n"));
    },
  }));
}

/** A finished chat.completion JSON answer, re-sent as one content event, for upstreams that cannot stream. */
export function wholeAsChunks(completion: { id?: string; model?: string; choices?: Array<{ message?: { content?: string } }>; usage?: StreamUsage }): ReadableStream<Uint8Array> {
  const id = completion.id ?? `chatcmpl-${crypto.randomUUID()}`, model = completion.model ?? "";
  const u = { prompt_tokens: completion.usage?.prompt_tokens ?? 0, completion_tokens: completion.usage?.completion_tokens ?? 0 };
  const parts = [
    event(chunk(id, model, { role: "assistant", content: "" }, null)),
    event(chunk(id, model, { content: completion.choices?.[0]?.message?.content ?? "" }, null)),
    event(chunk(id, model, {}, "stop")),
    event({ ...chunk(id, model, {}, null), choices: [], usage: { ...u, total_tokens: u.prompt_tokens + u.completion_tokens } }),
    enc.encode("data: [DONE]\n\n"),
  ];
  return new ReadableStream({ start(c) { for (const p of parts) c.enqueue(p); c.close(); } });
}

/** Passes events through untouched and reports the usage the last event carried (the shape openAiChunks writes). */
export function meterStream(src: ReadableStream<Uint8Array>, done: (u: StreamUsage) => void | Promise<void>): ReadableStream<Uint8Array> {
  const dec = new TextDecoder();
  let buf = "", usage: StreamUsage = {};
  const scan = (l: string) => {
    if (!l.startsWith("data:") || !l.includes('"usage"')) return;
    try { const u = (JSON.parse(l.slice(5)) as { usage?: StreamUsage }).usage; if (u) usage = u; } catch { /* not a usage event */ }
  };
  return src.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    transform(part, ctl) {
      ctl.enqueue(part);
      buf += dec.decode(part, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const l of lines) scan(l.trim());
    },
    async flush() { if (buf.trim()) scan(buf.trim()); await done(usage); },
  }));
}

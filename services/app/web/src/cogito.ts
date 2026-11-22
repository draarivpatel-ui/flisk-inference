// cogito (github.com/flisk-sh/cogito) for POST /v1/chat/completions, opt-in by `Accept: application/vnd.flisk.cogito+ndjson`.
// The request body is the same OpenAI-shaped JSON as before (stream is forced on); the answer is one cogito frame per line:
//   {"h":{...}} first, {"s":"thinking"|"writing"} when the stage changes, {"t":"word"} text, {"r":"..."} reasoning (level 2 only),
//   {"u":[in,out]} usage, {"d":1} last. Errors before the stream starts stay plain JSON with a status code.
export const COGITO_TYPE = "application/vnd.flisk.cogito+ndjson";
export const COGITO_HEADERS = { "content-type": COGITO_TYPE, "cache-control": "no-store", "x-accel-buffering": "no", vary: "Accept, Cogito-Level" };
export const wantsCogito = (req: Request): boolean => (req.headers.get("accept") ?? "").includes(COGITO_TYPE);
export const cogitoLevel = (req: Request): number => {
  const n = Number.parseInt(req.headers.get("cogito-level") ?? "1", 10);
  return Number.isNaN(n) ? 1 : Math.min(Math.max(n, 0), 2);
};

const enc = new TextEncoder();
const lineOf = (f: unknown) => enc.encode(JSON.stringify(f) + "\n");

/** Turns the OpenAI chat.completion.chunk events (the shape sse.ts writes) into cogito frames. */
export function cogitoFrames(src: ReadableStream<Uint8Array>, level = 1, id = "r_" + crypto.randomUUID().slice(0, 8)): ReadableStream<Uint8Array> {
  const dec = new TextDecoder();
  let buf = "", stage = "", usage: [number, number] | null = null;
  const to = (s: string, ctl: TransformStreamDefaultController<Uint8Array>) => { if (stage !== s) { stage = s; ctl.enqueue(lineOf({ s })); } };
  const read = (l: string, ctl: TransformStreamDefaultController<Uint8Array>) => {
    if (!l.startsWith("data:")) return;
    const data = l.slice(5).trim();
    if (!data || data === "[DONE]") return;
    let j: { usage?: { prompt_tokens?: number; completion_tokens?: number }; choices?: Array<{ delta?: { content?: string; reasoning?: string; reasoning_content?: string } }> };
    try { j = JSON.parse(data); } catch { return; }
    if (j.usage) usage = [j.usage.prompt_tokens ?? 0, j.usage.completion_tokens ?? 0];
    const d = j.choices?.[0]?.delta;
    const why = d?.reasoning ?? d?.reasoning_content;
    if (why) { to("thinking", ctl); if (level >= 2) ctl.enqueue(lineOf({ r: why })); }
    if (d?.content) { to("writing", ctl); ctl.enqueue(lineOf({ t: d.content })); }
  };
  return src.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    start(ctl) {
      // Retention is a declaration by this server: it keeps usage counters per key and never the prompt or the answer.
      ctl.enqueue(lineOf({ h: { v: 1, id, lvl: level, ret: "none", fmt: "ndjson" } }));
      ctl.enqueue(lineOf({ s: "thinking" })); stage = "thinking";
    },
    transform(part, ctl) {
      buf += dec.decode(part, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const l of lines) read(l.trim(), ctl);
    },
    flush(ctl) {
      if (buf.trim()) read(buf.trim(), ctl);
      if (usage) ctl.enqueue(lineOf({ u: usage }));
      ctl.enqueue(lineOf({ d: 1 }));
    },
  }));
}

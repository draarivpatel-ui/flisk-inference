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

/** Turns the OpenAI chat.completion.chunk events (the shape sse.ts writes) into cogito frames.
 *  `src` may be a promise: the hello and the first `thinking` go out at once, the frames follow when the stream arrives, and a
 *  rejection becomes an `e` frame. That is what makes "thinking" visible while a slow model is still working. */
export function cogitoFrames(src: ReadableStream<Uint8Array> | Promise<ReadableStream<Uint8Array>>, level = 1, id = "r_" + crypto.randomUUID().slice(0, 8)): ReadableStream<Uint8Array> {
  const dec = new TextDecoder();
  let buf = "", stage = "thinking", usage: [number, number] | null = null;
  return new ReadableStream<Uint8Array>({
    async start(ctl) {
      const out = (f: unknown) => ctl.enqueue(lineOf(f));
      const to = (s: string) => { if (stage !== s) { stage = s; out({ s }); } };
      const read = (l: string) => {
        if (!l.startsWith("data:")) return;
        const data = l.slice(5).trim();
        if (!data || data === "[DONE]") return;
        let j: { usage?: { prompt_tokens?: number; completion_tokens?: number }; choices?: Array<{ delta?: { content?: string; reasoning?: string; reasoning_content?: string } }> };
        try { j = JSON.parse(data); } catch { return; }
        if (j.usage) usage = [j.usage.prompt_tokens ?? 0, j.usage.completion_tokens ?? 0];
        const d = j.choices?.[0]?.delta;
        const why = d?.reasoning ?? d?.reasoning_content;
        if (why) { to("thinking"); if (level >= 2) out({ r: why }); }
        if (d?.content) { to("writing"); out({ t: d.content }); }
      };
      // Retention is a declaration by this server: it keeps usage counters per key and never the prompt or the answer.
      out({ h: { v: 1, id, lvl: level, ret: "none", fmt: "ndjson" } });
      out({ s: "thinking" });
      try {
        const reader = (await src).getReader();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          const lines = buf.split("\n");
          buf = lines.pop() ?? "";
          for (const l of lines) read(l.trim());
        }
        if (buf.trim()) read(buf.trim());
        if (usage) out({ u: usage });
        out({ d: 1 });
      } catch (err) {
        const e = err as { code?: string; message?: string };
        out({ e: { c: e.code ?? "internal", m: String(e.message ?? err).slice(0, 300) } });
      }
      ctl.close();
    },
  });
}

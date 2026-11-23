import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cogitoFrames, COGITO_TYPE } from "../src/cogito";
import { fileStore } from "../src/file-store";
import { createPortal } from "../src/portal";

const BASE = "http://portal.test";
const ME = { id: 4242, login: "octocat", name: "Octo Cat", avatar_url: "https://example.com/a.png" };
let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "cogito-")); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const chunk = (delta: Record<string, unknown>, extra: Record<string, unknown> = {}) => `data: ${JSON.stringify({ choices: [{ index: 0, delta }], ...extra })}\n\n`;
const SSE = [chunk({ role: "assistant", content: "" }), chunk({ reasoning_content: "hm " }), chunk({ content: "Hel" }), chunk({ content: "lo" }),
  `data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 7, completion_tokens: 2 } })}\n\n`, "data: [DONE]\n\n"].join("");
const streamOf = (s: string) => new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new TextEncoder().encode(s)); c.close(); } });
const lines = async (res: Response | ReadableStream<Uint8Array>) => (await new Response(res instanceof Response ? res.body : res).text()).trim().split("\n").map((l) => JSON.parse(l));

describe("cogitoFrames", () => {
  it("maps text, usage and the end; hides reasoning below level 2", async () => {
    const f = await lines(cogitoFrames(streamOf(SSE), 1, "r_x"));
    expect(f[0]).toEqual({ h: { v: 1, id: "r_x", lvl: 1, ret: "none", fmt: "ndjson" } });
    expect(f.filter((x) => "t" in x).map((x) => x.t).join("")).toBe("Hello");
    expect(f.filter((x) => "s" in x).map((x) => x.s)).toEqual(["thinking", "writing"]);
    expect(f.some((x) => "r" in x)).toBe(false);
    expect(f.at(-2)).toEqual({ u: [7, 2] });
    expect(f.at(-1)).toEqual({ d: 1 });
  });
  it("sends reasoning at level 2", async () => {
    const f = await lines(cogitoFrames(streamOf(SSE), 2));
    expect(f.filter((x) => "r" in x).map((x) => x.r).join("")).toBe("hm ");
  });
  it("ignores half-written and unknown lines and still ends with d", async () => {
    const f = await lines(cogitoFrames(streamOf("data: {oops\n\nevent: ping\n\n" + chunk({ content: "ok" })), 1));
    expect(f.filter((x) => "t" in x).map((x) => x.t).join("")).toBe("ok");
    expect(f.at(-1)).toEqual({ d: 1 });
  });
});

describe("POST /v1/chat/completions with Accept: cogito", () => {
  let seen: Array<{ stream?: boolean }>;
  function make(upstream: () => Response | Promise<Response>) {
    seen = [];
    return createPortal({ publicUrl: BASE, upstreamUrl: "http://upstream.test", store: fileStore(dir), indexHtml: () => readFileSync(join(import.meta.dir, "..", "public", "index.html"), "utf-8"),
      devLogin: async () => ME, fetchImpl: (async (_u: RequestInfo | URL, init?: RequestInit) => { seen.push(JSON.parse(String(init?.body ?? "{}"))); return upstream(); }) as typeof fetch });
  }
  async function key(portal: ReturnType<typeof make>) {
    const cookie = ((await portal.fetch(new Request(BASE + "/auth/dev"))).headers.get("set-cookie") ?? "").split(";")[0];
    const r = await portal.fetch(new Request(BASE + "/api/keys", { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ name: "t" }) }));
    return ((await r.json()) as { key: string }).key;
  }
  const call = (portal: ReturnType<typeof make>, k: string, headers: Record<string, string>, body: unknown = { model: "m", messages: [] }) =>
    portal.fetch(new Request(BASE + "/v1/chat/completions", { method: "POST", headers: { authorization: `Bearer ${k}`, "content-type": "application/json", ...headers }, body: JSON.stringify(body) }));
  const sseRes = () => new Response(streamOf(SSE), { headers: { "content-type": "text/event-stream" } });

  it("answers in cogito frames, forces stream on, and the usual SSE is unchanged without the header", async () => {
    const portal = make(sseRes); const k = await key(portal);
    const co = await call(portal, k, { accept: COGITO_TYPE });
    expect(co.headers.get("content-type")).toBe(COGITO_TYPE);
    expect(seen.at(-1)?.stream).toBe(true);
    const f = await lines(co);
    expect(f[0].h.ret).toBe("none"); expect(f.filter((x) => "t" in x).map((x) => x.t).join("")).toBe("Hello"); expect(f.at(-1)).toEqual({ d: 1 });
    const plain = await call(portal, k, {});
    expect(plain.headers.get("content-type")).toContain("text/event-stream");
    expect(await plain.text()).toContain("[DONE]");
  });
  it("honours Cogito-Level 2 and works when the upstream cannot stream", async () => {
    const whole = make(() => Response.json({ choices: [{ message: { content: "Whole answer" } }], usage: { prompt_tokens: 3, completion_tokens: 2 } }));
    const k = await key(whole);
    const f = await lines(await call(whole, k, { accept: COGITO_TYPE, "cogito-level": "2" }));
    expect(f[0].h.lvl).toBe(2); expect(f.filter((x) => "t" in x).map((x) => x.t).join("")).toBe("Whole answer"); expect(f.at(-2)).toEqual({ u: [3, 2] });
  });
  it("an upstream error becomes an e frame, because the answer has already started", async () => {
    const portal = make(() => new Response(JSON.stringify({ error: { message: "bad" } }), { status: 502, headers: { "content-type": "application/json" } }));
    const k = await key(portal);
    const f = await lines(await call(portal, k, { accept: COGITO_TYPE }));
    expect(f[0].h.v).toBe(1); expect(f.at(-1)).toEqual({ e: { c: "upstream", m: "bad" } });
  });
  it("sends hello and thinking BEFORE the model has answered", async () => {
    let release!: () => void; const gate = new Promise<void>((r) => { release = r; });
    const portal = make(async () => { await gate; return new Response(JSON.stringify({ choices: [{ message: { content: "late" } }], usage: { prompt_tokens: 1, completion_tokens: 1 } }), { headers: { "content-type": "application/json" } }); });
    const k = await key(portal);
    const res = await call(portal, k, { accept: COGITO_TYPE });
    const reader = res.body!.getReader(); const dec = new TextDecoder();
    let got = ""; while (got.trim().split("\n").length < 2) got += dec.decode((await reader.read()).value); // the model is still blocked on `gate`
    const head = got.trim().split("\n").map((l) => JSON.parse(l));
    expect(head[0].h.v).toBe(1); expect(head[1]).toEqual({ s: "thinking" });
    release();
    let rest = ""; for (;;) { const { done, value } = await reader.read(); if (done) break; rest += dec.decode(value); }
    expect(rest).toContain('"t":"late"'); expect(rest.trim().endsWith('{"d":1}')).toBe(true);
  });
});

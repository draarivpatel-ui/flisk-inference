import { expect, test } from "bun:test";
import { callEvents, sendTrace } from "../src/trace";

test("a normal model call writes nothing", () => {
  expect(callEvents("/v1/chat/completions", "POST", 200, 3000)).toEqual([]);
  expect(callEvents("/v1/models", "GET", 500, 90000)).toEqual([]);
  expect(callEvents("/", "GET", 200, 90000)).toEqual([]);
});

test("a refused, failed or slow model call is one row", () => {
  expect(callEvents("/v1/chat/completions", "POST", 429, 50)[0]).toMatchObject({ kind: "capped", status: 429 });
  expect(callEvents("/v1/chat/completions", "POST", 502, 50)[0]).toMatchObject({ kind: "error", status: 502 });
  expect(callEvents("/v1/chat/completions", "POST", 200, 25_000)[0]).toMatchObject({ kind: "slow" });
});

test("sendTrace does nothing without a key, uses the binding, and never throws", async () => {
  let n = 0;
  await sendTrace({}, { route: "/a", kind: "error", why: "x" }, (async () => { n++; return new Response(); }) as unknown as typeof fetch);
  expect(n).toBe(0);
  const sent: string[] = [];
  await sendTrace({ TRACE_KEY: "k", TRACES: { fetch: async (u, init) => { sent.push(u + " " + (init.headers as Record<string, string>).authorization); return new Response("{}"); } } }, { route: "/a", kind: "error", why: "x" });
  expect(sent).toEqual(["https://traces.flisk.si/v1/trace Bearer k"]);
  await sendTrace({ TRACE_KEY: "k" }, { route: "/a", kind: "error", why: "x" }, (async () => { throw new Error("down"); }) as unknown as typeof fetch);
});

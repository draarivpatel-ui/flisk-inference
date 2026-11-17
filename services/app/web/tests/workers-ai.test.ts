import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseModelfile, workersAiUpstream } from "../src/workers-ai";

const modelfile = readFileSync(join(import.meta.dir, "..", "..", "..", "..", "deploy", "Modelfile"), "utf-8");
const post = (body: unknown): RequestInit => ({ method: "POST", body: JSON.stringify(body) });

describe("parseModelfile", () => {
  it("reads the system prompt and the example turns in order", () => {
    const msgs = parseModelfile(modelfile);
    expect(msgs[0].role).toBe("system");
    expect(msgs[0].content).toContain("You write Flisk service.json files");
    expect(msgs.slice(1).map((m) => m.role)).toEqual(["user", "assistant", "user", "assistant", "user", "assistant", "user", "assistant", "user", "assistant"]);
    expect(msgs.some((m) => m.content.includes('"""'))).toBe(false);
  });
});

describe("workersAiUpstream", () => {
  const calls: Array<{ model: string; input: Record<string, unknown> }> = [];
  const up = workersAiUpstream({
    ai: { run: async (model, input) => { calls.push({ model, input }); return { response: '{"a":1}', usage: { prompt_tokens: 7, completion_tokens: 3 } }; } },
    model: "@cf/qwen/qwen2.5-coder-32b-instruct", publicModel: "flisk-wolf", prelude: [{ role: "system", content: "rules" }],
  });
  it("puts the rules first, caps output tokens and answers in the OpenAI shape", async () => {
    const res = await up("/v1/chat/completions", post({ model: "flisk-wolf", max_tokens: 99999, messages: [{ role: "user", content: "hi" }] }));
    const json = (await res.json()) as { model: string; choices: Array<{ message: { content: string } }>; usage: { total_tokens: number } };
    expect(json.model).toBe("flisk-wolf");
    expect(json.choices[0].message.content).toBe('{"a":1}');
    expect(json.usage.total_tokens).toBe(10);
    expect(calls[0].model).toBe("@cf/qwen/qwen2.5-coder-32b-instruct");
    expect(calls[0].input.messages).toEqual([{ role: "system", content: "rules" }, { role: "user", content: "hi" }]);
    expect(calls[0].input.max_tokens).toBe(1024);
  });
  it("returns an answer the model gave as parsed JSON as text, the way OpenAI clients expect", async () => {
    const parsed = workersAiUpstream({ ai: { run: async () => ({ response: { appName: "x" } }) }, model: "m", publicModel: "p", prelude: [] });
    const json = (await (await parsed("/v1/chat/completions", post({ messages: [{ role: "user", content: "x" }] }))).json()) as { choices: Array<{ message: { content: unknown } }> };
    expect(json.choices[0].message.content).toBe('{\n  "appName": "x"\n}');
  });
  it("serves flisk-wolf-chat from the same model without the Flisk rules, and lists both names", async () => {
    const seen: Array<Record<string, unknown>> = [];
    const two = workersAiUpstream({ ai: { run: async (_m, input) => { seen.push(input); return { response: "hello" }; } }, model: "m", publicModel: "flisk-wolf", prelude: [{ role: "system", content: "rules" }], others: { "flisk-wolf-chat": [] } });
    const json = (await (await two("/v1/chat/completions", post({ model: "flisk-wolf-chat", messages: [{ role: "user", content: "hi" }] }))).json()) as { model: string };
    expect(json.model).toBe("flisk-wolf-chat");
    expect(seen[0].messages).toEqual([{ role: "user", content: "hi" }]);
    await two("/v1/chat/completions", post({ model: "toString", messages: [{ role: "user", content: "hi" }] }));
    expect(seen[1].messages).toEqual([{ role: "system", content: "rules" }, { role: "user", content: "hi" }]);
    const list = (await (await two("/v1/models", { method: "GET" })).json()) as { data: Array<{ id: string }> };
    expect(list.data.map((m) => m.id).sort()).toEqual(["flisk-wolf", "flisk-wolf-chat"]);
  });
  it("lists only the public model name", async () => {
    expect(((await (await up("/v1/models", {})).json()) as { data: Array<{ id: string }> }).data.map((d) => d.id)).toEqual(["flisk-wolf"]);
  });
  it("refuses an empty conversation and reports a failed model call as 502", async () => {
    expect((await up("/v1/chat/completions", post({ messages: [] }))).status).toBe(400);
    const broken = workersAiUpstream({ ai: { run: async () => { throw new Error("quota"); } }, model: "m", publicModel: "p", prelude: [] });
    expect((await broken("/v1/chat/completions", post({ messages: [{ role: "user", content: "x" }] }))).status).toBe(502);
  });
  it("runs an overridden public model on its own base model, with its system suffix and output cap", async () => {
    const seen: Array<{ model: string; input: Record<string, unknown> }> = [];
    const two = workersAiUpstream({
      ai: { run: async (model, input) => { seen.push({ model, input }); return { response: "<think>hm</think>\n\nhello" }; } },
      model: "big", publicModel: "flisk-wolf", prelude: [{ role: "system", content: "rules" }], others: { chat: [] },
      overrides: { chat: { model: "small", systemSuffix: "\n/no_think", maxTokens: 2048 } },
    });
    const ask = (body: unknown) => two("/v1/chat/completions", post(body));
    const res = await ask({ model: "chat", max_tokens: 99999, messages: [{ role: "system", content: "be brief" }, { role: "user", content: "hi" }] });
    expect(((await res.json()) as { choices: Array<{ message: { content: string } }> }).choices[0].message.content).toBe("hello");
    expect(seen[0].model).toBe("small");
    expect(seen[0].input.messages).toEqual([{ role: "system", content: "be brief\n/no_think" }, { role: "user", content: "hi" }]);
    expect(seen[0].input.max_tokens).toBe(2048);
    await ask({ model: "chat", messages: [{ role: "user", content: "hi" }] });
    expect(seen[1].input.messages).toEqual([{ role: "system", content: "/no_think" }, { role: "user", content: "hi" }]);
    await ask({ model: "flisk-wolf", max_tokens: 99999, messages: [{ role: "user", content: "hi" }] });
    expect(seen[2].model).toBe("big");
    expect(seen[2].input.messages).toEqual([{ role: "system", content: "rules" }, { role: "user", content: "hi" }]);
    expect(seen[2].input.max_tokens).toBe(1024);
  });
  it("sends a reasoning effort: the model's default, medium on request, never xhigh", async () => {
    const seen: Array<Record<string, unknown>> = [];
    const up = workersAiUpstream({
      ai: { run: async (_m, input) => { seen.push(input); return { response: "ok" }; } },
      model: "big", publicModel: "p", prelude: [], others: { chat: [] },
      overrides: { chat: { model: "q", reasoningEffort: "low" } },
    });
    const ask = (extra: object, model = "chat") => up("/v1/chat/completions", post({ model, messages: [{ role: "user", content: "hi" }], ...extra }));
    await ask({});
    await ask({ reasoning_effort: "medium" });
    await ask({ reasoning_effort: "xhigh" });
    await ask({}, "p");
    expect(seen.map((i) => i.reasoning_effort)).toEqual(["low", "medium", "low", undefined]);
  });
});

describe("flisk-wolf-large on Inkling 2 Small", () => {
  it("runs on its own base model at low effort, with no Flisk rules", async () => {
    const seen: Array<{ model: string; input: Record<string, unknown> }> = [];
    const up = workersAiUpstream({ ai: { run: async (model, input) => { seen.push({ model, input }); return { choices: [{ message: { content: "ok" } }], usage: { prompt_tokens: 3, completion_tokens: 1 } }; } }, model: "coder", publicModel: "flisk-wolf", prelude: [{ role: "system", content: "rules" }], others: { "flisk-wolf-large": [] }, overrides: { "flisk-wolf-large": { model: "@cf/thinkingmachines/inkling-2-small", reasoningEffort: "low", maxTokens: 2048 } } });
    const res = await up("/v1/chat/completions", { method: "POST", body: JSON.stringify({ model: "flisk-wolf-large", messages: [{ role: "user", content: "hi" }] }) });
    const json = (await res.json()) as { model: string; choices: Array<{ message: { content: string } }> };
    expect(json.model).toBe("flisk-wolf-large");
    expect(json.choices[0].message.content).toBe("ok");
    expect(seen[0].model).toBe("@cf/thinkingmachines/inkling-2-small");
    expect(seen[0].input.reasoning_effort).toBe("low");
    expect((seen[0].input.messages as Array<{ content: string }>).some((m) => m.content === "rules")).toBe(false);
  });
});

describe("workersAiUpstream streaming", () => {
  const sse = (parts: string[], usage?: object) => new ReadableStream<Uint8Array>({
    start(c) {
      const e = new TextEncoder();
      for (const p of parts) c.enqueue(e.encode(`data: ${JSON.stringify({ response: p })}\n\n`));
      if (usage) c.enqueue(e.encode(`data: ${JSON.stringify({ response: "", usage })}\n\n`));
      c.enqueue(e.encode("data: [DONE]\n\n"));
      c.close();
    },
  });
  it("sends each word as an OpenAI chunk, then the usage and [DONE]", async () => {
    const seen: Array<Record<string, unknown>> = [];
    const up = workersAiUpstream({ ai: { run: async (_m, input) => { seen.push(input); return sse(["The sea", " is salty"], { prompt_tokens: 5, completion_tokens: 4 }); } }, model: "m", publicModel: "flisk-wolf", prelude: [] });
    const res = await up("/v1/chat/completions", post({ model: "flisk-wolf", stream: true, messages: [{ role: "user", content: "hi" }] }));
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    expect(seen[0].stream).toBe(true);
    const text = await res.text();
    const events = text.split("\n\n").filter((l) => l.startsWith("data: ") && !l.includes("[DONE]")).map((l) => JSON.parse(l.slice(6)));
    expect(events.map((e) => e.choices[0]?.delta?.content).filter((c) => c)).toEqual(["The sea", " is salty"]);
    expect(events.some((e) => e.choices[0]?.finish_reason === "stop")).toBe(true);
    expect(events.at(-1).usage).toEqual({ prompt_tokens: 5, completion_tokens: 4, total_tokens: 9 });
    expect(text.trim().endsWith("data: [DONE]")).toBe(true);
  });
  it("sends a thinking model's answer whole, with its notes cut out", async () => {
    const up = workersAiUpstream({ ai: { run: async () => ({ response: "<think>x</think>done", usage: {} }) }, model: "m", publicModel: "p", prelude: [], overrides: { p: { reasoningEffort: "low" } } });
    const res = await up("/v1/chat/completions", post({ model: "p", stream: true, messages: [{ role: "user", content: "hi" }] }));
    const text = await res.text();
    expect(text).toContain('"content":"done"');
    expect(text).not.toContain("think");
  });
});

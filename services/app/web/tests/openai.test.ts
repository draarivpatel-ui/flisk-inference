import { describe, expect, it } from "bun:test";
import { openaiUpstream } from "../src/openai";

const post = (body: unknown): RequestInit => ({ method: "POST", body: JSON.stringify(body) });

describe("openaiUpstream", () => {
  const sent: Array<{ url: string; auth: string | null; body: { model: string; messages: Array<{ role: string }>; max_completion_tokens: number } }> = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    sent.push({ url, auth: new Headers(init.headers).get("authorization"), body: JSON.parse(String(init.body)) });
    return Response.json({ choices: [{ message: { content: " hello " } }], usage: { prompt_tokens: 5, completion_tokens: 2 } });
  }) as unknown as typeof fetch;
  const up = openaiUpstream({ key: "sk-test", model: "gpt-4o-mini", publicModel: "flisk-wolf", preludes: { "flisk-wolf": [{ role: "system", content: "rules" }], chat: [] }, fetchImpl });
  it("puts the rules first, caps the answer, uses the key and keeps the public model name", async () => {
    const res = await up("/v1/chat/completions", post({ model: "flisk-wolf", max_tokens: 99999, messages: [{ role: "user", content: "hi" }] }));
    const json = (await res.json()) as { model: string; choices: Array<{ message: { content: string } }>; usage: { total_tokens: number } };
    expect(json.model).toBe("flisk-wolf");
    expect(json.choices[0].message.content).toBe("hello");
    expect(json.usage.total_tokens).toBe(7);
    expect(sent[0].url).toBe("https://api.openai.com/v1/chat/completions");
    expect(sent[0].auth).toBe("Bearer sk-test");
    expect(sent[0].body.model).toBe("gpt-4o-mini");
    expect(sent[0].body.messages.map((m) => m.role)).toEqual(["system", "user"]);
    expect(sent[0].body.max_completion_tokens).toBe(1024);
  });
  it("does not pass an OpenAI error on, since it can name the key", async () => {
    const bad = openaiUpstream({ key: "sk-test", model: "m", publicModel: "flisk-wolf", preludes: { "flisk-wolf": [] },
      fetchImpl: (async () => Response.json({ error: { message: "Incorrect API key provided: sk-test" } }, { status: 401 })) as unknown as typeof fetch });
    const res = await bad("/v1/chat/completions", post({ messages: [{ role: "user", content: "hi" }] }));
    expect(res.status).toBe(502);
    expect(await res.text()).not.toContain("sk-test");
  });
});

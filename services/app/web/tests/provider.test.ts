import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileStore } from "../src/file-store";
import { createPortal } from "../src/portal";
import { open, seal } from "../src/providers";
import { withSecurityHeaders } from "../src/security-headers";

const BASE = "http://portal.test";
let dir: string;
let calls: Array<{ url: string; auth: string | null; body: Record<string, unknown> }>;

function make() {
  calls = [];
  return createPortal({
    publicUrl: BASE, store: fileStore(dir), dailyLimit: 1, allowedModels: ["flisk-wolf"], maxOutputTokens: 1024,
    indexHtml: () => readFileSync(join(import.meta.dir, "..", "public", "index.html"), "utf-8"),
    devLogin: async () => ({ id: 1, login: "octocat" }),
    upstream: async () => Response.json({ choices: [{ message: { content: "free" } }], usage: { prompt_tokens: 1, completion_tokens: 1 } }),
    ownProviders: { publicModel: "flisk-wolf", preludes: { "flisk-wolf": [{ role: "system", content: "rules" }] } },
    fetchImpl: (async (url: string, init: RequestInit) => {
      calls.push({ url, auth: new Headers(init.headers).get("authorization"), body: JSON.parse(String(init.body)) });
      return Response.json({ choices: [{ message: { content: "own" } }], usage: { prompt_tokens: 7, completion_tokens: 3 } });
    }) as unknown as typeof fetch,
  });
}
const j = (cookie: string, body?: unknown, method = "POST") => ({ method, headers: { cookie, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
async function setup() {
  const p = make();
  const cookie = ((await p.fetch(new Request(`${BASE}/auth/dev`))).headers.get("set-cookie") ?? "").split(";")[0];
  const { key } = (await (await p.fetch(new Request(`${BASE}/api/keys`, j(cookie, { name: "t" })))).json()) as { key: string };
  const chat = () => p.fetch(new Request(`${BASE}/v1/chat/completions`, { method: "POST", headers: { authorization: `Bearer ${key}`, "content-type": "application/json" }, body: JSON.stringify({ model: "flisk-wolf", messages: [{ role: "user", content: "hi" }] }) }));
  return { p, cookie, chat };
}

beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "prov-")); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("saved provider key", () => {
  it("seals and opens, and a wrong secret opens nothing", () => {
    const s = seal("secret-a", "sk-abcdefghijkl");
    expect(s).not.toContain("sk-abc");
    expect(open("secret-a", s)).toBe("sk-abcdefghijkl");
    expect(open("secret-b", s)).toBeNull();
  });
  it("needs sign-in, never returns the key, and keeps it when only the model changes", async () => {
    const { p, cookie } = await setup();
    expect((await p.fetch(new Request(`${BASE}/api/provider`))).status).toBe(401);
    expect((await p.fetch(new Request(`${BASE}/api/provider`, j(cookie, { provider: "openai" }, "PUT")))).status).toBe(400); // no key yet
    const saved = await p.fetch(new Request(`${BASE}/api/provider`, j(cookie, { provider: "openai", model: "gpt-4o", key: "sk-test-1234567890" }, "PUT")));
    expect(saved.status).toBe(200);
    expect(await saved.text()).not.toContain("sk-test-1234567890");
    expect(readFileSync(join(dir, "db.json"), "utf-8")).not.toContain("sk-test-1234567890");
    const again = await p.fetch(new Request(`${BASE}/api/provider`, j(cookie, { provider: "openai", model: "gpt-4o-mini" }, "PUT")));
    expect(again.status).toBe(200);
    const cur = ((await (await p.fetch(new Request(`${BASE}/api/provider`, { headers: { cookie } }))).json()) as { current: { model: string; last4: string } }).current;
    expect(cur).toEqual({ provider: "openai", model: "gpt-4o-mini", last4: "7890" });
  });
  it("runs calls on the person's own account and does not count them in the shared daily limit", async () => {
    const { p, cookie, chat } = await setup();
    for (const [provider, url, field] of [["openai", "https://api.openai.com/v1/chat/completions", "max_completion_tokens"], ["anthropic", "https://api.anthropic.com/v1/chat/completions", "max_tokens"], ["openrouter", "https://openrouter.ai/api/v1/chat/completions", "max_tokens"]] as const) {
      await p.fetch(new Request(`${BASE}/api/provider`, j(cookie, { provider, key: "sk-test-1234567890" }, "PUT")));
      const res = await chat();
      expect(res.status).toBe(200);
      expect(((await res.json()) as { model: string }).model).toBe("flisk-wolf");
      const c = calls.at(-1)!;
      expect(c.url).toBe(url);
      expect(c.auth).toBe("Bearer sk-test-1234567890");
      expect(c.body[field]).toBe(1024);
    }
    // dailyLimit is 1: ten own calls later the free model still has its whole allowance.
    for (let i = 0; i < 5; i++) expect((await chat()).status).toBe(200);
    await p.fetch(new Request(`${BASE}/api/provider`, j(cookie, undefined, "DELETE")));
    expect(((await (await chat()).json()) as { choices: Array<{ message: { content: string } }> }).choices[0].message.content).toBe("free");
    expect((await chat()).status).toBe(429); // the free allowance was used by that one call
  });
});

describe("picker", () => {
  it("is framed only by flisk.si sites and the script names the portal", async () => {
    const { p } = await setup();
    const page = withSecurityHeaders(await p.fetch(new Request(`${BASE}/picker`)));
    expect(page.headers.get("content-security-policy")).toContain("frame-ancestors https://*.flisk.si");
    expect(page.headers.get("x-frame-options")).toBeNull();
    const js = await (await p.fetch(new Request(`${BASE}/picker.js`))).text();
    expect(js).toContain(`"${BASE}"`);
    expect(js).toContain("FliskPicker");
  });

  it("draws the chat-style picker: search, provider rail, catalog list, key box, logos inline", async () => {
    const { p } = await setup();
    const html = await (await p.fetch(new Request(`${BASE}/picker`))).text();
    for (const part of ["Search models", '"rail"', "pgrid", "/v1/catalog", "/api/provider", "data:image/svg+xml", "flisk-picker"]) expect(html).toContain(part);
    expect(html).not.toContain("<select");
  });
});

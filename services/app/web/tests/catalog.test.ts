import { expect, test } from "bun:test";
import { CATALOG, catalogResponse } from "../src/catalog";

test("catalog lists the free Flisk model first and every entry is complete", () => {
  expect(CATALOG[0]).toMatchObject({ id: "flisk-wolf-chat", free: true, key: "" });
  const ids = new Set<string>();
  for (const m of CATALOG) {
    expect(ids.has(m.id)).toBe(false);
    ids.add(m.id);
    expect(m.name && m.providerName && m.description).toBeTruthy();
    expect(m.free).toBe(m.key === "");
  }
});

test("catalog is public JSON any Flisk site can read", async () => {
  const res = catalogResponse();
  expect(res.headers.get("access-control-allow-origin")).toBe("*");
  const body = (await res.json()) as { data: unknown[] };
  expect(body.data.length).toBe(CATALOG.length);
});

test("GPT-6.2 Astra and Sol are released OpenAI models, flagged new", () => {
  expect(CATALOG.find((m) => m.id === "gpt-6-2-astra")).toMatchObject({ key: "openai", model: "gpt-6.2-astra", free: false });
  expect(CATALOG.find((m) => m.id === "gpt-6-2-sol")).toMatchObject({ key: "openai", model: "gpt-6.2-sol", free: false });
  expect(CATALOG.filter((m) => m.new).map((m) => m.id)).toEqual(["gpt-6-2-astra", "gpt-6-2-sol"]);
});

test("the previous GPT-6 Astra is listed, and every named OpenAI model uses an ID from OpenAI's model list", () => {
  expect(CATALOG.find((m) => m.id === "gpt-6-astra")).toMatchObject({ key: "openai", model: "gpt-6-astra", free: false });
  expect(CATALOG.find((m) => m.id === "gpt-6-astra")?.new).toBeUndefined();
  // IDs checked against developers.openai.com/api/docs/models on 2026-11-17
  const official = ["gpt-6.2-astra", "gpt-6.2-sol", "gpt-6-astra", "gpt-6.1-terra", "gpt-6-luna"];
  const named = CATALOG.filter((m) => m.provider === "openai" && m.model !== "").map((m) => m.model);
  expect(named).toEqual(official);
});

import { expect, mock, test } from "bun:test";
import { withSecurityHeaders } from "../src/security-headers";

// wrangler.toml loads the Modelfile as text; Bun cannot parse it as a module.
mock.module("../../../../deploy/Modelfile", () => ({ default: "FROM test" }));
const { default: worker } = await import("../src/worker");

test("adds the baseline to a bare response and a frame-ancestors policy", () => {
  const res = withSecurityHeaders(new Response("hi"));
  expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  expect(res.headers.get("x-frame-options")).toBeNull();
  expect(res.headers.get("strict-transport-security")).toBe("max-age=31536000; includeSubDomains");
  expect(res.headers.get("referrer-policy")).toBe("strict-origin-when-cross-origin");
  expect(res.headers.get("permissions-policy")).toBe("camera=(), microphone=(), geolocation=()");
  expect(res.headers.get("content-security-policy")).toBe("default-src 'self'; script-src 'self' 'unsafe-inline' https:; style-src 'self' 'unsafe-inline' https:; img-src 'self' data: blob: https:; font-src 'self' data: https:; connect-src 'self' https: wss:; media-src 'self' https:; frame-src 'self' https:; worker-src 'self' blob:; object-src 'none'; frame-ancestors 'self' https://analytics.flisk.si; base-uri 'self'; form-action 'self' https:");
});

test("keeps headers and a policy the route already set", () => {
  const res = withSecurityHeaders(new Response("hi", { headers: { "x-frame-options": "DENY", "content-security-policy": "default-src 'none'" } }));
  expect(res.headers.get("x-frame-options")).toBe("DENY");
  expect(res.headers.get("content-security-policy")).toBe("default-src 'none'; frame-ancestors 'self' https://analytics.flisk.si");
  const own = withSecurityHeaders(new Response("hi", { headers: { "content-security-policy": "frame-ancestors 'none'" } }));
  expect(own.headers.get("content-security-policy")).toBe("frame-ancestors 'none'");
});

test("works on responses with immutable headers", () => {
  const res = withSecurityHeaders(Response.redirect("https://example.com"));
  expect(res.status).toBe(302);
  expect(res.headers.get("x-content-type-options")).toBe("nosniff");
});

test("the Worker adds the headers and keeps the public catalog readable cross-origin", async () => {
  const res = await worker.fetch(new Request("https://inference.flisk.si/v1/catalog"), {} as never);
  expect(res.status).toBe(200);
  expect(res.headers.get("access-control-allow-origin")).toBe("*");
  expect(res.headers.get("x-frame-options")).toBeNull();
  expect(res.headers.get("strict-transport-security")).toBe("max-age=31536000; includeSubDomains");
});

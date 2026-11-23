import { describe, expect, it } from "bun:test";
import { modelFailure } from "../src/workers-ai";

describe("modelFailure", () => {
  it("turns Cloudflare's free-allowance error (4006) into a friendly 429 with a reset time", async () => {
    const r = modelFailure(new Error("4006: you have used up your daily free allocation of 10,000 neurons, please upgrade to Cloudflare's Workers Paid plan"));
    expect(r.status).toBe(429);
    const j = (await r.json()) as { error: { message: string } };
    expect(j.error.message).toContain("resets at 00:00 UTC"); expect(j.error.message).not.toContain("Paid");
    expect(Number(r.headers.get("retry-after"))).toBeGreaterThanOrEqual(60);
  });
  it("keeps every other failure a 502", async () => {
    const r = modelFailure(new Error("boom"));
    expect(r.status).toBe(502);
    expect(((await r.json()) as { error: { message: string } }).error.message).toBe("model call failed: boom");
  });
});

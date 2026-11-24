import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const html = readFileSync(join(import.meta.dir, "..", "public", "index.html"), "utf-8");
const css = html.slice(html.indexOf("<style>"), html.indexOf("</style>"));
// The landing is built in JS: take its source, from the first h1 to the end of the hero.
const landing = html.slice(html.indexOf("function landing()"), html.indexOf("/* ---------- console"));

describe("next-cta (predicted next action on the landing)", () => {
  it("marks exactly one element with data-next-cta, and it carries class next-cta", () => {
    expect(html.match(/data-next-cta/g)?.length).toBe(1);
    const marked = html.match(/h\("a",\{class:"([^"]*)","data-next-cta":[^}]*\}[^)]*\)/);
    expect(marked).not.toBeNull();
    expect(marked![1].split(" ")).toContain("next-cta");
    expect(marked![1].split(" ")).toContain("btn"); // existing classes kept
    expect(marked![1].split(" ")).toContain("primary");
  });

  it("is the first link or button after the first h1", () => {
    const afterH1 = landing.slice(landing.indexOf('h("h1"'));
    const firstControl = afterH1.match(/h\("(a|button)",\{[^}]*\}/);
    expect(firstControl).not.toBeNull();
    expect(firstControl![0]).toContain("data-next-cta");
    expect(firstControl![0]).toContain("?section=keys");
  });

  it("styles it with a spinning conic-gradient border and a reduced-motion fallback", () => {
    expect(css).toContain("@property --next-cta-angle");
    expect(css).toMatch(/\.next-cta[^{]*\{[^}]*conic-gradient/);
    expect(css).toMatch(/@keyframes\s+next-cta-spin/);
    expect(css).toMatch(/animation:[^;}]*next-cta-spin/);
    const rm = css.match(/@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{[^@]*\.next-cta[^{]*\{[^}]*animation:\s*none/);
    expect(rm).not.toBeNull();
  });
});

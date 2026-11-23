import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// The org bar (flisk.si/assets/bar.js) reads the signed-in login from [data-flisk-login]: the element's whole trimmed text, a leading @ stripped,
// must match ^[A-Za-z0-9][A-Za-z0-9-]{0,38}$. The SPA builds the element client-side, so the test runs its own helper against a fake `h`.
const indexHtml = readFileSync(join(import.meta.dir, "..", "public", "index.html"), "utf-8");
const BAR_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;

const line = (start: string) => {
	const l = indexHtml.split("\n").find((x) => x.startsWith(start));
	if (!l) throw new Error(`missing in index.html: ${start}`);
	return l;
};
type El = { attrs: Record<string, unknown>; text: string };
const h = (_tag: string, attrs: Record<string, unknown> | null, ...kids: string[]): El => ({ attrs: attrs ?? {}, text: kids.join("") });
const whoSpan = new Function("h", `${line("const GH_LOGIN=")}\n${line("const whoSpan=")}\nreturn whoSpan;`)(h) as (me: unknown) => El;
const barReads = (el: El) => ("data-flisk-login" in el.attrs ? (el.text.trim().replace(/^@/, "").match(BAR_PATTERN)?.[0] ?? "") : "");

describe("org bar login hook", () => {
	it("marks the signed-in login so the bar reads exactly it", () => {
		const el = whoSpan({ login: "octo-cat", avatar: "" });
		expect(el.attrs["data-flisk-login"]).toBe(true);
		expect(barReads(el)).toBe("octo-cat");
	});

	it("has no hook when signed out, and the text could not match anyway", () => {
		const el = whoSpan(null);
		expect(el.text).toBe("Not signed in");
		expect("data-flisk-login" in el.attrs).toBe(false);
		expect(BAR_PATTERN.test(el.text)).toBe(false);
		expect(barReads(el)).toBe("");
	});

	it("never marks something that is not a GitHub login", () => {
		for (const login of ["", "has space", "-lead", "a".repeat(40), "<b>x</b>", undefined]) {
			expect("data-flisk-login" in whoSpan({ login }).attrs).toBe(false);
		}
	});

	it("renders the sidebar name through the helper", () => {
		expect(indexHtml).toContain("whoSpan(me)");
		expect(indexHtml.match(/"data-flisk-login":true/g)?.length).toBe(1);
	});
});

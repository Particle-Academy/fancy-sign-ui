import { describe, expect, it, vi } from "vitest";
import { createSignClient } from "./client";
import { initialEnvelopeSetupState, setupProblems } from "./EnvelopeSetup";
import type { EnvelopeSetupState } from "./EnvelopeSetup";

/**
 * Two regexes that were quadratic on crafted input (CodeQL js/polynomial-redos,
 * alerts #1 and #2), shipped in 0.1.0 through 0.3.0:
 *
 * - `createSignClient` trimmed the base URL with `/\/+$/`. A run of slashes NOT
 *   at the end is retried from every position, each attempt scanning to the end.
 * - `setupProblems` checked email with `^[^\s@]+@[^\s@]+\.[^\s@]+$`. The two
 *   classes either side of `\.` both accept `.`, so a domain of many dots with
 *   no valid ending tries every split. The email is typed by whoever fills in
 *   the form, or written by an agent through the bridge.
 *
 * Both are now scans. A ReDoS fix changes only the time, so the time is what
 * is asserted: under 50 ms on 100,000 characters.
 */

describe("createSignClient base URL trim is linear", () => {
  it("handles 100k slashes that are not at the end in under 50 ms", () => {
    const base = `https://sign.example.com/x${"/".repeat(100_000)}a`;

    const started = performance.now();
    createSignClient({ baseUrl: base, fetch: vi.fn() as unknown as typeof fetch });
    const elapsed = performance.now() - started;

    expect(elapsed, `took ${elapsed.toFixed(0)}ms; the quadratic trim is back`).toBeLessThan(50);
  });

  it.each([
    ["https://sign.example.com/api", "https://sign.example.com/api"],
    ["https://sign.example.com/api/", "https://sign.example.com/api"],
    ["https://sign.example.com/api///", "https://sign.example.com/api"],
    ["/sign/", "/sign"],
    ["/", ""],
    ["", ""],
    ["https://sign.example.com/a//b/", "https://sign.example.com/a//b"],
  ])("trims %j to %j, as before", async (baseUrl, expected) => {
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL) => new Response(JSON.stringify({ key: "k" }), { status: 200, headers: { "content-type": "application/json" } }));
    await createSignClient({ baseUrl, fetch: fetchImpl as unknown as typeof fetch }).publicKey();

    expect(String(fetchImpl.mock.calls[0]![0])).toBe(`${expected}/public-key`);
  });
});

function withEmail(email: string): EnvelopeSetupState {
  return { ...initialEnvelopeSetupState(), title: "T", signers: [{ id: "s1", name: "N", email } as EnvelopeSetupState["signers"][number]] };
}

function emailRejected(email: string): boolean {
  return setupProblems(withEmail(email)).some((p) => p.includes("is not an email address"));
}

describe("setupProblems email check is linear", () => {
  it.each([
    ["many dots then an @", `a@${".".repeat(100_000)}@`],
    ["many dots then an inner space", `a@${".".repeat(100_000)} x`],
    ["many characters with no dot", `a@${"b".repeat(100_000)}@`],
  ])("rejects %s (100k characters) in under 50 ms", (_, email) => {
    const started = performance.now();
    const rejected = emailRejected(email);
    const elapsed = performance.now() - started;

    expect(rejected).toBe(true);
    expect(elapsed, `took ${elapsed.toFixed(0)}ms; the quadratic email regex is back`).toBeLessThan(50);
  });

  // What the regex accepted and refused, pinned before it is replaced.
  it.each([
    "a@b.c",
    "first.last@example.com",
    "a+tag@sub.example.co.uk",
    "a@b..c",
    "a@.b.c",
    "  a@b.c  ",
  ])("accepts %j", (email) => {
    expect(emailRejected(email)).toBe(false);
  });

  it.each(["", "a", "a@b", "@b.c", "a@.c", "a@b.", "a@@b.c", "a b@c.d", "a@b c.d", "a@b.c@d.e", "a@b x.c", "a@."])(
    "rejects %j",
    (email) => {
      expect(emailRejected(email)).toBe(true);
    },
  );
});

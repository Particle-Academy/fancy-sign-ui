import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

/**
 * The legal-claims wording is binding (fancy-sign plan, section 10). A README is
 * the first thing a buyer reads, so a forbidden phrase there is a claim we made,
 * whatever the code does. This test is the guard, the same way a hard-coded kit
 * version is guarded elsewhere.
 *
 * Lives in `tests/` rather than `src/` so `tsc --noEmit` (which compiles `src`)
 * does not need `@types/node` on the runtime type graph.
 */
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const readme = readFileSync(join(root, "README.md"), "utf8");
const lower = readme.toLowerCase();

const FORBIDDEN = [
  "legally compliant",
  "legally binding",
  "eidas compliant",
  "eidas-compliant",
  "esign compliant",
  "ueta compliant",
  "esign/ueta compliant",
  "court-proof",
  "court proof",
  "qualified",
];

describe("README legal claims", () => {
  for (const phrase of FORBIDDEN) {
    it(`never says "${phrase}"`, () => {
      expect(lower.includes(phrase)).toBe(false);
    });
  }

  it("never calls this phase AdES (case-sensitive, so the word cannot hide in another)", () => {
    // Matches "AdES" and "advanced electronic signature", not e.g. "shades".
    expect(/\bAdES\b/.test(readme)).toBe(false);
    expect(lower.includes("advanced electronic signature")).toBe(false);
  });

  it("says what it is designed to support, in the plan's wording", () => {
    expect(readme).toContain(
      "Designed to support simple electronic signatures (SES): consent and intent captured, signer verified by email one-time code, a hash-chained audit trail, and a sealed final document.",
    );
  });

  it("recommends legal review", () => {
    expect(readme).toContain("Have it reviewed by a lawyer before relying on it.");
  });
});

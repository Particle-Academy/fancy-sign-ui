import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { DataCanonicalError, canonicalData, dataSha256, parseCanonicalData } from "../src/data";

/**
 * fsig-data-1 (CC-fancy-0052), the form the signer's page re-derives before it
 * renders anything. Held to fancy-conformance `sign/data`: the fixture is that
 * suite's `cases.json`, exported by fancy-sign-php (the reference), copied here
 * byte for byte. A disagreement is a bug in one of the two implementations.
 */
interface Case {
  id: string;
  input: { text: string };
  expected: { canonical: string; sha256: string; bytes: number } | { error: "refused" };
}

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const cases = (JSON.parse(readFileSync(join(root, "tests/fixtures/sign-data-cases.json"), "utf8")) as { cases: Case[] }).cases;

describe("fsig-data-1 against the sign/data rows", () => {
  it("has all thirteen rows", () => {
    expect(cases.map((c) => c.id.slice(0, 4))).toEqual(
      ["0001", "0002", "0003", "0004", "0005", "0006", "0007", "0008", "0009", "0010", "0011", "0012", "0013"],
    );
  });

  for (const c of cases) {
    it(`${c.id}`, async () => {
      if ("error" in c.expected) {
        expect(() => canonicalData(JSON.parse(c.input.text))).toThrow(DataCanonicalError);
        return;
      }
      const value = JSON.parse(c.input.text);
      const canonical = canonicalData(value);
      expect(canonical).toBe(c.expected.canonical);
      expect(new TextEncoder().encode(canonical).length).toBe(c.expected.bytes);
      expect(await dataSha256(value)).toBe(c.expected.sha256);
      // Idempotent: the canonical bytes canonicalise to themselves.
      expect(canonicalData(JSON.parse(canonical))).toBe(canonical);
    });
  }
});

describe("the mutants sign/data exists to catch", () => {
  it("prints -0 as 0 and keeps float noise", () => {
    expect(canonicalData({ a: -0, b: 0.30000000000000004 })).toBe('{"a":0,"b":0.30000000000000004}');
  });

  it("sorts keys by UTF-8 bytes, not UTF-16 code units", () => {
    // U+E000 is one UTF-16 unit above the surrogate range; JS's default sort puts the emoji first.
    const pua = String.fromCodePoint(0xe000);
    const emoji = String.fromCodePoint(0x1f600);
    expect(canonicalData({ [emoji]: 2, [pua]: 1 })).toBe(`{"${pua}":1,"${emoji}":2}`);
  });

  it("refuses non-finite and unsafe numbers, and a non-object top level", () => {
    for (const bad of [{ n: Number.NaN }, { n: Infinity }, { n: 2 ** 53 }, { n: -(2 ** 53) }]) {
      expect(() => canonicalData(bad)).toThrow(DataCanonicalError);
    }
    for (const bad of [[], "x", 1, null]) {
      expect(() => canonicalData(bad)).toThrow(DataCanonicalError);
    }
  });

  it("refuses a lone low surrogate in a key as well as a value", () => {
    expect(() => canonicalData({ ["a" + String.fromCharCode(0xdc00)]: 1 })).toThrow(DataCanonicalError);
  });

  it("refuses data nested deeper than the limit", () => {
    let deep: Record<string, unknown> = {};
    const top = deep;
    for (let i = 0; i < 70; i++) {
      const next = {};
      deep.x = next;
      deep = next;
    }
    expect(() => canonicalData(top)).toThrow(DataCanonicalError);
    expect(() => canonicalData(top, 100)).not.toThrow();
  });
});

describe("parseCanonicalData", () => {
  it("parses the served bytes and proves they hash to the expected value", async () => {
    const row = cases.find((c) => c.id.startsWith("0007"))!;
    const expected = row.expected as { canonical: string; sha256: string };
    const parsed = await parseCanonicalData(expected.canonical, expected.sha256);
    expect(parsed.data).toEqual(JSON.parse(expected.canonical));
    expect(parsed.sha256).toBe(expected.sha256);
  });

  it("refuses bytes that do not hash to the expected value: data_hash_mismatch", async () => {
    const row = cases.find((c) => c.id.startsWith("0007"))!;
    const expected = row.expected as { canonical: string; sha256: string };
    const tampered = expected.canonical.replace("612.5", "61.25");
    await expect(parseCanonicalData(tampered, expected.sha256)).rejects.toMatchObject({ code: "data_hash_mismatch" });
  });

  it("refuses bytes that are not JSON, or not canonicalisable: data_invalid", async () => {
    await expect(parseCanonicalData("{nope", "0".repeat(64))).rejects.toMatchObject({ code: "data_invalid" });
    await expect(parseCanonicalData('{"n": 9007199254740993}', "0".repeat(64))).rejects.toMatchObject({ code: "data_invalid" });
  });
});

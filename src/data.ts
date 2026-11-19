/**
 * `@particle-academy/fancy-sign-ui/data`: `fsig-data-1`, the canonical byte
 * form fancy-sign hashes in data mode (CC-fancy-0052). **React-free.**
 *
 * The rule is fancy-conformance `sign/chain` canonical JSON (keys sorted by
 * UTF-8 bytes, no whitespace, slash and non-ASCII raw, controls escaped) with
 * one change: a non-integral number prints as ECMAScript `Number::toString`
 * (shortest round trip), which is what `String(n)` does. Refused: a top level
 * that is not an object, an integral number beyond 2^53 - 1 (two runtimes
 * would read it differently), a non-finite number, a lone surrogate, and
 * nesting deeper than `maxDepth`.
 *
 * `data_sha256` is the lowercase hex SHA-256 of the UTF-8 bytes. Held to the
 * `sign/data` rows (`src/data.test.ts`). An optional helper for hosts; the
 * signer ceremony uses it to prove the data it hands to `renderData` is the
 * data that is signed.
 */

/** Why a value cannot be canonicalised, or why served data was refused. */
export class DataCanonicalError extends Error {
  /** `data_invalid`: not canonicalisable. `data_hash_mismatch`: canonical, but not the signed hash. */
  readonly code: "data_invalid" | "data_hash_mismatch";

  constructor(code: "data_invalid" | "data_hash_mismatch", message: string) {
    super(message);
    this.name = "DataCanonicalError";
    this.code = code;
  }
}

/** The name recorded beside every hash made this way. */
export const DATA_CANONICAL_NAME = "fsig-data-1";

/** 2^53 - 1. */
const MAX_SAFE = Number.MAX_SAFE_INTEGER;

/** The PHP reference's default. The server has already enforced its own limit at create time. */
export const DATA_DEFAULT_MAX_DEPTH = 64;

/** Canonical `fsig-data-1` text of a JSON value (a parsed object). Throws `DataCanonicalError`. */
export function canonicalData(value: unknown, maxDepth: number = DATA_DEFAULT_MAX_DEPTH): string {
  if (!isPlainObject(value)) {
    throw new DataCanonicalError("data_invalid", "The data must be a JSON object.");
  }
  return encode(value, 1, maxDepth, "");
}

/** `data_sha256`: lowercase hex SHA-256 of the canonical bytes, by WebCrypto. */
export async function dataSha256(value: unknown, maxDepth: number = DATA_DEFAULT_MAX_DEPTH): Promise<string> {
  return sha256Hex(canonicalData(value, maxDepth));
}

/** Lowercase hex SHA-256 of a string's UTF-8 bytes, by WebCrypto. */
export async function sha256Hex(text: string): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new DataCanonicalError("data_invalid", "This browser has no WebCrypto, so the data cannot be checked.");
  }
  const digest = await subtle.digest("SHA-256", new TextEncoder().encode(text));
  let hex = "";
  for (const byte of new Uint8Array(digest)) hex += byte.toString(16).padStart(2, "0");
  return hex;
}

/**
 * Parse data as served (`GET s/{token}/document` in data mode) and prove it is
 * the signed data: it must canonicalise, and its canonical bytes must hash to
 * `expectedSha256`. Returns the parsed object, which is exactly what was
 * hashed. Throws `DataCanonicalError` with `data_invalid` or
 * `data_hash_mismatch`.
 */
export async function parseCanonicalData(
  text: string,
  expectedSha256: string,
  maxDepth = 512,
): Promise<{ data: Record<string, unknown>; canonical: string; sha256: string }> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new DataCanonicalError("data_invalid", "The data is not valid JSON.");
  }
  const canonical = canonicalData(parsed, maxDepth);
  const sha256 = await sha256Hex(canonical);
  if (sha256 !== expectedSha256.toLowerCase()) {
    throw new DataCanonicalError("data_hash_mismatch", "The data received does not match the data that is signed.");
  }
  return { data: parsed as Record<string, unknown>, canonical, sha256 };
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function encode(v: unknown, depth: number, maxDepth: number, at: string): string {
  if (v === null) return "null";
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "string") return str(v, at);
  if (typeof v === "number") return num(v, at);
  if (typeof v !== "object") {
    throw new DataCanonicalError("data_invalid", `${at || "/"}: ${typeof v} is not a JSON value.`);
  }
  if (depth > maxDepth) {
    throw new DataCanonicalError("data_invalid", `${at || "/"}: the data is nested deeper than ${maxDepth} levels.`);
  }
  if (Array.isArray(v)) {
    return "[" + v.map((item, i) => encode(item, depth + 1, maxDepth, `${at}/${i}`)).join(",") + "]";
  }
  const keys = Object.keys(v).sort(compareUtf8);
  const out: string[] = [];
  for (const key of keys) {
    const item = (v as Record<string, unknown>)[key];
    out.push(str(key, at) + ":" + encode(item, depth + 1, maxDepth, `${at}/${key.split("~").join("~0").split("/").join("~1")}`));
  }
  return "{" + out.join(",") + "}";
}

function num(x: number, at: string): string {
  if (!Number.isFinite(x)) {
    throw new DataCanonicalError("data_invalid", `${at || "/"}: a number must be finite.`);
  }
  if (Number.isInteger(x)) {
    if (Math.abs(x) > MAX_SAFE) {
      throw new DataCanonicalError("data_invalid", `${at || "/"}: an integral number beyond 2^53 - 1 is not read exactly by every runtime.`);
    }
    // -0 prints 0.
    return x === 0 ? "0" : String(x);
  }
  // ECMA-262 Number::toString: shortest round-trip digits.
  return String(x);
}

/**
 * A JSON string, as JSON.stringify writes it (quote, backslash and controls
 * escaped; slash, non-ASCII and U+2028 raw), after refusing a lone surrogate,
 * which JSON.stringify would silently escape and PHP refuses. A linear scan, no
 * regular expression.
 */
function str(s: string, at: string): string {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const next = i + 1 < s.length ? s.charCodeAt(i + 1) : 0;
      if (next >= 0xdc00 && next <= 0xdfff) {
        i++;
        continue;
      }
      throw new DataCanonicalError("data_invalid", `${at || "/"}: a string holds a lone surrogate.`);
    }
    if (c >= 0xdc00 && c <= 0xdfff) {
      throw new DataCanonicalError("data_invalid", `${at || "/"}: a string holds a lone surrogate.`);
    }
  }
  return JSON.stringify(s);
}

/** UTF-8 byte order, which is Unicode code point order (not UTF-16 code unit order). */
function compareUtf8(a: string, b: string): number {
  const ia = a[Symbol.iterator]();
  const ib = b[Symbol.iterator]();
  for (;;) {
    const x = ia.next();
    const y = ib.next();
    if (x.done || y.done) return x.done && y.done ? 0 : x.done ? -1 : 1;
    const cx = x.value.codePointAt(0)!;
    const cy = y.value.codePointAt(0)!;
    if (cx !== cy) return cx < cy ? -1 : 1;
  }
}

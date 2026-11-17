import { afterEach, describe, expect, it, vi } from "vitest";
import { createSignClient } from "./client";

/*
 * The sender routes sit behind Laravel's `web` middleware by default, which
 * refuses a state-changing request without a CSRF token. Laravel sets an
 * `XSRF-TOKEN` cookie and accepts it back as `X-XSRF-TOKEN`; the token changes
 * (on sign-in, for one), so it is read from the cookie on EVERY request rather
 * than fixed when the client is made.
 */

function capture() {
  const sent: Array<Record<string, string>> = [];
  const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((v, k) => {
      headers[k] = v;
    });
    sent.push(headers);
    return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
  return { sent, fetchImpl };
}

function clearCookies() {
  for (const c of document.cookie.split(";")) {
    const name = c.split("=")[0]?.trim();
    if (name) document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
  }
}

afterEach(clearCookies);

describe("XSRF", () => {
  it("sends the XSRF-TOKEN cookie back as X-XSRF-TOKEN on a state-changing request, read fresh each time", async () => {
    const { sent, fetchImpl } = capture();
    const client = createSignClient({ baseUrl: "/fancy-sign", fetch: fetchImpl });

    document.cookie = `XSRF-TOKEN=${encodeURIComponent("first=token/1")}; path=/`;
    await client.sendEnvelope("e1");
    document.cookie = `XSRF-TOKEN=${encodeURIComponent("second")}; path=/`;
    await client.voidEnvelope("e1", "wrong quote");

    expect(sent[0]?.["x-xsrf-token"]).toBe("first=token/1");
    expect(sent[1]?.["x-xsrf-token"]).toBe("second");
  });

  it("sends nothing on a GET, nothing without the cookie, and nothing when turned off", async () => {
    const { sent, fetchImpl } = capture();
    document.cookie = "XSRF-TOKEN=abc; path=/";
    await createSignClient({ baseUrl: "/fancy-sign", fetch: fetchImpl }).getEnvelope("e1");
    await createSignClient({ baseUrl: "/fancy-sign", fetch: fetchImpl, xsrf: false }).sendEnvelope("e1");
    clearCookies();
    await createSignClient({ baseUrl: "/fancy-sign", fetch: fetchImpl }).sendEnvelope("e1");

    expect(sent.map((h) => h["x-xsrf-token"] ?? null)).toEqual([null, null, null]);
  });

  it("never sends the token to another origin", async () => {
    const { sent, fetchImpl } = capture();
    document.cookie = "XSRF-TOKEN=abc; path=/";
    await createSignClient({ baseUrl: "https://other.example.com/fancy-sign", fetch: fetchImpl }).sendEnvelope("e1");

    expect(sent[0]?.["x-xsrf-token"]).toBeUndefined();
  });
});

import { describe, expect, it, vi } from "vitest";
import { SignError, createSignClient, isSignErrorCode } from "./client";

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

function stubFetch(responses: Array<{ status: number; body?: unknown; type?: string }>) {
  const calls: Call[] = [];
  let i = 0;
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((value, key) => {
      headers[key] = value;
    });
    calls.push({ url: String(input), method: init?.method ?? "GET", headers, body: init?.body });
    const next = responses[Math.min(i, responses.length - 1)]!;
    i += 1;
    const type = next.type ?? "application/json";
    const payload =
      next.body === undefined ? null : type === "application/json" ? JSON.stringify(next.body) : (next.body as BodyInit);
    return new Response(payload, { status: next.status, headers: { "content-type": type } });
  });
  return { fetchImpl: fetchImpl as unknown as typeof fetch, calls };
}

/** The kit-wide error envelope (CC-fancy-0031) for a non-422 refusal. */
function errorBody(code: string, message = "nope") {
  return { error: code, message, requestId: "req-1" };
}

/** A 422: validation_failed, with the fancy-sign code as its one item. */
function validationBody(code: string, message = "nope") {
  return { error: "validation_failed", message, errors: [{ error: code, message }], requestId: "req-422" };
}

describe("error mapping (failure paths first)", () => {
  it("reads a 422's fancy-sign code from its one item, and keeps the request id", async () => {
    const { fetchImpl } = stubFetch([{ status: 422, body: validationBody("fields_incomplete", "Complete every field.") }]);
    const client = createSignClient({ baseUrl: "https://app.example.com/fancy-sign", fetch: fetchImpl });
    const failure = (await client.getEnvelope("e1").catch((e: unknown) => e)) as SignError;
    expect(failure.code).toBe("fields_incomplete");
    expect(failure.message).toBe("Complete every field.");
    expect(failure.requestId).toBe("req-422");
  });

  it("keeps the request id of a top-level code", async () => {
    const { fetchImpl } = stubFetch([{ status: 404, body: errorBody("link_invalid", "This link is not valid.") }]);
    const client = createSignClient({ baseUrl: "https://app.example.com/fancy-sign", fetch: fetchImpl });
    const failure = (await client.getEnvelope("e1").catch((e: unknown) => e)) as SignError;
    expect(failure.code).toBe("link_invalid");
    expect(failure.requestId).toBe("req-1");
  });

  it("does not trust a 422 item code outside the closed set", async () => {
    const { fetchImpl } = stubFetch([{ status: 422, body: validationBody("otp_wrong") }]);
    const client = createSignClient({ baseUrl: "https://app.example.com/fancy-sign", fetch: fetchImpl });
    const failure = (await client.getEnvelope("e1").catch((e: unknown) => e)) as SignError;
    expect(failure.code).toBe("unknown_error");
    expect(failure.serverCode).toBe("otp_wrong");
  });

  it("does not read the retired nested {error: {code}} shape as a known code", async () => {
    const { fetchImpl } = stubFetch([{ status: 404, body: { error: { code: "not_found", message: "old" } } }]);
    const client = createSignClient({ baseUrl: "https://app.example.com/fancy-sign", fetch: fetchImpl });
    const failure = (await client.getEnvelope("e1").catch((e: unknown) => e)) as SignError;
    expect(failure.code).toBe("unknown_error");
  });

  it("maps otp_invalid to a SignError with that code and the status", async () => {
    const { fetchImpl } = stubFetch([{ status: 422, body: validationBody("otp_invalid", "Invalid code.") }]);
    const client = createSignClient({ baseUrl: "https://app.example.com/fancy-sign", fetch: fetchImpl });
    const failure = await client.verifyViewCode("tok", "123456").catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(SignError);
    expect((failure as SignError).code).toBe("otp_invalid");
    expect((failure as SignError).status).toBe(422);
    expect((failure as SignError).message).toBe("Invalid code.");
  });

  it("keeps otp_locked distinct from otp_invalid", async () => {
    const { fetchImpl } = stubFetch([{ status: 429, body: errorBody("otp_locked") }]);
    const client = createSignClient({ baseUrl: "https://app.example.com/fancy-sign", fetch: fetchImpl });
    const failure = (await client.verifyViewCode("tok", "123456").catch((e: unknown) => e)) as SignError;
    expect(failure.code).toBe("otp_locked");
    expect(failure.code).not.toBe("otp_invalid");
  });

  it("maps otp_invalid and otp_locked on sign (the accept code) the same way", async () => {
    const { fetchImpl } = stubFetch([
      { status: 422, body: validationBody("otp_invalid") },
      { status: 429, body: errorBody("otp_locked") },
    ]);
    const client = createSignClient({ baseUrl: "https://app.example.com/fancy-sign", fetch: fetchImpl, session: "s1" });
    const input = { fields: {}, mark: { kind: "typed" as const, text: "A" }, adoption: "I adopt", code: "000000" };
    expect(((await client.sign("tok", input).catch((e: unknown) => e)) as SignError).code).toBe("otp_invalid");
    expect(((await client.sign("tok", input).catch((e: unknown) => e)) as SignError).code).toBe("otp_locked");
  });

  it("maps every code in the closed set through unchanged", async () => {
    const codes = [
      "invalid_request", "not_found", "forbidden", "link_invalid", "otp_invalid", "otp_locked", "otp_rate_limited",
      "session_required", "consent_required", "not_viewed", "fields_incomplete", "mark_invalid",
      "envelope_not_open", "envelope_not_draft", "already_signed", "already_declined",
      "step_up_required", "limit_exceeded",
    ];
    for (const code of codes) {
      expect(isSignErrorCode(code)).toBe(true);
      const { fetchImpl } = stubFetch([{ status: 400, body: errorBody(code) }]);
      const client = createSignClient({ baseUrl: "https://app.example.com/fancy-sign", fetch: fetchImpl });
      const failure = (await client.getEnvelope("e1").catch((e: unknown) => e)) as SignError;
      expect(failure.code).toBe(code);
    }
  });

  it("does not trust a code outside the closed set, and keeps the raw one", async () => {
    const { fetchImpl } = stubFetch([{ status: 400, body: errorBody("otp_wrong") }]);
    const client = createSignClient({ baseUrl: "https://app.example.com/fancy-sign", fetch: fetchImpl });
    const failure = (await client.getEnvelope("e1").catch((e: unknown) => e)) as SignError;
    expect(failure.code).toBe("unknown_error");
    expect(failure.serverCode).toBe("otp_wrong");
  });

  it("names a 5xx server_error and a body with no JSON unknown_error", async () => {
    const first = stubFetch([{ status: 503, body: "down", type: "text/plain" }]);
    const a = (await createSignClient({ baseUrl: "https://app.example.com", fetch: first.fetchImpl })
      .listEnvelopes()
      .catch((e: unknown) => e)) as SignError;
    expect(a.code).toBe("server_error");
    expect(a.status).toBe(503);

    const second = stubFetch([{ status: 400, body: "bad", type: "text/plain" }]);
    const b = (await createSignClient({ baseUrl: "https://app.example.com", fetch: second.fetchImpl })
      .listEnvelopes()
      .catch((e: unknown) => e)) as SignError;
    expect(b.code).toBe("unknown_error");
  });

  it("names a rejected fetch network_error", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    }) as unknown as typeof fetch;
    const failure = (await createSignClient({ baseUrl: "https://app.example.com", fetch: fetchImpl })
      .listEnvelopes()
      .catch((e: unknown) => e)) as SignError;
    expect(failure.code).toBe("network_error");
    expect(failure.status).toBe(0);
  });
});

describe("signer session", () => {
  it("stores the session from the view code and sends it on every signer call", async () => {
    const { fetchImpl, calls } = stubFetch([
      { status: 200, body: { session: "sess-1", expires_at: "2026-11-13T12:30:00Z" } },
      { status: 200, body: { envelope: {} } },
    ]);
    const client = createSignClient({ baseUrl: "https://app.example.com/fancy-sign/", fetch: fetchImpl });
    await client.verifyViewCode("tok", "123456");
    expect(client.getSession()).toBe("sess-1");
    await client.getSignerView("tok");

    expect(calls[0]!.url).toBe("https://app.example.com/fancy-sign/s/tok/otp/verify");
    expect(JSON.parse(String(calls[0]!.body))).toEqual({ purpose: "view", code: "123456" });
    expect(calls[1]!.url).toBe("https://app.example.com/fancy-sign/s/tok/envelope");
    expect(calls[1]!.headers["x-fancy-sign-session"]).toBe("sess-1");
  });

  it("url-encodes the link token rather than letting it change the path", async () => {
    const { fetchImpl, calls } = stubFetch([{ status: 202, body: { sent: true, expires_in: 600 } }]);
    const client = createSignClient({ baseUrl: "https://app.example.com/fancy-sign", fetch: fetchImpl });
    await client.requestCode("a/../b", "view");
    expect(calls[0]!.url).toBe("https://app.example.com/fancy-sign/s/a%2F..%2Fb/otp");
  });
});

describe("every endpoint", () => {
  const BASE = "https://app.example.com/fancy-sign";

  it("hits the contract's method and path for each call", async () => {
    const { fetchImpl, calls } = stubFetch([{ status: 200, body: {} }]);
    const client = createSignClient({ baseUrl: BASE, fetch: fetchImpl, session: "s" });
    const input = {
      title: "Quote",
      document: { type: "doc" },
      signers: [],
      fields: [],
      settings: { per_page: "none" as const, step_up: "none" as const, expires_at: null },
    };
    await client.listEnvelopes();
    await client.createEnvelope(input);
    await client.getEnvelope("e1");
    await client.updateEnvelope("e1", input);
    await client.sendEnvelope("e1");
    await client.voidEnvelope("e1", "wrong price");
    await client.remindEnvelope("e1");
    await client.listEvents("e1");
    await client.getCertificate("e1");
    await client.requestCode("t", "accept");
    await client.consent("t", "v2");
    await client.reportPageView("t", 3, 1500);
    await client.sign("t", { fields: { f1: true }, mark: { kind: "typed", text: "A" }, adoption: "I adopt", code: "123456" });
    await client.decline("t", "not mine");
    await client.publicKey();

    expect(calls.map((c) => `${c.method} ${c.url.slice(BASE.length)}`)).toEqual([
      "GET /envelopes",
      "POST /envelopes",
      "GET /envelopes/e1",
      "PUT /envelopes/e1",
      "POST /envelopes/e1/send",
      "POST /envelopes/e1/void",
      "POST /envelopes/e1/remind",
      "GET /envelopes/e1/events",
      "GET /envelopes/e1/certificate?format=json",
      "POST /s/t/otp",
      "POST /s/t/consent",
      "POST /s/t/events",
      "POST /s/t/sign",
      "POST /s/t/decline",
      "GET /public-key",
    ]);
    expect(JSON.parse(String(calls[5]!.body))).toEqual({ reason: "wrong price" });
    expect(JSON.parse(String(calls[9]!.body))).toEqual({ purpose: "accept" });
    expect(JSON.parse(String(calls[10]!.body))).toEqual({ version: "v2" });
    expect(JSON.parse(String(calls[11]!.body))).toEqual({ type: "page.viewed", page: 3, ms: 1500 });
    expect(JSON.parse(String(calls[12]!.body))).toEqual({
      fields: { f1: true },
      mark: { kind: "typed", text: "A" },
      adoption: "I adopt",
      code: "123456",
    });
    expect(JSON.parse(String(calls[13]!.body))).toEqual({ reason: "not mine" });
  });

  it("builds the PDF urls without fetching", () => {
    const client = createSignClient({ baseUrl: BASE });
    expect(client.documentUrl("e1")).toBe(`${BASE}/envelopes/e1/document`);
    expect(client.certificateUrl("e1")).toBe(`${BASE}/envelopes/e1/certificate`);
  });

  it("fetches the signer's as-sent PDF as a Blob with the session header", async () => {
    const { fetchImpl, calls } = stubFetch([{ status: 200, body: "%PDF-1.7", type: "application/pdf" }]);
    const client = createSignClient({ baseUrl: BASE, fetch: fetchImpl, session: "s9" });
    const blob = await client.signerDocument("t");
    expect(blob.type).toBe("application/pdf");
    expect(calls[0]!.url).toBe(`${BASE}/s/t/document`);
    expect(calls[0]!.headers["x-fancy-sign-session"]).toBe("s9");
  });

  it("posts verify as multipart with the completion as JSON and optional events", async () => {
    const result = { ok: false, reason: "seal_invalid", checks: { seal: false, token: null, final_hash: null, prefix: null, chain: null } };
    const { fetchImpl, calls } = stubFetch([{ status: 200, body: result }]);
    const client = createSignClient({ baseUrl: BASE, fetch: fetchImpl });
    const pdf = new Blob(["%PDF"], { type: "application/pdf" });
    const answer = await client.verify({ pdf, completion: { token: "fsig_v1_x" }, events: [] });
    expect(answer).toEqual(result);
    expect(calls[0]!.url).toBe(`${BASE}/verify`);
    const body = calls[0]!.body as FormData;
    expect(body).toBeInstanceOf(FormData);
    expect(body.get("pdf")).toBeInstanceOf(Blob);
    expect(body.get("completion")).toBe(JSON.stringify({ token: "fsig_v1_x" }));
    expect(body.get("events")).toBe("[]");
    // The browser must set the multipart boundary, so no content-type is forced.
    expect(calls[0]!.headers["content-type"]).toBeUndefined();
  });

  it("sends a picked completion.json and events file as string fields, not file parts", async () => {
    const result = { ok: true, reason: null, checks: { seal: true, token: true, final_hash: true, prefix: true, chain: true } };
    const { fetchImpl, calls } = stubFetch([{ status: 200, body: result }]);
    const client = createSignClient({ baseUrl: BASE, fetch: fetchImpl });
    await client.verify({
      pdf: new Blob(["%PDF"], { type: "application/pdf" }),
      completion: new Blob(['{"token":"fsig_v1_y"}'], { type: "application/json" }),
      events: new Blob(["[]"], { type: "application/json" }),
    });
    const body = calls[0]!.body as FormData;
    expect(body.get("completion")).toBe('{"token":"fsig_v1_y"}');
    expect(body.get("events")).toBe("[]");
  });
});

describe("data mode (CC-fancy-0052)", () => {
  const BASE_D = "https://app.example.com/fancy-sign";

  it("knows the data-mode codes as members of the closed set", () => {
    for (const code of ["data_hash_mismatch", "data_external_reference", "envelope_not_completed", "final_already_attached"]) {
      expect(isSignErrorCode(code)).toBe(true);
    }
  });

  it("fetches the signer's data as TEXT with its hash header, never parsed by the client", async () => {
    const text = '{"a":[true,null,"x"],"b":1}';
    const fetchImpl = vi.fn(async () =>
      new Response(text, { status: 200, headers: { "content-type": "application/json", "x-fancy-sign-data-sha256": "ab".repeat(32) } }),
    ) as unknown as typeof fetch;
    const client = createSignClient({ baseUrl: BASE_D, fetch: fetchImpl, session: "s9" });
    const got = await client.signerData("t");
    expect(got).toEqual({ text, sha256: "ab".repeat(32) });
    const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0]! as [string, RequestInit];
    expect(url).toBe(`${BASE_D}/s/t/document`);
    expect(new Headers(init.headers).get("x-fancy-sign-session")).toBe("s9");
  });

  it("posts the rendering claim as a document.rendered event", async () => {
    const { fetchImpl, calls } = stubFetch([{ status: 202, body: { recorded: true } }]);
    const client = createSignClient({ baseUrl: BASE_D, fetch: fetchImpl, session: "s9" });
    await client.reportRendered("t", { data_sha256: "9".repeat(64), renderer: "quote-v7 @ shop 1", pages: 2 });
    expect(calls[0]!.url).toBe(`${BASE_D}/s/t/events`);
    expect(calls[0]!.method).toBe("POST");
    expect(JSON.parse(String(calls[0]!.body))).toEqual({ type: "document.rendered", data_sha256: "9".repeat(64), renderer: "quote-v7 @ shop 1", pages: 2 });
  });

  it("hits the sender's invite, signatures and final routes", async () => {
    const { fetchImpl, calls } = stubFetch([{ status: 200, body: {} }]);
    const client = createSignClient({ baseUrl: BASE_D, fetch: fetchImpl });
    await client.inviteSigner("e 1", "alice");
    await client.getSignatures("e 1");
    await client.attachFinal("e 1", { sha256: "f".repeat(64), bytes: 1234 });
    expect(calls.map((c) => `${c.method} ${c.url.slice(BASE_D.length)}`)).toEqual([
      "POST /envelopes/e%201/signers/alice/invite",
      "GET /envelopes/e%201/signatures",
      "POST /envelopes/e%201/final",
    ]);
    expect(JSON.parse(String(calls[2]!.body))).toEqual({ sha256: "f".repeat(64), bytes: 1234 });
  });
});

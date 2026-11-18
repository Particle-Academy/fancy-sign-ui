import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { SignError, createSignClient, type SignClient } from "./client";
import { SignerCeremony, initialCeremonyState, type SignerCeremonyState } from "./SignerCeremony";
import { EnvelopeTimeline } from "./EnvelopeTimeline";
import type { SignActivityEvent, SignEvent, SignerView } from "./types";

/*
 * Request changes (fancy-sign 0.3.0 / fancy-sign-ui 0.2.0): beside Decline,
 * the signer sends a required, bounded message. The envelope stays open:
 * after a request the signer can still sign or decline.
 */

afterEach(cleanup);
beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:as-sent");
  vi.spyOn(URL, "revokeObjectURL").mockReturnValue(undefined);
});

function q<T extends HTMLElement = HTMLElement>(selector: string): T {
  const el = document.querySelector<T>(selector);
  if (!el) throw new Error(`nothing matches ${selector}`);
  return el;
}

function view(asked = 0): SignerView {
  return {
    envelope: { id: "env1", title: "Quote 42", status: "sent", pages: 1 },
    signer: { id: "sg1", name: "Ada", email: "ada@example.com", status: "viewed", consent_at: "2026-11-18T12:00:00Z", signed_at: null, declined_at: null },
    consent: { required: false, text: "I agree.", version: "1" },
    adoption_text: "I adopt this.",
    fields: [],
    changes_requested: asked,
    max_change_requests: 2,
  };
}

function client(overrides: Partial<SignClient> = {}): SignClient {
  return {
    signerDocument: vi.fn(async () => new Blob(["%PDF"], { type: "application/pdf" })),
    reportPageView: vi.fn(async () => undefined),
    requestChanges: vi.fn(async () => view(1)),
    ...overrides,
  } as unknown as SignClient;
}

function Harness({ c, initial, onActivity }: { c: SignClient; initial: SignerCeremonyState; onActivity?: (e: SignActivityEvent) => void }) {
  const [state, setState] = useState(initial);
  return <SignerCeremony client={c} token="tok" value={state} onChange={setState} onActivity={onActivity} />;
}

const review = (asked = 0): SignerCeremonyState => ({ ...initialCeremonyState(), step: "review", view: view(asked) });

describe("request changes in the ceremony", () => {
  it("opens a required message beside Decline, sends it, and stays in review so the signer can still sign", async () => {
    const c = client();
    const activity: SignActivityEvent[] = [];
    render(<Harness c={c} initial={review()} onActivity={(e) => activity.push(e)} />);

    act(() => q<HTMLButtonElement>('[data-fancy-sign-action="start-request-changes"]').click());
    const send = q<HTMLButtonElement>('[data-fancy-sign-action="confirm-request-changes"]');
    expect(send.disabled).toBe(true);

    fireEvent.change(q<HTMLTextAreaElement>("[data-fancy-sign-changes-text]"), { target: { value: "  Please itemise the delivery.  " } });
    await act(async () => q<HTMLButtonElement>('[data-fancy-sign-action="confirm-request-changes"]').click());

    expect(c.requestChanges).toHaveBeenCalledWith("tok", "Please itemise the delivery.");
    await waitFor(() => expect(document.querySelector("[data-fancy-sign-changes-sent]")).not.toBeNull());
    expect(q("[data-fancy-sign-surface]").getAttribute("data-fancy-sign-step")).toBe("review");
    expect(document.querySelector('[data-fancy-sign-action="sign"]')).not.toBeNull();
    expect(document.querySelector("[data-fancy-sign-changes-text]")).toBeNull();
    // Activity says it happened, never what the signer wrote.
    const event = activity.find((e) => e.action === "changes-requested");
    expect(event).toBeDefined();
    expect(JSON.stringify(event)).not.toContain("itemise");
  });

  it("can be cancelled without sending anything", () => {
    const c = client();
    render(<Harness c={c} initial={review()} />);
    act(() => q<HTMLButtonElement>('[data-fancy-sign-action="start-request-changes"]').click());
    act(() => q<HTMLButtonElement>('[data-fancy-sign-action="cancel-request-changes"]').click());

    expect(c.requestChanges).not.toHaveBeenCalled();
    expect(document.querySelector("[data-fancy-sign-changes-text]")).toBeNull();
  });

  it("bounds the message at maxDeclineReason, like a decline reason", () => {
    render(<SignerCeremony client={client()} token="tok" defaultValue={review()} maxDeclineReason={10} />);
    act(() => q<HTMLButtonElement>('[data-fancy-sign-action="start-request-changes"]').click());
    fireEvent.change(q<HTMLTextAreaElement>("[data-fancy-sign-changes-text]"), { target: { value: "x".repeat(25) } });

    expect(q<HTMLTextAreaElement>("[data-fancy-sign-changes-text]").value).toHaveLength(10);
  });

  it("disables the request once the cap is reached, and says so", () => {
    render(<Harness c={client()} initial={review(2)} />);

    expect(q<HTMLButtonElement>('[data-fancy-sign-action="start-request-changes"]').disabled).toBe(true);
    expect(document.querySelector("[data-fancy-sign-changes-cap]")).not.toBeNull();
  });

  it("shows a refusal from the server, and keeps the message so nothing typed is lost", async () => {
    const c = client({ requestChanges: vi.fn(async () => { throw new SignError("limit_exceeded", "You have asked for changes as many times as this envelope allows.", 429); }) });
    render(<Harness c={c} initial={review()} />);
    act(() => q<HTMLButtonElement>('[data-fancy-sign-action="start-request-changes"]').click());
    fireEvent.change(q<HTMLTextAreaElement>("[data-fancy-sign-changes-text]"), { target: { value: "Again." } });
    await act(async () => q<HTMLButtonElement>('[data-fancy-sign-action="confirm-request-changes"]').click());

    await waitFor(() => expect(document.querySelector('[data-fancy-sign-error="limit_exceeded"]')).not.toBeNull());
    expect(q<HTMLTextAreaElement>("[data-fancy-sign-changes-text]").value).toBe("Again.");
  });
});

describe("client.requestChanges", () => {
  it("posts the text to /s/{token}/request-changes with the signer session", async () => {
    const calls: Array<{ url: string; method: string; headers: Record<string, string>; body: unknown }> = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const headers: Record<string, string> = {};
      new Headers(init?.headers).forEach((v, k) => {
        headers[k] = v;
      });
      calls.push({ url: String(input), method: init?.method ?? "GET", headers, body: init?.body });
      return new Response(JSON.stringify(view(1)), { status: 200, headers: { "content-type": "application/json" } });
    }) as unknown as typeof fetch;
    const c = createSignClient({ baseUrl: "https://app.example.com/fancy-sign", fetch: fetchImpl, session: "s1" });

    const answer = await c.requestChanges("tok", "Please itemise.");

    expect(calls[0]).toMatchObject({ url: "https://app.example.com/fancy-sign/s/tok/request-changes", method: "POST", body: JSON.stringify({ text: "Please itemise." }) });
    expect(calls[0]?.headers["x-fancy-sign-session"]).toBe("s1");
    expect(answer.changes_requested).toBe(1);
  });
});

describe("EnvelopeTimeline", () => {
  it("shows a request for changes with its text, as plain text", () => {
    const hostile = '<b>change</b> the date';
    const event: SignEvent = {
      envelope_id: "env1", seq: 9, at: "2026-11-18T12:09:00Z", type: "signer.requested_changes", actor: "signer:sg1", source: "server",
      ip: "192.0.2.10", user_agent: "Test", data: { text: hostile }, prev_hash: "0".repeat(64), hash: "9".repeat(64),
    };
    render(<EnvelopeTimeline events={[event]} />);

    const text = q("[data-fancy-sign-event-reason]");
    expect(text.textContent).toBe(hostile);
    expect(text.querySelector("b")).toBeNull();
    expect(q('[data-fancy-sign-event="9"]').textContent).toContain("Changes requested");
  });
});

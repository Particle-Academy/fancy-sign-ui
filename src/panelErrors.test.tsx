import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { SignError, type SignClient } from "./client";
import { SignerCeremony, initialCeremonyState, type SignerCeremonyState } from "./SignerCeremony";
import type { SignerView } from "./types";

/*
 * CC-fancy-0046. An error caused by a panel action renders INSIDE that panel,
 * beside the control that caused it, announced (role="alert") and with focus
 * returned to the control. It used to render as a banner at the top of the
 * ceremony, above a 70vh document viewer, so a signer pressing Sign at the
 * bottom saw nothing happen. The top banner is for ceremony-level errors only.
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

function view(consentAt: string | null = "2026-11-18T12:00:00Z"): SignerView {
  return {
    envelope: { id: "env1", title: "Quote 42", status: "sent", pages: 1 },
    signer: { id: "sg1", name: "Ada", email: "ada@example.com", status: "viewed", consent_at: consentAt, signed_at: null, declined_at: null },
    consent: { required: true, text: "I agree.", version: "v3" },
    adoption_text: "I adopt this.",
    fields: [],
    changes_requested: 0,
    max_change_requests: 2,
  };
}

function refuse(code: string, status = 422) {
  return vi.fn(async () => {
    throw new SignError(code as never, `server said ${code}`, status);
  });
}

function client(overrides: Partial<SignClient> = {}): SignClient {
  return {
    requestCode: vi.fn(async () => ({ sent: true as const, expires_in: 600 })),
    verifyViewCode: vi.fn(async () => ({ session: "s", expires_at: "2026-11-18T12:30:00Z" })),
    getSignerView: vi.fn(async () => view()),
    consent: vi.fn(async () => view()),
    signerDocument: vi.fn(async () => new Blob(["%PDF"], { type: "application/pdf" })),
    reportPageView: vi.fn(async () => undefined),
    sign: vi.fn(async () => view()),
    decline: vi.fn(async () => view()),
    requestChanges: vi.fn(async () => view()),
    ...overrides,
  } as unknown as SignClient;
}

let last: SignerCeremonyState | null = null;

function Harness({ c, initial }: { c: SignClient; initial: SignerCeremonyState }) {
  const [state, setState] = useState(initial);
  return (
    <SignerCeremony
      client={c}
      token="tok"
      value={state}
      onChange={(next) => {
        last = next;
        setState(next);
      }}
    />
  );
}

const READY: Partial<SignerCeremonyState> = {
  mark: { kind: "typed", text: "Ada" },
  acceptCodeSent: true,
  acceptCode: "654321",
};

const review = (patch: Partial<SignerCeremonyState> = {}): SignerCeremonyState => ({
  ...initialCeremonyState(),
  step: "review",
  view: view(),
  ...patch,
});

const click = (action: string) =>
  act(async () => q<HTMLButtonElement>(`[data-fancy-sign-action="${action}"]`).click());

/** The error element for `code`, asserting it is inside `panel` and announced. */
async function errorIn(panelSelector: string, code: string): Promise<HTMLElement> {
  await waitFor(() => expect(document.querySelector(`[data-fancy-sign-error="${code}"]`)).not.toBeNull());
  const errors = document.querySelectorAll<HTMLElement>("[data-fancy-sign-error]");
  expect(errors).toHaveLength(1);
  const el = errors[0]!;
  expect(el.closest(panelSelector)).not.toBeNull();
  expect(el.getAttribute("role")).toBe("alert");
  expect(el.textContent?.length).toBeGreaterThan(0);
  return el;
}

/** No error is rendered as a direct child of the ceremony root (the top banner). */
function noBanner() {
  expect(document.querySelector("[data-fancy-sign-surface] > [data-fancy-sign-error]")).toBeNull();
}

describe("a wrong signing code", () => {
  it("renders inside the sign panel by the code boxes, announced, focuses the first box, and shows no top banner", async () => {
    render(<Harness c={client({ sign: refuse("otp_invalid") })} initial={review(READY)} />);
    await click("sign");

    const el = await errorIn('[data-fancy-sign-panel="sign"]', "otp_invalid");
    expect(el.getAttribute("data-fancy-sign-error-panel")).toBe("sign");
    noBanner();
    await waitFor(() => expect(document.activeElement).toBe(q('[data-fancy-sign-code="accept"] input')));
    expect(last!.step).toBe("review");
    expect(last!.acceptCode).toBe("");
  });

  it("a locked code focuses the request-code button, since the boxes are gone", async () => {
    render(<Harness c={client({ sign: refuse("otp_locked", 429) })} initial={review(READY)} />);
    await click("sign");

    await errorIn('[data-fancy-sign-panel="sign"]', "otp_locked");
    noBanner();
    await waitFor(() => expect(document.activeElement).toBe(q('[data-fancy-sign-action="request-accept-code"]')));
  });

  it("clears on the next attempt", async () => {
    let attempts = 0;
    const sign = vi.fn(async () => {
      attempts += 1;
      if (attempts === 1) throw new SignError("otp_invalid", "bad", 422);
      return new Promise<SignerView>(() => undefined); // the second attempt is in flight
    });
    render(<Harness c={client({ sign })} initial={review(READY)} />);
    await click("sign");
    await errorIn('[data-fancy-sign-panel="sign"]', "otp_invalid");

    const inputs = document.querySelectorAll<HTMLInputElement>('[data-fancy-sign-code="accept"] input');
    "123456".split("").forEach((digit, i) => fireEvent.change(inputs[i]!, { target: { value: digit } }));
    await click("sign");

    expect(sign).toHaveBeenCalledTimes(2);
    expect(document.querySelector("[data-fancy-sign-error]")).toBeNull();
  });
});

describe("every other panel failure renders in its panel", () => {
  it("requesting a signing code", async () => {
    render(<Harness c={client({ requestCode: refuse("otp_rate_limited", 429) })} initial={review()} />);
    await click("request-accept-code");

    await errorIn('[data-fancy-sign-panel="sign"]', "otp_rate_limited");
    noBanner();
    await waitFor(() => expect(document.activeElement).toBe(q('[data-fancy-sign-action="request-accept-code"]')));
  });

  it("a wrong view code: in the code panel, focus on the first code box", async () => {
    render(
      <Harness
        c={client({ verifyViewCode: refuse("otp_invalid") })}
        initial={{ ...initialCeremonyState(), viewCodeSent: true, viewCode: "111111" }}
      />,
    );
    await click("verify-view-code");

    const el = await errorIn('[data-fancy-sign-panel="code"]', "otp_invalid");
    expect(el.getAttribute("data-fancy-sign-error-panel")).toBe("code");
    noBanner();
    await waitFor(() => expect(document.activeElement).toBe(q('[data-fancy-sign-code="view"] input')));
  });

  it("requesting a view code", async () => {
    render(<Harness c={client({ requestCode: refuse("link_invalid", 404) })} initial={initialCeremonyState()} />);
    await click("request-view-code");

    await errorIn('[data-fancy-sign-panel="code"]', "link_invalid");
    noBanner();
    await waitFor(() => expect(document.activeElement).toBe(q('[data-fancy-sign-action="request-view-code"]')));
  });

  it("accepting consent", async () => {
    render(
      <Harness
        c={client({ consent: refuse("consent_required") })}
        initial={{ ...initialCeremonyState(), step: "consent", view: view(null), consentChecked: true }}
      />,
    );
    await click("accept-consent");

    await errorIn('[data-fancy-sign-panel="consent"]', "consent_required");
    noBanner();
    await waitFor(() => expect(document.activeElement).toBe(q('[data-fancy-sign-action="accept-consent"]')));
  });

  it("requesting changes: inside the request group, focus on the message", async () => {
    render(<Harness c={client({ requestChanges: refuse("limit_exceeded", 429) })} initial={review()} />);
    act(() => q<HTMLButtonElement>('[data-fancy-sign-action="start-request-changes"]').click());
    fireEvent.change(q<HTMLTextAreaElement>("[data-fancy-sign-changes-text]"), { target: { value: "Again." } });
    await click("confirm-request-changes");

    const el = await errorIn('[role="group"][aria-label="Request changes"]', "limit_exceeded");
    expect(el.getAttribute("data-fancy-sign-error-panel")).toBe("request-changes");
    noBanner();
    await waitFor(() => expect(document.activeElement).toBe(q("[data-fancy-sign-changes-text]")));
  });

  it("declining: inside the decline group, focus on the reason", async () => {
    render(<Harness c={client({ decline: refuse("envelope_not_open", 409) })} initial={review()} />);
    act(() => q<HTMLButtonElement>('[data-fancy-sign-action="start-decline"]').click());
    fireEvent.change(q<HTMLTextAreaElement>("[data-fancy-sign-decline-reason]"), { target: { value: "No." } });
    await click("confirm-decline");

    const el = await errorIn('[role="group"][aria-label="Decline to sign"]', "envelope_not_open");
    expect(el.getAttribute("data-fancy-sign-error-panel")).toBe("decline");
    noBanner();
    await waitFor(() => expect(document.activeElement).toBe(q("[data-fancy-sign-decline-reason]")));
  });
});

describe("closing a panel takes its error with it", () => {
  it("Go back from a failed decline clears the error instead of moving it to the banner", async () => {
    render(<Harness c={client({ decline: refuse("envelope_not_open", 409) })} initial={review()} />);
    act(() => q<HTMLButtonElement>('[data-fancy-sign-action="start-decline"]').click());
    fireEvent.change(q<HTMLTextAreaElement>("[data-fancy-sign-decline-reason]"), { target: { value: "No." } });
    await click("confirm-decline");
    await errorIn('[role="group"][aria-label="Decline to sign"]', "envelope_not_open");

    act(() => q<HTMLButtonElement>('[data-fancy-sign-action="cancel-decline"]').click());
    expect(document.querySelector("[data-fancy-sign-error]")).toBeNull();
    expect(last!.error).toBeNull();
  });
});

describe("ceremony-level errors keep the top banner", () => {
  it("a document load failure shows as the banner, announced, not inside a panel", async () => {
    render(<Harness c={client({ signerDocument: refuse("session_required", 401) })} initial={review()} />);

    await waitFor(() => expect(document.querySelector('[data-fancy-sign-error="session_required"]')).not.toBeNull());
    const el = q('[data-fancy-sign-error="session_required"]');
    expect(el.parentElement?.hasAttribute("data-fancy-sign-surface")).toBe(true);
    expect(el.closest("[data-fancy-sign-panel]")).toBeNull();
    expect(el.getAttribute("role")).toBe("alert");
    expect(el.hasAttribute("data-fancy-sign-error-panel")).toBe(false);
  });

  it("a host-restored error with no panel still shows as the banner", () => {
    render(<Harness c={client()} initial={{ ...initialCeremonyState(), status: "error", error: { code: "link_invalid", message: "x" } }} />);

    const el = q('[data-fancy-sign-error="link_invalid"]');
    expect(el.parentElement?.hasAttribute("data-fancy-sign-surface")).toBe(true);
  });
});

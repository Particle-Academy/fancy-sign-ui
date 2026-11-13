import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { SignError, type SignClient } from "./client";
import {
  SignerCeremony,
  initialCeremonyState,
  signBlockers,
  type SignerCeremonyProps,
  type SignerCeremonyState,
} from "./SignerCeremony";
import type { Field, SignActivityEvent, SignerView } from "./types";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  // Node's URL.createObjectURL rejects jsdom's Blob; a browser would not.
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:as-sent");
  vi.spyOn(URL, "revokeObjectURL").mockReturnValue(undefined);
});

function field(id: string, kind: Field["kind"], required = true): Field {
  return {
    id,
    signer_id: "sg1",
    kind,
    anchor: { final_page: true },
    required,
    label: null,
    placement: [{ page: 2, rect: [10, 10, 200, 60] }],
    completed: false,
  };
}

function view(overrides: Partial<SignerView> = {}): SignerView {
  return {
    envelope: { id: "env1", title: "Quote 42", status: "sent", pages: 2 },
    signer: { id: "sg1", name: "Ada", email: "ada@example.com", status: "viewed", consent_at: null, signed_at: null, declined_at: null },
    consent: { required: true, text: "I agree to use electronic records.", version: "v3" },
    adoption_text: "I adopt this as my signature.",
    fields: [field("f-sig", "signature"), field("f-date", "date_signed"), field("f-opt", "initials", false)],
    ...overrides,
  };
}

function consented(): SignerView {
  const v = view();
  return { ...v, signer: { ...v.signer, consent_at: "2026-11-13T12:00:00Z" } };
}

function fakeClient(overrides: Partial<SignClient> = {}): SignClient {
  const base: Partial<SignClient> = {
    requestCode: vi.fn(async () => ({ sent: true as const, expires_in: 600 })),
    verifyViewCode: vi.fn(async () => ({ session: "s", expires_at: "2026-11-13T12:30:00Z" })),
    getSignerView: vi.fn(async () => view()),
    consent: vi.fn(async () => consented()),
    signerDocument: vi.fn(async () => new Blob(["%PDF"], { type: "application/pdf" })),
    reportPageView: vi.fn(async () => undefined),
    sign: vi.fn(async () => {
      const v = consented();
      return { ...v, signer: { ...v.signer, status: "signed" as const, signed_at: "2026-11-13T12:05:00Z" } };
    }),
    decline: vi.fn(async () => {
      const v = consented();
      return { ...v, signer: { ...v.signer, status: "declined" as const, declined_at: "2026-11-13T12:05:00Z" } };
    }),
  };
  return { ...base, ...overrides } as SignClient;
}

function reviewState(patch: Partial<SignerCeremonyState> = {}): SignerCeremonyState {
  return { ...initialCeremonyState(), step: "review", view: consented(), ...patch };
}

const READY: Partial<SignerCeremonyState> = {
  completedFields: ["f-sig", "f-date"],
  mark: { kind: "typed", text: "Ada" },
  acceptCodeSent: true,
  acceptCode: "654321",
};

function Harness({
  initial,
  onState,
  ...props
}: { initial: SignerCeremonyState; onState?: (s: SignerCeremonyState) => void } & Omit<SignerCeremonyProps, "value" | "onChange">) {
  const [state, setState] = useState(initial);
  return (
    <SignerCeremony
      {...props}
      value={state}
      onChange={(next) => {
        onState?.(next);
        setState(next);
      }}
    />
  );
}

function q<T extends HTMLElement = HTMLElement>(selector: string): T {
  const el = document.querySelector<T>(selector);
  if (!el) throw new Error(`nothing matches ${selector}`);
  return el;
}

const signButton = () => q<HTMLButtonElement>('[data-fancy-sign-action="sign"]');

describe("code gate (failure paths first)", () => {
  it("shows otp_invalid, keeps the code request, and clears the wrong code", async () => {
    const client = fakeClient({
      verifyViewCode: vi.fn(async () => {
        throw new SignError("otp_invalid", "Invalid code.", 422);
      }),
    });
    let last: SignerCeremonyState | null = null;
    render(
      <Harness
        client={client}
        token="tok"
        initial={{ ...initialCeremonyState(), viewCodeSent: true, viewCode: "111111" }}
        onState={(s) => (last = s)}
      />,
    );
    await act(async () => q<HTMLButtonElement>('[data-fancy-sign-action="verify-view-code"]').click());
    await waitFor(() => expect(document.querySelector('[data-fancy-sign-error="otp_invalid"]')).not.toBeNull());
    expect(last!.step).toBe("code");
    expect(last!.viewCodeSent).toBe(true);
    expect(last!.viewCode).toBe("");
  });

  it("on otp_locked tells the signer to request a new code and resets the request", async () => {
    const client = fakeClient({
      verifyViewCode: vi.fn(async () => {
        throw new SignError("otp_locked", "Locked.", 429);
      }),
    });
    let last: SignerCeremonyState | null = null;
    render(
      <Harness
        client={client}
        token="tok"
        initial={{ ...initialCeremonyState(), viewCodeSent: true, viewCode: "111111" }}
        onState={(s) => (last = s)}
      />,
    );
    await act(async () => q<HTMLButtonElement>('[data-fancy-sign-action="verify-view-code"]').click());
    await waitFor(() => expect(document.querySelector('[data-fancy-sign-error="otp_locked"]')).not.toBeNull());
    expect(last!.viewCodeSent).toBe(false);
    expect(q('[data-fancy-sign-error="otp_locked"]').textContent).toMatch(/new code/i);
  });

  it("will not verify fewer than 6 digits", () => {
    render(
      <Harness client={fakeClient()} token="tok" initial={{ ...initialCeremonyState(), viewCodeSent: true, viewCode: "12345" }} />,
    );
    expect(q<HTMLButtonElement>('[data-fancy-sign-action="verify-view-code"]').disabled).toBe(true);
  });

  it("requests a view code, takes 6 typed digits, verifies, and moves to consent", async () => {
    const client = fakeClient();
    let last: SignerCeremonyState | null = null;
    render(<Harness client={client} token="tok" initial={initialCeremonyState()} onState={(s) => (last = s)} />);
    await act(async () => q<HTMLButtonElement>('[data-fancy-sign-action="request-view-code"]').click());
    expect(client.requestCode).toHaveBeenCalledWith("tok", "view");

    const inputs = document.querySelectorAll<HTMLInputElement>('[data-fancy-sign-code="view"] input');
    expect(inputs).toHaveLength(6);
    "482913".split("").forEach((digit, i) => fireEvent.change(inputs[i]!, { target: { value: digit } }));
    expect(last!.viewCode).toBe("482913");

    await act(async () => q<HTMLButtonElement>('[data-fancy-sign-action="verify-view-code"]').click());
    await waitFor(() => expect(last!.step).toBe("consent"));
    expect(client.verifyViewCode).toHaveBeenCalledWith("tok", "482913");
  });
});

describe("consent", () => {
  it("cannot continue until the box is ticked, then sends the disclosure version", async () => {
    const client = fakeClient();
    let last: SignerCeremonyState | null = null;
    render(
      <Harness client={client} token="tok" initial={{ ...initialCeremonyState(), step: "consent", view: view() }} onState={(s) => (last = s)} />,
    );
    const accept = q<HTMLButtonElement>('[data-fancy-sign-action="accept-consent"]');
    expect(accept.disabled).toBe(true);
    expect(q('[data-fancy-sign-consent-text]').textContent).toBe("I agree to use electronic records.");

    act(() => q<HTMLInputElement>('[data-fancy-sign-consent-check] input').click());
    expect(q<HTMLButtonElement>('[data-fancy-sign-action="accept-consent"]').disabled).toBe(false);
    await act(async () => q<HTMLButtonElement>('[data-fancy-sign-action="accept-consent"]').click());
    expect(client.consent).toHaveBeenCalledWith("tok", "v3");
    await waitFor(() => expect(last!.step).toBe("review"));
  });
});

describe("Sign is disabled until everything is in place", () => {
  it("blocks without consent", () => {
    expect(signBlockers(reviewState({ ...READY, view: view() }))).toContain("consent");
  });

  it("blocks with a required field incomplete, and ignores optional ones", () => {
    const missing = reviewState({ ...READY, completedFields: ["f-sig"] });
    expect(signBlockers(missing)).toEqual(["fields"]);
    render(<Harness client={fakeClient()} token="tok" initial={missing} />);
    expect(signButton().disabled).toBe(true);
    cleanup();

    render(<Harness client={fakeClient()} token="tok" initial={reviewState(READY)} />);
    expect(signButton().disabled).toBe(false);
  });

  it("blocks without a mark, or with a blank typed mark", () => {
    expect(signBlockers(reviewState({ ...READY, mark: null }))).toEqual(["mark"]);
    expect(signBlockers(reviewState({ ...READY, mark: { kind: "typed", text: "  " } }))).toEqual(["mark"]);
    render(<Harness client={fakeClient()} token="tok" initial={reviewState({ ...READY, mark: null })} />);
    expect(signButton().disabled).toBe(true);
  });

  it("blocks without a 6-digit accept code", () => {
    for (const acceptCode of ["", "12345", "12a456", "1234567"]) {
      expect(signBlockers(reviewState({ ...READY, acceptCode }))).toEqual(["accept_code"]);
    }
    render(<Harness client={fakeClient()} token="tok" initial={reviewState({ ...READY, acceptCode: "123" })} />);
    expect(signButton().disabled).toBe(true);
  });

  it("blocks when the envelope is no longer open", () => {
    const v = consented();
    const closed = reviewState({ ...READY, view: { ...v, envelope: { ...v.envelope, status: "voided" } } });
    expect(signBlockers(closed)).toContain("envelope_not_open");
  });

  it("signature fields cannot be completed before a mark exists", () => {
    render(<Harness client={fakeClient()} token="tok" initial={reviewState({ ...READY, completedFields: [], mark: null })} />);
    const sig = q<HTMLButtonElement>('[data-fancy-sign-action="complete-field"][data-fancy-sign-field-id="f-sig"]');
    expect(sig.disabled).toBe(true);
    const date = q<HTMLButtonElement>('[data-fancy-sign-action="complete-field"][data-fancy-sign-field-id="f-date"]');
    expect(date.disabled).toBe(false);
  });

  it("signs with the completed fields, the mark, the adoption text and the fresh code", async () => {
    const client = fakeClient();
    const activity: SignActivityEvent[] = [];
    let last: SignerCeremonyState | null = null;
    render(
      <Harness client={client} token="tok" initial={reviewState(READY)} onState={(s) => (last = s)} onActivity={(e) => activity.push(e)} />,
    );
    await act(async () => signButton().click());
    expect(client.sign).toHaveBeenCalledWith("tok", {
      fields: { "f-sig": true, "f-date": true },
      mark: { kind: "typed", text: "Ada" },
      adoption: "I adopt this as my signature.",
      code: "654321",
    });
    await waitFor(() => expect(last!.step).toBe("signed"));
    expect(last!.acceptCode).toBe("");
    // No activity event may carry a one-time code.
    expect(JSON.stringify(activity)).not.toContain("654321");
    expect(activity.some((e) => e.action === "signed")).toBe(true);
  });

  it("a wrong accept code clears it and keeps the request", async () => {
    const client = fakeClient({
      sign: vi.fn(async () => {
        throw new SignError("otp_invalid", "bad", 422);
      }),
    });
    let last: SignerCeremonyState | null = null;
    render(<Harness client={client} token="tok" initial={reviewState(READY)} onState={(s) => (last = s)} />);
    await act(async () => signButton().click());
    await waitFor(() => expect(document.querySelector('[data-fancy-sign-error="otp_invalid"]')).not.toBeNull());
    expect(last!.acceptCode).toBe("");
    expect(last!.acceptCodeSent).toBe(true);
    expect(last!.step).toBe("review");
  });

  it("a locked accept code resets the request, so the signer asks for a new one", async () => {
    const client = fakeClient({
      sign: vi.fn(async () => {
        throw new SignError("otp_locked", "locked", 429);
      }),
    });
    let last: SignerCeremonyState | null = null;
    render(<Harness client={client} token="tok" initial={reviewState(READY)} onState={(s) => (last = s)} />);
    await act(async () => signButton().click());
    await waitFor(() => expect(document.querySelector('[data-fancy-sign-error="otp_locked"]')).not.toBeNull());
    expect(last!.acceptCode).toBe("");
    expect(last!.acceptCodeSent).toBe(false);
    expect(q('[data-fancy-sign-action="request-accept-code"]')).toBeTruthy();
  });
});

describe("decline requires a reason", () => {
  it("cannot confirm with an empty or blank reason, and sends the trimmed one", async () => {
    const client = fakeClient();
    let last: SignerCeremonyState | null = null;
    render(<Harness client={client} token="tok" initial={reviewState()} onState={(s) => (last = s)} />);
    act(() => q<HTMLButtonElement>('[data-fancy-sign-action="start-decline"]').click());
    const confirm = () => q<HTMLButtonElement>('[data-fancy-sign-action="confirm-decline"]');
    expect(confirm().disabled).toBe(true);

    const reason = q<HTMLTextAreaElement>('[data-fancy-sign-decline-reason]');
    fireEvent.change(reason, { target: { value: "    " } });
    expect(confirm().disabled).toBe(true);

    fireEvent.change(reason, { target: { value: "  The price is wrong.  " } });
    expect(confirm().disabled).toBe(false);
    await act(async () => confirm().click());
    expect(client.decline).toHaveBeenCalledWith("tok", "The price is wrong.");
    await waitFor(() => expect(last!.step).toBe("declined"));
  });

  it("can be backed out of without declining", () => {
    const client = fakeClient();
    render(<Harness client={client} token="tok" initial={reviewState()} />);
    act(() => q<HTMLButtonElement>('[data-fancy-sign-action="start-decline"]').click());
    act(() => q<HTMLButtonElement>('[data-fancy-sign-action="cancel-decline"]').click());
    expect(document.querySelector('[data-fancy-sign-decline-reason]')).toBeNull();
    expect(client.decline).not.toHaveBeenCalled();
  });
});

describe("page.viewed reporting", () => {
  type IOCallback = (entries: Array<{ target: Element; isIntersecting: boolean }>) => void;
  let observers: IOCallback[] = [];

  beforeEach(() => {
    observers = [];
    class FakeIO {
      constructor(cb: IOCallback) {
        observers.push(cb);
      }
      observe() {}
      unobserve() {}
      disconnect() {}
      takeRecords() {
        return [];
      }
    }
    vi.stubGlobal("IntersectionObserver", FakeIO);
  });

  function page(n: number): Element {
    return q(`[data-fancy-sign-page="${n}"]`);
  }

  function see(n: number, visible: boolean) {
    act(() => {
      for (const cb of observers) cb([{ target: page(n), isIntersecting: visible }]);
    });
  }

  it("reports dwell over the minimum, ignores glances, and rate-limits a page", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-13T12:00:00Z"));
    const client = fakeClient();
    render(
      <Harness
        client={client}
        token="tok"
        initial={reviewState()}
        renderPage={(n) => <span>page body {n}</span>}
        minDwellMs={1000}
        pageViewIntervalMs={30000}
      />,
    );
    expect(page(1).textContent).toContain("page body 1");

    // A glance (300 ms) is not reported.
    see(1, true);
    vi.setSystemTime(new Date("2026-11-13T12:00:00.300Z"));
    see(1, false);
    expect(client.reportPageView).not.toHaveBeenCalled();

    // A real read (2.5 s) is.
    see(1, true);
    vi.setSystemTime(new Date("2026-11-13T12:00:02.800Z"));
    see(1, false);
    expect(client.reportPageView).toHaveBeenCalledWith("tok", 1, 2500);

    // The same page again inside the interval is not reported twice.
    see(1, true);
    vi.setSystemTime(new Date("2026-11-13T12:00:06Z"));
    see(1, false);
    expect(client.reportPageView).toHaveBeenCalledTimes(1);

    // A different page is.
    see(2, true);
    vi.setSystemTime(new Date("2026-11-13T12:00:08Z"));
    see(2, false);
    expect(client.reportPageView).toHaveBeenCalledTimes(2);
    expect(client.reportPageView).toHaveBeenLastCalledWith("tok", 2, 2000);
  });
});

describe("document viewer", () => {
  it("fetches the as-sent PDF through the session and shows it when no pages are rendered", async () => {
    const client = fakeClient();
    render(<Harness client={client} token="tok" initial={reviewState()} />);
    await waitFor(() => expect(document.querySelector('[data-fancy-sign-document="pdf"]')).not.toBeNull());
    expect(client.signerDocument).toHaveBeenCalledWith("tok");
    expect(client.reportPageView).not.toHaveBeenCalled();
  });
});

describe("uncontrolled", () => {
  it("runs without value/onChange from a default", async () => {
    const client = fakeClient();
    render(<SignerCeremony client={client} token="tok" />);
    await act(async () => q<HTMLButtonElement>('[data-fancy-sign-action="request-view-code"]').click());
    expect(document.querySelectorAll('[data-fancy-sign-code="view"] input')).toHaveLength(6);
  });
});

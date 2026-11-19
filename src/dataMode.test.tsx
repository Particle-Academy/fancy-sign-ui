import { useEffect, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import type { SignClient } from "./client";
import { canonicalData } from "./data";
import {
  SignerCeremony,
  initialCeremonyState,
  signBlockers,
  type DataRenderContext,
  type SignerCeremonyProps,
  type SignerCeremonyState,
} from "./SignerCeremony";
import type { Field, SignActivityEvent, SignerView } from "./types";

/*
 * Data mode (CC-fancy-0052): the envelope signs the HOST's data. The ceremony
 * fetches the canonical bytes, proves they hash to the signed data_sha256, and
 * hands the parsed object to the host's renderData with a context for placing
 * the ceremony's own field controls. Nothing presentational comes from the
 * envelope: the ceremony is live.
 */

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:as-sent");
  vi.spyOn(URL, "revokeObjectURL").mockReturnValue(undefined);
});

/** Plan vector d0007, the host's own text (not canonical). */
const QUOTE = {
  quote: "Q-1001",
  currency: "USD",
  customer: { name: "Pat Buyer", tags: [] },
  lines: [
    { sku: "W-1", qty: 2, unit: 612.5, discount: 0.05 },
    { sku: "S-9", qty: 1, unit: 25, options: {} },
  ],
  tax_rate: 0.0825,
  totals: { net: 1250, tax: 103.125 },
  terms: ["Net 30", "Valid 14 days"],
};
const QUOTE_SHA = "9f3a6327d5c426994325ae9037518f595c604153944915a21236aa728e9ed2a9";
const CANONICAL = canonicalData(QUOTE);
const SENT_AT = "2026-11-19T12:00:00Z";
const RENDERER = "host quote-v7 @ host-app 2026.11.19";

function dataField(id: string, kind: Field["kind"], anchor: Field["anchor"] = null, required = true): Field {
  return { id, signer_id: "alice", kind, anchor, required, label: kind === "signature" ? "Buyer" : null, placement: null, completed: false };
}

/**
 * A SignerView exactly as fancy-sign-php's first data-mode backend serves it
 * (its LiveCeremonyTest allow-lists these keys). The live-ceremony guarantee:
 * what that backend sends renders under this UI.
 */
function dataView(overrides: Partial<SignerView> = {}): SignerView {
  return {
    envelope: { id: "01JDATA", title: "Quote Q-1001", status: "sent", mode: "data", data_sha256: QUOTE_SHA, sent_at: SENT_AT },
    signer: {
      id: "alice", name: "Alice Example", email: "alice@example.com", status: "viewed",
      consent_at: "2026-11-19T12:01:00Z", signed_at: null, declined_at: null, signature: null,
    },
    consent: { required: false, text: "I agree to use electronic records.", version: "1" },
    adoption_text: "I adopt this as my signature.",
    changes_requested: 0,
    max_change_requests: 3,
    fields: [dataField("alice-sig", "signature", { pointer: "/lines" }), dataField("alice-date", "date_signed")],
    ...overrides,
  };
}

function fakeClient(overrides: Partial<SignClient> = {}): SignClient {
  const base: Partial<SignClient> = {
    requestCode: vi.fn(async () => ({ sent: true as const, expires_in: 600 })),
    getSignerView: vi.fn(async () => dataView()),
    signerDocument: vi.fn(async () => new Blob(["%PDF"], { type: "application/pdf" })),
    signerData: vi.fn(async () => ({ text: CANONICAL, sha256: QUOTE_SHA })),
    reportRendered: vi.fn(async () => undefined),
    reportPageView: vi.fn(async () => undefined),
    sign: vi.fn(async () => {
      const v = dataView();
      return { ...v, signer: { ...v.signer, status: "signed" as const, signed_at: "2026-11-19T12:05:00Z" } };
    }),
  };
  return { ...base, ...overrides } as SignClient;
}

function reviewState(patch: Partial<SignerCeremonyState> = {}): SignerCeremonyState {
  return { ...initialCeremonyState(), step: "review", view: dataView(), ...patch };
}

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

/** A host template: renders the quote and places the signature control beside the lines. */
function QuoteTemplate({ data, ctx, pages }: { data: Record<string, unknown>; ctx: DataRenderContext; pages?: number }) {
  useEffect(() => {
    if (pages !== undefined) ctx.reportLayout({ pages });
  }, [ctx, pages]);
  return (
    <div data-host-quote={String(data.quote)}>
      <span data-host-lines={String((data.lines as unknown[]).length)} />
      <div data-host-slot="alice-sig">{ctx.renderField("alice-sig")}</div>
    </div>
  );
}

describe("data mode: fetch, check, render", () => {
  it("renders the host's template with the parsed signed data and never mounts the PDF viewer", async () => {
    const client = fakeClient();
    const renderData = vi.fn((data: Record<string, unknown>, ctx: DataRenderContext) => <QuoteTemplate data={data} ctx={ctx} />);
    render(<Harness client={client} token="tok" initial={reviewState()} renderData={renderData} renderer={RENDERER} />);

    await waitFor(() => q('[data-host-quote="Q-1001"]'));
    expect(client.signerData).toHaveBeenCalledWith("tok");
    expect(client.signerDocument).not.toHaveBeenCalled();
    expect(document.querySelector('[data-fancy-sign-document="pdf"]')).toBeNull();
    expect(q('[data-fancy-sign-document="data"]').getAttribute("data-fancy-sign-data-sha256")).toBe(QUOTE_SHA);
    const [data, ctx] = renderData.mock.calls[renderData.mock.calls.length - 1]!;
    expect(data).toEqual(JSON.parse(CANONICAL));
    expect(ctx.now).toBe(SENT_AT);
    expect(ctx.fields.map((f) => [f.id, f.kind, f.required, f.label, f.anchor, f.completed])).toEqual([
      ["alice-sig", "signature", true, "Buyer", { pointer: "/lines" }, false],
      ["alice-date", "date_signed", true, null, null, false],
    ]);
  });

  it("refuses to render data that does not hash to the signed data_sha256", async () => {
    const tampered = CANONICAL.replace("612.5", "61.25");
    const client = fakeClient({ signerData: vi.fn(async () => ({ text: tampered, sha256: QUOTE_SHA })) });
    const renderData = vi.fn(() => <div data-host-quote="" />);
    const events: SignActivityEvent[] = [];
    let last: SignerCeremonyState | null = null;
    render(
      <Harness client={client} token="tok" initial={reviewState()} renderData={renderData} renderer={RENDERER}
        onState={(s) => (last = s)} onActivity={(e) => events.push(e)} />,
    );

    await waitFor(() => q('[data-fancy-sign-error="data_hash_mismatch"]'));
    expect(renderData).not.toHaveBeenCalled();
    expect(q('[data-fancy-sign-document="refused"]')).toBeTruthy();
    expect(document.body.textContent).not.toContain("61.25");
    expect(last!.dataCheck).toBe("refused");
    expect(signBlockers({ ...last!, completedFields: ["alice-sig", "alice-date"], mark: { kind: "typed", text: "A" }, acceptCode: "123456" }))
      .toContain("data");
    expect(events.some((e) => e.action === "error" && e.detail?.code === "data_hash_mismatch")).toBe(true);
  });

  it("refuses data whose served hash header disagrees with the envelope, even if the bytes match it", async () => {
    const client = fakeClient({ signerData: vi.fn(async () => ({ text: CANONICAL, sha256: "0".repeat(64) })) });
    const renderData = vi.fn(() => <div />);
    render(<Harness client={client} token="tok" initial={reviewState()} renderData={renderData} renderer={RENDERER} />);

    await waitFor(() => q('[data-fancy-sign-error="data_hash_mismatch"]'));
    expect(renderData).not.toHaveBeenCalled();
  });

  it("shows an error, never raw JSON, when the host gave no renderData", async () => {
    const client = fakeClient();
    render(<Harness client={client} token="tok" initial={reviewState()} renderer={RENDERER} />);

    await waitFor(() => q('[data-fancy-sign-document="no-renderer"]'));
    // Nothing from the data (the title is the envelope's, not the data's).
    for (const fromData of ["Pat Buyer", "612.5", "Net 30", '"quote"']) {
      expect(document.body.textContent).not.toContain(fromData);
    }
    // And nothing was fetched: the signer cannot be shown it, so it must not count as opened.
    expect(client.signerData).not.toHaveBeenCalled();
    expect(signBlockers(reviewState({ completedFields: ["alice-sig", "alice-date"], mark: { kind: "typed", text: "A" }, acceptCode: "123456" })))
      .toContain("data");
  });

  it("keeps pdf mode on the PDF path: a pdf envelope never fetches data", async () => {
    const client = fakeClient();
    const v = dataView();
    const pdfView: SignerView = { ...v, envelope: { id: "E", title: "T", status: "sent", pages: 1, mode: "pdf" } };
    render(<Harness client={client} token="tok" initial={reviewState({ view: pdfView })} renderData={() => <div data-host-quote="" />} />);

    await waitFor(() => q('[data-fancy-sign-document="pdf"]'));
    expect(client.signerData).not.toHaveBeenCalled();
    expect(document.querySelector("[data-host-quote]")).toBeNull();
  });
});

describe("data mode: fields placed by the host", () => {
  it("shares state between the host-placed control and the checklist", async () => {
    const client = fakeClient();
    let last: SignerCeremonyState | null = null;
    render(
      <Harness client={client} token="tok" initial={reviewState({ mark: { kind: "typed", text: "Alice" } })}
        renderData={(data, ctx) => <QuoteTemplate data={data} ctx={ctx} />} renderer={RENDERER} onState={(s) => (last = s)} />,
    );
    await waitFor(() => q('[data-host-slot="alice-sig"] [data-fancy-sign-action="complete-field"]'));

    fireEvent.click(q('[data-host-slot="alice-sig"] [data-fancy-sign-action="complete-field"]'));
    expect(last!.completedFields).toEqual(["alice-sig"]);
    // The checklist shows the same state: one field, two places.
    expect(q('[data-fancy-sign-panel="fields"] [data-fancy-sign-field="alice-sig"]').getAttribute("data-fancy-sign-field-completed")).toBe("true");
    expect(q('[data-fancy-sign-field-slot="alice-sig"] [data-fancy-sign-field="alice-sig"]').getAttribute("data-fancy-sign-field-completed")).toBe("true");

    // And the other way round: completed from the checklist, shown in the host's control.
    fireEvent.click(q('[data-fancy-sign-panel="fields"] [data-fancy-sign-field-id="alice-date"]'));
    expect(last!.completedFields).toEqual(["alice-sig", "alice-date"]);
  });

  it("works with a host that places nothing: the checklist is a complete UI", async () => {
    const client = fakeClient();
    let last: SignerCeremonyState | null = null;
    render(
      <Harness client={client} token="tok" initial={reviewState({ mark: { kind: "typed", text: "Alice" } })}
        renderData={(data) => <div data-host-quote={String(data.quote)} />} renderer={RENDERER} onState={(s) => (last = s)} />,
    );
    await waitFor(() => q('[data-host-quote="Q-1001"]'));
    fireEvent.click(q('[data-fancy-sign-panel="fields"] [data-fancy-sign-field-id="alice-sig"]'));
    fireEvent.click(q('[data-fancy-sign-panel="fields"] [data-fancy-sign-field-id="alice-date"]'));
    expect(last!.completedFields).toEqual(["alice-sig", "alice-date"]);
  });

  it("fires onLocate subscribers from the checklist's Show button, and stops after unsubscribe", async () => {
    const client = fakeClient();
    const located: string[] = [];
    let unsubscribe: (() => void) | null = null;
    const events: SignActivityEvent[] = [];
    function Locating({ ctx }: { ctx: DataRenderContext }) {
      useEffect(() => {
        unsubscribe = ctx.onLocate((f) => located.push(`${f.id}:${f.anchor && "pointer" in f.anchor ? f.anchor.pointer : "-"}`));
        return () => unsubscribe?.();
      }, [ctx]);
      return <div data-host-locating="" />;
    }
    render(
      <Harness client={client} token="tok" initial={reviewState()} renderData={(_d, ctx) => <Locating ctx={ctx} />}
        renderer={RENDERER} onActivity={(e) => events.push(e)} />,
    );
    await waitFor(() => q("[data-host-locating]"));

    fireEvent.click(q('[data-fancy-sign-field-show="alice-sig"]'));
    fireEvent.click(q('[data-fancy-sign-field-show="alice-date"]'));
    expect(located).toEqual(["alice-sig:/lines", "alice-date:-"]);
    expect(events.filter((e) => e.action === "locate").map((e) => e.target)).toEqual(["alice-sig", "alice-date"]);

    act(() => unsubscribe!());
    fireEvent.click(q('[data-fancy-sign-field-show="alice-sig"]'));
    expect(located).toHaveLength(2);
  });

  it("gives renderField no way to complete a field: it is a control the signer presses", async () => {
    const client = fakeClient();
    let captured: DataRenderContext | null = null;
    render(
      <Harness client={client} token="tok" initial={reviewState()}
        renderData={(_d, ctx) => {
          captured = ctx;
          return <div data-host-quote="" />;
        }} renderer={RENDERER} />,
    );
    await waitFor(() => q("[data-host-quote]"));
    expect(Object.keys(captured!).sort()).toEqual(["fields", "now", "onLocate", "renderField", "reportLayout"]);
  });
});

describe("data mode: the rendering claim", () => {
  it("posts document.rendered with the host's renderer once per layout change", async () => {
    const client = fakeClient();
    const events: SignActivityEvent[] = [];
    let last: SignerCeremonyState | null = null;
    let setPages: (n: number) => void = () => undefined;
    function Host() {
      const [pages, set] = useState(3);
      setPages = set;
      return (
        <SignerCeremony client={client} token="tok" defaultValue={reviewState()} renderer={RENDERER}
          onChange={(s) => (last = s)} onActivity={(e) => events.push(e)}
          renderData={(data, ctx) => <QuoteTemplate data={data} ctx={ctx} pages={pages} />} />
      );
    }
    render(<Host />);

    await waitFor(() => expect(client.reportRendered).toHaveBeenCalledTimes(1));
    expect(client.reportRendered).toHaveBeenCalledWith("tok", { data_sha256: QUOTE_SHA, renderer: RENDERER, pages: 3 });
    expect(last!.reportedPages).toBe(3);
    expect(events.find((e) => e.action === "rendered")?.detail).toEqual({ pages: 3, renderer: RENDERER });

    act(() => setPages(3));
    act(() => setPages(1));
    await waitFor(() => expect(client.reportRendered).toHaveBeenCalledTimes(2));
    expect(client.reportRendered).toHaveBeenLastCalledWith("tok", { data_sha256: QUOTE_SHA, renderer: RENDERER, pages: 1 });
  });

  it("makes no claim without a renderer label, and ignores a non-positive page count", async () => {
    const client = fakeClient();
    render(<Harness client={client} token="tok" initial={reviewState()} renderData={(data, ctx) => <QuoteTemplate data={data} ctx={ctx} pages={2} />} />);
    await waitFor(() => q('[data-host-quote="Q-1001"]'));
    cleanup();
    render(<Harness client={client} token="tok" initial={reviewState()} renderer={RENDERER} renderData={(data, ctx) => <QuoteTemplate data={data} ctx={ctx} pages={0} />} />);
    await waitFor(() => q('[data-host-quote="Q-1001"]'));
    expect(client.reportRendered).not.toHaveBeenCalled();
  });

  it("still signs when the host's render never reports a layout, and sends data_sha256", async () => {
    const client = fakeClient();
    let last: SignerCeremonyState | null = null;
    render(
      <Harness client={client} token="tok"
        initial={reviewState({ completedFields: ["alice-sig", "alice-date"], mark: { kind: "typed", text: "Alice" }, acceptCodeSent: true, acceptCode: "654321" })}
        renderData={(data) => <div data-host-quote={String(data.quote)} />} renderer={RENDERER} onState={(s) => (last = s)} />,
    );
    await waitFor(() => expect(q<HTMLButtonElement>('[data-fancy-sign-action="sign"]').disabled).toBe(false));
    expect(client.reportRendered).not.toHaveBeenCalled();

    fireEvent.click(q('[data-fancy-sign-action="sign"]'));
    await waitFor(() => expect(last!.step).toBe("signed"));
    expect(client.sign).toHaveBeenCalledWith("tok", {
      fields: { "alice-sig": true, "alice-date": true },
      mark: { kind: "typed", text: "Alice" },
      adoption: "I adopt this as my signature.",
      code: "654321",
      data_sha256: QUOTE_SHA,
    });
  });

  it("blocks Sign until the data is checked", () => {
    const ready = reviewState({ completedFields: ["alice-sig", "alice-date"], mark: { kind: "typed", text: "A" }, acceptCode: "123456" });
    expect(signBlockers(ready)).toEqual(["data"]);
    expect(signBlockers({ ...ready, dataCheck: "verified" })).toEqual([]);
    // pdf mode is unchanged: no data blocker.
    const v = dataView();
    expect(signBlockers({ ...ready, view: { ...v, envelope: { id: "E", title: "T", status: "sent", pages: 1 } } })).toEqual([]);
  });

  it("observes the host's data-fancy-sign-page elements once a layout is reported", async () => {
    const observed: Element[] = [];
    class FakeIO {
      observe(el: Element) {
        observed.push(el);
      }
      unobserve() {}
      disconnect() {}
      takeRecords() {
        return [];
      }
    }
    vi.stubGlobal("IntersectionObserver", FakeIO);
    const client = fakeClient();
    function Paged({ ctx }: { ctx: DataRenderContext }) {
      useEffect(() => ctx.reportLayout({ pages: 2 }), [ctx]);
      return (
        <div>
          <section data-fancy-sign-page="1">one</section>
          <section data-fancy-sign-page="2">two</section>
        </div>
      );
    }
    render(<Harness client={client} token="tok" initial={reviewState()} renderer={RENDERER} renderData={(_d, ctx) => <Paged ctx={ctx} />} />);

    await waitFor(() => expect(observed.map((el) => el.getAttribute("data-fancy-sign-page"))).toEqual(["1", "2"]));
  });
});

describe("data mode: the earlier steps are unchanged", () => {
  it("goes code, consent, review, then fetches the data", async () => {
    const v = dataView();
    const unconsented: SignerView = { ...v, consent: { ...v.consent, required: true }, signer: { ...v.signer, consent_at: null } };
    const client = fakeClient({
      verifyViewCode: vi.fn(async () => ({ session: "s", expires_at: "2026-11-19T12:30:00Z" })),
      getSignerView: vi.fn(async () => unconsented),
      consent: vi.fn(async () => dataView()),
    });
    render(<Harness client={client} token="tok" initial={initialCeremonyState()} renderer={RENDERER} renderData={(data) => <div data-host-quote={String(data.quote)} />} />);

    await act(async () => q<HTMLButtonElement>('[data-fancy-sign-action="request-view-code"]').click());
    const inputs = document.querySelectorAll<HTMLInputElement>('[data-fancy-sign-code="view"] input');
    "123456".split("").forEach((d, i) => fireEvent.change(inputs[i]!, { target: { value: d } }));
    await act(async () => q<HTMLButtonElement>('[data-fancy-sign-action="verify-view-code"]').click());
    await waitFor(() => q('[data-fancy-sign-panel="consent"]'));
    expect(client.signerData).not.toHaveBeenCalled();
    act(() => q<HTMLInputElement>("[data-fancy-sign-consent-check] input").click());
    await act(async () => q<HTMLButtonElement>('[data-fancy-sign-action="accept-consent"]').click());
    await waitFor(() => q('[data-host-quote="Q-1001"]'));
    expect(client.signerData).toHaveBeenCalledTimes(1);
  });
});

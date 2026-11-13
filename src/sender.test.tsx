import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { SignError, type SignClient } from "./client";
import { EnvelopeTimeline, CLIENT_EVENT_LABEL } from "./EnvelopeTimeline";
import { SignatureVerifier, VERIFY_REASON_TEXT, initialVerifierState, type SignatureVerifierState } from "./SignatureVerifier";
import { EnvelopeSetup, initialEnvelopeSetupState, type EnvelopeSetupState } from "./EnvelopeSetup";
import { SignFieldPalette, emptyFieldDraft } from "./fields";
import { CompletionCertificate } from "./CompletionCertificate";
import type { Completion, FieldDraft, SignActivityEvent, SignEvent, VerifyReason, VerifyResult } from "./types";

afterEach(cleanup);

function q<T extends HTMLElement = HTMLElement>(selector: string): T {
  const el = document.querySelector<T>(selector);
  if (!el) throw new Error(`nothing matches ${selector}`);
  return el;
}

function event(seq: number, type: string, patch: Partial<SignEvent> = {}): SignEvent {
  return {
    envelope_id: "env1",
    seq,
    at: `2026-11-13T12:0${seq}:00Z`,
    type,
    actor: "signer:sg1",
    source: "server",
    ip: "192.0.2.10",
    user_agent: "Test",
    data: {},
    prev_hash: "0".repeat(64),
    hash: String(seq).repeat(64).slice(0, 64),
    ...patch,
  };
}

describe("EnvelopeTimeline", () => {
  it("labels every client-sourced event as reported by the signer's browser, and no server event", () => {
    render(
      <EnvelopeTimeline
        events={[
          event(1, "envelope.sent"),
          event(2, "page.viewed", { source: "client", data: { page: 1, ms: 2500 } }),
          event(3, "document.opened"),
          event(4, "page.viewed", { source: "client", data: { page: 2, ms: 1800 } }),
        ]}
      />,
    );
    const labelled = document.querySelectorAll("[data-fancy-sign-event-claim]");
    expect(labelled).toHaveLength(2);
    for (const el of Array.from(labelled)) {
      expect(el.textContent).toBe(CLIENT_EVENT_LABEL);
    }
    expect(CLIENT_EVENT_LABEL).toBe("reported by the signer's browser");
    expect(q('[data-fancy-sign-event="1"]').querySelector("[data-fancy-sign-event-claim]")).toBeNull();
    expect(q('[data-fancy-sign-event="2"]').getAttribute("data-fancy-sign-event-source")).toBe("client");
  });

  it("renders a decline reason as plain text, never as HTML", () => {
    const hostile = '<img src=x onerror="alert(1)"><b>bold</b>';
    render(<EnvelopeTimeline events={[event(1, "signer.declined", { data: { reason: hostile } })]} />);
    const reason = q("[data-fancy-sign-event-reason]");
    expect(reason.textContent).toBe(hostile);
    expect(reason.querySelector("img")).toBeNull();
    expect(reason.querySelector("b")).toBeNull();
  });

  it("shows events in seq order whatever order they arrive in", () => {
    render(<EnvelopeTimeline events={[event(3, "signer.signed"), event(1, "envelope.sent"), event(2, "document.opened")]} />);
    const seqs = Array.from(document.querySelectorAll("[data-fancy-sign-event]")).map((el) =>
      el.getAttribute("data-fancy-sign-event"),
    );
    expect(seqs).toEqual(["1", "2", "3"]);
  });
});

describe("SignatureVerifier", () => {
  const REASONS: VerifyReason[] = [
    "completion_invalid",
    "seal_invalid",
    "token_mismatch",
    "final_hash_mismatch",
    "prefix_mismatch",
    "chain_broken",
    "chain_head_mismatch",
  ];

  for (const reason of REASONS) {
    it(`names the ${reason} failure`, () => {
      const result: VerifyResult = {
        ok: false,
        reason,
        checks: { seal: false, token: null, final_hash: null, prefix: null, chain: null },
      };
      render(
        <SignatureVerifier
          client={{} as SignClient}
          value={{ ...initialVerifierState(), result, status: "idle" }}
          onChange={vi.fn()}
        />,
      );
      const shown = q(`[data-fancy-sign-verify-reason="${reason}"]`);
      expect(shown.textContent).toContain(VERIFY_REASON_TEXT[reason]);
      expect(q("[data-fancy-sign-verify-ok]").getAttribute("data-fancy-sign-verify-ok")).toBe("false");
    });
  }

  it("says verified, and shows each check, when ok", () => {
    const result: VerifyResult = {
      ok: true,
      reason: null,
      checks: { seal: true, token: true, final_hash: true, prefix: true, chain: null },
    };
    render(<SignatureVerifier client={{} as SignClient} value={{ ...initialVerifierState(), result }} onChange={vi.fn()} />);
    expect(q("[data-fancy-sign-verify-ok]").getAttribute("data-fancy-sign-verify-ok")).toBe("true");
    expect(q('[data-fancy-sign-verify-check="seal"]').getAttribute("data-fancy-sign-verify-check-result")).toBe("pass");
    expect(q('[data-fancy-sign-verify-check="chain"]').getAttribute("data-fancy-sign-verify-check-result")).toBe("not_checked");
  });

  it("cannot verify without both the PDF and the completion record, then posts them", async () => {
    const result: VerifyResult = {
      ok: false,
      reason: "prefix_mismatch",
      checks: { seal: true, token: true, final_hash: true, prefix: false, chain: null },
    };
    const verify = vi.fn(async () => result);
    const client = { verify } as unknown as SignClient;
    let last: SignatureVerifierState | null = null;
    function Host() {
      const [state, setState] = useState(initialVerifierState());
      return (
        <SignatureVerifier
          client={client}
          value={state}
          onChange={(next) => {
            last = next;
            setState(next);
          }}
        />
      );
    }
    render(<Host />);
    const button = () => q<HTMLButtonElement>('[data-fancy-sign-action="verify"]');
    expect(button().disabled).toBe(true);

    const pdf = new File(["%PDF"], "final.pdf", { type: "application/pdf" });
    const completion = new File(['{"token":"fsig_v1_a"}'], "completion.json", { type: "application/json" });
    fireEvent.change(q('[data-fancy-sign-verify-file="pdf"] input[type="file"]'), { target: { files: [pdf] } });
    expect(button().disabled).toBe(true);
    fireEvent.change(q('[data-fancy-sign-verify-file="completion"] input[type="file"]'), { target: { files: [completion] } });
    expect(last!.files.pdf).toBe("final.pdf");
    expect(button().disabled).toBe(false);

    await act(async () => button().click());
    expect(verify).toHaveBeenCalledWith({ pdf, completion });
    await waitFor(() => expect(document.querySelector('[data-fancy-sign-verify-reason="prefix_mismatch"]')).not.toBeNull());
  });

  it("shows a request failure as an error, not as a verdict", async () => {
    const verify = vi.fn(async () => {
      throw new SignError("limit_exceeded", "Too large.", 413);
    });
    function Host() {
      const [state, setState] = useState<SignatureVerifierState>(initialVerifierState());
      return <SignatureVerifier client={{ verify } as unknown as SignClient} value={state} onChange={setState} />;
    }
    render(<Host />);
    fireEvent.change(q('[data-fancy-sign-verify-file="pdf"] input[type="file"]'), {
      target: { files: [new File(["%PDF"], "a.pdf")] },
    });
    fireEvent.change(q('[data-fancy-sign-verify-file="completion"] input[type="file"]'), {
      target: { files: [new File(["{}"], "c.json")] },
    });
    await act(async () => q<HTMLButtonElement>('[data-fancy-sign-action="verify"]').click());
    await waitFor(() => expect(document.querySelector('[data-fancy-sign-error="limit_exceeded"]')).not.toBeNull());
    expect(document.querySelector("[data-fancy-sign-verify-ok]")).toBeNull();
  });
});

describe("EnvelopeSetup", () => {
  function Host({
    initial,
    onSend,
    onVoid,
    pendingMode,
    envelopeStatus,
    onState,
    onActivity,
  }: {
    initial: EnvelopeSetupState;
    onSend?: () => void;
    onVoid?: (reason: string) => void;
    pendingMode?: boolean;
    envelopeStatus?: "draft" | "sent";
    onState?: (s: EnvelopeSetupState) => void;
    onActivity?: (e: SignActivityEvent) => void;
  }) {
    const [state, setState] = useState(initial);
    return (
      <EnvelopeSetup
        value={state}
        onChange={(next) => {
          onState?.(next);
          setState(next);
        }}
        onSend={onSend}
        onVoid={onVoid}
        pendingMode={pendingMode}
        envelopeStatus={envelopeStatus}
        onActivity={onActivity}
      />
    );
  }

  const READY: EnvelopeSetupState = {
    ...initialEnvelopeSetupState(),
    title: "Quote 42",
    signers: [{ id: "s1", name: "Ada", email: "ada@example.com", order: 1 }],
  };

  it("stages Send for confirmation by default and only sends on confirm", async () => {
    const onSend = vi.fn();
    const activity: SignActivityEvent[] = [];
    render(<Host initial={READY} onSend={onSend} onActivity={(e) => activity.push(e)} />);
    act(() => q<HTMLButtonElement>('[data-fancy-sign-action="send"]').click());
    expect(onSend).not.toHaveBeenCalled();
    expect(q('[data-fancy-sign-confirm="send"]').textContent).toMatch(/1 signer/);
    expect(activity.map((e) => e.action)).toContain("send-proposed");

    await act(async () => q<HTMLButtonElement>('[data-fancy-sign-action="confirm-send"]').click());
    expect(onSend).toHaveBeenCalledTimes(1);
  });

  it("cancelling a staged send sends nothing", () => {
    const onSend = vi.fn();
    render(<Host initial={READY} onSend={onSend} />);
    act(() => q<HTMLButtonElement>('[data-fancy-sign-action="send"]').click());
    act(() => q<HTMLButtonElement>('[data-fancy-sign-action="cancel-send"]').click());
    expect(onSend).not.toHaveBeenCalled();
    expect(document.querySelector('[data-fancy-sign-confirm="send"]')).toBeNull();
  });

  it("cannot send without a title and a signer with a valid email", () => {
    render(
      <Host
        initial={{ ...READY, signers: [{ id: "s1", name: "Ada", email: "not-an-email", order: 1 }] }}
        onSend={vi.fn()}
      />,
    );
    expect(q<HTMLButtonElement>('[data-fancy-sign-action="send"]').disabled).toBe(true);
  });

  it("void needs a reason, is staged, and passes the trimmed reason", async () => {
    const onVoid = vi.fn();
    render(<Host initial={READY} onVoid={onVoid} envelopeStatus="sent" />);
    act(() => q<HTMLButtonElement>('[data-fancy-sign-action="void"]').click());
    const confirm = () => q<HTMLButtonElement>('[data-fancy-sign-action="confirm-void"]');
    expect(confirm().disabled).toBe(true);
    fireEvent.change(q("[data-fancy-sign-void-reason]"), { target: { value: "  wrong price " } });
    await act(async () => confirm().click());
    expect(onVoid).toHaveBeenCalledWith("wrong price");
  });

  it("shows level SES and seal none as fixed, and edits signers and settings", () => {
    let last: EnvelopeSetupState | null = null;
    render(<Host initial={READY} onState={(s) => (last = s)} />);
    expect(q("[data-fancy-sign-setting-level]").textContent).toContain("SES");
    expect(q("[data-fancy-sign-setting-seal]").textContent).toContain("none");

    act(() => q<HTMLButtonElement>('[data-fancy-sign-action="add-signer"]').click());
    expect(last!.signers).toHaveLength(2);
    expect(last!.signers[1]!.order).toBe(2);
    const second = last!.signers[1]!.id;
    fireEvent.change(q(`[data-fancy-sign-signer="${second}"] [data-fancy-sign-signer-input="email"]`), {
      target: { value: "bob@example.com" },
    });
    expect(last!.signers[1]!.email).toBe("bob@example.com");

    fireEvent.change(q('[data-fancy-sign-setting="per_page"]'), { target: { value: "initials" } });
    expect(last!.settings.per_page).toBe("initials");
    fireEvent.change(q('[data-fancy-sign-setting="step_up"]'), { target: { value: "passkey" } });
    expect(last!.settings.step_up).toBe("passkey");

    act(() => q<HTMLButtonElement>(`[data-fancy-sign-action="remove-signer"][data-fancy-sign-signer-id="${second}"]`).click());
    expect(last!.signers).toHaveLength(1);
  });

  it("is read-only once sent", () => {
    render(<Host initial={READY} envelopeStatus="sent" />);
    expect(q<HTMLInputElement>("[data-fancy-sign-setup-title]").disabled).toBe(true);
    expect(document.querySelector('[data-fancy-sign-action="send"]')).toBeNull();
  });
});

describe("SignFieldPalette", () => {
  it("emits a full FieldDraft on every edit and places it", () => {
    const drafts: FieldDraft[] = [];
    const placed: FieldDraft[] = [];
    function Host() {
      const [draft, setDraft] = useState(emptyFieldDraft());
      return (
        <SignFieldPalette
          signers={[{ id: "s1", name: "Ada" }, { id: "s2", name: "Bob" }]}
          value={draft}
          onChange={(next) => {
            drafts.push(next);
            setDraft(next);
          }}
          onPlace={(d) => placed.push(d)}
        />
      );
    }
    render(<Host />);
    expect(q<HTMLButtonElement>('[data-fancy-sign-action="place-field"]').disabled).toBe(true);

    act(() => q<HTMLButtonElement>('[data-fancy-sign-action="pick-kind"][data-fancy-sign-kind="initials"]').click());
    fireEvent.change(q('[data-fancy-sign-palette-input="signer"]'), { target: { value: "s2" } });
    fireEvent.change(q('[data-fancy-sign-palette-input="anchor"]'), { target: { value: "every_page" } });
    expect(drafts[drafts.length - 1]).toEqual({
      signer_id: "s2",
      kind: "initials",
      anchor: { every_page: true },
      required: true,
      label: null,
    });
    act(() => q<HTMLButtonElement>('[data-fancy-sign-action="place-field"]').click());
    expect(placed).toHaveLength(1);
  });
});

describe("CompletionCertificate", () => {
  const completion: Completion = {
    type: "fancy-sign.completion",
    version: 1,
    envelope_id: "env1",
    as_sent_sha256: "a".repeat(64),
    final_sha256: "b".repeat(64),
    signers: [
      { id: "sg1", name: "Ada", email: "ada@example.com", signed_at: "2026-11-13T12:05:00Z", method: "otp", otp_seq: 7, consent_seq: 4 },
    ],
    chain_head: "c".repeat(64),
    nonce: "d".repeat(32),
    key_id: "key-2026",
    token: `fsig_v1_${"e".repeat(64)}`,
    seal: "c2VhbA==",
  };

  it("renders the record, each signer, and the events with client claims labelled", () => {
    render(
      <CompletionCertificate
        completion={completion}
        events={[event(1, "envelope.sent"), event(2, "page.viewed", { source: "client", data: { page: 1, ms: 2000 } })]}
      />,
    );
    expect(q('[data-fancy-sign-cert-value="token"]').textContent).toBe(completion.token);
    expect(q('[data-fancy-sign-cert-value="final_sha256"]').textContent).toBe(completion.final_sha256);
    expect(q('[data-fancy-sign-cert-value="key_id"]').textContent).toBe("key-2026");
    expect(q('[data-fancy-sign-cert-signer="sg1"]').textContent).toContain("ada@example.com");
    expect(document.querySelectorAll("[data-fancy-sign-event-claim]")).toHaveLength(1);
  });
});

import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { SignError, createSignClient, isSignErrorCode, type SignClient } from "./client";
import {
  SignerCeremony,
  initialCeremonyState,
  signerMessage,
  type SignerCeremonyProps,
  type SignerCeremonyState,
} from "./SignerCeremony";
import type { SignActivityEvent } from "./types";

/*
 * fancy-sign settings.order: "sequential" (CC-fancy-0051). A signer whose group
 * has not been invited is refused with not_your_turn (409). The ceremony shows
 * a "waiting for your turn" panel with a stable handle instead of a generic
 * error, and offers nothing to act on.
 */

afterEach(() => cleanup());

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

const notYourTurn = () => new SignError("not_your_turn", "It is not your turn to sign yet.", 409);

describe("not_your_turn", () => {
  it("is in the closed error set, so the client keeps it rather than unknown_error", async () => {
    expect(isSignErrorCode("not_your_turn")).toBe(true);
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ error: "not_your_turn", message: "Not yet.", requestId: "r1" }), {
        status: 409,
        headers: { "Content-Type": "application/json" },
      }),
    );
    const client = createSignClient({ baseUrl: "https://app.example.com/fancy-sign", fetch: fetchImpl });
    const failure = (await client.requestCode("tok", "view").catch((e: unknown) => e)) as SignError;
    expect(failure.code).toBe("not_your_turn");
    expect(failure.status).toBe(409);
  });

  it("has plain-language text for the signer", () => {
    expect(signerMessage({ code: "not_your_turn", message: "raw" })).toMatch(/not your turn/i);
  });

  it("moves the ceremony to a waiting panel, with no code entry and no error banner", async () => {
    const client = { requestCode: vi.fn(async () => Promise.reject(notYourTurn())) } as unknown as SignClient;
    let last: SignerCeremonyState | null = null;
    const activity: SignActivityEvent[] = [];
    render(
      <Harness
        client={client}
        token="tok"
        initial={initialCeremonyState()}
        onState={(s) => (last = s)}
        onActivity={(e) => activity.push(e)}
      />,
    );

    await act(async () => document.querySelector<HTMLButtonElement>('[data-fancy-sign-action="request-view-code"]')!.click());

    await waitFor(() => expect(document.querySelector('[data-fancy-sign-panel="waiting"]')).not.toBeNull());
    expect(last!.step).toBe("waiting");
    expect(last!.error).toBeNull();
    expect(document.querySelector('[data-fancy-sign-step="waiting"]')).not.toBeNull();
    expect(document.querySelector('[data-fancy-sign-panel="code"]')).toBeNull();
    expect(document.querySelector("[data-fancy-sign-error]")).toBeNull();
    expect(document.querySelector('[data-fancy-sign-panel="waiting"]')!.textContent).toMatch(/not your turn/i);
    expect(activity.map((e) => e.action)).toContain("waiting");
  });

  it("renders the waiting panel from a restored state", () => {
    render(<Harness client={{} as SignClient} token="tok" initial={{ ...initialCeremonyState(), step: "waiting" }} />);
    expect(document.querySelector('[data-fancy-sign-panel="waiting"]')).not.toBeNull();
    expect(document.querySelector("[data-fancy-sign-action]")).toBeNull();
  });
});

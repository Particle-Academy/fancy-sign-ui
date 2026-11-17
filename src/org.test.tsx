import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { SignError, createSignClient, isSignErrorCode } from "./client";
import { EnvelopeSetup, initialEnvelopeSetupState, type EnvelopeSetupState } from "./EnvelopeSetup";
import { OrgSigningSettings, initialOrgSigningState, type OrgSigningState } from "./OrgSigningSettings";
import type { PerPageMark, SignActivityEvent } from "./types";

afterEach(cleanup);

function q<T extends HTMLElement = HTMLElement>(selector: string): T {
  const el = document.querySelector<T>(selector);
  if (!el) throw new Error(`nothing matches ${selector}`);
  return el;
}

describe("client: organisation settings", () => {
  it("reads and writes /org/settings, and knows forbidden", async () => {
    const calls: Array<{ url: string; method: string; body: unknown }> = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), method: init?.method ?? "GET", body: init?.body });
      if (calls.length === 3) {
        return new Response(JSON.stringify({ error: { code: "forbidden", message: "no" } }), { status: 403 });
      }
      return new Response(JSON.stringify({ org_id: "org-1", per_page: "initials", updated_by: "user:1", updated_at: null }), { status: 200 });
    }) as unknown as typeof fetch;
    const client = createSignClient({ baseUrl: "https://app.example.com/fancy-sign", fetch: fetchImpl });

    expect((await client.getOrgSettings()).per_page).toBe("initials");
    await client.updateOrgSettings({ per_page: "initials" });
    const failure = (await client.updateOrgSettings({ per_page: "none" }).catch((e: unknown) => e)) as SignError;

    expect(calls[0]).toMatchObject({ url: "https://app.example.com/fancy-sign/org/settings", method: "GET" });
    expect(calls[1]).toMatchObject({ method: "PUT", body: JSON.stringify({ per_page: "initials" }) });
    expect(isSignErrorCode("forbidden")).toBe(true);
    expect(failure.code).toBe("forbidden");
    expect(failure.status).toBe(403);
  });
});

describe("EnvelopeSetup under an organisation's per-page setting", () => {
  function Host({ initial, org, onState }: { initial: EnvelopeSetupState; org: PerPageMark | null; onState?: (s: EnvelopeSetupState) => void }) {
    const [state, setState] = useState(initial);
    return (
      <EnvelopeSetup
        value={state}
        orgPerPage={org}
        onChange={(next) => {
          onState?.(next);
          setState(next);
        }}
      />
    );
  }

  it("locks the per-page select to the org's choice and brings the state into line", () => {
    const states: EnvelopeSetupState[] = [];
    render(<Host initial={initialEnvelopeSetupState()} org="initials" onState={(s) => states.push(s)} />);

    const wrap = q('[data-fancy-sign-setting-wrap="per_page"]');
    expect(wrap.getAttribute("data-fancy-sign-locked")).toBe("org");
    expect(wrap.textContent).toMatch(/organisation/i);
    expect(states[states.length - 1]?.settings.per_page).toBe("initials");
  });

  it("leaves the select to the sender when the org has none", () => {
    render(<Host initial={initialEnvelopeSetupState()} org="none" />);
    expect(q('[data-fancy-sign-setting-wrap="per_page"]').getAttribute("data-fancy-sign-locked")).toBeNull();
  });
});

describe("OrgSigningSettings", () => {
  function Host({
    canEdit,
    onSave,
    onActivity,
    onState,
  }: {
    canEdit: boolean;
    onSave?: (perPage: PerPageMark) => Promise<void> | void;
    onActivity?: (e: SignActivityEvent) => void;
    onState?: (s: OrgSigningState) => void;
  }) {
    const [state, setState] = useState<OrgSigningState>(initialOrgSigningState("none"));
    return (
      <OrgSigningSettings
        value={state}
        onChange={(next) => {
          onState?.(next);
          setState(next);
        }}
        canEdit={canEdit}
        onSave={onSave}
        onActivity={onActivity}
      />
    );
  }

  it("is read-only for a sender who is not an admin", () => {
    render(<Host canEdit={false} />);
    expect(q('[data-fancy-sign-surface="org-signing-settings"]').getAttribute("data-fancy-sign-can-edit")).toBe("false");
    expect(document.querySelector('[data-fancy-sign-action="save-org-settings"]')).toBeNull();
  });

  it("saves the admin's choice through onSave and reports it as activity", async () => {
    const onSave = vi.fn();
    const activity: SignActivityEvent[] = [];
    const states: OrgSigningState[] = [];
    render(<Host canEdit onSave={onSave} onActivity={(e) => activity.push(e)} onState={(s) => states.push(s)} />);

    act(() => {
      fireEvent.change(q<HTMLSelectElement>('[data-fancy-sign-org-setting="per_page"] select'), { target: { value: "initials" } });
    });
    await act(async () => q<HTMLButtonElement>('[data-fancy-sign-action="save-org-settings"]').click());

    expect(onSave).toHaveBeenCalledWith("initials");
    expect(states[states.length - 1]).toMatchObject({ per_page: "initials", saved: "initials", status: "idle" });
    expect(activity.map((e) => e.action)).toEqual(["per-page-edited", "org-settings-saved"]);
  });

  it("keeps the saved value and shows the error when saving fails", async () => {
    const onSave = vi.fn(async () => {
      throw new SignError("forbidden", "Only an organisation admin can change these settings.", 403);
    });
    render(<Host canEdit onSave={onSave} />);
    act(() => {
      fireEvent.change(q<HTMLSelectElement>('[data-fancy-sign-org-setting="per_page"] select'), { target: { value: "signature" } });
    });
    await act(async () => q<HTMLButtonElement>('[data-fancy-sign-action="save-org-settings"]').click());

    expect(q("[data-fancy-sign-error]").getAttribute("data-fancy-sign-error")).toBe("forbidden");
  });
});

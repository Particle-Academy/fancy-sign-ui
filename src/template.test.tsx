// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, type ReactElement } from "react";
import { createRoot } from "react-dom/client";
import * as core from "@particle-academy/fancy-template-ui/core";
import { signBlockKinds, SIGN_KIND } from "./template";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const signers = [
  { id: "client", label: "Client" },
  { id: "acme", label: "Acme Ltd" },
];

afterEach(() => {
  document.body.innerHTML = "";
});

describe("signBlockKinds", () => {
  const kinds = signBlockKinds(signers);

  it("exports the three namespaced kinds, none allowed in a repeat", () => {
    expect(kinds.map((k) => k.kind)).toEqual([SIGN_KIND.signature, SIGN_KIND.initials, SIGN_KIND.dateSigned]);
    expect(kinds.map((k) => k.kind)).toEqual(["fancy-sign:signature", "fancy-sign:initials", "fancy-sign:date-signed"]);
    for (const k of kinds) {
      expect(k.allowInRepeat).toBe(false);
      // A valid kind by the builder's own rules (namespaced, defaults pass the schema).
      expect(() => core.defineKind(k)).not.toThrow();
    }
  });

  it("renders fine-print's opt-in field nodes", () => {
    const [signature, initials, date] = kinds;
    const ctx = { page: core.defaultPage(), accent: "#000000", fieldToken: (t: string) => `{{ ${t} }}` };
    expect(signature!.render({ id: "sig_client", signer: "client", required: true, label: "Client signature" }, ctx)).toEqual([
      { type: "signatureField", id: "sig_client", signer: "client", required: true, label: "Client signature" },
    ]);
    expect(initials!.render({ id: "ini_client", signer: "client", required: false }, ctx)).toEqual([
      { type: "initialsField", id: "ini_client", signer: "client", required: false },
    ]);
    expect(date!.render({ id: "date_client", signer: "client", required: true }, ctx)).toEqual([
      { type: "dateSignedField", id: "date_client", signer: "client", required: true },
    ]);
  });

  it("refuses an id or signer fine-print would refuse, through the schema", () => {
    const k = kinds[0]!;
    expect(core.validateSchema({ id: "bad id!", signer: "client", required: true }, k.schema)).not.toEqual([]);
    expect(core.validateSchema({ id: "ok", signer: "nobody", required: true }, k.schema)).not.toEqual([]);
    expect(core.validateSchema({ id: "x".repeat(65), signer: "client", required: true }, k.schema)).not.toEqual([]);
    expect(core.validateSchema({ id: "ok", signer: "client", required: true, label: "y".repeat(201) }, k.schema)).not.toEqual([]);
  });

  it("compiles cleanly in a template, and cannot be placed in a repeat", () => {
    let s = core.addBlock(core.emptyState(), core.hostBlock(kinds[0]!));
    s = core.addBlock(s, { type: "repeat", props: { list: "lines", pageEach: false } });
    const out = core.compile(s, { kinds, lists: [{ label: "Lines", token: "lines", itemFields: [] }] });
    expect(out.problems).toEqual([]);
    expect(out.template.document.blocks[0]).toMatchObject({ type: "signatureField", signer: "client" });
    const group = core.orderedBlocks(s).find((n) => n.type === "repeat")!.id;
    const node = core.makeNode(s, core.hostBlock(kinds[0]!), { parent: group });
    expect(core.checkOp(s, { t: "insert", node }, kinds)).toMatch(/not allowed in a repeat/);
  });

  it("its settings panel edits signer, id, required and label through onChange", () => {
    const k = kinds[0]!;
    const Settings = k.Settings as (p: { value: Record<string, unknown>; onChange: (v: Record<string, unknown>) => void; fields: [] }) => ReactElement;
    const onChange = vi.fn();
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    act(() => root.render(<Settings value={k.defaults} onChange={onChange} fields={[]} />));
    expect(host.querySelector("[data-fancy-sign-kind-settings]")).toBeTruthy();
    const required = host.querySelector<HTMLButtonElement>('[data-fancy-sign-kind-required] button, [data-fancy-sign-kind-required] [role="switch"]');
    act(() => required!.click());
    expect(onChange).toHaveBeenLastCalledWith({ ...k.defaults, required: false });
    act(() => root.unmount());
  });
});

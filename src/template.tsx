/**
 * `@particle-academy/fancy-sign-ui/template`: signing fields as host block kinds
 * for the document builder, `@particle-academy/fancy-template-ui`.
 *
 * ```tsx
 * <TemplateBuilder kinds={[...signBlockKinds(signers)]} ... />
 * ```
 *
 * Each kind renders one of fine-print's opt-in field nodes (`signatureField`,
 * `initialsField`, `dateSignedField`). The host renders the template with
 * fine-print's `fields: true`, and `fancy-sign` finds each field by its id (the
 * `{node: "<field id>"}` anchor). Where a field lands on the page is computed
 * by fine-print at render, never stored here.
 *
 * None of them may sit in a repeating section: a field id must be unique, and
 * a repeat would print the same id once per item.
 *
 * The builder is imported for TYPES only, so this entry adds no runtime
 * dependency on it.
 */
import { Input, Select, Switch, Text } from "@particle-academy/react-fancy";
import type { BlockKind, JsonObject, JsonSchema } from "@particle-academy/fancy-template-ui/core";

/** fine-print's field id rule (`Schema::FIELD_ID`), also used for signer ids. */
export const FIELD_ID_PATTERN = "^[A-Za-z0-9_-]{1,64}$";
const FIELD_LABEL_MAX = 200;

export const SIGN_KIND = {
  signature: "fancy-sign:signature",
  initials: "fancy-sign:initials",
  dateSigned: "fancy-sign:date-signed",
} as const;

export interface TemplateSigner {
  /** The signer's id in the envelope (`^[A-Za-z0-9_-]{1,64}$`). */
  id: string;
  label: string;
}

export interface SignFieldProps extends JsonObject {
  id: string;
  signer: string;
  required: boolean;
}

interface KindSettingsProps {
  value: JsonObject;
  onChange(props: JsonObject): void;
  disabled?: boolean;
}

function makeSettings(signers: readonly TemplateSigner[], noun: string) {
  function SignFieldSettings({ value, onChange, disabled }: KindSettingsProps) {
    const v = value as SignFieldProps & { label?: string };
    const set = (patch: Partial<SignFieldProps & { label?: string }>) => {
      const next: JsonObject = { ...v, ...patch } as JsonObject;
      if (next.label === undefined || next.label === "") delete next.label;
      onChange(next);
    };
    const idOk = new RegExp(FIELD_ID_PATTERN).test(v.id);
    return (
      <div className="flex flex-col gap-3" data-fancy-sign-kind-settings={noun}>
        <div data-fancy-sign-kind-signer="">
          <Select
            label="Signer"
            list={signers.map((s) => ({ value: s.id, label: s.label }))}
            value={v.signer}
            disabled={disabled}
            onValueChange={(signer) => set({ signer })}
          />
        </div>
        <div data-fancy-sign-kind-id="">
          <Input
            label="Field id"
            value={v.id}
            disabled={disabled}
            error={idOk ? undefined : "Letters, digits, _ and -, at most 64."}
            onValueChange={(id) => set({ id })}
          />
        </div>
        <div data-fancy-sign-kind-required="">
          <Switch label="Required" checked={v.required} disabled={disabled} onCheckedChange={(required) => set({ required })} />
        </div>
        <div data-fancy-sign-kind-label="">
          <Input label="Label under the box" value={v.label ?? ""} disabled={disabled} onValueChange={(label) => set({ label })} />
        </div>
        <Text size="xs" color="muted">
          Each field id must be unique in the document. The box is placed where this block sits.
        </Text>
      </div>
    );
  }
  return SignFieldSettings;
}

/**
 * The three signing kinds for the given signers. The first signer is the
 * default; ids default to `<kind>_<signer>`, which the person can change.
 */
export function signBlockKinds(signers: readonly TemplateSigner[]): BlockKind[] {
  const first = signers[0]?.id ?? "signer";
  const schema: JsonSchema = {
    type: "object",
    additionalProperties: false,
    required: ["id", "signer", "required"],
    properties: {
      id: { type: "string", pattern: FIELD_ID_PATTERN },
      signer: signers.length ? { type: "string", enum: signers.map((s) => s.id) } : { type: "string", pattern: FIELD_ID_PATTERN },
      required: { type: "boolean" },
      label: { type: "string", maxLength: FIELD_LABEL_MAX },
    },
  };
  const make = (kind: string, label: string, node: string, prefix: string, noun: string): BlockKind => ({
    kind,
    label,
    icon: "pen-line",
    schema,
    defaults: { id: `${prefix}_${first}`, signer: first, required: true },
    allowInRepeat: false,
    styleable: [],
    render: (props) => {
      const p = props as SignFieldProps & { label?: string };
      const out: JsonObject = { type: node, id: p.id, signer: p.signer, required: p.required };
      if (typeof p.label === "string" && p.label !== "") out.label = p.label;
      return [out];
    },
    Settings: makeSettings(signers, noun),
  });
  return [
    make(SIGN_KIND.signature, "Signature", "signatureField", "signature", "signature"),
    make(SIGN_KIND.initials, "Initials", "initialsField", "initials", "initials"),
    make(SIGN_KIND.dateSigned, "Date signed", "dateSignedField", "date", "date-signed"),
  ];
}

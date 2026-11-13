import { useCallback } from "react";
import { Badge, Button, Card, Checkbox, Input, Select, Text, cn } from "@particle-academy/react-fancy";
import { activityEvent } from "./activity";
import type { Field, FieldAnchor, FieldDraft, FieldKind, Mark, SignActivityEvent } from "./types";

const KIND_LABEL: Record<FieldKind, string> = {
  signature: "Signature",
  initials: "Initials",
  date_signed: "Date signed",
};

const KIND_ACTION: Record<FieldKind, string> = {
  signature: "Sign here",
  initials: "Initial here",
  date_signed: "Date it",
};

/**
 * A preview of a mark, drawn as vector polylines from the strokes. Never an
 * image: the strokes ARE the mark. Typed marks render as plain text.
 */
export function MarkPreview({ mark, className }: { mark: Mark | null; className?: string }) {
  if (!mark) return null;
  if (mark.kind === "typed") {
    return (
      <span data-fancy-sign-mark-preview="typed" className={cn("fancy-sign-mark fancy-sign-mark--typed", className)}>
        {mark.text}
      </span>
    );
  }
  return (
    <svg
      data-fancy-sign-mark-preview="drawn"
      viewBox="0 0 100 40"
      preserveAspectRatio="none"
      role="img"
      aria-label="Drawn signature"
      className={cn("fancy-sign-mark fancy-sign-mark--drawn", className)}
    >
      {mark.strokes.map((stroke, i) => (
        <polyline
          key={i}
          points={stroke.map(([x, y]) => `${x * 100},${y * 40}`).join(" ")}
          fill="none"
          stroke="currentColor"
          strokeWidth={1.2}
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
      ))}
    </svg>
  );
}

export interface SignFieldProps {
  field: Field;
  /** Overrides `field.completed`, for a ceremony tracking completion locally. */
  completed?: boolean;
  /** Called with the field id when the signer completes it. Omit for a display-only field. */
  onComplete?: (fieldId: string) => void;
  /** The adopted mark, previewed once a signature or initials field is complete. */
  mark?: Mark | null;
  /** Text shown in a completed date field. Default: today's date, `YYYY-MM-DD`. */
  dateText?: string;
  /** Why the field cannot be completed yet (e.g. "Adopt a signature first"). Disables the action. */
  blockedReason?: string | null;
  disabled?: boolean;
  className?: string;
}

function SignFieldBox({
  kind,
  field,
  completed,
  onComplete,
  mark,
  dateText,
  blockedReason,
  disabled,
  className,
}: SignFieldProps & { kind: FieldKind }) {
  const done = completed ?? field.completed;
  const pages = field.placement?.map((p) => p.page) ?? [];
  return (
    <Card
      variant="outlined"
      padding="sm"
      data-fancy-sign-field={field.id}
      data-fancy-sign-field-kind={kind}
      data-fancy-sign-field-completed={String(done)}
      data-fancy-sign-field-required={String(field.required)}
      className={cn("fancy-sign-field", className)}
    >
      <div className="fancy-sign-field__head">
        <Text as="span" weight="medium">
          {field.label ?? KIND_LABEL[kind]}
        </Text>
        {field.required ? (
          <Badge size="sm" variant="soft" color="amber">
            Required
          </Badge>
        ) : (
          <Badge size="sm" variant="soft">
            Optional
          </Badge>
        )}
        {pages.length > 0 ? (
          <Text as="span" size="xs" color="muted">
            {pages.length === 1 ? `Page ${pages[0]}` : `Pages ${pages.join(", ")}`}
          </Text>
        ) : null}
      </div>

      {done ? (
        <div className="fancy-sign-field__value" data-fancy-sign-field-value={field.id}>
          {kind === "date_signed" ? (
            <Text as="span">{dateText ?? new Date().toISOString().slice(0, 10)}</Text>
          ) : mark ? (
            <MarkPreview mark={mark} />
          ) : (
            <Badge color="green" variant="soft">
              Completed
            </Badge>
          )}
        </div>
      ) : onComplete ? (
        <div className="fancy-sign-field__action">
          <Button
            type="button"
            size="sm"
            color="blue"
            disabled={disabled || Boolean(blockedReason)}
            title={blockedReason ?? undefined}
            data-fancy-sign-action="complete-field"
            data-fancy-sign-field-id={field.id}
            onClick={() => onComplete(field.id)}
          >
            {KIND_ACTION[kind]}
          </Button>
          {blockedReason ? (
            <Text as="span" size="xs" color="muted" data-fancy-sign-field-blocked={field.id}>
              {blockedReason}
            </Text>
          ) : null}
        </div>
      ) : (
        <Text as="span" size="sm" color="muted">
          Not completed
        </Text>
      )}
    </Card>
  );
}

/** A signature field: display plus completion state. */
export function SignatureField(props: SignFieldProps) {
  return <SignFieldBox {...props} kind="signature" />;
}

/** An initials field: display plus completion state. */
export function InitialsField(props: SignFieldProps) {
  return <SignFieldBox {...props} kind="initials" />;
}

/** A date-signed field: display plus completion state. */
export function DateSignedField(props: SignFieldProps) {
  return <SignFieldBox {...props} kind="date_signed" />;
}

/** Render the right field component for `field.kind`. */
export function SignFieldView(props: SignFieldProps) {
  return <SignFieldBox {...props} kind={props.field.kind} />;
}

export interface PaletteSigner {
  id: string;
  name: string;
  email?: string;
}

export interface SignFieldPaletteProps {
  signers: PaletteSigner[];
  /** The draft being composed. */
  value: FieldDraft;
  /** Always the full next draft. */
  onChange: (next: FieldDraft) => void;
  /** Place the draft. The host adds it to the envelope's `fields[]`. */
  onPlace?: (draft: FieldDraft) => void;
  disabled?: boolean;
  /** Root handle. Default `"sign-field-palette"`. */
  surfaceId?: string;
  onActivity?: (event: SignActivityEvent) => void;
  className?: string;
}

type AnchorKind = "final_page" | "every_page" | "node";

function anchorKind(anchor: FieldAnchor): AnchorKind {
  if ("node" in anchor) return "node";
  if ("every_page" in anchor) return "every_page";
  return "final_page";
}

/** A fresh draft: a required signature on the final page for `signerId`. */
export function emptyFieldDraft(signerId = ""): FieldDraft {
  return { signer_id: signerId, kind: "signature", anchor: { final_page: true }, required: true, label: null };
}

/** Why a draft cannot be placed yet, or `null` when it can. */
export function fieldDraftProblem(draft: FieldDraft, signers: PaletteSigner[]): string | null {
  if (!signers.some((s) => s.id === draft.signer_id)) return "Choose a signer.";
  if ("node" in draft.anchor && draft.anchor.node.trim().length === 0) return "Name the document node to anchor to.";
  return null;
}

/**
 * Pick a field kind, a signer and an anchor, then place it. Emits a `FieldDraft`
 * on every edit. Where the field lands on the page is computed by the backend's
 * layout, never chosen here, so a re-flowed document cannot leave a field
 * floating over the wrong line.
 */
export function SignFieldPalette({
  signers,
  value,
  onChange,
  onPlace,
  disabled = false,
  surfaceId = "sign-field-palette",
  onActivity,
  className,
}: SignFieldPaletteProps) {
  const emit = useCallback(
    (action: string, detail?: Record<string, unknown>) => {
      onActivity?.(activityEvent(surfaceId, action, undefined, detail));
    },
    [onActivity, surfaceId],
  );

  const set = (patch: Partial<FieldDraft>) => {
    const next = { ...value, ...patch };
    emit("field-draft", { kind: next.kind, signer_id: next.signer_id });
    onChange(next);
  };

  const kindNow = anchorKind(value.anchor);
  const problem = fieldDraftProblem(value, signers);

  return (
    <div data-fancy-sign-surface={surfaceId} className={cn("fancy-sign fancy-sign-palette", className)}>
      <div className="fancy-sign-palette__kinds" role="group" aria-label="Field kind">
        {(Object.keys(KIND_LABEL) as FieldKind[]).map((kind) => (
          <Button
            key={kind}
            type="button"
            size="sm"
            variant={value.kind === kind ? "default" : "ghost"}
            active={value.kind === kind}
            disabled={disabled}
            data-fancy-sign-action="pick-kind"
            data-fancy-sign-kind={kind}
            onClick={() => set({ kind })}
          >
            {KIND_LABEL[kind]}
          </Button>
        ))}
      </div>

      <Select
        label="Signer"
        placeholder="Choose a signer"
        list={signers.map((s) => ({ value: s.id, label: s.email ? `${s.name} (${s.email})` : s.name }))}
        value={value.signer_id}
        disabled={disabled}
        data-fancy-sign-palette-input="signer"
        onValueChange={(signer_id) => set({ signer_id })}
      />

      <Select
        label="Anchor"
        list={[
          { value: "final_page", label: "The final signature page" },
          { value: "every_page", label: "Every page (before the final page)" },
          { value: "node", label: "A node in the document" },
        ]}
        value={kindNow}
        disabled={disabled}
        data-fancy-sign-palette-input="anchor"
        onValueChange={(next) => {
          const anchor: FieldAnchor =
            next === "node" ? { node: "" } : next === "every_page" ? { every_page: true } : { final_page: true };
          set({ anchor });
        }}
      />

      {"node" in value.anchor ? (
        <Input
          type="text"
          label="Document node id"
          value={value.anchor.node}
          disabled={disabled}
          data-fancy-sign-palette-input="node"
          onChange={(event) => set({ anchor: { node: event.target.value } })}
        />
      ) : null}

      <Input
        type="text"
        label="Label (optional)"
        value={value.label ?? ""}
        disabled={disabled}
        data-fancy-sign-palette-input="label"
        onChange={(event) => set({ label: event.target.value.length > 0 ? event.target.value : null })}
      />

      <div data-fancy-sign-palette-input="required">
        <Checkbox
          label="Required"
          checked={value.required}
          disabled={disabled}
          onCheckedChange={(required) => set({ required })}
        />
      </div>

      {onPlace ? (
        <Button
          type="button"
          color="blue"
          icon="plus"
          disabled={disabled || problem !== null}
          title={problem ?? undefined}
          data-fancy-sign-action="place-field"
          onClick={() => {
            emit("field-placed", { kind: value.kind, signer_id: value.signer_id });
            onPlace(value);
          }}
        >
          Place field
        </Button>
      ) : null}
    </div>
  );
}

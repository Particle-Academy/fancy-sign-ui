import { useCallback, useEffect } from "react";
import {
  Badge,
  Button,
  Callout,
  Card,
  DatePicker,
  Heading,
  Input,
  Select,
  Text,
  Textarea,
  cn,
} from "@particle-academy/react-fancy";
import { activityEvent, isoDate, useSurfaceState } from "./activity";
import { toStateError } from "./client";
import type { EnvelopeStatus, PerPageMark, SettingsInput, SignActivityEvent, SignStateError, SignerInput, StepUp } from "./types";

export interface EnvelopeSetupState {
  title: string;
  signers: SignerInput[];
  settings: SettingsInput;
  /** A staged sender action waiting for the human to confirm it. */
  pending: "send" | "void" | null;
  voidReason: string;
  status: "idle" | "busy" | "error";
  error: SignStateError | null;
}

export function initialEnvelopeSetupState(): EnvelopeSetupState {
  return {
    title: "",
    signers: [],
    settings: { per_page: "none", step_up: "none", expires_at: null },
    pending: null,
    voidReason: "",
    status: "idle",
    error: null,
  };
}

/**
 * `local@domain`, no whitespace, exactly one `@`, and a `.` in the domain with
 * at least one character either side. The same strings as
 * `^[^\s@]+@[^\s@]+\.[^\s@]+$`, which this replaces: that regex was quadratic on
 * a domain of many dots with no valid ending (CodeQL js/polynomial-redos; 11 s
 * on 100,000 characters). Linear: indexOf and one non-backtracking test.
 */
function isEmail(value: string): boolean {
  if (/\s/.test(value)) return false;
  const at = value.indexOf("@");
  if (at < 1 || value.indexOf("@", at + 1) !== -1) return false;
  const domain = value.slice(at + 1);
  return domain.length >= 3 && domain.lastIndexOf(".", domain.length - 2) >= 1;
}

/** Why the envelope cannot be sent yet. Empty means it can. */
export function setupProblems(state: EnvelopeSetupState): string[] {
  const problems: string[] = [];
  if (state.title.trim().length === 0) problems.push("Give the envelope a title.");
  if (state.signers.length === 0) problems.push("Add at least one signer.");
  for (const signer of state.signers) {
    if (signer.name.trim().length === 0) problems.push("Every signer needs a name.");
    if (!isEmail(signer.email.trim())) problems.push(`"${signer.email}" is not an email address.`);
  }
  return Array.from(new Set(problems));
}

function newId(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c?.randomUUID) return `signer-${c.randomUUID()}`;
  return `signer-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export interface EnvelopeSetupProps {
  value?: EnvelopeSetupState;
  /** Always the FULL next state. */
  onChange?: (next: EnvelopeSetupState) => void;
  defaultValue?: EnvelopeSetupState;
  /** The envelope's status. Only a draft is editable. Default `"draft"`. */
  envelopeStatus?: EnvelopeStatus;
  /** Send the envelope (draft to sent). The host calls `client.sendEnvelope`. */
  onSend?: () => Promise<void> | void;
  /** Void a sent envelope with the sender's reason. */
  onVoid?: (reason: string) => Promise<void> | void;
  /**
   * Stage Send and Void for human confirmation instead of performing them.
   * **Defaults to `true`**: sending emails real people and voiding cannot be
   * undone. Set `false` only when something else already confirmed.
   */
  pendingMode?: boolean;
  /**
   * The organisation's per-page setting (`client.getOrgSettings()`). When it is
   * not `"none"` the per-page select is locked to it, and the state is brought
   * into line, because the backend refuses an envelope that disagrees.
   */
  orgPerPage?: PerPageMark | null;
  /** Make a draft id for a new signer. Default: a random UUID. */
  newSignerId?: () => string;
  /** Most characters in a void reason. Default 1000. */
  maxVoidReason?: number;
  /** Root handle. Default `"envelope-setup"`. */
  surfaceId?: string;
  onActivity?: (event: SignActivityEvent) => void;
  className?: string;
}

/**
 * The sender's envelope editor: title, signers (name, email, order) and
 * settings. `level` and `seal` are shown fixed at `SES` and `none`: the later
 * phases are not built, and a selector offering them would offer something
 * the backend refuses.
 */
export function EnvelopeSetup({
  value,
  onChange,
  defaultValue,
  envelopeStatus = "draft",
  onSend,
  onVoid,
  pendingMode = true,
  orgPerPage = null,
  newSignerId = newId,
  maxVoidReason = 1000,
  surfaceId = "envelope-setup",
  onActivity,
  className,
}: EnvelopeSetupProps) {
  const { state, latest, update } = useSurfaceState(value, defaultValue ?? initialEnvelopeSetupState(), onChange);

  const emit = useCallback(
    (action: string, target?: string, detail?: Record<string, unknown>) => {
      onActivity?.(activityEvent(surfaceId, action, target, detail));
    },
    [onActivity, surfaceId],
  );

  const editable = envelopeStatus === "draft";
  const orgLocked = orgPerPage !== null && orgPerPage !== "none";

  useEffect(() => {
    if (orgLocked && editable && latest.current.settings.per_page !== orgPerPage) {
      update((c) => ({ ...c, settings: { ...c.settings, per_page: orgPerPage } }));
      emit("settings-from-org", undefined, { per_page: orgPerPage });
    }
  }, [orgLocked, orgPerPage, editable, latest, update, emit]);
  const busy = state.status === "busy";
  const problems = setupProblems(state);

  const setSigner = (id: string, patch: Partial<SignerInput>) => {
    update((c) => ({ ...c, signers: c.signers.map((s) => (s.id === id ? { ...s, ...patch } : s)) }));
    emit("signer-edited", id, Object.keys(patch).includes("email") ? { field: "email" } : { fields: Object.keys(patch) });
  };

  const addSigner = () => {
    const id = newSignerId();
    update((c) => ({
      ...c,
      signers: [...c.signers, { id, name: "", email: "", order: c.signers.reduce((m, s) => Math.max(m, s.order), 0) + 1 }],
    }));
    emit("signer-added", id);
  };

  const removeSigner = (id: string) => {
    update((c) => ({ ...c, signers: c.signers.filter((s) => s.id !== id) }));
    emit("signer-removed", id);
  };

  const setSettings = (patch: Partial<SettingsInput>) => {
    update((c) => ({ ...c, settings: { ...c.settings, ...patch } }));
    emit("settings-edited", undefined, { keys: Object.keys(patch) });
  };

  const run = async (action: "send" | "void") => {
    const reason = latest.current.voidReason.trim();
    update((c) => ({ ...c, status: "busy", error: null }));
    try {
      if (action === "send") await onSend?.();
      else await onVoid?.(reason);
      update((c) => ({ ...c, pending: null, voidReason: "", status: "idle", error: null }));
      emit(action === "send" ? "sent" : "voided");
    } catch (err) {
      const error = toStateError(err);
      update((c) => ({ ...c, status: "error", error }));
      emit("error", undefined, { code: error.code });
    }
  };

  const propose = (action: "send" | "void") => {
    // Void always needs a reason, so it is always staged, whatever pendingMode says.
    if (!pendingMode && action === "send") {
      emit("send-confirmed", undefined, { staged: false });
      void run("send");
      return;
    }
    update((c) => ({ ...c, pending: action, error: null }));
    emit(`${action}-proposed`, undefined, { signers: latest.current.signers.length });
  };

  const confirm = (action: "send" | "void") => {
    emit(`${action}-confirmed`, undefined, { staged: true });
    void run(action);
  };

  const cancel = (action: "send" | "void") => {
    update((c) => ({ ...c, pending: null, voidReason: "" }));
    emit(`${action}-cancelled`);
  };

  const signerCount = state.signers.length;

  return (
    <div
      data-fancy-sign-surface={surfaceId}
      data-fancy-sign-status={state.status}
      data-fancy-sign-envelope-status={envelopeStatus}
      className={cn("fancy-sign fancy-sign-setup", className)}
    >
      {state.error ? (
        <div data-fancy-sign-error={state.error.code} className="fancy-sign__error">
          <Callout color="red">{state.error.message}</Callout>
        </div>
      ) : null}

      <Input
        type="text"
        label="Title"
        value={state.title}
        disabled={!editable || busy}
        data-fancy-sign-setup-title=""
        onChange={(event) => update((c) => ({ ...c, title: event.target.value }))}
      />

      <Card variant="outlined" padding="md">
        <Heading as="h3" size="sm">
          Signers
        </Heading>
        {state.signers.length === 0 ? (
          <Text size="sm" color="muted">
            No signers yet.
          </Text>
        ) : null}
        {[...state.signers]
          .sort((a, b) => a.order - b.order)
          .map((signer) => (
            <div key={signer.id} data-fancy-sign-signer={signer.id} className="fancy-sign-setup__signer">
              <Input
                type="text"
                label="Name"
                value={signer.name}
                disabled={!editable || busy}
                data-fancy-sign-signer-input="name"
                onChange={(event) => setSigner(signer.id, { name: event.target.value })}
              />
              <Input
                type="email"
                label="Email"
                value={signer.email}
                disabled={!editable || busy}
                data-fancy-sign-signer-input="email"
                onChange={(event) => setSigner(signer.id, { email: event.target.value })}
              />
              <Input
                type="number"
                label="Order"
                min={1}
                value={String(signer.order)}
                disabled={!editable || busy}
                data-fancy-sign-signer-input="order"
                onChange={(event) => {
                  const order = Number.parseInt(event.target.value, 10);
                  if (Number.isInteger(order) && order >= 1) setSigner(signer.id, { order });
                }}
              />
              {editable ? (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  icon="trash-2"
                  disabled={busy}
                  data-fancy-sign-action="remove-signer"
                  data-fancy-sign-signer-id={signer.id}
                  onClick={() => removeSigner(signer.id)}
                >
                  Remove
                </Button>
              ) : null}
            </div>
          ))}
        {editable ? (
          <Button
            type="button"
            size="sm"
            icon="plus"
            disabled={busy}
            data-fancy-sign-action="add-signer"
            onClick={addSigner}
          >
            Add signer
          </Button>
        ) : null}
      </Card>

      <Card variant="outlined" padding="md">
        <Heading as="h3" size="sm">
          Settings
        </Heading>
        <div data-fancy-sign-setting-wrap="per_page" data-fancy-sign-locked={orgLocked ? "org" : undefined}>
          <Select
            label="Per-page marks"
            description={
              orgLocked
                ? "Set by your organisation's admin for every envelope. Never on the final signature page."
                : "Added to every page before the final signature page."
            }
            list={[
              { value: "none", label: "None" },
              { value: "initials", label: "Initials on every page" },
              { value: "signature", label: "Signature on every page" },
            ]}
            value={orgLocked ? orgPerPage : state.settings.per_page}
            disabled={!editable || busy || orgLocked}
            data-fancy-sign-setting="per_page"
            onValueChange={(v) => setSettings({ per_page: v as PerPageMark })}
          />
        </div>
        <Select
          label="Step-up before signing"
          list={[
            { value: "none", label: "Email code only" },
            { value: "passkey", label: "Email code and a passkey" },
          ]}
          value={state.settings.step_up}
          disabled={!editable || busy}
          data-fancy-sign-setting="step_up"
          onValueChange={(v) => setSettings({ step_up: v as StepUp })}
        />
        <div data-fancy-sign-setting="expires_at">
          <DatePicker
            label="Expires (optional)"
            value={isoDate(state.settings.expires_at)}
            disabled={!editable || busy}
            onValueChange={(date: string) => setSettings({ expires_at: date ? `${date}T23:59:59Z` : null })}
          />
        </div>
        <div className="fancy-sign-setup__fixed">
          <Text as="span" size="sm" data-fancy-sign-setting-level="ses">
            Level: <Badge size="sm" variant="soft">SES</Badge>
          </Text>
          <Text as="span" size="sm" data-fancy-sign-setting-seal="none">
            Seal: <Badge size="sm" variant="soft">none</Badge>
          </Text>
          <Text as="span" size="xs" color="muted">
            Other levels and seals are not available yet.
          </Text>
        </div>
      </Card>

      {editable && onSend ? (
        <div className="fancy-sign-setup__actions">
          {problems.length > 0 ? (
            <ul data-fancy-sign-setup-problems="">
              {problems.map((p) => (
                <li key={p}>
                  <Text as="span" size="sm" color="muted">
                    {p}
                  </Text>
                </li>
              ))}
            </ul>
          ) : null}
          <Button
            type="button"
            color="blue"
            icon="send"
            loading={busy && state.pending === null}
            disabled={busy || problems.length > 0 || state.pending !== null}
            data-fancy-sign-action="send"
            onClick={() => propose("send")}
          >
            Send
          </Button>
        </div>
      ) : null}

      {envelopeStatus === "sent" && onVoid ? (
        <Button
          type="button"
          color="red"
          variant="ghost"
          disabled={busy || state.pending !== null}
          data-fancy-sign-action="void"
          onClick={() => propose("void")}
        >
          Void envelope
        </Button>
      ) : null}

      {state.pending === "send" ? (
        <div role="alertdialog" aria-label="Confirm sending" data-fancy-sign-confirm="send" className="fancy-sign__confirm">
          <Callout color="amber">
            Send &quot;{state.title}&quot; to {signerCount} {signerCount === 1 ? "signer" : "signers"}? Each one gets an
            email with a signing link, and the envelope can no longer be edited.
          </Callout>
          <div className="fancy-sign-setup__actions">
            <Button type="button" color="blue" loading={busy} disabled={busy} data-fancy-sign-action="confirm-send" onClick={() => confirm("send")}>
              Send now
            </Button>
            <Button type="button" variant="ghost" disabled={busy} data-fancy-sign-action="cancel-send" onClick={() => cancel("send")}>
              Not yet
            </Button>
          </div>
        </div>
      ) : null}

      {state.pending === "void" ? (
        <div role="alertdialog" aria-label="Confirm voiding" data-fancy-sign-confirm="void" className="fancy-sign__confirm">
          <Callout color="red">
            Voiding stops this envelope for every signer and cannot be undone. Signers who already signed are told.
          </Callout>
          <Textarea
            label="Reason"
            required
            value={state.voidReason}
            maxLength={maxVoidReason}
            disabled={busy}
            data-fancy-sign-void-reason=""
            onChange={(event) => update((c) => ({ ...c, voidReason: event.target.value.slice(0, maxVoidReason) }))}
          />
          <div className="fancy-sign-setup__actions">
            <Button
              type="button"
              color="red"
              loading={busy}
              disabled={busy || state.voidReason.trim().length === 0}
              data-fancy-sign-action="confirm-void"
              onClick={() => confirm("void")}
            >
              Void envelope
            </Button>
            <Button type="button" variant="ghost" disabled={busy} data-fancy-sign-action="cancel-void" onClick={() => cancel("void")}>
              Keep it
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

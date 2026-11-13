import { useCallback, useRef } from "react";
import { Badge, Button, Callout, FileUpload, Text, cn } from "@particle-academy/react-fancy";
import { activityEvent, useSurfaceState } from "./activity";
import { toStateError, type SignClient } from "./client";
import type { SignActivityEvent, SignStateError, VerifyReason, VerifyResult } from "./types";

/** What each named failure means, in words a recipient of the PDF can act on. */
export const VERIFY_REASON_TEXT: Record<VerifyReason, string> = {
  completion_invalid: "The completion record is not a valid fancy-sign completion record.",
  seal_invalid:
    "The seal does not match the host's public key: the completion record was changed, or sealed by a different key.",
  token_mismatch: "The completion token does not match the record it claims to identify.",
  final_hash_mismatch: "This PDF is not the final document the completion record describes.",
  prefix_mismatch:
    "This PDF does not begin with the document as it was sent: the content the signers saw was changed.",
  chain_broken: "The event chain is broken: an event was changed, removed or reordered.",
  chain_head_mismatch: "The events do not end at the chain head the completion record was sealed with.",
};

const CHECK_LABEL: Record<keyof VerifyResult["checks"], string> = {
  seal: "Seal",
  token: "Token",
  final_hash: "Final document hash",
  prefix: "As-sent prefix",
  chain: "Event chain",
};

type FileSlot = "pdf" | "completion" | "events";

export interface SignatureVerifierState {
  /** Names of the picked files. The files themselves stay in the browser. */
  files: Record<FileSlot, string | null>;
  result: VerifyResult | null;
  status: "idle" | "busy" | "error";
  error: SignStateError | null;
}

export function initialVerifierState(): SignatureVerifierState {
  return { files: { pdf: null, completion: null, events: null }, result: null, status: "idle", error: null };
}

export interface SignatureVerifierProps {
  client: SignClient;
  value?: SignatureVerifierState;
  onChange?: (next: SignatureVerifierState) => void;
  defaultValue?: SignatureVerifierState;
  /** Largest upload accepted per file, in bytes. Default 25 MB. */
  maxFileSize?: number;
  /** Root handle. Default `"signature-verifier"`. */
  surfaceId?: string;
  onActivity?: (event: SignActivityEvent) => void;
  className?: string;
}

/**
 * Pick a final PDF and its completion.json (and optionally the events), post
 * them to `/verify`, and show the named reason.
 *
 * The state carries file NAMES, not files: a `File` does not serialise, and an
 * agent has no business producing one. An agent verifies through the bridge's
 * `sign_verify`, not through this surface.
 */
export function SignatureVerifier({
  client,
  value,
  onChange,
  defaultValue,
  maxFileSize = 25 * 1024 * 1024,
  surfaceId = "signature-verifier",
  onActivity,
  className,
}: SignatureVerifierProps) {
  const { state, update } = useSurfaceState(value, defaultValue ?? initialVerifierState(), onChange);
  const files = useRef<Record<FileSlot, File | null>>({ pdf: null, completion: null, events: null });

  const emit = useCallback(
    (action: string, detail?: Record<string, unknown>) => {
      onActivity?.(activityEvent(surfaceId, action, undefined, detail));
    },
    [onActivity, surfaceId],
  );

  const pick = (slot: FileSlot, picked: File[]) => {
    const file = picked[picked.length - 1] ?? null;
    files.current[slot] = file;
    update((c) => ({ ...c, files: { ...c.files, [slot]: file?.name ?? null }, result: null, error: null, status: "idle" }));
    emit("file-picked", { slot, name: file?.name ?? null });
  };

  const verify = async () => {
    const { pdf, completion, events } = files.current;
    if (!pdf || !completion) return;
    update((c) => ({ ...c, status: "busy", error: null, result: null }));
    try {
      const result = await client.verify(events ? { pdf, completion, events } : { pdf, completion });
      update((c) => ({ ...c, result, status: "idle", error: null }));
      emit("verified", { ok: result.ok, reason: result.reason });
    } catch (err) {
      const error = toStateError(err);
      update((c) => ({ ...c, status: "error", error }));
      emit("error", { code: error.code });
    }
  };

  const busy = state.status === "busy";
  const ready = Boolean(state.files.pdf && state.files.completion) && !busy;
  const result = state.result;

  const slot = (name: FileSlot, label: string, hint: string, accept: string) => {
    const picked = state.files[name] ? files.current[name] : null;
    return (
    <div data-fancy-sign-verify-file={name} data-fancy-sign-verify-file-name={state.files[name] ?? ""}>
      <FileUpload
        value={picked ? [picked] : []}
        onChange={(picked) => pick(name, picked)}
        accept={accept}
        maxSize={maxFileSize}
        disabled={busy}
      >
        <FileUpload.Dropzone>
          <Text weight="medium">{label}</Text>
          <Text size="sm" color="muted">
            {state.files[name] ?? hint}
          </Text>
        </FileUpload.Dropzone>
      </FileUpload>
    </div>
    );
  };

  return (
    <div
      data-fancy-sign-surface={surfaceId}
      data-fancy-sign-status={state.status}
      className={cn("fancy-sign fancy-sign-verifier", className)}
    >
      <div className="fancy-sign-verifier__files">
        {slot("pdf", "Final PDF", "Drop the signed PDF here, or click to choose it.", "application/pdf,.pdf")}
        {slot("completion", "completion.json", "The completion record that came with it.", "application/json,.json")}
        {slot("events", "Events (optional)", "The events JSON, to check the audit chain too.", "application/json,.json")}
      </div>

      <Button
        type="button"
        color="blue"
        loading={busy}
        disabled={!ready}
        data-fancy-sign-action="verify"
        onClick={() => void verify()}
      >
        Verify
      </Button>

      {state.error ? (
        <div data-fancy-sign-error={state.error.code} className="fancy-sign__error">
          <Callout color="red">{state.error.message}</Callout>
        </div>
      ) : null}

      {result ? (
        <div data-fancy-sign-verify-ok={String(result.ok)} className="fancy-sign-verifier__result">
          {result.ok ? (
            <Callout color="green">
              Verified. The seal is valid for this record, and the PDF is the final document it describes.
            </Callout>
          ) : (
            <div data-fancy-sign-verify-reason={result.reason ?? "unknown"}>
              <Callout color="red">
                Not verified. {result.reason ? VERIFY_REASON_TEXT[result.reason] ?? result.reason : "No reason was given."}
              </Callout>
            </div>
          )}
          <ul className="fancy-sign-verifier__checks">
            {(Object.keys(CHECK_LABEL) as Array<keyof VerifyResult["checks"]>).map((key) => {
              const v = result.checks[key];
              const outcome = v === true ? "pass" : v === false ? "fail" : "not_checked";
              return (
                <li key={key} data-fancy-sign-verify-check={key} data-fancy-sign-verify-check-result={outcome}>
                  <Text as="span" size="sm">
                    {CHECK_LABEL[key]}
                  </Text>{" "}
                  <Badge size="sm" variant="soft" color={v === true ? "green" : v === false ? "red" : "zinc"}>
                    {v === true ? "Pass" : v === false ? "Fail" : "Not checked"}
                  </Badge>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

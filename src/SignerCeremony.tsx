import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  Badge,
  Button,
  Callout,
  Card,
  Checkbox,
  Heading,
  OtpInput,
  PdfViewer,
  Text,
  Textarea,
  cn,
} from "@particle-academy/react-fancy";
import { activityEvent, isoDateTime, useSurfaceState } from "./activity";
import { toStateError, type SignClient } from "./client";
import { SignFieldView } from "./fields";
import { MARK_LIMITS, isMarkComplete } from "./mark";
import { SignaturePad } from "./SignaturePad";
import type { Mark, SignActivityEvent, SignStateError, SignerView } from "./types";

export type CeremonyStep = "code" | "consent" | "review" | "signed" | "declined";

/**
 * The whole ceremony as one serialisable object.
 *
 * The signer session is NOT in here: it is a bearer credential, and it lives in
 * the `SignClient`. The one-time codes are, because the signer types them into
 * this surface; nothing in this package ever puts them in an activity event.
 */
export interface SignerCeremonyState {
  step: CeremonyStep;
  viewCodeSent: boolean;
  viewCode: string;
  view: SignerView | null;
  consentChecked: boolean;
  /** Ids of the fields the signer has completed. */
  completedFields: string[];
  mark: Mark | null;
  acceptCodeSent: boolean;
  acceptCode: string;
  declining: boolean;
  declineReason: string;
  /** The request-changes message is open (fancy-sign 0.3.0 and later). */
  requestingChanges?: boolean;
  changesText?: string;
  /** Requests sent from THIS ceremony; the server's count is `view.changes_requested`. */
  changesSent?: number;
  /** Pages reported as viewed (a claim from this browser, not proof of reading). */
  viewedPages: number[];
  status: "idle" | "busy" | "error";
  error: SignStateError | null;
}

export function initialCeremonyState(): SignerCeremonyState {
  return {
    step: "code",
    viewCodeSent: false,
    viewCode: "",
    view: null,
    consentChecked: false,
    completedFields: [],
    mark: null,
    acceptCodeSent: false,
    acceptCode: "",
    declining: false,
    declineReason: "",
    requestingChanges: false,
    changesText: "",
    changesSent: 0,
    viewedPages: [],
    status: "idle",
    error: null,
  };
}

export type SignBlocker = "not_loaded" | "envelope_not_open" | "consent" | "fields" | "mark" | "accept_code" | "busy";

const SIX_DIGITS = /^\d{6}$/;

/**
 * Everything standing between the signer and the Sign button. Empty means Sign
 * is enabled. Exported so a host or an observer can say WHY, not just that it
 * is disabled.
 */
export function signBlockers(state: SignerCeremonyState): SignBlocker[] {
  const view = state.view;
  if (!view) return ["not_loaded"];
  const blockers: SignBlocker[] = [];
  if (view.envelope.status !== "sent") blockers.push("envelope_not_open");
  if (view.consent.required && !view.signer.consent_at) blockers.push("consent");
  const done = new Set(state.completedFields);
  if (view.fields.some((f) => f.required && !done.has(f.id))) blockers.push("fields");
  if (!isMarkComplete(state.mark)) blockers.push("mark");
  if (!SIX_DIGITS.test(state.acceptCode)) blockers.push("accept_code");
  if (state.status === "busy") blockers.push("busy");
  return blockers;
}

const BLOCKER_TEXT: Record<SignBlocker, string> = {
  not_loaded: "The envelope has not loaded.",
  envelope_not_open: "This envelope is no longer open for signing.",
  consent: "Agree to sign electronically first.",
  fields: "Complete every required field.",
  mark: "Draw or type your signature.",
  accept_code: "Enter the 6-digit signing code we emailed you.",
  busy: "Working...",
};

/** Plain-language text for the codes a signer can hit. */
export function signerMessage(error: SignStateError): string {
  switch (error.code) {
    case "otp_invalid":
      return "That code is not valid. Check it and try again, or request a new code.";
    case "otp_locked":
      return "Too many attempts with that code. Request a new code to continue.";
    case "otp_rate_limited":
      return "Too many codes requested. Wait a few minutes before asking for another.";
    case "link_invalid":
      return "This signing link is not valid, or has expired.";
    case "session_required":
      return "Your session has ended. Enter a new code to continue.";
    case "envelope_not_open":
      return "This envelope is no longer open for signing.";
    case "already_signed":
      return "You have already signed this envelope.";
    case "already_declined":
      return "You have already declined this envelope.";
    case "fields_incomplete":
      return "Complete every required field before signing.";
    case "consent_required":
      return "Agree to sign electronically before continuing.";
    case "mark_invalid":
      return "Your signature could not be accepted. Clear it and try again.";
    case "step_up_required":
      return "This envelope needs a passkey confirmation before signing.";
    default:
      return error.message;
  }
}

export interface SignerCeremonyProps {
  /** The signer's link token, from the URL. */
  token: string;
  /** A `createSignClient(...)` pointed at the host's routes. It holds the session. */
  client: SignClient;
  /** Controlled state. Omit for an uncontrolled ceremony. */
  value?: SignerCeremonyState;
  /** Always the FULL next state. */
  onChange?: (next: SignerCeremonyState) => void;
  /** Starting state when uncontrolled. */
  defaultValue?: SignerCeremonyState;
  /**
   * Render one page of the as-sent document (1-based). When given, each page is
   * observed and `page.viewed` is reported with its dwell time. Without it the
   * PDF is shown whole, and no per-page claim is made (there are no pages to
   * observe, and inventing them would overstate the evidence).
   */
  renderPage?: (page: number) => ReactNode;
  /**
   * A URL to SHOW for the as-sent PDF instead of the fetched one. The ceremony
   * still opens the document through the signer's session, in every mode: that
   * fetch is the server-observed `document.opened`, and signing is refused
   * (`not_viewed`) without it.
   */
  documentUrl?: string;
  /**
   * The as-sent PDF bytes, once opened through the session. A host rendering
   * its own pages (`renderPage`) renders them from these, so the signer sees
   * exactly the bytes the server recorded as opened.
   */
  onDocument?: (pdf: Blob) => void;
  /** Minimum time on screen before a page counts as viewed. Default 1500 ms. */
  minDwellMs?: number;
  /** Minimum time between two reports for the same page. Default 30000 ms. */
  pageViewIntervalMs?: number;
  /** Most `page.viewed` reports this ceremony sends in total. Default 200. */
  maxPageViewReports?: number;
  /** Most characters in a decline reason. Default 1000. */
  maxDeclineReason?: number;
  /** Root handle. Default `"signer-ceremony"`. */
  surfaceId?: string;
  onActivity?: (event: SignActivityEvent) => void;
  className?: string;
}

/**
 * The signer's whole flow: code gate, consent, document, fields, mark, a fresh
 * accept code, then Sign; or Decline with a reason.
 *
 * **No prop, handle or callback lets anything but the signer complete it.** Every
 * act that carries evidence (verifying a code, consenting, signing, declining) is
 * a button the signer presses. That absence is the design.
 */
export function SignerCeremony({
  token,
  client,
  value,
  onChange,
  defaultValue,
  renderPage,
  documentUrl,
  onDocument,
  minDwellMs = 1500,
  pageViewIntervalMs = 30000,
  maxPageViewReports = 200,
  maxDeclineReason = 1000,
  surfaceId = "signer-ceremony",
  onActivity,
  className,
}: SignerCeremonyProps) {
  const { state, latest, update } = useSurfaceState(value, defaultValue ?? initialCeremonyState(), onChange);

  const emit = useCallback(
    (action: string, target?: string, detail?: Record<string, unknown>) => {
      onActivity?.(activityEvent(surfaceId, action, target, detail));
    },
    [onActivity, surfaceId],
  );

  const fail = useCallback(
    (err: unknown, patch: (current: SignerCeremonyState, code: string) => Partial<SignerCeremonyState> = () => ({})) => {
      const error = toStateError(err);
      update((current) => ({ ...current, ...patch(current, error.code), status: "error", error }));
      emit("error", undefined, { code: error.code });
    },
    [emit, update],
  );

  const busy = () => update((current) => ({ ...current, status: "busy", error: null }));

  const stepFor = (view: SignerView): CeremonyStep => {
    if (view.signer.status === "signed") return "signed";
    if (view.signer.status === "declined") return "declined";
    if (view.consent.required && !view.signer.consent_at) return "consent";
    return "review";
  };

  // --- code gate ---------------------------------------------------------

  const requestViewCode = async () => {
    busy();
    try {
      await client.requestCode(token, "view");
      update((c) => ({ ...c, viewCodeSent: true, viewCode: "", status: "idle", error: null }));
      emit("view-code-requested");
    } catch (err) {
      fail(err);
    }
  };

  const verifyViewCode = async () => {
    const code = latest.current.viewCode;
    if (!SIX_DIGITS.test(code)) return;
    busy();
    try {
      await client.verifyViewCode(token, code);
      const view = await client.getSignerView(token);
      update((c) => ({ ...c, view, viewCode: "", step: stepFor(view), status: "idle", error: null }));
      emit("view-code-verified", view.envelope.id);
    } catch (err) {
      fail(err, (_c, errCode) =>
        errCode === "otp_locked" ? { viewCode: "", viewCodeSent: false } : { viewCode: "" },
      );
    }
  };

  // --- consent -----------------------------------------------------------

  const acceptConsent = async () => {
    const view = latest.current.view;
    if (!view || !latest.current.consentChecked) return;
    busy();
    try {
      const next = await client.consent(token, view.consent.version);
      update((c) => ({ ...c, view: next, step: stepFor(next), status: "idle", error: null }));
      emit("consent-accepted", view.envelope.id, { version: view.consent.version });
    } catch (err) {
      fail(err);
    }
  };

  // --- review: fields, mark, accept code, sign / decline --------------------

  const completeField = (fieldId: string) => {
    update((c) =>
      c.completedFields.includes(fieldId) ? c : { ...c, completedFields: [...c.completedFields, fieldId] },
    );
    emit("field-completed", fieldId);
  };

  const requestAcceptCode = async () => {
    busy();
    try {
      await client.requestCode(token, "accept");
      update((c) => ({ ...c, acceptCodeSent: true, acceptCode: "", status: "idle", error: null }));
      emit("accept-code-requested");
    } catch (err) {
      fail(err);
    }
  };

  const sign = async () => {
    const current = latest.current;
    if (signBlockers(current).length > 0 || !current.view || !current.mark) return;
    const fields: Record<string, true> = {};
    for (const id of current.completedFields) fields[id] = true;
    busy();
    try {
      const next = await client.sign(token, {
        fields,
        mark: current.mark,
        adoption: current.view.adoption_text,
        code: current.acceptCode,
      });
      update((c) => ({ ...c, view: next, step: "signed", acceptCode: "", status: "idle", error: null }));
      emit("signed", current.view.envelope.id, { fields: Object.keys(fields).length, mark: current.mark.kind });
    } catch (err) {
      fail(err, (_c, code) =>
        code === "otp_locked" ? { acceptCode: "", acceptCodeSent: false } : code === "otp_invalid" ? { acceptCode: "" } : {},
      );
    }
  };

  const startDecline = () => {
    update((c) => ({ ...c, declining: true, error: null }));
    emit("decline-started");
  };

  const cancelDecline = () => {
    update((c) => ({ ...c, declining: false, declineReason: "" }));
    emit("decline-cancelled");
  };

  const startRequestChanges = () => {
    update((c) => ({ ...c, requestingChanges: true, declining: false, error: null }));
    emit("request-changes-started");
  };

  const cancelRequestChanges = () => {
    update((c) => ({ ...c, requestingChanges: false, changesText: "" }));
    emit("request-changes-cancelled");
  };

  const requestChanges = async () => {
    const current = latest.current;
    const text = (current.changesText ?? "").trim();
    if (text.length === 0) return;
    busy();
    try {
      const next = await client.requestChanges(token, text);
      // The envelope stays open: back to review, the signer can still sign or decline.
      update((c) => ({ ...c, view: next, requestingChanges: false, changesText: "", changesSent: (c.changesSent ?? 0) + 1, status: "idle", error: null }));
      // Never the text: activity events carry no signer-written content.
      emit("changes-requested", current.view?.envelope.id, { count: next.changes_requested ?? null });
    } catch (err) {
      fail(err);
    }
  };

  const decline = async () => {
    const current = latest.current;
    const reason = current.declineReason.trim();
    if (reason.length === 0) return;
    busy();
    try {
      const next = await client.decline(token, reason);
      update((c) => ({ ...c, view: next, step: "declined", declining: false, status: "idle", error: null }));
      emit("declined", current.view?.envelope.id);
    } catch (err) {
      fail(err);
    }
  };

  // --- page.viewed beacons -------------------------------------------------

  const reportRef = useRef({ client, token, minDwellMs, pageViewIntervalMs, maxPageViewReports, emit, update });
  reportRef.current = { client, token, minDwellMs, pageViewIntervalMs, maxPageViewReports, emit, update };
  const pagesRef = useRef<HTMLDivElement | null>(null);
  const pageCount = state.view?.envelope.pages ?? 0;
  const observing = state.step === "review" && Boolean(renderPage) && pageCount > 0;

  useEffect(() => {
    if (!observing || typeof IntersectionObserver === "undefined" || !pagesRef.current) return;
    const since = new Map<number, number>();
    const lastReport = new Map<number, number>();
    let reports = 0;

    const finish = (page: number) => {
      const start = since.get(page);
      if (start === undefined) return;
      since.delete(page);
      const now = Date.now();
      const ms = now - start;
      const cfg = reportRef.current;
      if (ms < cfg.minDwellMs) return;
      const prev = lastReport.get(page);
      if (prev !== undefined && now - prev < cfg.pageViewIntervalMs) return;
      if (reports >= cfg.maxPageViewReports) return;
      reports += 1;
      lastReport.set(page, now);
      cfg.update((c) => (c.viewedPages.includes(page) ? c : { ...c, viewedPages: [...c.viewedPages, page] }));
      cfg.emit("page-viewed", String(page), { ms });
      // A beacon is best-effort: a failed report must never interrupt the signer.
      cfg.client.reportPageView(cfg.token, page, ms).catch(() => undefined);
    };

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const page = Number((entry.target as HTMLElement).dataset.fancySignPage);
          if (!Number.isInteger(page) || page < 1) continue;
          if (entry.isIntersecting) {
            if (!since.has(page)) since.set(page, Date.now());
          } else {
            finish(page);
          }
        }
      },
      { threshold: 0.5 },
    );
    pagesRef.current.querySelectorAll("[data-fancy-sign-page]").forEach((el) => observer.observe(el));
    return () => {
      observer.disconnect();
      for (const page of Array.from(since.keys())) finish(page);
    };
  }, [observing, pageCount]);

  // --- the as-sent PDF, opened through the session in every mode ----------
  //
  // The server records `document.opened` when the signer's session fetches the
  // as-sent PDF, and refuses to sign until it has. So it is fetched whatever
  // the host shows: the ceremony's own viewer, the host's `renderPage`, or the
  // host's `documentUrl`. Once per ceremony.

  const [fetchedUrl, setFetchedUrl] = useState<string | null>(null);
  const opening = state.step === "review";
  const showsPdf = !renderPage && !documentUrl;
  const onDocumentRef = useRef(onDocument);
  onDocumentRef.current = onDocument;
  useEffect(() => {
    if (!opening) return;
    let cancelled = false;
    let url: string | null = null;
    client
      .signerDocument(token)
      .then((blob) => {
        if (cancelled) return;
        onDocumentRef.current?.(blob);
        if (showsPdf && typeof URL !== "undefined" && typeof URL.createObjectURL === "function") {
          url = URL.createObjectURL(blob);
          setFetchedUrl(url);
        }
      })
      .catch((err) => {
        if (!cancelled) fail(err);
      });
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
    // `fail` and `showsPdf` are read once per opening; re-fetching on their
    // identity would open the document again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opening, client, token]);

  // --- render --------------------------------------------------------------

  const view = state.view;
  const isBusy = state.status === "busy";
  const blockers = signBlockers(state);
  const changesCapped =
    typeof view?.max_change_requests === "number" && (view.changes_requested ?? 0) >= view.max_change_requests;
  const pdfUrl = documentUrl ?? fetchedUrl;

  return (
    <div
      data-fancy-sign-surface={surfaceId}
      data-fancy-sign-step={state.step}
      data-fancy-sign-status={state.status}
      className={cn("fancy-sign fancy-sign-ceremony", className)}
    >
      {view ? (
        <div className="fancy-sign-ceremony__head">
          <Heading as="h2" size="lg">
            {view.envelope.title}
          </Heading>
          <Text as="span" size="sm" color="muted">
            Signing as {view.signer.name} ({view.signer.email})
          </Text>
        </div>
      ) : null}

      {state.error ? (
        <div data-fancy-sign-error={state.error.code} className="fancy-sign__error">
          <Callout color={state.error.code === "otp_invalid" ? "amber" : "red"}>{signerMessage(state.error)}</Callout>
        </div>
      ) : null}

      {state.step === "code" ? (
        <Card variant="outlined" padding="md" data-fancy-sign-panel="code">
          <Text>Enter the code we email you to open this document.</Text>
          <Button
            type="button"
            variant={state.viewCodeSent ? "ghost" : "default"}
            color={state.viewCodeSent ? undefined : "blue"}
            loading={isBusy && !state.viewCodeSent}
            disabled={isBusy}
            data-fancy-sign-action="request-view-code"
            onClick={() => void requestViewCode()}
          >
            {state.viewCodeSent ? "Send a new code" : "Email me a code"}
          </Button>
          {state.viewCodeSent ? (
            <>
              <div data-fancy-sign-code="view">
                <OtpInput
                  length={6}
                  value={state.viewCode}
                  disabled={isBusy}
                  onChange={(code) => update((c) => ({ ...c, viewCode: code.replace(/\D/g, "").slice(0, 6) }))}
                />
              </div>
              <Button
                type="button"
                color="blue"
                loading={isBusy}
                disabled={isBusy || !SIX_DIGITS.test(state.viewCode)}
                data-fancy-sign-action="verify-view-code"
                onClick={() => void verifyViewCode()}
              >
                Continue
              </Button>
            </>
          ) : null}
        </Card>
      ) : null}

      {state.step === "consent" && view ? (
        <Card variant="outlined" padding="md" data-fancy-sign-panel="consent">
          <Heading as="h3" size="md">
            Agree to sign electronically
          </Heading>
          {/* Host-supplied disclosure: plain text, never HTML. */}
          <Text as="div" className="fancy-sign__prose" data-fancy-sign-consent-text={view.consent.version}>
            {view.consent.text}
          </Text>
          <div data-fancy-sign-consent-check={view.consent.version}>
            <Checkbox
              label="I have read this and agree to sign electronically."
              checked={state.consentChecked}
              disabled={isBusy}
              onCheckedChange={(checked) => update((c) => ({ ...c, consentChecked: checked }))}
            />
          </div>
          <Button
            type="button"
            color="blue"
            loading={isBusy}
            disabled={isBusy || !state.consentChecked}
            data-fancy-sign-action="accept-consent"
            onClick={() => void acceptConsent()}
          >
            Continue
          </Button>
        </Card>
      ) : null}

      {state.step === "review" && view ? (
        <>
          <Card variant="outlined" padding="md" data-fancy-sign-panel="document">
            {renderPage && pageCount > 0 ? (
              <div ref={pagesRef} className="fancy-sign-ceremony__pages">
                {Array.from({ length: pageCount }, (_, i) => i + 1).map((n) => (
                  <div
                    key={n}
                    data-fancy-sign-page={n}
                    data-fancy-sign-page-viewed={String(state.viewedPages.includes(n))}
                    className="fancy-sign-ceremony__page"
                  >
                    {renderPage(n)}
                  </div>
                ))}
              </div>
            ) : pdfUrl ? (
              <div data-fancy-sign-document="pdf">
                <PdfViewer src={pdfUrl} title={view.envelope.title} style={{ height: "70vh" }} />
              </div>
            ) : (
              <Text color="muted" data-fancy-sign-document="loading">
                Loading the document...
              </Text>
            )}
          </Card>

          <Card variant="outlined" padding="md" data-fancy-sign-panel="mark">
            <Heading as="h3" size="md">
              Your signature
            </Heading>
            <SignaturePad
              value={state.mark}
              disabled={isBusy || state.declining}
              surfaceId={`${surfaceId}-pad`}
              onActivity={onActivity}
              maxTypedLength={MARK_LIMITS.typedLength}
              onChange={(mark) => update((c) => ({ ...c, mark }))}
            />
            <Text size="sm" color="muted" data-fancy-sign-adoption-text="">
              {view.adoption_text}
            </Text>
          </Card>

          {view.fields.length > 0 ? (
            <div className="fancy-sign-ceremony__fields" data-fancy-sign-panel="fields">
              {view.fields.map((f) => (
                <SignFieldView
                  key={f.id}
                  field={f}
                  completed={state.completedFields.includes(f.id) || f.completed}
                  mark={state.mark}
                  disabled={isBusy || state.declining}
                  blockedReason={f.kind !== "date_signed" && !isMarkComplete(state.mark) ? "Adopt a signature first." : null}
                  onComplete={completeField}
                />
              ))}
            </div>
          ) : null}

          <Card variant="outlined" padding="md" data-fancy-sign-panel="sign">
            <Text>To sign, enter a fresh code. We email it to you now, right before you sign.</Text>
            <Button
              type="button"
              variant={state.acceptCodeSent ? "ghost" : "default"}
              disabled={isBusy || state.declining}
              data-fancy-sign-action="request-accept-code"
              onClick={() => void requestAcceptCode()}
            >
              {state.acceptCodeSent ? "Send a new signing code" : "Email me a signing code"}
            </Button>
            {state.acceptCodeSent ? (
              <div data-fancy-sign-code="accept">
                <OtpInput
                  length={6}
                  value={state.acceptCode}
                  disabled={isBusy || state.declining}
                  onChange={(code) => update((c) => ({ ...c, acceptCode: code.replace(/\D/g, "").slice(0, 6) }))}
                />
              </div>
            ) : null}

            {blockers.length > 0 && !blockers.includes("busy") ? (
              <ul className="fancy-sign-ceremony__blockers" data-fancy-sign-blockers={blockers.join(" ")}>
                {blockers.map((b) => (
                  <li key={b}>
                    <Text as="span" size="sm" color="muted">
                      {BLOCKER_TEXT[b]}
                    </Text>
                  </li>
                ))}
              </ul>
            ) : null}

            <div className="fancy-sign-ceremony__actions">
              <Button
                type="button"
                color="blue"
                loading={isBusy && !state.declining}
                disabled={blockers.length > 0 || state.declining}
                data-fancy-sign-action="sign"
                onClick={() => void sign()}
              >
                Sign
              </Button>
              {!state.declining && !state.requestingChanges ? (
                <Button
                  type="button"
                  variant="ghost"
                  disabled={isBusy || changesCapped}
                  data-fancy-sign-action="start-request-changes"
                  onClick={startRequestChanges}
                >
                  Request changes
                </Button>
              ) : null}
              {!state.declining ? (
                <Button
                  type="button"
                  variant="ghost"
                  disabled={isBusy}
                  data-fancy-sign-action="start-decline"
                  onClick={startDecline}
                >
                  Decline
                </Button>
              ) : null}
            </div>

            {changesCapped ? (
              <Text size="sm" color="muted" data-fancy-sign-changes-cap="">
                You have asked for changes as many times as this envelope allows. You can still sign or decline.
              </Text>
            ) : null}

            {(state.changesSent ?? 0) > 0 && !state.requestingChanges ? (
              <div data-fancy-sign-changes-sent={String(state.changesSent)}>
                <Callout color="blue">
                  Your request was sent to the sender. You can still sign this version or decline it.
                </Callout>
              </div>
            ) : null}

            {state.requestingChanges ? (
              <div role="group" aria-label="Request changes" className="fancy-sign-ceremony__decline">
                <Textarea
                  label="What should change?"
                  required
                  value={state.changesText ?? ""}
                  maxLength={maxDeclineReason}
                  disabled={isBusy}
                  data-fancy-sign-changes-text=""
                  onChange={(event) =>
                    update((c) => ({ ...c, changesText: event.target.value.slice(0, maxDeclineReason) }))
                  }
                />
                <div className="fancy-sign-ceremony__actions">
                  <Button
                    type="button"
                    color="blue"
                    loading={isBusy}
                    disabled={isBusy || (state.changesText ?? "").trim().length === 0}
                    data-fancy-sign-action="confirm-request-changes"
                    onClick={() => void requestChanges()}
                  >
                    Send request
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={isBusy}
                    data-fancy-sign-action="cancel-request-changes"
                    onClick={cancelRequestChanges}
                  >
                    Go back
                  </Button>
                </div>
              </div>
            ) : null}

            {state.declining ? (
              <div role="group" aria-label="Decline to sign" className="fancy-sign-ceremony__decline">
                <Textarea
                  label="Why are you declining?"
                  required
                  value={state.declineReason}
                  maxLength={maxDeclineReason}
                  disabled={isBusy}
                  data-fancy-sign-decline-reason=""
                  onChange={(event) =>
                    update((c) => ({ ...c, declineReason: event.target.value.slice(0, maxDeclineReason) }))
                  }
                />
                <div className="fancy-sign-ceremony__actions">
                  <Button
                    type="button"
                    color="red"
                    loading={isBusy}
                    disabled={isBusy || state.declineReason.trim().length === 0}
                    data-fancy-sign-action="confirm-decline"
                    onClick={() => void decline()}
                  >
                    Decline to sign
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={isBusy}
                    data-fancy-sign-action="cancel-decline"
                    onClick={cancelDecline}
                  >
                    Go back
                  </Button>
                </div>
              </div>
            ) : null}
          </Card>
        </>
      ) : null}

      {state.step === "signed" ? (
        <div data-fancy-sign-panel="signed">
          <Callout color="green">
            You have signed{view ? ` "${view.envelope.title}"` : ""}
            {view?.signer.signed_at ? ` on ${isoDateTime(view.signer.signed_at)}` : ""}. You will receive the
            completed document by email when every signer has finished.
          </Callout>
        </div>
      ) : null}

      {state.step === "declined" ? (
        <div data-fancy-sign-panel="declined">
          <Callout color="zinc">
            You declined to sign. The sender has been told.{" "}
            <Badge size="sm" variant="soft">
              Declined
            </Badge>
          </Callout>
        </div>
      ) : null}
    </div>
  );
}

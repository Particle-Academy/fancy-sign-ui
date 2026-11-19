import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { DataCanonicalError, parseCanonicalData } from "./data";
import { SignFieldView } from "./fields";
import { MARK_LIMITS, isMarkComplete } from "./mark";
import { SignaturePad } from "./SignaturePad";
import type { Field, Mark, SignActivityEvent, SignStateError, SignerView } from "./types";

/** Data mode: one of the signer's fields, as the host's template sees it. */
export interface DataField {
  id: string;
  kind: Field["kind"];
  required: boolean;
  label: string | null;
  /** `{ pointer }` into the data (a hint for the template), or null. */
  anchor: Field["anchor"];
  completed: boolean;
}

/**
 * Data mode: what the ceremony hands the host's `renderData`, so the host can
 * place the ceremony's controls inside its own layout. Nothing here places
 * anything for it, and nothing here completes a field: `renderField` returns a
 * control the SIGNER presses.
 */
export interface DataRenderContext {
  /** This signer's fields and their state. */
  fields: DataField[];
  /** The ceremony's own control for a field, bound to ceremony state. Put it wherever the template wants. Null for an unknown id. */
  renderField: (id: string) => ReactNode;
  /** "Show me this field": fired when the signer presses Show in the fields checklist. Returns an unsubscribe. */
  onLocate: (handler: (field: DataField) => void) => () => void;
  /** The envelope's `sent_at`, for a stable "as of" date in the rendering. */
  now: string | null;
  /**
   * Tell the ceremony how many pages the template laid out (1 for one
   * continuous page). Posts the `document.rendered` claim with the `renderer`
   * prop once per change of layout; page elements marked
   * `data-fancy-sign-page="n"` are then observed for `page.viewed`. Call it
   * from an effect, not during render.
   */
  reportLayout: (layout: { pages: number }) => void;
}

/**
 * `waiting`: the backend refused this signer with `not_your_turn` (fancy-sign
 * `settings.order: "sequential"`, an earlier signer has not finished). Nothing
 * to act on; the signer is emailed a link when it is their turn.
 */
export type CeremonyStep = "code" | "consent" | "review" | "signed" | "declined" | "waiting";

/**
 * The panel whose action caused `error`. The error renders inside that panel,
 * beside the control, instead of in the top banner. Absent or null means a
 * ceremony-level error (the document failed to load, a restored state), which
 * keeps the banner.
 */
export type CeremonyErrorPanel = "code" | "consent" | "sign" | "request-changes" | "decline";

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
  /** Where `error` came from; see `CeremonyErrorPanel`. */
  errorPanel?: CeremonyErrorPanel | null;
  /**
   * Data mode: has the data received been proved to be the signed data? Set
   * to `verified` only after its fsig-data-1 hash matched `data_sha256`;
   * `refused` when it did not (nothing is rendered). Sign is blocked until
   * `verified`.
   */
  dataCheck?: "pending" | "verified" | "refused" | null;
  /** Data mode: the pages the host's template last reported (a claim posted as `document.rendered`). */
  reportedPages?: number | null;
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
    errorPanel: null,
    dataCheck: null,
    reportedPages: null,
  };
}

/** `data`: a data-mode envelope whose data has not been proved to be the signed data. */
export type SignBlocker = "not_loaded" | "envelope_not_open" | "consent" | "data" | "fields" | "mark" | "accept_code" | "busy";

function isDataView(view: SignerView | null | undefined): boolean {
  return view?.envelope.mode === "data";
}

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
  if (isDataView(view) && state.dataCheck !== "verified") blockers.push("data");
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
  data: "The document has not been checked yet.",
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
    case "not_your_turn":
      return "It is not your turn to sign yet. We will email you when the signers before you have finished.";
    case "data_hash_mismatch":
      return "The document received does not match the one you were asked to sign, so it is not shown. Do not sign; contact the sender.";
    case "data_invalid":
      return "The document received could not be checked, so it is not shown. Contact the sender.";
    default:
      return error.message;
  }
}

/** The `renderer` label as the server takes it: controls stripped, trimmed, at most 200 characters; null when empty. */
function cleanRenderer(value: string | undefined): string | null {
  if (typeof value !== "string") return null;
  let out = "";
  for (const ch of value) {
    const c = ch.codePointAt(0)!;
    if (c < 0x20 || (c >= 0x7f && c < 0xa0)) continue;
    out += ch;
  }
  out = Array.from(out.trim()).slice(0, 200).join("").trim();
  return out.length > 0 ? out : null;
}

/** Closing a panel takes its error with it; the error would have nowhere to show. */
function clearedIf(state: SignerCeremonyState, panel: CeremonyErrorPanel): Partial<SignerCeremonyState> {
  return state.errorPanel === panel ? { error: null, errorPanel: null, status: "idle" } : {};
}

/**
 * Where focus goes when a panel shows an error: the control the signer acts on
 * next. The first selector that matches an enabled element wins.
 */
const ERROR_FOCUS: Record<CeremonyErrorPanel, string[]> = {
  code: ['[data-fancy-sign-code="view"] input', '[data-fancy-sign-action="request-view-code"]'],
  consent: ['[data-fancy-sign-action="accept-consent"]'],
  sign: ['[data-fancy-sign-code="accept"] input', '[data-fancy-sign-action="request-accept-code"]'],
  "request-changes": ["[data-fancy-sign-changes-text]", '[data-fancy-sign-action="confirm-request-changes"]'],
  decline: ["[data-fancy-sign-decline-reason]", '[data-fancy-sign-action="confirm-decline"]'],
};

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
  /**
   * Data mode (fancy-sign 0.7): render the signed data with the host's CURRENT
   * template. `data` is the object parsed from the canonical bytes the
   * ceremony fetched and proved against `data_sha256`; `ctx` places the
   * ceremony's field controls. Read at every render, never stored: a new
   * template reaches every open envelope with no resend. Without it a data
   * envelope shows an error, never raw JSON.
   */
  renderData?: (data: Record<string, unknown>, ctx: DataRenderContext) => ReactNode;
  /**
   * Data mode: the template AND app release `renderData` draws with, e.g.
   * `"quote-v7 @ shop 2026.11.19"` (1 to 200 characters). Posted in the
   * `document.rendered` claim; without it no claim is made.
   */
  renderer?: string;
  /** Data mode: most `document.rendered` claims this ceremony posts. Default 20. */
  maxRenderReports?: number;
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
  renderData,
  renderer,
  maxRenderReports = 20,
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
    (
      err: unknown,
      panel: CeremonyErrorPanel | null,
      patch: (current: SignerCeremonyState, code: string) => Partial<SignerCeremonyState> = () => ({}),
    ) => {
      const error = err instanceof DataCanonicalError ? { code: err.code, message: err.message } : toStateError(err);
      if (error.code === "not_your_turn") {
        // Not a failure the signer can fix: the whole ceremony waits for an earlier signer.
        update((current) => ({ ...current, step: "waiting", status: "idle", error: null, errorPanel: null }));
        emit("waiting");
        return;
      }
      update((current) => ({ ...current, ...patch(current, error.code), status: "error", error, errorPanel: panel }));
      emit("error", undefined, { code: error.code });
    },
    [emit, update],
  );

  const busy = () => update((current) => ({ ...current, status: "busy", error: null, errorPanel: null }));

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
      fail(err, "code");
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
      fail(err, "code", (_c, errCode) =>
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
      fail(err, "consent");
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
      fail(err, "sign");
    }
  };

  const sign = async () => {
    const current = latest.current;
    if (signBlockers(current).length > 0 || !current.view || !current.mark) return;
    const fields: Record<string, true> = {};
    for (const id of current.completedFields) fields[id] = true;
    busy();
    try {
      const dataSha = isDataView(current.view) ? current.view.envelope.data_sha256 : undefined;
      const next = await client.sign(token, {
        fields,
        mark: current.mark,
        adoption: current.view.adoption_text,
        code: current.acceptCode,
        // Data mode: the hash of what the signer is signing; the server refuses a mismatch before the code is spent.
        ...(dataSha !== undefined ? { data_sha256: dataSha } : {}),
      });
      update((c) => ({ ...c, view: next, step: "signed", acceptCode: "", status: "idle", error: null }));
      emit("signed", current.view.envelope.id, { fields: Object.keys(fields).length, mark: current.mark.kind });
    } catch (err) {
      fail(err, "sign", (_c, code) =>
        code === "otp_locked" ? { acceptCode: "", acceptCodeSent: false } : code === "otp_invalid" ? { acceptCode: "" } : {},
      );
    }
  };

  const startDecline = () => {
    update((c) => ({ ...c, declining: true, error: null, errorPanel: null }));
    emit("decline-started");
  };

  const cancelDecline = () => {
    update((c) => ({ ...c, declining: false, declineReason: "", ...clearedIf(c, "decline") }));
    emit("decline-cancelled");
  };

  const startRequestChanges = () => {
    update((c) => ({ ...c, requestingChanges: true, declining: false, error: null, errorPanel: null }));
    emit("request-changes-started");
  };

  const cancelRequestChanges = () => {
    update((c) => ({ ...c, requestingChanges: false, changesText: "", ...clearedIf(c, "request-changes") }));
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
      fail(err, "request-changes");
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
      fail(err, "decline");
    }
  };

  // --- page.viewed beacons -------------------------------------------------

  const reportRef = useRef({ client, token, minDwellMs, pageViewIntervalMs, maxPageViewReports, emit, update });
  reportRef.current = { client, token, minDwellMs, pageViewIntervalMs, maxPageViewReports, emit, update };
  const pagesRef = useRef<HTMLDivElement | null>(null);
  const dataMode = isDataView(state.view);
  // Data mode: pages exist only as the host's template reported them, and only
  // elements it marked data-fancy-sign-page are observed. No layout, no claim.
  const pageCount = dataMode ? (state.reportedPages ?? 0) : (state.view?.envelope.pages ?? 0);
  const observing =
    state.step === "review" && pageCount > 0 && (dataMode ? state.dataCheck === "verified" && Boolean(renderData) : Boolean(renderPage));

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

  // --- data mode: the signed data, fetched through the session and proved ----
  //
  // The fetch is the server-observed `document.opened`. The bytes are parsed
  // here and canonicalised again; only when their fsig-data-1 hash equals the
  // envelope's `data_sha256` (and the header the server sent beside them) is
  // the parsed object handed to the host. So the host's template renders the
  // data that is signed, and cannot be handed anything else through this
  // ceremony. Without `renderData` nothing is fetched: there is no way to show
  // the signer the data, so it must not count as opened.
  const [signedData, setSignedData] = useState<Record<string, unknown> | null>(null);
  const expectedSha = dataMode ? (state.view?.envelope.data_sha256 ?? null) : null;
  const canRenderData = Boolean(renderData);
  useEffect(() => {
    if (!opening || !dataMode || !canRenderData) return;
    let cancelled = false;
    setSignedData(null);
    update((c) => ({ ...c, dataCheck: "pending" }));
    (async () => {
      const served = await client.signerData(token);
      const expected = expectedSha ?? "";
      if (expected.length === 0 || (served.sha256 !== null && served.sha256.toLowerCase() !== expected.toLowerCase())) {
        throw new DataCanonicalError("data_hash_mismatch", "The data received does not match the data that is signed.");
      }
      return parseCanonicalData(served.text, expected);
    })()
      .then((parsed) => {
        if (cancelled) return;
        setSignedData(parsed.data);
        update((c) => ({ ...c, dataCheck: "verified" }));
        emit("data-verified", state.view?.envelope.id, { data_sha256: parsed.sha256 });
      })
      .catch((err) => {
        if (cancelled) return;
        if (err instanceof DataCanonicalError) update((c) => ({ ...c, dataCheck: "refused" }));
        // Ceremony-level: no panel caused it, so it keeps the top banner.
        fail(err, null);
      });
    return () => {
      cancelled = true;
    };
    // Once per opening of this envelope's data; `fail`, `emit` and `update` are read then.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opening, dataMode, canRenderData, client, token, expectedSha]);

  // Locate subscribers and the rendering claim, stable across renders.
  const locateRef = useRef(new Set<(field: DataField) => void>());
  const onLocate = useCallback((handler: (field: DataField) => void) => {
    locateRef.current.add(handler);
    return () => {
      locateRef.current.delete(handler);
    };
  }, []);
  const claimRef = useRef({ client, token, renderer, expectedSha, maxRenderReports, emit, update });
  claimRef.current = { client, token, renderer, expectedSha, maxRenderReports, emit, update };
  const claimed = useRef<{ pages: number | null; reports: number }>({ pages: null, reports: 0 });
  const reportLayout = useCallback((layout: { pages: number }) => {
    const pages = layout?.pages;
    if (typeof pages !== "number" || !Number.isInteger(pages) || pages < 1) return;
    const cfg = claimRef.current;
    cfg.update((c) => (c.reportedPages === pages ? c : { ...c, reportedPages: pages }));
    const label = cleanRenderer(cfg.renderer);
    if (label === null || !cfg.expectedSha) return;
    if (claimed.current.pages === pages || claimed.current.reports >= cfg.maxRenderReports) return;
    claimed.current = { pages, reports: claimed.current.reports + 1 };
    cfg.emit("rendered", undefined, { pages, renderer: label });
    // A claim is best-effort: a failed report must never interrupt the signer.
    cfg.client.reportRendered(cfg.token, { data_sha256: cfg.expectedSha, renderer: label, pages }).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!opening || dataMode) return;
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
        // Ceremony-level: no panel caused it, so it keeps the top banner.
        if (!cancelled) fail(err, null);
      });
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
    // `fail` and `showsPdf` are read once per opening; re-fetching on their
    // identity would open the document again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opening, dataMode, client, token]);

  // --- render --------------------------------------------------------------

  const view = state.view;
  const isBusy = state.status === "busy";
  const blockers = signBlockers(state);
  const changesCapped =
    typeof view?.max_change_requests === "number" && (view.changes_requested ?? 0) >= view.max_change_requests;
  const pdfUrl = documentUrl ?? fetchedUrl;

  // --- data mode: the context the host's template places controls with ------

  const fieldView = (f: Field, slot?: string) => (
    <SignFieldView
      field={f}
      completed={state.completedFields.includes(f.id) || f.completed}
      mark={state.mark}
      disabled={isBusy || state.declining}
      blockedReason={f.kind !== "date_signed" && !isMarkComplete(state.mark) ? "Adopt a signature first." : null}
      onComplete={completeField}
      className={slot}
    />
  );
  const dataFields: DataField[] = (view?.fields ?? []).map((f) => ({
    id: f.id,
    kind: f.kind,
    required: f.required,
    label: f.label,
    anchor: f.anchor,
    completed: state.completedFields.includes(f.id) || f.completed,
  }));
  const locate = (f: DataField) => {
    for (const handler of Array.from(locateRef.current)) {
      try {
        handler(f);
      } catch {
        // A host's locate handler cannot break the ceremony.
      }
    }
    emit("locate", f.id, { pointer: f.anchor && "pointer" in f.anchor ? f.anchor.pointer : null });
  };
  const fieldsKey = JSON.stringify(dataFields);
  const renderKey = `${fieldsKey}|${JSON.stringify(state.mark)}|${isBusy}|${state.declining}`;
  const fieldViewRef = useRef(fieldView);
  fieldViewRef.current = fieldView;
  const ctx: DataRenderContext = useMemo(
    () => ({
      fields: JSON.parse(fieldsKey) as DataField[],
      renderField: (id: string) => {
        const f = view?.fields.find((x) => x.id === id);
        return f ? <span data-fancy-sign-field-slot={id}>{fieldViewRef.current(f, "fancy-sign-field--placed")}</span> : null;
      },
      onLocate,
      now: view?.envelope.sent_at ?? null,
      reportLayout,
    }),
    // A new context when anything a placed control shows changes, and not otherwise.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [renderKey, view, onLocate, reportLayout],
  );

  // Is the panel that caused the error on screen? If not (a host restored a
  // state, or the panel closed), the error falls back to the top banner rather
  // than vanishing.
  const panelShown = (panel: CeremonyErrorPanel | null | undefined): panel is CeremonyErrorPanel => {
    switch (panel) {
      case "code":
        return state.step === "code";
      case "consent":
        return state.step === "consent" && Boolean(view);
      case "sign":
        return state.step === "review" && Boolean(view);
      case "request-changes":
        return state.step === "review" && Boolean(view) && Boolean(state.requestingChanges);
      case "decline":
        return state.step === "review" && Boolean(view) && state.declining;
      default:
        return false;
    }
  };
  const errorPanel = state.error && panelShown(state.errorPanel) ? state.errorPanel : null;

  const errorView = (panel: CeremonyErrorPanel | null) =>
    state.error ? (
      <div
        role="alert"
        data-fancy-sign-error={state.error.code}
        data-fancy-sign-error-panel={panel ?? undefined}
        className="fancy-sign__error"
      >
        <Callout color={state.error.code === "otp_invalid" ? "amber" : "red"}>{signerMessage(state.error)}</Callout>
      </div>
    ) : null;
  const panelError = (panel: CeremonyErrorPanel) => (errorPanel === panel ? errorView(panel) : null);

  // A new panel error moves focus to the control the signer acts on next, so a
  // keyboard or screen-reader user lands where the fix is. Keyed on the error
  // object: typing afterwards does not steal focus back.
  const rootRef = useRef<HTMLDivElement | null>(null);
  const focusedError = useRef<SignStateError | null>(null);
  useEffect(() => {
    const error = state.error;
    if (!error || !errorPanel || focusedError.current === error) return;
    focusedError.current = error;
    for (const selector of ERROR_FOCUS[errorPanel]) {
      const el = rootRef.current?.querySelector<HTMLElement>(selector);
      if (el && !(el as HTMLInputElement).disabled) {
        el.focus();
        return;
      }
    }
  }, [state.error, errorPanel]);

  return (
    <div
      ref={rootRef}
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

      {/* The top banner: ceremony-level errors only. Panel errors render in their panel. */}
      {state.error && !errorPanel ? errorView(null) : null}

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
          {!state.viewCodeSent ? panelError("code") : null}
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
              {panelError("code")}
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
          {panelError("consent")}
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
            {dataMode ? (
              !renderData ? (
                <div data-fancy-sign-document="no-renderer">
                  <Callout color="red">
                    This document cannot be shown here: the page has no template for it. Do not sign; contact the sender.
                  </Callout>
                </div>
              ) : state.dataCheck === "refused" ? (
                <div data-fancy-sign-document="refused">
                  <Text color="muted">The document is not shown because it could not be checked against what is signed.</Text>
                </div>
              ) : signedData && state.dataCheck === "verified" ? (
                <div
                  ref={pagesRef}
                  data-fancy-sign-document="data"
                  data-fancy-sign-data-sha256={view.envelope.data_sha256}
                  className="fancy-sign-ceremony__data"
                >
                  {renderData(signedData, ctx)}
                </div>
              ) : (
                <Text color="muted" data-fancy-sign-document="loading">
                  Loading the document...
                </Text>
              )
            ) : renderPage && pageCount > 0 ? (
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
              {view.fields.map((f) =>
                dataMode ? (
                  // Data mode: the checklist is the fallback UI, complete on its own. Show asks the
                  // host's template to bring the field into view.
                  <div key={f.id} className="fancy-sign-ceremony__checklist-item" data-fancy-sign-checklist={f.id}>
                    {fieldView(f)}
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      disabled={state.dataCheck !== "verified"}
                      data-fancy-sign-field-show={f.id}
                      onClick={() => locate(dataFields.find((d) => d.id === f.id)!)}
                    >
                      Show
                    </Button>
                  </div>
                ) : (
                  <SignFieldView
                    key={f.id}
                    field={f}
                    completed={state.completedFields.includes(f.id) || f.completed}
                    mark={state.mark}
                    disabled={isBusy || state.declining}
                    blockedReason={f.kind !== "date_signed" && !isMarkComplete(state.mark) ? "Adopt a signature first." : null}
                    onComplete={completeField}
                  />
                ),
              )}
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
            {/* Beside the code boxes and the Sign button, not above a 70vh viewer. */}
            {panelError("sign")}

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
                {panelError("request-changes")}
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
                {panelError("decline")}
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

      {state.step === "waiting" ? (
        <div data-fancy-sign-panel="waiting">
          <Callout color="blue">
            {signerMessage({ code: "not_your_turn", message: "" })}
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

/**
 * `@particle-academy/fancy-sign-ui/client`: a typed client for the fancy-sign
 * wire contract. **React-free**, so a Vue, Svelte or vanilla frontend can use it
 * without React in its tree (`tests/packaging.test.ts` asserts that).
 *
 * One function per endpoint. Every non-2xx answer is the kit-wide error
 * envelope (CC-fancy-0031): `{error, message, errors?, requestId}`, a 422 being
 * `validation_failed` with the fancy-sign code as its one item. It becomes a
 * `SignError` whose `code` is from the closed `SignErrorCode` set, or one the client names itself
 * (`network_error`, `server_error`, `unknown_error`). A code outside the closed
 * set is never passed through as if it were in it: a UI branching on
 * `otp_locked` must not be fooled by a backend inventing `otp_lockedout`.
 */
import type {
  Completion,
  Envelope,
  EnvelopeInput,
  OrgSettings,
  OtpPurpose,
  OtpSent,
  PerPageMark,
  PublicKey,
  SignClientErrorCode,
  SignErrorCode,
  SignEvent,
  SignInput,
  SignerSession,
  SignerView,
  VerifyResult,
} from "./types";

export type * from "./types";

const SIGN_ERROR_CODES: ReadonlySet<string> = new Set<SignErrorCode>([
  "invalid_request",
  "not_found",
  "forbidden",
  "link_invalid",
  "otp_invalid",
  "otp_locked",
  "otp_rate_limited",
  "session_required",
  "consent_required",
  "not_viewed",
  "fields_incomplete",
  "mark_invalid",
  "envelope_not_open",
  "envelope_not_draft",
  "already_signed",
  "already_declined",
  "step_up_required",
  "limit_exceeded",
  "not_your_turn",
]);

/** True when `code` is in the closed set the backends emit. */
export function isSignErrorCode(code: unknown): code is SignErrorCode {
  return typeof code === "string" && SIGN_ERROR_CODES.has(code);
}

/** A failed call. `status` is the HTTP status, or `0` when no response arrived. */
export class SignError extends Error {
  readonly code: SignErrorCode | SignClientErrorCode;
  readonly status: number;
  /** The raw code from the body, when one arrived but was not in the closed set. */
  readonly serverCode?: string;
  /** The envelope's `requestId`, to quote when reporting a problem. */
  readonly requestId?: string;

  constructor(
    code: SignErrorCode | SignClientErrorCode,
    message: string,
    status: number,
    serverCode?: string,
    requestId?: string,
  ) {
    super(message);
    this.name = "SignError";
    this.code = code;
    this.status = status;
    if (serverCode !== undefined) this.serverCode = serverCode;
    if (requestId !== undefined) this.requestId = requestId;
  }
}

export interface SignClientOptions {
  /** Where the routes are mounted, e.g. `https://app.example.com/fancy-sign`. A trailing slash is fine. */
  baseUrl: string;
  /** Defaults to the global `fetch`. */
  fetch?: typeof fetch;
  /** A signer session from an earlier view code. `verifyViewCode` sets it for you. */
  session?: string;
  /** Extra headers on every request (a CSRF token, for example). */
  headers?: Record<string, string>;
  /** `fetch` credentials mode. Default `"same-origin"`. */
  credentials?: RequestCredentials;
  /**
   * Send the `XSRF-TOKEN` cookie back as `X-XSRF-TOKEN` on every POST and PUT
   * to the page's own origin, read fresh each time. Laravel's `web` middleware
   * (the default `sender_middleware`) refuses a state-changing request without
   * it. Default `true`; nothing is sent when there is no such cookie.
   */
  xsrf?: boolean;
}

/** The XSRF-TOKEN cookie, decoded, when there is a document and the URL is on its origin. */
function xsrfToken(url: string): string | null {
  const doc = (globalThis as { document?: { cookie?: string; baseURI?: string } }).document;
  if (!doc || typeof doc.cookie !== "string") return null;
  try {
    const page = new URL(doc.baseURI ?? "");
    if (new URL(url, page).origin !== page.origin) return null;
  } catch {
    return null;
  }
  const pair = doc.cookie.split("; ").find((c) => c.startsWith("XSRF-TOKEN="));
  if (!pair) return null;
  try {
    return decodeURIComponent(pair.slice("XSRF-TOKEN=".length));
  } catch {
    return null;
  }
}

/** What `verify` uploads. Files as picked, or already-parsed JSON. */
export interface VerifyInput {
  pdf: Blob;
  completion: Blob | string | Completion | Record<string, unknown>;
  events?: Blob | string | SignEvent[];
}

/** The certificate as JSON (`?format=json`). Shape beyond these keys is the backend's. */
export interface CertificateJson {
  envelope?: Envelope;
  completion?: Completion | null;
  events?: SignEvent[];
  [key: string]: unknown;
}

export interface SignClient {
  getSession(): string | null;
  setSession(session: string | null): void;

  // Sender (authenticated by the host's middleware)
  listEnvelopes(): Promise<Envelope[]>;
  createEnvelope(input: EnvelopeInput): Promise<Envelope>;
  getEnvelope(id: string): Promise<Envelope>;
  updateEnvelope(id: string, input: Partial<EnvelopeInput>): Promise<Envelope>;
  sendEnvelope(id: string): Promise<Envelope>;
  voidEnvelope(id: string, reason: string): Promise<Envelope>;
  remindEnvelope(id: string): Promise<Envelope>;
  listEvents(id: string): Promise<SignEvent[]>;
  getCertificate(id: string): Promise<CertificateJson>;
  getCertificatePdf(id: string): Promise<Blob>;
  getDocument(id: string): Promise<Blob>;
  certificateUrl(id: string): string;
  documentUrl(id: string): string;
  /** The signed-in sender's organisation settings (`not_found` with no organisation). */
  getOrgSettings(): Promise<OrgSettings>;
  /** Change them. Only an org admin may (`forbidden` otherwise). */
  updateOrgSettings(input: { per_page: PerPageMark }): Promise<OrgSettings>;

  // Signer (link token, then a session after the view code)
  requestCode(token: string, purpose: OtpPurpose): Promise<OtpSent>;
  verifyViewCode(token: string, code: string): Promise<SignerSession>;
  getSignerView(token: string): Promise<SignerView>;
  consent(token: string, version: string): Promise<SignerView>;
  signerDocument(token: string): Promise<Blob>;
  reportPageView(token: string, page: number, ms: number): Promise<void>;
  sign(token: string, input: SignInput): Promise<SignerView>;
  decline(token: string, reason: string): Promise<SignerView>;
  /** Ask the sender for changes. The envelope stays open (fancy-sign 0.3.0 and later). */
  requestChanges(token: string, text: string): Promise<SignerView>;

  // Public
  verify(input: VerifyInput): Promise<VerifyResult>;
  publicKey(): Promise<PublicKey>;
}

const SESSION_HEADER = "X-Fancy-Sign-Session";

/**
 * Strip trailing slashes by scanning from the end. Replaces `/\/+$/`, which is
 * quadratic on a run of slashes that is not at the end (CodeQL
 * js/polynomial-redos; 8 s on 100,000 slashes).
 */
function trimTrailingSlashes(value: string): string {
  let end = value.length;
  while (end > 0 && value.charCodeAt(end - 1) === 47 /* "/" */) end--;
  return value.slice(0, end);
}

export function createSignClient(options: SignClientOptions): SignClient {
  const base = trimTrailingSlashes(options.baseUrl);
  let session: string | null = options.session ?? null;
  const credentials = options.credentials ?? "same-origin";

  const doFetch: typeof fetch = (input, init) => {
    const impl = options.fetch ?? globalThis.fetch;
    return impl(input, init);
  };

  const enc = encodeURIComponent;
  const signerPath = (token: string, rest: string) => `/s/${enc(token)}${rest}`;

  async function raw(
    method: string,
    path: string,
    init: { json?: unknown; body?: BodyInit; signer?: boolean } = {},
  ): Promise<Response> {
    const headers: Record<string, string> = { Accept: "application/json", ...options.headers };
    let body: BodyInit | undefined = init.body;
    if (init.json !== undefined) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(init.json);
    }
    if (init.signer && session) {
      headers[SESSION_HEADER] = session;
    }
    if (method !== "GET" && options.xsrf !== false) {
      const token = xsrfToken(`${base}${path}`);
      if (token !== null) headers["X-XSRF-TOKEN"] = token;
    }

    let response: Response;
    try {
      response = await doFetch(`${base}${path}`, { method, headers, body, credentials });
    } catch (err) {
      const message = err instanceof Error ? err.message : "The request could not be sent.";
      throw new SignError("network_error", message, 0);
    }
    if (!response.ok) {
      throw await toError(response);
    }
    return response;
  }

  async function json<T>(
    method: string,
    path: string,
    init: { json?: unknown; body?: BodyInit; signer?: boolean } = {},
  ): Promise<T> {
    const response = await raw(method, path, init);
    const text = await response.text();
    return (text.length > 0 ? JSON.parse(text) : null) as T;
  }

  async function blob(path: string, signer = false): Promise<Blob> {
    const response = await raw("GET", path, { signer });
    return response.blob();
  }

  return {
    getSession: () => session,
    setSession: (next) => {
      session = next;
    },

    listEnvelopes: () => json("GET", "/envelopes"),
    createEnvelope: (input) => json("POST", "/envelopes", { json: input }),
    getEnvelope: (id) => json("GET", `/envelopes/${enc(id)}`),
    updateEnvelope: (id, input) => json("PUT", `/envelopes/${enc(id)}`, { json: input }),
    sendEnvelope: (id) => json("POST", `/envelopes/${enc(id)}/send`, { json: {} }),
    voidEnvelope: (id, reason) => json("POST", `/envelopes/${enc(id)}/void`, { json: { reason } }),
    remindEnvelope: (id) => json("POST", `/envelopes/${enc(id)}/remind`, { json: {} }),
    listEvents: (id) => json("GET", `/envelopes/${enc(id)}/events`),
    getCertificate: (id) => json("GET", `/envelopes/${enc(id)}/certificate?format=json`),
    getCertificatePdf: (id) => blob(`/envelopes/${enc(id)}/certificate`),
    getDocument: (id) => blob(`/envelopes/${enc(id)}/document`),
    certificateUrl: (id) => `${base}/envelopes/${enc(id)}/certificate`,
    documentUrl: (id) => `${base}/envelopes/${enc(id)}/document`,
    getOrgSettings: () => json("GET", "/org/settings"),
    updateOrgSettings: (input) => json("PUT", "/org/settings", { json: input }),

    requestCode: (token, purpose) =>
      json("POST", signerPath(token, "/otp"), { json: { purpose }, signer: true }),
    verifyViewCode: async (token, code) => {
      const answer = await json<SignerSession>("POST", signerPath(token, "/otp/verify"), {
        json: { purpose: "view", code },
      });
      session = answer.session;
      return answer;
    },
    getSignerView: (token) => json("GET", signerPath(token, "/envelope"), { signer: true }),
    consent: (token, version) =>
      json("POST", signerPath(token, "/consent"), { json: { version }, signer: true }),
    signerDocument: (token) => blob(signerPath(token, "/document"), true),
    reportPageView: async (token, page, ms) => {
      await raw("POST", signerPath(token, "/events"), {
        json: { type: "page.viewed", page, ms },
        signer: true,
      });
    },
    sign: (token, input) => json("POST", signerPath(token, "/sign"), { json: input, signer: true }),
    decline: (token, reason) =>
      json("POST", signerPath(token, "/decline"), { json: { reason }, signer: true }),
    requestChanges: (token, text) =>
      json("POST", signerPath(token, "/request-changes"), { json: { text }, signer: true }),

    verify: async (input) => {
      // The PDF is the one file part. The completion and events are string
      // fields: a picked .json file is read to text first, so the backend
      // never has to accept two encodings of the same field.
      const form = new FormData();
      form.append("pdf", input.pdf);
      form.append("completion", await asText(input.completion));
      if (input.events !== undefined) {
        form.append("events", await asText(input.events));
      }
      return json("POST", "/verify", { body: form });
    },
    publicKey: () => json("GET", "/public-key"),
  };
}

async function asText(value: Blob | string | object): Promise<string> {
  if (typeof value === "string") return value;
  if (value instanceof Blob) return readBlobText(value);
  return JSON.stringify(value);
}

function readBlobText(blob: Blob): Promise<string> {
  if (typeof blob.text === "function") return blob.text();
  // Older environments (and jsdom) without Blob.prototype.text.
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error ?? new Error("Could not read the file."));
    reader.readAsText(blob);
  });
}

async function toError(response: Response): Promise<SignError> {
  const status = response.status;
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(await response.text());
  } catch {
    parsed = null;
  }
  // The kit-wide error envelope. A 422 is validation_failed: the fancy-sign
  // code is its one item. Anything else carries the code at the top level.
  const body = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  const top = typeof body.error === "string" ? body.error : undefined;
  const items = Array.isArray(body.errors) ? body.errors : [];
  const item = top === "validation_failed" && items[0] && typeof items[0] === "object" ? (items[0] as Record<string, unknown>) : undefined;
  const code = item ? (typeof item.error === "string" ? item.error : undefined) : top;
  const text = item && typeof item.message === "string" ? item.message : body.message;
  const message = typeof text === "string" && text.length > 0 ? text : `HTTP ${status}`;
  const requestId = typeof body.requestId === "string" ? body.requestId : undefined;

  if (isSignErrorCode(code)) {
    return new SignError(code, message, status, undefined, requestId);
  }
  if (status >= 500) {
    return new SignError("server_error", message, status, code, requestId);
  }
  return new SignError("unknown_error", message, status, code, requestId);
}

/** Map anything thrown into the plain object surfaces keep in state. */
export function toStateError(err: unknown): { code: string; message: string } {
  if (err instanceof SignError) return { code: err.code, message: err.message };
  if (err instanceof Error) return { code: "unknown_error", message: err.message };
  return { code: "unknown_error", message: "Something went wrong." };
}

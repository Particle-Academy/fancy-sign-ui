/**
 * The fancy-sign phase 1 wire contract, as TypeScript.
 *
 * **Type-only.** Nothing in this file emits runtime code, which is what lets the
 * React-free `./client` entry and the React entry share it without either one
 * dragging the other into a consumer's bundle.
 *
 * Every key is snake_case and every time is an ISO-8601 UTC string, exactly as
 * the PHP and Node backends serve them. Renaming a key here "to be idiomatic"
 * would make every response silently read as `undefined`, so do not.
 */

export type EnvelopeStatus = "draft" | "sent" | "completed" | "declined" | "voided" | "expired";
/** `waiting`: under `settings.order: "sequential"`, this signer's group has not been invited yet (fancy-sign 0.6). */
export type SignerStatus = "pending" | "viewed" | "signed" | "declined" | "waiting";

/** Who is invited when (fancy-sign 0.6). `parallel` is the default and what earlier backends do. */
export type SigningOrder = "parallel" | "sequential";
export type FieldKind = "signature" | "initials" | "date_signed";
export type PerPageMark = "none" | "initials" | "signature";
export type StepUp = "none" | "passkey";
export type OtpPurpose = "view" | "accept";

/**
 * Where a field is anchored. The landing rect is computed by fine-print, never stored by hand.
 * `{ pointer }` (data mode, fancy-sign 0.7): an RFC 6901 pointer into the host's data, a hint for
 * the host's template; the package places nothing.
 */
export type FieldAnchor = { node: string } | { final_page: true } | { every_page: true } | { pointer: string };

/** What an envelope signs (fancy-sign 0.7). Absent from earlier backends, which are `pdf`. */
export type EnvelopeMode = "pdf" | "data";

/** `[x0, y0, x1, y1]` in PDF points, bottom-up. */
export type Rect = [number, number, number, number];

export interface FieldPlacement {
  page: number;
  rect: Rect;
}

export interface EnvelopeSettings {
  per_page: PerPageMark;
  otp: { view: true; accept: true };
  step_up: StepUp;
  /** Phase 1 serves only `"ses"`. Any other level is refused by the backend today. */
  level: "ses";
  /** Phase 1 serves only `"none"`. Any other seal is refused by the backend today. */
  seal: "none";
  expires_at: string | null;
  /** fancy-sign 0.6; absent from earlier backends, which are `parallel`. */
  order?: SigningOrder;
  /** fancy-sign 0.7; absent from earlier backends, which are `pdf`. Fixed at send. */
  mode?: EnvelopeMode;
}

export interface SignerConsent {
  text_sha256: string;
  version: string;
  at: string;
}

export interface Signer {
  id: string;
  name: string;
  email: string;
  order: number;
  status: SignerStatus;
  consent: SignerConsent | null;
  signed_at: string | null;
  declined_at: string | null;
  /** Signer-written text. Render as plain text only, never as HTML. */
  decline_reason: string | null;
  /** When the signer was last mailed a link (fancy-sign 0.7). */
  invited_at?: string | null;
  /** Data mode: this signer's sealed signature record, once signed (fancy-sign 0.7). */
  signature?: SignatureRecord | null;
}

export interface Field {
  id: string;
  signer_id: string;
  kind: FieldKind;
  /** `null` for a data-mode field declared without an anchor. */
  anchor: FieldAnchor | null;
  required: boolean;
  label: string | null;
  /** `null` before the envelope is sent, and always in data mode (the host places it). */
  placement: FieldPlacement[] | null;
  completed: boolean;
}

export interface EnvelopeDocument {
  /** fancy-sign 0.7. */
  mode?: EnvelopeMode;
  /** Data mode: the optional typed profile (`"last-word"`), or null for opaque data. */
  profile?: string | null;
  /** Data mode: `"fsig-data-1"`. */
  canonical?: string | null;
  /** Data mode: sha256 hex of the data's fsig-data-1 bytes. What is signed. */
  data_sha256?: string | null;
  data_bytes?: number | null;
  fields_sha256?: string | null;
  as_sent_sha256: string | null;
  final_sha256: string | null;
  pages: number | null;
}

export interface Envelope {
  id: string;
  org_id: string | null;
  /** Who created it, as the host identifies its users. Present on fancy-sign-php. */
  created_by?: string | null;
  title: string;
  status: EnvelopeStatus;
  document: EnvelopeDocument;
  settings: EnvelopeSettings;
  signers: Signer[];
  fields: Field[];
  /** sha256 hex of the last event. */
  chain_head: string;
  completion: Completion | DataCompletion | null;
  /** Data mode: the host's registered final PDF hash (attachFinal), or null. */
  final?: FinalRecord | null;
  created_at: string;
  sent_at: string | null;
  completed_at: string | null;
}

/** A drawn signature: strokes of `[x, y]` points, each in `[0, 1]`, y pointing down. Never an image. */
export interface DrawnMark {
  kind: "drawn";
  strokes: Array<Array<[number, number]>>;
}

/** A typed signature, at most 128 characters by default. */
export interface TypedMark {
  kind: "typed";
  text: string;
}

export type Mark = DrawnMark | TypedMark;

export type SignEventType =
  | "envelope.created"
  | "envelope.sent"
  | "email.sent"
  | "link.opened"
  | "otp.sent"
  | "otp.verified"
  | "otp.failed"
  | "otp.locked"
  | "consent.accepted"
  | "document.opened"
  | "page.viewed"
  | "field.completed"
  | "mark.adopted"
  | "signer.signed"
  | "signer.declined"
  | "signer.requested_changes"
  | "reminder.sent"
  | "envelope.completed"
  | "envelope.voided"
  | "envelope.expired"
  | "document.downloaded"
  | "seal.applied"
  /** Data mode: the browser's rendering claim (client). */
  | "document.rendered"
  /** Data mode: a signature record's token on the chain. */
  | "signature.sealed"
  /** Data mode: the host registered its final PDF hash. */
  | "document.finalized";

/**
 * One link of the envelope's hash chain.
 *
 * `source: "client"` means the signer's browser reported it (only `page.viewed`
 * today). That is a claim, not an observation, and every surface here labels it
 * as such.
 */
export interface SignEvent {
  envelope_id: string;
  /** 1-based. */
  seq: number;
  at: string;
  /** Kept as `string` beyond the closed set so a newer backend is not a type error. */
  type: SignEventType | (string & {});
  actor: string;
  source: "server" | "client";
  ip: string | null;
  user_agent: string | null;
  data: Record<string, unknown>;
  prev_hash: string;
  hash: string;
}

export interface CompletionSigner {
  id: string;
  name: string;
  email: string;
  signed_at: string;
  method: "otp" | "otp+passkey";
  otp_seq: number;
  consent_seq: number;
}

/** The `fsig_v1_` completion record, sealed with Ed25519 by the host's key. */
export interface Completion {
  type: "fancy-sign.completion";
  version: 1;
  envelope_id: string;
  as_sent_sha256: string;
  final_sha256: string;
  signers: CompletionSigner[];
  chain_head: string;
  /** 32 hex characters. */
  nonce: string;
  key_id: string;
  /** `fsig_v1_<64 hex>`. */
  token: string;
  /** base64 of the 64-byte Ed25519 signature. */
  seal: string;
}

/** Data mode: the sealed record of ONE signature, `fancy-sign.signature` v1. */
export interface SignatureRecord {
  type: "fancy-sign.signature";
  version: 1;
  envelope_id: string;
  signer_id: string;
  name: string;
  email: string;
  signed_at: string;
  method: "otp" | "otp+passkey";
  otp_seq: number;
  consent_seq: number;
  rendered_seq: number | null;
  /** The signer's browser's claim of which template and release it rendered. A claim. */
  renderer: string | null;
  data_sha256: string;
  data_bytes: number;
  canonical: string;
  profile: string | null;
  fields_sha256: string;
  fields: string[];
  per_page_pages: number | null;
  mark_sha256: string;
  adoption_text_sha256: string;
  consent_text_sha256: string;
  step_up_sha256: string | null;
  chain_head: string;
  nonce: string;
  key_id: string;
  /** `fsig_sig_v1_<64 hex>`. */
  token: string;
  seal: string;
}

/** Data mode: the completion, `fancy-sign.completion` VERSION 2, binding every signature record. */
export interface DataCompletion {
  type: "fancy-sign.completion";
  version: 2;
  mode: "data";
  envelope_id: string;
  data_sha256: string;
  data_bytes: number;
  canonical: string;
  profile: string | null;
  fields_sha256: string;
  signers: Array<CompletionSigner & { signature: string }>;
  chain_head: string;
  nonce: string;
  key_id: string;
  /** `fsig_v2_<64 hex>`. */
  token: string;
  seal: string;
}

/** Data mode: the host's final PDF hash, registered once after completion (`fancy-sign.final` v1). */
export interface FinalRecord {
  type: "fancy-sign.final";
  version: 1;
  envelope_id: string;
  completion_token: string;
  final_sha256: string;
  final_bytes: number;
  attached_at: string;
  attached_by: string;
  chain_head: string;
  nonce: string;
  key_id: string;
  /** `fsig_fin_v1_<64 hex>`. */
  token: string;
  seal: string;
}

/** One entry of `GET envelopes/{id}/signatures`. */
export interface SignatureEntry {
  record: SignatureRecord;
  mark: Mark;
  fields_completed: string[];
}

/** Data mode: what the signer's browser says it rendered (`document.rendered`). A claim. */
export interface RenderedClaim {
  data_sha256: string;
  /** The host's template and app release, 1 to 200 characters. */
  renderer: string;
  pages: number;
}

export type VerifyReason =
  | "completion_invalid"
  | "seal_invalid"
  | "token_mismatch"
  | "final_hash_mismatch"
  | "prefix_mismatch"
  | "chain_broken"
  | "chain_head_mismatch";

export interface VerifyResult {
  ok: boolean;
  reason: VerifyReason | null;
  checks: {
    seal: boolean | null;
    token: boolean | null;
    final_hash: boolean | null;
    prefix: boolean | null;
    chain: boolean | null;
  };
}

export interface SignerViewSigner {
  id: string;
  name: string;
  email: string;
  status: SignerStatus;
  consent_at: string | null;
  signed_at: string | null;
  declined_at: string | null;
  /** Data mode: the signer's own signature record once signed. */
  signature?: SignatureRecord | null;
}

/** What one signer sees, after the view code. */
export interface SignerView {
  /**
   * Data mode (fancy-sign 0.7) carries `mode: "data"`, `data_sha256` and `sent_at` and no
   * `pages`: data facts only, never a template or layout (the ceremony is live).
   */
  envelope: {
    id: string;
    title: string;
    status: EnvelopeStatus;
    pages?: number | null;
    mode?: EnvelopeMode;
    data_sha256?: string;
    sent_at?: string | null;
  };
  signer: SignerViewSigner;
  consent: { required: boolean; text: string; version: string };
  adoption_text: string;
  /** This signer's fields only, with placement. */
  fields: Field[];
  /** How many times this signer has asked for changes (fancy-sign 0.3.0 and later). */
  changes_requested?: number;
  /** How many times a signer may ask for changes (fancy-sign 0.3.0 and later). */
  max_change_requests?: number;
}

export interface OtpSent {
  sent: true;
  expires_in: number;
}

export interface SignerSession {
  session: string;
  expires_at: string;
}

export interface PublicKey {
  key_id: string;
  algorithm: "ed25519";
  public_key: string;
}

/** The closed set of error codes the backends put in `{ "error": { "code", "message" } }`. */
export type SignErrorCode =
  | "invalid_request"
  | "not_found"
  | "forbidden"
  | "link_invalid"
  | "otp_invalid"
  | "otp_locked"
  | "otp_rate_limited"
  | "session_required"
  | "consent_required"
  | "not_viewed"
  | "fields_incomplete"
  | "mark_invalid"
  | "envelope_not_open"
  | "envelope_not_draft"
  | "already_signed"
  | "already_declined"
  | "step_up_required"
  | "limit_exceeded"
  /** fancy-sign 0.6, `settings.order: "sequential"`: this signer's group has not been invited yet (409). */
  | "not_your_turn"
  /** fancy-sign 0.7, data mode: the data does not hash to `data_sha256` (422). */
  | "data_hash_mismatch"
  /** fancy-sign 0.7, profile `last-word`: an image not inlined (422). */
  | "data_external_reference"
  /** fancy-sign 0.7, attachFinal before every signer has signed (409). */
  | "envelope_not_completed"
  /** fancy-sign 0.7, attachFinal with a different hash than the one registered (409). */
  | "final_already_attached";

/**
 * Failures the client names itself, because no backend answered with a code:
 * the network failed, the server answered 5xx, or a 4xx body did not carry a
 * code from the closed set.
 */
export type SignClientErrorCode = "network_error" | "server_error" | "unknown_error";

/** A signer as the sender edits it. `id` is the server's id, or a host-chosen draft key. */
export interface SignerInput {
  id: string;
  name: string;
  email: string;
  order: number;
}

/** A field before the backend has given it an id or a placement. */
export interface FieldDraft {
  signer_id: string;
  kind: FieldKind;
  anchor: FieldAnchor;
  required: boolean;
  label: string | null;
}

/**
 * An organisation's signing settings (`GET`/`PUT {prefix}/org/settings`). When
 * `per_page` is not `"none"`, every envelope of the org carries it and a
 * sender cannot change it.
 */
export interface OrgSettings {
  org_id: string;
  per_page: PerPageMark;
  /** The organisation's default for `settings.order` (fancy-sign 0.6). */
  order?: SigningOrder;
  updated_by: string | null;
  updated_at: string | null;
}

/** The settings a sender may choose in phase 1. `level` and `seal` are fixed. */
export interface SettingsInput {
  per_page: PerPageMark;
  step_up: StepUp;
  expires_at: string | null;
}

/** Body of `POST /envelopes` and `PUT /envelopes/{id}`. */
export interface EnvelopeInput {
  title: string;
  /** last-word document JSON. Opaque to this package. */
  document: unknown;
  signers: SignerInput[];
  fields: Array<FieldDraft & { id?: string }>;
  settings: SettingsInput & { otp?: { view: true; accept: true }; level?: "ses"; seal?: "none" };
}

/** Body of `POST /s/{token}/sign`. */
export interface SignInput {
  fields: Record<string, true>;
  mark: Mark;
  adoption: string;
  code: string;
  /** Data mode: the hash of the data the signer is signing. Required by a data envelope. */
  data_sha256?: string;
}

/** Plain-object error carried in surface state (an `Error` would not serialise). */
export interface SignStateError {
  code: string;
  message: string;
}

/**
 * `AgentActivity`-shaped event emitted on every mutation, so presence, undo and
 * coaching layers compose without this package knowing about them.
 *
 * Never carries a one-time code, a session, or a mark's points.
 */
export interface SignActivityEvent {
  /** The `surfaceId` of the emitting surface. */
  surface: string;
  action: string;
  /** Field, signer or envelope id, where the action has one. */
  target?: string;
  /** ISO-8601. */
  at: string;
  detail?: Record<string, unknown>;
}

# Changelog

All notable changes to `@particle-academy/fancy-sign-ui` are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and
this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

> **Pre-1.0.** Breaking changes land in MINOR releases until 1.0.0. The version
> number is not yet a compatibility promise, so read this file before upgrading
> a minor.

## [Unreleased]

**Nothing changes unless an envelope is in data mode** (fancy-sign 0.7,
`settings.mode: "data"`); every new wire field is optional, so this release
keeps reading older backends. One type widened (see Changed).

### Added

- **The data-mode signer ceremony** (CC-fancy-0052). For a `mode: "data"`
  envelope, `SignerCeremony` signs the host's own data instead of showing a PDF:
  - It fetches the data through the signer's session (`client.signerData`, the
    server-observed `document.opened`), canonicalises it (`fsig-data-1`) and
    checks its SHA-256 against the envelope's `data_sha256` and the server's
    `X-Fancy-Sign-Data-Sha256` header. Only then is the parsed object handed to
    the host. On a mismatch nothing is rendered, the banner shows
    `data_hash_mismatch` and Sign stays blocked.
  - New props `renderData(data, ctx)` and `renderer`. `ctx` has `fields`,
    `renderField(id)` (the ceremony's own control, which the signer presses),
    `onLocate(handler)`, `now` (the envelope's `sent_at`) and
    `reportLayout({ pages })`, which posts a `document.rendered` claim with the
    `renderer` string once per layout change (at most `maxRenderReports`,
    default 20). Page elements the host marks `data-fancy-sign-page` are
    observed for `page.viewed` once a layout is reported. A render that never
    reports still signs.
  - The fields checklist stays as a complete fallback, with a **Show** button
    per field (`data-fancy-sign-field-show`) that fires the `onLocate`
    subscribers. A host-placed control and the checklist share one state.
  - A data envelope without `renderData` shows an error and never raw JSON, and
    does not fetch the data.
  - `sign` sends `data_sha256`. The code, consent and sign steps are unchanged.
  - State gains `dataCheck` and `reportedPages`; `signBlockers` gains `data`;
    handles `data-fancy-sign-document="data" | "refused" | "no-renderer"`,
    `data-fancy-sign-field-slot`; activity `data-verified`, `rendered`,
    `locate`. Nothing about presentation is read from or stored on the
    envelope, so a new template or a new release of this package reaches
    envelopes already sent.
- **`./data`** (React-free, also on the main entry): `canonicalData`,
  `dataSha256`, `parseCanonicalData`, `sha256Hex`, `DataCanonicalError`. Held
  to fancy-conformance `sign/data`.
- **Client:** `signerData`, `reportRendered`; sender `inviteSigner`,
  `getSignatures`, `attachFinal`. The closed error set gains
  `data_hash_mismatch`, `data_external_reference`, `envelope_not_completed`
  and `final_already_attached`.
- **Types:** `EnvelopeMode`, `SignatureRecord`, `DataCompletion`,
  `FinalRecord`, `SignatureEntry`, `RenderedClaim`, `DataField`,
  `DataRenderContext`; optional `settings.mode`, `document.{mode, profile,
  canonical, data_sha256, data_bytes, fields_sha256}`, `envelope.final`,
  `signers[].{invited_at, signature}`, `SignerView.envelope.{mode,
  data_sha256, sent_at}`, `SignInput.data_sha256`; `FieldAnchor` gains
  `{ pointer }`; the timeline names `document.rendered`, `signature.sealed`
  and `document.finalized`.

### Changed

- **Types: `Field.anchor` is `FieldAnchor | null`** (a data-mode field may have
  no anchor) and `SignerView.envelope.pages` is optional (a data-mode view has
  none). A host that reads `field.anchor` with an `in` check adds a null check;
  nothing changes at runtime for a pdf envelope.

### Not in this release

- Data-mode views in `SignatureVerifier` and `CompletionCertificate`.

## [0.5.0] - 2026-11-19

### Added

- **A "waiting for your turn" state in `SignerCeremony`** for fancy-sign 0.6's
  `settings.order: "sequential"` (CC-fancy-0051). When the backend refuses a
  signer with `not_your_turn` (409), the ceremony moves to `step: "waiting"`
  and shows `[data-fancy-sign-panel="waiting"]` with no action, instead of a
  generic error; `onActivity` emits `waiting`. **Default unchanged; consumers
  do nothing unless they opt in.** A backend without signing order never sends
  the code, so nothing changes against fancy-sign 0.5 or earlier.
- `not_your_turn` is in the client's closed `SignErrorCode` set (it was
  `unknown_error` before). Types: `SignerStatus` gains `"waiting"`;
  `SigningOrder`; optional `order` on `EnvelopeSettings` and `OrgSettings`.
  A host with an exhaustive `switch` over `SignerStatus` or `CeremonyStep`
  adds a `"waiting"` case.

## [0.4.0] - 2026-11-18

**What a consumer must do.** If your host reads the error banner at the top of
`SignerCeremony` to detect a failed panel action (a wrong signing code, a refused
decline or change request), read `[data-fancy-sign-error]` instead: those errors
now render inside their panel. The handle and its value (the kit error code) are
unchanged, so a host that already selects `[data-fancy-sign-error="..."]` does
nothing. No prop changed. (CC-fancy-0046.) This release also carries two
security fixes (below) for every earlier version; upgrade.

### Added

- `data-fancy-sign-error-panel` on a panel error, naming its panel, and the
  matching optional `errorPanel` in `SignerCeremonyState` (exported type
  `CeremonyErrorPanel`). Absent or `null` means a ceremony-level error. Additive:
  a stored state without it renders its error in the banner, as before.

### Changed

- CI: re-pin org third-party allowlist to 2614224

### Fixed

- **A panel action's error now shows where the signer is looking.** A wrong
  signing code on Sign used to render as a banner at the TOP of the ceremony,
  above a 70vh document viewer, while the Sign button and the code boxes sit at
  the bottom: the signer pressed Sign, the boxes cleared, and nothing visible
  happened. Each error caused by a panel action now renders inside that panel,
  beside the control: the view code (`code` panel), consent, the signing code
  and Sign (`sign` panel, by the code boxes), request changes and decline. Every
  error has `role="alert"` so it is announced, and focus moves to the first code
  box, or to the failing control when there are no boxes (a locked code focuses
  "Send a new signing code"). Ceremony-level errors, such as the document
  failing to load, keep the top banner. Closing the decline or request-changes
  group clears the error it was showing. Field completion has no server call and
  so no failure path; a `fields_incomplete` refusal comes from Sign and shows in
  the `sign` panel.

### Security

- **Two quadratic regexes replaced with linear scans** (CodeQL
  js/polynomial-redos, alerts #1 and #2, HIGH). Both shipped in every released
  version, 0.1.0 through 0.3.0:
  - `createSignClient` trimmed `baseUrl` with `/\/+$/`: 8 s on 100,000 slashes
    that are not at the end. It now scans back from the end.
  - `setupProblems` (and so `EnvelopeSetup`) checked signer emails with
    `^[^\s@]+@[^\s@]+\.[^\s@]+$`: 11 s on a 100,000-character domain of dots.
    The email is typed by whoever fills in the form, or set by an agent. It is
    now checked with indexOf, accepting and refusing exactly the same strings.
- Consumers just upgrade; no API or behaviour changed. Regression tests time
  the hostile inputs (under 50 ms) and pin what was accepted before.

## [0.3.0] - 2026-11-18

**What a consumer must do.** Nothing. `./template` is a new entry; the main entry is
unchanged. Use it only with `@particle-academy/fancy-template-ui` 0.1.0 or later.

### Added

- **`./template`: signing fields for the document builder.** `signBlockKinds(signers)`
  returns three host block kinds for `@particle-academy/fancy-template-ui`:
  `fancy-sign:signature`, `fancy-sign:initials` and `fancy-sign:date-signed`.
  Each renders fine-print's opt-in field node (`signatureField`,
  `initialsField`, `dateSignedField`) with an id, a signer, `required` and an
  optional label, and has its own settings panel. None can be placed in a
  repeating section, because a field id must be unique. Write the rendered
  document with fine-print's `FinePrint\Writer\Signable::write()`, which
  accepts field nodes and returns where each one landed. fancy-template-ui is an
  optional peer used for types only; the main entry is unchanged. This replaces
  the fancy-cms islands planned for field placement, which were never built.


### Changed

- **Tested against react-fancy 6.29.0** (the dev dependency was `^6.28.0`):
  fancy-template-ui, the new dev dependency for `./template`'s tests, needs it.
  Dev only; the peer range is unchanged.
## [0.2.0] - 2026-11-18

### Added

- **Request changes** (owner-approved q_8c180eab; needs fancy-sign 0.3.0 or
  later on the server). `SignerCeremony` shows **Request changes** beside
  Decline: a required message, bounded by `maxDeclineReason` like a decline
  reason, sent with `client.requestChanges(token, text)`. The ceremony stays in
  review afterwards, so the signer can still sign or decline, and the button is
  disabled with a note once `view.max_change_requests` is reached. A refusal
  keeps the typed message. The activity event `changes-requested` carries the
  count, never the text.
- `EnvelopeTimeline` labels `signer.requested_changes` "Changes requested" and
  shows its text as plain text.
- Types: `signer.requested_changes` in `SignEventType`;
  `SignerView.changes_requested` and `max_change_requests` (optional, so a
  0.1/0.2 server still type-checks); `SignerCeremonyState.requestingChanges`,
  `changesText` and `changesSent` (optional, so a stored 0.1.0 state still loads).
- **Consumer action:** none. Against a fancy-sign server before 0.3.0 the
  button shows and its request answers 404 (`unknown_error`); upgrade the server
  with this package.

### Changed

- **CI: the lab-certificate gate verifies against the lab's rotated key list.**
  The lab's first signing key is retired: certificates it already issued still
  verify, and nothing new it signs ever can. Consumers do nothing.

## [0.1.0] - 2026-11-18

### Added

- First version. React surfaces for the fancy-sign
  phase 1 wire contract, built from react-fancy:
  - `createSignClient` on a React-free `./client` subpath: one typed method per
    endpoint, every 4xx mapped to a `SignError` with the closed `code` set
    (`unknown_error`, `server_error` and `network_error` when no known code
    arrived). The signer session is kept in the client and sent as
    `X-Fancy-Sign-Session`. `verify` posts the PDF as a file and the completion
    and events as string fields. All wire types are exported.
  - `SignerCeremony`: view code, consent (sends the disclosure version), document
    (host `renderPage` with rate-limited `page.viewed` beacons, or the as-sent
    PDF), fields, signature, a fresh signing code, then Sign; or Decline with a
    required reason. Controlled or uncontrolled. `signBlockers` says why Sign is
    disabled.
  - `SignaturePad`: drawn strokes normalised to `[0, 1]` (y down), capped at 64
    strokes and 2048 points, or typed text up to 128 characters. Never an image.
  - `SignatureField`, `InitialsField`, `DateSignedField`, `SignFieldPalette`.
  - `EnvelopeSetup` with Send and Void staged for confirmation by default
    (`pendingMode`); level and seal shown fixed as SES and none.
  - `EnvelopeTimeline`, labelling every browser-reported event "reported by the
    signer's browser" and rendering signer-written text as plain text.
  - `CompletionCertificate` and `SignatureVerifier` (shows each named failure).
  - `OrgSigningSettings`, the organisation admin's per-page initials or
    signature switch, and `EnvelopeSetup`'s `orgPerPage` prop, which locks the
    per-page select to it. `client.getOrgSettings()` /
    `updateOrgSettings()`, the `OrgSettings` type, and the `forbidden` error
    code.
  - The client reads the kit-wide error envelope (CC-fancy-0031): the code at
    the top level, or on a 422 (`validation_failed`) from its one item, and
    keeps `requestId` on the `SignError`.
  - The client sends Laravel's `XSRF-TOKEN` cookie back as `X-XSRF-TOKEN` on
    every POST and PUT to the page's own origin, read fresh each time, so the
    sender routes work behind the default `web` middleware (`xsrf: false` turns
    it off).
  - `SignerCeremony` opens the as-sent PDF through the signer's session in
    every display mode, once: with its own viewer, with the host's
    `renderPage`, and with the host's `documentUrl`. That fetch is the
    server-observed `document.opened`, and the server refuses to sign
    (`not_viewed`) without it; before this, a host rendering its own pages
    could never sign. `onDocument(pdf)` hands the host the exact bytes to
    render pages from.
  - A test that fails if the README uses any forbidden legal claim.

### Changed

- Dev dependency `@particle-academy/react-fancy` moves from `^4.17.1` to
  `^6.28.0`, so the suite runs against the react-fancy consumers install today.
  The peer range gains an upper bound, `>=4.17.1 <7.0`: the suite has run on
  4.17.1 and 6.28.0, and no react-fancy 7 exists to test against.

- **Docs:** `AGENTS.md` is now the guide to using this package (install, how to find it on the Fancy MCP catalog server once it is listed, API essentials, traps), and it ships in the package. The contributor notes it held moved to `CONTRIBUTING.md`, and `CLAUDE.md` is now a symlink to it. The README points to the MCP server and to `AGENTS.md`. No code changed; nothing to do.

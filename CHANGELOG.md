# Changelog

All notable changes to `@particle-academy/fancy-sign-ui` are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and
this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

> **Pre-1.0.** Breaking changes land in MINOR releases until 1.0.0. The version
> number is not yet a compatibility promise, so read this file before upgrading
> a minor.

## [Unreleased]

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

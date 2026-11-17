# Changelog

All notable changes to `@particle-academy/fancy-sign-ui` are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and
this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

> **Pre-1.0.** Breaking changes land in MINOR releases until 1.0.0. The version
> number is not yet a compatibility promise, so read this file before upgrading
> a minor.

## [Unreleased]

### Added

- First version (0.1.0, not yet released). React surfaces for the fancy-sign
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
  - A test that fails if the README uses any forbidden legal claim.

### Changed

- **Docs:** `AGENTS.md` is now the guide to using this package (install, how to find it on the Fancy MCP catalog server once it is listed, API essentials, traps), and it ships in the package. The contributor notes it held moved to `CONTRIBUTING.md`, and `CLAUDE.md` is now a symlink to it. The README points to the MCP server and to `AGENTS.md`. No code changed; nothing to do.

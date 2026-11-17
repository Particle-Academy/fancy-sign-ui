# Using @particle-academy/fancy-sign-ui — guide for agents

How an agent installs and uses this package in a consumer app. What the package
is, is in [README.md](./README.md). Notes for working ON this repo's code are in
[CONTRIBUTING.md](./CONTRIBUTING.md).

## Install

```bash
npm install @particle-academy/fancy-sign-ui
npm install react react-dom @particle-academy/react-fancy tailwindcss
```

- **Everything is a peer:** `react ^19`, `react-dom ^19`,
  `@particle-academy/react-fancy >=4.17.1`, `tailwindcss ^4`.
- Import the stylesheet once, and point Tailwind at react-fancy's dist:

  ```ts
  import "@particle-academy/fancy-sign-ui/styles.css";
  ```

  ```css
  @import "tailwindcss";
  @source '../node_modules/@particle-academy/react-fancy/dist/**/*.{js,cjs,mjs}';
  ```

- It needs a backend serving the fancy-sign wire contract: today the PHP
  package `particle-academy/fancy-sign` (Laravel).

## Find it on the Fancy MCP server

The catalog server is `https://ui.particle.academy/mcp` (streamable HTTP, no API
key; MCP id `fancy-ui`). fancy-sign-ui is not yet listed there; it appears once
published. Find it then with `search-components`.

## API essentials

- **`./client`** (no React): `createSignClient({ baseUrl })`, one method per
  endpoint; `SignError` with `code` from a closed set (`otp_invalid`,
  `otp_locked`, `consent_required`, `fields_incomplete`, ...). An unknown code
  is `unknown_error` with the raw value in `serverCode`; no response is
  `network_error`; a 5xx is `server_error`. Also every wire type (`Envelope`,
  `Signer`, `Field`, `Mark`, `SignEvent`, `Completion`, `VerifyResult`, ...).
- **Signer:** `<SignerCeremony token client />`, optionally controlled with
  `value` / `onChange` (`initialCeremonyState()`). `signBlockers(state)` says
  why Sign is still disabled. `renderPage={(n) => ...}` renders pages yourself
  and enables per-page `page.viewed` beacons.
- **Sender:** `<EnvelopeSetup value onChange envelopeStatus onSend onVoid />`,
  `<SignFieldPalette signers value onChange onPlace />` (emits a `FieldDraft`
  anchored to `final_page`, `every_page` or a document node), and
  `<EnvelopeTimeline events />`.
- **Record:** `<CompletionCertificate completion events />` and
  `<SignatureVerifier client />`.
- Also: `SignaturePad`, `SignatureField`, `InitialsField`, `DateSignedField`,
  and pure helpers (`setupProblems`, `MARK_LIMITS`, `startStroke`,
  `extendStroke`, `validateMark`, ...).
- **Human+:** controlled `value` + `onChange` (the full next state,
  JSON-serialisable), `data-fancy-sign-*` handles on every interactive element,
  and an optional `onActivity` callback per mutation.

## Traps

- **An agent cannot sign.** Verifying a code, accepting consent, adopting a
  mark, signing and declining are buttons only the signer presses; no prop,
  handle or callback completes them. An agent can read envelopes and timelines,
  edit a draft, propose send / void / reminder for a human to confirm, and
  verify a completed document.
- **Send and Void are staged** (`pendingMode`, default `true`); Void always
  needs a reason.
- **The signer session lives inside the client** (sent as
  `X-Fancy-Sign-Session`), never in component state.
- **Field positions are computed by the backend's layout.** Do not try to set
  coordinates.
- **A signature is never an image:** `{ kind: "drawn", strokes }` (points in
  `[0, 1]`, y down, at most 64 strokes / 2048 points) or
  `{ kind: "typed", text }` (at most 128 characters).
- **`level` is fixed at `SES` and `seal` at `none`** in this phase.
- **`page.viewed` is reported by the signer's browser** and labelled so; without
  `renderPage`, no per-page claim is made.
- **Legal wording:** say only that it is designed to support simple electronic
  signatures (SES), and recommend legal review.
- **Personal data:** the audit trail records IP addresses and user agents; the
  host's privacy notice must say so, and the backend should set a retention
  period.
- **Pre-1.0:** breaking changes land in MINOR releases.

## Agents

To drive envelopes over MCP, `@particle-academy/agent-integrations` ships
`registerSignBridge` (subpath `/bridges/sign`). Its tools manage envelopes and
propose sends, voids and reminders; none of them signs.

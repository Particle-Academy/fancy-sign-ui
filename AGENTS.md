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
- **Request changes:** the ceremony shows **Request changes** beside Decline
  (`data-fancy-sign-action="start-request-changes"`, the message in
  `data-fancy-sign-changes-text`, sent by `confirm-request-changes`). It needs
  fancy-sign 0.3.0 or later on the server (`client.requestChanges(token,
  text)`), keeps the ceremony in review, and is disabled at the cap
  (`view.max_change_requests`). The timeline shows `signer.requested_changes`
  with its text as plain text. No agent tool sends one: it is the signer's act.
- **Signer:** `<SignerCeremony token client />`, optionally controlled with
  `value` / `onChange` (`initialCeremonyState()`). `signBlockers(state)` says
  why Sign is still disabled. `renderPage={(n) => ...}` renders pages yourself
  and enables per-page `page.viewed` beacons.
- **Organisation:** `<OrgSigningSettings value onChange canEdit onSave />` is
  the admin's per-page switch (`client.updateOrgSettings({ per_page })`; the
  backend answers `forbidden` to a non-admin). Pass the saved value to
  `<EnvelopeSetup orgPerPage>` so a sender sees it locked.
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
- **Error handles in the ceremony:** every error renders as
  `[data-fancy-sign-error="<code>"]` with `role="alert"`, where `<code>` is the
  kit error code from the server's envelope (`otp_invalid`, `otp_locked`,
  `limit_exceeded`, ...; `unknown_error` when it has none). An error caused by a
  panel action renders INSIDE that panel, beside the control, and carries
  `data-fancy-sign-error-panel`: `code` (view code), `consent`, `sign` (signing
  code and Sign, by the code boxes), `request-changes` or `decline`. Focus moves
  to the first code box or the failing control. Only ceremony-level errors (the
  document failed to load, a restored state with no panel) use the top banner,
  a direct child of `[data-fancy-sign-surface]` without the panel attribute.
  The same panel is in state as `errorPanel`. An error clears on the next
  attempt, or when its decline / request-changes group is closed. Read
  `data-fancy-sign-error`, never the position of the banner.

### Signing fields in the document builder (`./template`)

```tsx
import { TemplateBuilder } from "@particle-academy/fancy-template-ui";
import { signBlockKinds } from "@particle-academy/fancy-sign-ui/template";

<TemplateBuilder kinds={signBlockKinds([{ id: "client", label: "Client" }])} ... />
```

- Three kinds: `fancy-sign:signature`, `fancy-sign:initials`,
  `fancy-sign:date-signed`. Props: `id` (unique in the document,
  `^[A-Za-z0-9_-]{1,64}$`), `signer` (one of the ids you passed), `required`,
  optional `label`.
- They cannot go inside a repeating section: a repeat would print one id
  several times.
- Write the rendered document with `FinePrint\Writer\Signable::write($doc)`,
  not `Agent::toBytes()`: only the signing writer accepts field nodes, and it
  returns where each field landed. Validate with `Agent::validate($doc, ['fields' => true])`.
- Needs `@particle-academy/fancy-template-ui` installed (an optional peer).

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

# @particle-academy/fancy-sign-ui

React surfaces for **e-signature envelopes**: the signer's ceremony, the
sender's envelope setup, the audit timeline, the certificate of completion and
a verifier. Plus a **React-free client** (`./client`) for the wire contract.

Designed to support simple electronic signatures (SES): consent and intent captured, signer verified by email one-time code, a hash-chained audit trail, and a sealed final document.

Whether an electronic signature is appropriate for a given document, and which
level it needs, depends on the jurisdiction and the document type. Have it reviewed by a lawyer before relying on it.

Part of the Fancy Sign family. The backends serve the same JSON, so the same
surfaces work against either one:

| Package | Runtime | Role |
|---|---|---|
| `particle-academy/fancy-sign` (Composer) | PHP / Laravel | Server: envelopes, fields, email codes, audit chain, completion record and seal, verify. |
| `@particle-academy/fancy-sign` (npm) | Node | Server twin (planned). |
| **`@particle-academy/fancy-sign-ui`** (npm) | Browser | **This package.** React surfaces + `./client`. |

> **Pre-1.0.** Breaking changes land in MINOR releases until 1.0.0. Read
> `CHANGELOG.md` before upgrading a minor.

---

## Install

```bash
npm install @particle-academy/fancy-sign-ui
```

**Everything is a peer.** This package has an empty `dependencies` and keeps it
that way:

```bash
npm install react react-dom @particle-academy/react-fancy tailwindcss
```

Import the stylesheet once:

```ts
import "@particle-academy/fancy-sign-ui/styles.css";
```

Tailwind v4 does not scan `node_modules`, and these surfaces render react-fancy
components, so point Tailwind at react-fancy's dist beside
`@import "tailwindcss";`:

```css
@source '../node_modules/@particle-academy/react-fancy/dist/**/*.{js,cjs,mjs}';
```

---

## Quickstart

### The client

```ts
import { createSignClient, SignError } from "@particle-academy/fancy-sign-ui/client";

const client = createSignClient({ baseUrl: "https://app.example.com/fancy-sign" });

try {
  const envelope = await client.getEnvelope("01JC...");
} catch (err) {
  if (err instanceof SignError && err.code === "not_found") {
    // ...
  }
}
```

One method per endpoint. Every 4xx body (`{ "error": { "code", "message" } }`)
becomes a `SignError` whose `code` is from the closed set (`otp_invalid`,
`otp_locked`, `consent_required`, `fields_incomplete`, ...). A code outside that
set is reported as `unknown_error` with the raw value in `serverCode`, so a UI
branching on `otp_locked` cannot be fooled by a code it does not know. No
response at all is `network_error`; a 5xx is `server_error`.

The signer session from the view code is kept **inside the client** and sent as
`X-Fancy-Sign-Session`. It is never put in component state.

### The signer

```tsx
import { SignerCeremony } from "@particle-academy/fancy-sign-ui";

<SignerCeremony token={tokenFromUrl} client={client} />;
```

The flow: request a view code, enter the 6 digits; agree to sign electronically
(the host's disclosure text, sent back with its version); read the document; fill
the fields; draw or type a signature; request a fresh signing code; **Sign**. Or
**Decline**, which requires a reason.

Sign stays disabled until consent is recorded, every required field is
complete, a signature exists, and a 6-digit signing code is entered.
`signBlockers(state)` returns what is missing, so a host can say why.

Controlled:

```tsx
const [state, setState] = useState(initialCeremonyState());
<SignerCeremony token={token} client={client} value={state} onChange={setState} />;
```

**The document.** Pass `renderPage={(n) => ...}` to render pages yourself; each
page is then observed, and a `page.viewed` beacon (page and time on screen) is
sent once it has been on screen for `minDwellMs` (default 1500 ms), at most once
per page per `pageViewIntervalMs` (default 30 s) and at most
`maxPageViewReports` times (default 200). Without `renderPage`, the as-sent PDF
is fetched through the session and shown whole, and **no** per-page claim is
made. These beacons are claims from the signer's browser, and every surface here
labels them as such.

### The sender

```tsx
import { EnvelopeSetup, SignFieldPalette, EnvelopeTimeline } from "@particle-academy/fancy-sign-ui";

<EnvelopeSetup
  value={setup}
  onChange={setSetup}
  envelopeStatus={envelope.status}
  onSend={() => client.sendEnvelope(envelope.id).then(refresh)}
  onVoid={(reason) => client.voidEnvelope(envelope.id, reason).then(refresh)}
/>;

<SignFieldPalette signers={setup.signers} value={draft} onChange={setDraft} onPlace={addField} />;

<EnvelopeTimeline events={await client.listEvents(envelope.id)} />;
```

`EnvelopeSetup` edits the title, signers (name, email, order) and settings
(`per_page`, `step_up`, `expires_at`). The level is shown fixed as `SES` and the
seal as `none`; nothing else is built yet. **Send and Void are staged for
confirmation by default** (`pendingMode`, default `true`), and Void always needs
a reason.

Where a field lands on the page is computed by the backend's layout, never
chosen by hand, so `SignFieldPalette` picks a kind, a signer and an anchor
(`final_page`, `every_page`, or a document node) and emits a `FieldDraft`.

### Certificate and verification

```tsx
<CompletionCertificate completion={envelope.completion} events={events} />
<SignatureVerifier client={client} />
```

`SignatureVerifier` takes the final PDF, its `completion.json` and optionally the
events, posts them to `/verify`, and shows the named reason for any failure
(`seal_invalid`, `final_hash_mismatch`, `prefix_mismatch`, `chain_broken`, ...).

**An honest limit:** in this phase the seal is checked by this verifier against
the host's published public key. A PDF reader shows no signature panel for it.
The original document stays a byte-for-byte prefix of the final file, so anyone
can check the signed content did not change without any tool of ours.

---

## Human+ contract

Every interactive surface here is controlled (`value` + `onChange`, the FULL next
state, JSON-serialisable), carries stable `data-fancy-sign-*` handles on every
interactive element, and reports each mutation through an optional
`onActivity` callback with an `AgentActivity`-shaped event.

**What an agent can do:** read envelopes and timelines, edit a draft (signers,
settings, fields), propose a send, a void or a reminder for a human to confirm,
and verify a completed document.

**What an agent cannot do, by design:** verify a code, accept consent, adopt a
signature, sign, or decline. Those acts belong to the signer, and an agent able
to do them would empty the evidence of meaning. No prop, handle or callback here
completes them, and activity events never carry a one-time code or signature
points.

**Signer-written text** (a decline reason, a typed name) is rendered as plain
text, never as HTML.

## Personal data

The audit trail records IP addresses and user agents. Say so in your privacy
notice, and set a retention period on the backend.

## API

- `./client`: `createSignClient`, `SignError`, `isSignErrorCode`, `toStateError`,
  and every wire type (`Envelope`, `Signer`, `Field`, `Mark`, `SignEvent`,
  `Completion`, `VerifyResult`, `SignerView`, `SignErrorCode`, ...).
- Root: everything above, plus `SignerCeremony`, `SignaturePad`,
  `SignatureField`, `InitialsField`, `DateSignedField`, `SignFieldPalette`,
  `EnvelopeSetup`, `EnvelopeTimeline`, `CompletionCertificate`,
  `SignatureVerifier`, and the pure helpers (`signBlockers`, `setupProblems`,
  `MARK_LIMITS`, `startStroke`, `extendStroke`, `validateMark`, ...).

A drawn signature is `{ kind: "drawn", strokes }`, points normalised to `[0, 1]`
with y pointing down, capped at 64 strokes and 2048 points. A typed one is
`{ kind: "typed", text }`, at most 128 characters. **It is never an image.**

## Development

```bash
npm install
npm test       # builds, then vitest (jsdom)
npm run lint   # tsc --noEmit && eslint .
npm run build  # tsup
```

## License

MIT

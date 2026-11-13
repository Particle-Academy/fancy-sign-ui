# AGENTS.md - fancy-sign-ui

React surfaces for e-signature envelopes, plus a React-free client for the
fancy-sign wire contract. `CLAUDE.md` is a symlink to this file. This file
describes this repository's code only; process rules live in the envelope's
`RULES.md`. The design is `.ai/plans/fancy-sign.md` in the envelope.

## The rule that shapes this repo

**An agent can manage an envelope and can never sign one.** Verifying a code,
consenting, adopting a mark, signing and declining are the signer's acts. If an
agent could do any of them, the audit trail would stop being evidence of what a
person did. So:

- No prop, imperative handle or callback completes those acts. They are
  buttons the signer presses in `SignerCeremony`.
- The signer session lives in the `SignClient`, never in component state.
- Activity events (`onActivity`) never carry a one-time code, a session or
  mark points. `SignerCeremony.test.tsx` asserts the accept code is absent.

## Layout

- `src/types.ts` - the wire contract as types. Type-only; snake_case keys exactly
  as the backends serve them. Do not rename keys to camelCase.
- `src/client.ts` - `createSignClient`, `SignError`. **No React import**:
  `tests/packaging.test.ts` checks the built `dist/client.js` graph. A code
  outside the closed `SignErrorCode` set maps to `unknown_error` with the raw
  code in `serverCode`; never pass an unknown code through as a known one.
  `verify` sends the PDF as the file part `pdf` and the completion and events
  as STRING fields (a picked `.json` file is read to text first).
- `src/mark.ts` - pure stroke logic and caps (64 strokes, 2048 points, 128 typed
  characters, coordinates in `[0, 1]`, y down). Every function returns a new
  mark. A refused point returns the input mark unchanged with `limit` set.
- `src/activity.ts` - `activityEvent`, date helpers, and `useSurfaceState`
  (controlled or uncontrolled; `update(apply)` builds from the latest state so
  updates after an `await` compose rather than overwrite).
- `src/SignaturePad.tsx` - canvas view of the strokes. **Never produces an
  image**: no `toDataURL` / `toBlob` (the packaging test greps the bundle).
- `src/fields.tsx` - field display components, `MarkPreview` (SVG polylines from
  strokes), and `SignFieldPalette`. A field's position on the page is computed
  by the backend's layout; nothing here stores coordinates.
- `src/SignerCeremony.tsx` - the signer flow and `signBlockers`. `page.viewed`
  beacons are only sent in `renderPage` mode, where real pages exist to
  observe; the whole-PDF mode makes no per-page claim.
- `src/EnvelopeSetup.tsx` - sender editor. Send and Void are staged
  (`pendingMode`, default true); Void always needs a reason. `level` and `seal`
  are displayed fixed (`SES`, `none`); do not add selectors for values the
  backend refuses.
- `src/EnvelopeTimeline.tsx` - every `source: "client"` event carries
  `CLIENT_EVENT_LABEL` ("reported by the signer's browser"). Decline and void
  reasons render as React text nodes only.
- `src/CompletionCertificate.tsx`, `src/SignatureVerifier.tsx` - read-only record
  view; verifier showing each named `VerifyReason`. The verifier state holds
  file NAMES; the `File` objects stay in a ref.

## What these components owe

Controlled state (full next state, JSON-serialisable), stable
`data-fancy-sign-*` handles on every interactive element (react-fancy's
`Checkbox`, `OtpInput`, `DatePicker` and `FileUpload` do not forward `data-*`,
so they are wrapped in a `div` that carries the handle), JSON-friendly props,
and `onActivity` events. A new interactive element gets its handle and a test
asserting it in the same commit.

## Claims

The README's legal wording is fixed by the plan's section 10.
`tests/readme-claims.test.ts` fails on any forbidden phrase. Do not describe
this package with stronger words anywhere in the repo.

## Dependencies

`dependencies` is empty and stays empty (asserted). `react`, `react-dom`,
`@particle-academy/react-fancy` and `tailwindcss` are peers and are `external`
in `tsup.config.ts`.

## Commands

```bash
npm install
npm test       # tsup, then vitest (jsdom)
npm run lint   # tsc --noEmit && eslint .
npm run build  # tsup
```

## Test notes

- jsdom has no 2D canvas context; tests stub `getContext` to return `null` and
  the pad must work without one.
- Node's `URL.createObjectURL` rejects jsdom's `Blob`; ceremony tests stub it. A
  late rejection there once overwrote the error a test was waiting for.
- `IntersectionObserver` is stubbed in the page-view tests; time is driven with
  fake `Date` only.

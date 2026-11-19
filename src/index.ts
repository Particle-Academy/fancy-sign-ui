/**
 * `@particle-academy/fancy-sign-ui`: React surfaces for simple electronic
 * signatures (SES), built from react-fancy.
 *
 * Everything on `./client` is re-exported here, so a React consumer needs one
 * import. The reverse must not become true: `./client` stays React-free.
 *
 * Import the stylesheet once:
 * `import "@particle-academy/fancy-sign-ui/styles.css";`
 */

export { SignError, createSignClient, isSignErrorCode, toStateError } from "./client";
export type { SignClient, SignClientOptions, VerifyInput, CertificateJson, SignerData } from "./client";
export { DATA_CANONICAL_NAME, DataCanonicalError, canonicalData, dataSha256, parseCanonicalData, sha256Hex } from "./data";
export type * from "./types";

export {
  MARK_LIMITS,
  countPoints,
  extendStroke,
  isMarkComplete,
  normalisePoint,
  setTypedText,
  startStroke,
  undoStroke,
  validateMark,
} from "./mark";
export type { MarkLimits, MarkLimit, MarkProblem, MarkStep } from "./mark";

export { SignaturePad } from "./SignaturePad";
export type { SignaturePadProps } from "./SignaturePad";

export {
  SignatureField,
  InitialsField,
  DateSignedField,
  SignFieldView,
  SignFieldPalette,
  MarkPreview,
  emptyFieldDraft,
  fieldDraftProblem,
} from "./fields";
export type { SignFieldProps, SignFieldPaletteProps, PaletteSigner } from "./fields";

export { SignerCeremony, initialCeremonyState, signBlockers, signerMessage } from "./SignerCeremony";
export type {
  SignerCeremonyProps,
  SignerCeremonyState,
  CeremonyStep,
  CeremonyErrorPanel,
  SignBlocker,
  DataField,
  DataRenderContext,
} from "./SignerCeremony";

export { EnvelopeSetup, initialEnvelopeSetupState, setupProblems } from "./EnvelopeSetup";
export type { EnvelopeSetupProps, EnvelopeSetupState } from "./EnvelopeSetup";

export { OrgSigningSettings, initialOrgSigningState } from "./OrgSigningSettings";
export type { OrgSigningSettingsProps, OrgSigningState } from "./OrgSigningSettings";

export { EnvelopeTimeline, CLIENT_EVENT_LABEL, eventTitle } from "./EnvelopeTimeline";
export type { EnvelopeTimelineProps } from "./EnvelopeTimeline";

export { CompletionCertificate } from "./CompletionCertificate";
export type { CompletionCertificateProps } from "./CompletionCertificate";

export { SignatureVerifier, VERIFY_REASON_TEXT, initialVerifierState } from "./SignatureVerifier";
export type { SignatureVerifierProps, SignatureVerifierState } from "./SignatureVerifier";

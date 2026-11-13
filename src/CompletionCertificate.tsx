import { Badge, Card, Heading, Table, Text, cn } from "@particle-academy/react-fancy";
import { isoDateTime } from "./activity";
import { EnvelopeTimeline } from "./EnvelopeTimeline";
import type { Completion, SignEvent } from "./types";

export interface CompletionCertificateProps {
  completion: Completion;
  /** The envelope's events, shown in seq order with their source. */
  events?: SignEvent[];
  /** Envelope title, when the host has it. */
  title?: string;
  /** Root handle. Default `"completion-certificate"`. */
  surfaceId?: string;
  className?: string;
}

const RECORD_ROWS: Array<[keyof Completion, string]> = [
  ["envelope_id", "Envelope"],
  ["as_sent_sha256", "As-sent SHA-256"],
  ["final_sha256", "Final SHA-256"],
  ["chain_head", "Chain head"],
  ["nonce", "Nonce"],
  ["key_id", "Seal key id"],
  ["token", "Completion token"],
  ["seal", "Seal (Ed25519, base64)"],
];

/**
 * The completion record and every event, as the certificate of completion
 * shows them. Read-only. The record is verifiable with the host's public key
 * through `<SignatureVerifier>`; this surface does not claim to have checked it.
 */
export function CompletionCertificate({
  completion,
  events,
  title,
  surfaceId = "completion-certificate",
  className,
}: CompletionCertificateProps) {
  return (
    <div data-fancy-sign-surface={surfaceId} className={cn("fancy-sign fancy-sign-certificate", className)}>
      <Heading as="h2" size="lg">
        Certificate of completion{title ? `: ${title}` : ""}
      </Heading>

      <Card variant="outlined" padding="md">
        <Heading as="h3" size="sm">
          Record
        </Heading>
        <dl className="fancy-sign-certificate__record">
          {RECORD_ROWS.map(([key, label]) => (
            <div key={key} className="fancy-sign-certificate__row">
              <Text as="span" size="sm" color="muted">
                {label}
              </Text>
              <Text as="span" size="sm" className="fancy-sign__mono" data-fancy-sign-cert-value={key}>
                {String(completion[key])}
              </Text>
            </div>
          ))}
        </dl>
      </Card>

      <Card variant="outlined" padding="md">
        <Heading as="h3" size="sm">
          Signers
        </Heading>
        <Table>
          <Table.Head>
            <Table.Row>
              <Table.Cell header>Signer</Table.Cell>
              <Table.Cell header>Signed</Table.Cell>
              <Table.Cell header>Method</Table.Cell>
              <Table.Cell header>Evidence</Table.Cell>
            </Table.Row>
          </Table.Head>
          <Table.Body>
            {completion.signers.map((signer) => (
              <Table.Row key={signer.id}>
                <Table.Cell data-fancy-sign-cert-signer={signer.id}>
                  <Text as="span" weight="medium">
                    {signer.name}
                  </Text>{" "}
                  <Text as="span" size="sm" color="muted">
                    {signer.email}
                  </Text>
                </Table.Cell>
                <Table.Cell>{isoDateTime(signer.signed_at)}</Table.Cell>
                <Table.Cell>
                  <Badge size="sm" variant="soft">
                    {signer.method === "otp+passkey" ? "Email code + passkey" : "Email code"}
                  </Badge>
                </Table.Cell>
                <Table.Cell>
                  Consent event {signer.consent_seq}, code event {signer.otp_seq}
                </Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table>
      </Card>

      {events ? (
        <Card variant="outlined" padding="md">
          <Heading as="h3" size="sm">
            Events
          </Heading>
          <EnvelopeTimeline events={events} surfaceId={`${surfaceId}-events`} />
        </Card>
      ) : null}
    </div>
  );
}

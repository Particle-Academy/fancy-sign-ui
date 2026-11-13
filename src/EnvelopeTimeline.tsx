import { Badge, Text, Timeline, cn } from "@particle-academy/react-fancy";
import { isoDateTime } from "./activity";
import type { SignEvent } from "./types";

/**
 * The label every `source: "client"` event carries. `page.viewed` is reported
 * by the signer's browser, so it is a claim, not an observation; showing it
 * beside server-observed events without this label would overstate the
 * evidence.
 */
export const CLIENT_EVENT_LABEL = "reported by the signer's browser";

const EVENT_TITLE: Record<string, string> = {
  "envelope.created": "Envelope created",
  "envelope.sent": "Envelope sent",
  "email.sent": "Email sent",
  "link.opened": "Signing link opened",
  "otp.sent": "Code sent",
  "otp.verified": "Code verified",
  "otp.failed": "Code rejected",
  "otp.locked": "Code locked after too many attempts",
  "consent.accepted": "Agreed to sign electronically",
  "document.opened": "Document opened",
  "page.viewed": "Page viewed",
  "field.completed": "Field completed",
  "mark.adopted": "Signature adopted",
  "signer.signed": "Signed",
  "signer.declined": "Declined",
  "reminder.sent": "Reminder sent",
  "envelope.completed": "Envelope completed",
  "envelope.voided": "Envelope voided",
  "envelope.expired": "Envelope expired",
  "document.downloaded": "Document downloaded",
  "seal.applied": "Seal applied",
};

const EVENT_COLOR: Record<string, "green" | "red" | "amber" | "blue" | "zinc"> = {
  "signer.signed": "green",
  "envelope.completed": "green",
  "signer.declined": "red",
  "envelope.voided": "red",
  "otp.locked": "red",
  "otp.failed": "amber",
  "envelope.expired": "amber",
  "envelope.sent": "blue",
  "document.opened": "blue",
};

/** A human title for an event type. Unknown types show as themselves. */
export function eventTitle(type: string): string {
  return EVENT_TITLE[type] ?? type;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function summary(event: SignEvent): string | null {
  const d = event.data ?? {};
  switch (event.type) {
    case "page.viewed": {
      const page = num(d.page);
      const ms = num(d.ms);
      if (page === null) return null;
      return ms === null ? `Page ${page}` : `Page ${page}, ${(ms / 1000).toFixed(1)} s on screen`;
    }
    case "otp.sent":
    case "otp.verified":
    case "otp.failed":
      return str(d.purpose) ? `Purpose: ${String(d.purpose)}` : null;
    case "field.completed":
      return str(d.field_id) ? `Field ${String(d.field_id)}` : null;
    default:
      return null;
  }
}

export interface EnvelopeTimelineProps {
  events: SignEvent[];
  /** Map actor ids (e.g. `signer:<id>`) to display names. Unknown actors show as given. */
  actorNames?: Record<string, string>;
  /** Show IP and user agent under each event. Default `true`. */
  showNetwork?: boolean;
  /** Root handle. Default `"envelope-timeline"`. */
  surfaceId?: string;
  className?: string;
}

/**
 * An envelope's audit chain, in `seq` order.
 *
 * Signer-written text (a decline reason) is rendered as a React text node and
 * nothing else: it is hostile to every reader of this timeline, human or agent,
 * and must never become markup.
 */
export function EnvelopeTimeline({
  events,
  actorNames = {},
  showNetwork = true,
  surfaceId = "envelope-timeline",
  className,
}: EnvelopeTimelineProps) {
  const ordered = [...events].sort((a, b) => a.seq - b.seq);
  return (
    <div data-fancy-sign-surface={surfaceId} className={cn("fancy-sign fancy-sign-timeline", className)}>
      {ordered.length === 0 ? (
        <Text color="muted" data-fancy-sign-empty="">
          No events yet.
        </Text>
      ) : (
        <Timeline animated={false}>
          {ordered.map((event) => {
            const reason = event.type === "signer.declined" || event.type === "envelope.voided" ? str(event.data?.reason) : null;
            const detail = summary(event);
            const client = event.source === "client";
            return (
              <Timeline.Item key={event.seq} date={isoDateTime(event.at)} color={EVENT_COLOR[event.type] ?? "zinc"}>
                <div
                  data-fancy-sign-event={String(event.seq)}
                  data-fancy-sign-event-type={event.type}
                  data-fancy-sign-event-source={event.source}
                  className="fancy-sign-timeline__event"
                >
                  <div className="fancy-sign-timeline__title">
                    <Text as="span" weight="medium">
                      {eventTitle(event.type)}
                    </Text>
                    {client ? (
                      <Badge size="sm" variant="outline" color="amber" data-fancy-sign-event-claim="">
                        {CLIENT_EVENT_LABEL}
                      </Badge>
                    ) : null}
                  </div>
                  <Text as="span" size="sm" color="muted">
                    {actorNames[event.actor] ?? event.actor}
                    {detail ? `, ${detail}` : ""}
                  </Text>
                  {reason !== null ? (
                    <Text as="p" size="sm" className="fancy-sign__prose" data-fancy-sign-event-reason="">
                      {reason}
                    </Text>
                  ) : null}
                  {showNetwork && (event.ip || event.user_agent) ? (
                    <Text as="span" size="xs" color="muted" className="fancy-sign-timeline__network">
                      {[event.ip, event.user_agent].filter(Boolean).join(", ")}
                    </Text>
                  ) : null}
                </div>
              </Timeline.Item>
            );
          })}
        </Timeline>
      )}
    </div>
  );
}

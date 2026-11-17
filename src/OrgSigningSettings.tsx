import { useCallback } from "react";
import { Button, Callout, Card, Heading, Select, Text, cn } from "@particle-academy/react-fancy";
import { activityEvent, useSurfaceState } from "./activity";
import { toStateError } from "./client";
import type { PerPageMark, SignActivityEvent, SignStateError } from "./types";

export interface OrgSigningState {
  /** The choice on screen. */
  per_page: PerPageMark;
  /** What the backend last saved, so an unsaved change is visible. */
  saved: PerPageMark;
  status: "idle" | "busy" | "error";
  error: SignStateError | null;
}

export function initialOrgSigningState(saved: PerPageMark = "none"): OrgSigningState {
  return { per_page: saved, saved, status: "idle", error: null };
}

export interface OrgSigningSettingsProps {
  value?: OrgSigningState;
  /** Always the FULL next state. */
  onChange?: (next: OrgSigningState) => void;
  defaultValue?: OrgSigningState;
  /**
   * Whether this user is an org admin. The backend decides
   * (`OrgAdminPolicy`); this only hides controls that would be refused.
   */
  canEdit: boolean;
  /** Save the choice. The host calls `client.updateOrgSettings({ per_page })`. */
  onSave?: (perPage: PerPageMark) => Promise<unknown> | void;
  /** Root handle. Default `"org-signing-settings"`. */
  surfaceId?: string;
  onActivity?: (event: SignActivityEvent) => void;
  className?: string;
}

const OPTIONS = [
  { value: "none", label: "None" },
  { value: "initials", label: "Initials on every page" },
  { value: "signature", label: "Signature on every page" },
];

/**
 * The org admin's switch for per-page initials or signatures. When it is on,
 * every envelope the organisation sends carries the mark on each authored page
 * (never on the final signature page), and a sender cannot turn it off.
 */
export function OrgSigningSettings({
  value,
  onChange,
  defaultValue,
  canEdit,
  onSave,
  surfaceId = "org-signing-settings",
  onActivity,
  className,
}: OrgSigningSettingsProps) {
  const { state, latest, update } = useSurfaceState(value, defaultValue ?? initialOrgSigningState(), onChange);

  const emit = useCallback(
    (action: string, detail?: Record<string, unknown>) => {
      onActivity?.(activityEvent(surfaceId, action, undefined, detail));
    },
    [onActivity, surfaceId],
  );

  const busy = state.status === "busy";
  const dirty = state.per_page !== state.saved;

  const save = async () => {
    const choice = latest.current.per_page;
    update((c) => ({ ...c, status: "busy", error: null }));
    try {
      await onSave?.(choice);
      update((c) => ({ ...c, saved: choice, status: "idle", error: null }));
      emit("org-settings-saved", { per_page: choice });
    } catch (err) {
      const error = toStateError(err);
      update((c) => ({ ...c, status: "error", error }));
      emit("error", { code: error.code });
    }
  };

  return (
    <div
      data-fancy-sign-surface={surfaceId}
      data-fancy-sign-status={state.status}
      data-fancy-sign-can-edit={canEdit ? "true" : "false"}
      className={cn("fancy-sign fancy-sign-org", className)}
    >
      <Card variant="outlined" padding="md">
        <Heading as="h3" size="sm">
          Signing settings for your organisation
        </Heading>
        {state.error ? (
          <div data-fancy-sign-error={state.error.code} className="fancy-sign__error">
            <Callout color="red">{state.error.message}</Callout>
          </div>
        ) : null}
        <div data-fancy-sign-org-setting="per_page">
          <Select
            label="Per-page marks"
            description="Applies to every envelope your organisation sends. Never placed on the final signature page."
            list={OPTIONS}
            value={state.per_page}
            disabled={!canEdit || busy}
            onValueChange={(v) => {
              update((c) => ({ ...c, per_page: v as PerPageMark }));
              emit("per-page-edited", { per_page: v });
            }}
          />
        </div>
        {canEdit ? (
          <Button
            color="blue"
            disabled={!dirty || busy}
            data-fancy-sign-action="save-org-settings"
            onClick={() => void save()}
          >
            Save
          </Button>
        ) : (
          <Text size="sm" data-fancy-sign-org-readonly="">
            Only an organisation admin can change this.
          </Text>
        )}
      </Card>
    </div>
  );
}

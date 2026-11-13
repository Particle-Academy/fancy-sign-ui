import { useCallback, useRef, useState } from "react";
import type { SignActivityEvent } from "./types";

/**
 * Build one `AgentActivity`-shaped event.
 *
 * Kept in one place so every surface stamps the same shape: a presence or undo
 * layer subscribing to these should never have to special-case which component
 * emitted. Callers must never put a one-time code, a session or mark points in
 * `detail`.
 */
export function activityEvent(
  surface: string,
  action: string,
  target?: string,
  detail?: Record<string, unknown>,
): SignActivityEvent {
  const event: SignActivityEvent = { surface, action, at: new Date().toISOString() };
  if (target !== undefined) event.target = target;
  if (detail !== undefined) event.detail = detail;
  return event;
}

/** `2026-07-31T09:12:00Z` to `2026-07-31`, without dragging in a locale. */
export function isoDate(value: string | null | undefined): string {
  if (!value) return "";
  return value.length >= 10 ? value.slice(0, 10) : value;
}

/** `2026-07-31T09:12:00Z` to `2026-07-31 09:12 UTC`. */
export function isoDateTime(value: string | null | undefined): string {
  if (!value) return "";
  if (value.length < 16) return value;
  return `${value.slice(0, 10)} ${value.slice(11, 16)} UTC`;
}

/**
 * Controlled when `value` is given, uncontrolled (from `defaultValue`) when not.
 *
 * `update(apply)` builds the next state from the LATEST one, not the last one
 * rendered, so two updates in one tick (or one after an `await`) compose instead
 * of the second overwriting the first. It always emits the FULL next state.
 */
export function useSurfaceState<T>(
  value: T | undefined,
  defaultValue: T,
  onChange: ((next: T) => void) | undefined,
): { state: T; latest: { readonly current: T }; update: (apply: (current: T) => T) => void } {
  const [internal, setInternal] = useState<T>(defaultValue);
  const controlled = value !== undefined;
  const state = controlled ? value : internal;

  const latest = useRef(state);
  const lastRendered = useRef(state);
  // A new render (from the host or our own state) re-anchors the ref. Between
  // renders, `update` keeps it current so chained updates compose.
  if (lastRendered.current !== state) {
    lastRendered.current = state;
    latest.current = state;
  }

  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const controlledRef = useRef(controlled);
  controlledRef.current = controlled;

  const update = useCallback((apply: (current: T) => T) => {
    const next = apply(latest.current);
    latest.current = next;
    if (!controlledRef.current) setInternal(next);
    onChangeRef.current?.(next);
  }, []);

  return { state, latest, update };
}

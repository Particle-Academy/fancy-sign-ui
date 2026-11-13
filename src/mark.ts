/**
 * Pure mark logic: building a drawn signature as strokes, and the caps.
 *
 * A drawn signature is JSON points, **never an image**. The backend draws them
 * as vector paths, so no client-supplied image is ever decoded on the trust
 * boundary. Every function here returns a new mark and never mutates its input,
 * so a controlled host can keep the previous mark for undo.
 */
import type { DrawnMark, Mark, TypedMark } from "./types";

export interface MarkLimits {
  strokes: number;
  /** Total across all strokes. */
  points: number;
  typedLength: number;
}

/** The contract's defaults. Each is a backend setting, so a host may pass tighter ones. */
export const MARK_LIMITS: Readonly<MarkLimits> = Object.freeze({ strokes: 64, points: 2048, typedLength: 128 });

export type MarkLimit = "strokes" | "points";
export type MarkProblem = MarkLimit | "coordinates" | "typed_length";

export interface MarkStep {
  mark: DrawnMark;
  accepted: boolean;
  /** Which cap refused the point, when one did. */
  limit?: MarkLimit;
}

/** Points closer than this (in unit coordinates) to the previous one are dropped. */
const MIN_STEP = 0.002;

function clampUnit(n: number): number {
  if (!Number.isFinite(n)) return 0;
  const clamped = Math.min(1, Math.max(0, n));
  return Math.round(clamped * 10000) / 10000;
}

function asPoint(point: [number, number]): [number, number] {
  return [clampUnit(point[0]), clampUnit(point[1])];
}

export function countPoints(mark: DrawnMark | null): number {
  if (!mark) return 0;
  let total = 0;
  for (const stroke of mark.strokes) total += stroke.length;
  return total;
}

/** Client coordinates to `[0, 1]` against an element box, y pointing down. */
export function normalisePoint(
  clientX: number,
  clientY: number,
  rect: { left: number; top: number; width: number; height: number },
): [number, number] {
  const width = rect.width > 0 ? rect.width : 1;
  const height = rect.height > 0 ? rect.height : 1;
  return [clampUnit((clientX - rect.left) / width), clampUnit((clientY - rect.top) / height)];
}

/** Begin a new stroke at `point`. Refused (and the mark returned unchanged) at either cap. */
export function startStroke(
  mark: DrawnMark | null,
  point: [number, number],
  limits: MarkLimits = MARK_LIMITS,
): MarkStep {
  const current: DrawnMark = mark ?? { kind: "drawn", strokes: [] };
  if (current.strokes.length >= limits.strokes) {
    return { mark: current, accepted: false, limit: "strokes" };
  }
  if (countPoints(current) >= limits.points) {
    return { mark: current, accepted: false, limit: "points" };
  }
  return { mark: { kind: "drawn", strokes: [...current.strokes, [asPoint(point)]] }, accepted: true };
}

/** Add `point` to the last stroke. A point that has not moved is skipped, and accepted. */
export function extendStroke(
  mark: DrawnMark,
  point: [number, number],
  limits: MarkLimits = MARK_LIMITS,
): MarkStep {
  const last = mark.strokes[mark.strokes.length - 1];
  if (!last) return startStroke(mark, point, limits);
  if (countPoints(mark) >= limits.points) {
    return { mark, accepted: false, limit: "points" };
  }
  const next = asPoint(point);
  const prev = last[last.length - 1];
  if (prev && Math.hypot(next[0] - prev[0], next[1] - prev[1]) < MIN_STEP) {
    return { mark, accepted: true };
  }
  const strokes = mark.strokes.slice(0, -1);
  strokes.push([...last, next]);
  return { mark: { kind: "drawn", strokes }, accepted: true };
}

/** Remove the last stroke. Returns `null` once nothing is left. */
export function undoStroke(mark: DrawnMark | null): DrawnMark | null {
  if (!mark || mark.strokes.length <= 1) return null;
  return { kind: "drawn", strokes: mark.strokes.slice(0, -1) };
}

export function setTypedText(text: string, limits: MarkLimits = MARK_LIMITS): TypedMark {
  return { kind: "typed", text: Array.from(text).slice(0, limits.typedLength).join("") };
}

/** `null` when the mark is within contract, else the first problem found. */
export function validateMark(mark: Mark, limits: MarkLimits = MARK_LIMITS): MarkProblem | null {
  if (mark.kind === "typed") {
    return Array.from(mark.text).length > limits.typedLength ? "typed_length" : null;
  }
  if (mark.strokes.length > limits.strokes) return "strokes";
  if (countPoints(mark) > limits.points) return "points";
  for (const stroke of mark.strokes) {
    for (const [x, y] of stroke) {
      if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > 1 || y < 0 || y > 1) {
        return "coordinates";
      }
    }
  }
  return null;
}

/** True when the mark carries ink, or non-blank text, and is within contract. */
export function isMarkComplete(mark: Mark | null, limits: MarkLimits = MARK_LIMITS): boolean {
  if (!mark) return false;
  if (validateMark(mark, limits) !== null) return false;
  return mark.kind === "typed" ? mark.text.trim().length > 0 : countPoints(mark) > 0;
}

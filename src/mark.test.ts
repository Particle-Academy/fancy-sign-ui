import { describe, expect, it } from "vitest";
import {
  MARK_LIMITS,
  countPoints,
  extendStroke,
  isMarkComplete,
  normalisePoint,
  setTypedText,
  startStroke,
  validateMark,
} from "./mark";
import type { DrawnMark } from "./types";

function drawnWith(strokes: number, pointsEach: number): DrawnMark {
  return {
    kind: "drawn",
    strokes: Array.from({ length: strokes }, (_, s) =>
      Array.from({ length: pointsEach }, (_, p) => [((s + p) % 100) / 100, 0.5] as [number, number]),
    ),
  };
}

describe("caps (failure paths first)", () => {
  it("refuses a 65th stroke", () => {
    const full = drawnWith(64, 1);
    const result = startStroke(full, [0.1, 0.1]);
    expect(result.accepted).toBe(false);
    expect(result.limit).toBe("strokes");
    expect(result.mark.strokes).toHaveLength(64);
    expect(result.mark).toBe(full);
  });

  it("refuses a point past 2048 in total, across strokes", () => {
    const full = drawnWith(2, 1024);
    expect(countPoints(full)).toBe(2048);
    const extended = extendStroke(full, [0.9, 0.9]);
    expect(extended.accepted).toBe(false);
    expect(extended.limit).toBe("points");
    expect(countPoints(extended.mark)).toBe(2048);

    const started = startStroke(full, [0.9, 0.9]);
    expect(started.accepted).toBe(false);
    expect(started.limit).toBe("points");
  });

  it("honours tighter caps passed by the host", () => {
    const limits = { ...MARK_LIMITS, strokes: 2 };
    const two = drawnWith(2, 1);
    expect(startStroke(two, [0.2, 0.2], limits).accepted).toBe(false);
  });

  it("clamps coordinates into [0, 1] rather than emitting out-of-range points", () => {
    const result = startStroke(null, [1.7, -0.4]);
    expect(result.mark.strokes[0]![0]).toEqual([1, 0]);
  });

  it("caps typed text at 128 characters", () => {
    const long = "x".repeat(300);
    expect(setTypedText(long).text).toHaveLength(128);
    expect(setTypedText(long, { ...MARK_LIMITS, typedLength: 10 }).text).toHaveLength(10);
  });

  it("validateMark names each way a mark is out of contract", () => {
    expect(validateMark(drawnWith(65, 1))).toBe("strokes");
    expect(validateMark(drawnWith(3, 700))).toBe("points");
    expect(validateMark({ kind: "drawn", strokes: [[[1.5, 0]]] })).toBe("coordinates");
    expect(validateMark({ kind: "drawn", strokes: [[[Number.NaN, 0]]] })).toBe("coordinates");
    expect(validateMark({ kind: "typed", text: "y".repeat(129) })).toBe("typed_length");
    expect(validateMark({ kind: "drawn", strokes: [[[0.1, 0.2]]] })).toBeNull();
  });
});

describe("drawing", () => {
  it("normalises against the element box, y pointing down", () => {
    const rect = { left: 10, top: 20, width: 200, height: 100 };
    expect(normalisePoint(110, 70, rect)).toEqual([0.5, 0.5]);
    expect(normalisePoint(10, 120, rect)).toEqual([0, 1]);
  });

  it("does not divide by zero on an unmeasured box", () => {
    const point = normalisePoint(5, 5, { left: 0, top: 0, width: 0, height: 0 });
    expect(point.every((n) => Number.isFinite(n))).toBe(true);
  });

  it("skips a point that has not moved, so a resting pen does not eat the budget", () => {
    let mark = startStroke(null, [0.5, 0.5]).mark;
    mark = extendStroke(mark, [0.5, 0.5]).mark;
    mark = extendStroke(mark, [0.5001, 0.5]).mark;
    expect(countPoints(mark)).toBe(1);
    mark = extendStroke(mark, [0.6, 0.5]).mark;
    expect(countPoints(mark)).toBe(2);
  });

  it("a mark is complete only when it has ink or non-blank text", () => {
    expect(isMarkComplete(null)).toBe(false);
    expect(isMarkComplete({ kind: "drawn", strokes: [] })).toBe(false);
    expect(isMarkComplete({ kind: "typed", text: "   " })).toBe(false);
    expect(isMarkComplete({ kind: "typed", text: "Ada" })).toBe(true);
    expect(isMarkComplete(startStroke(null, [0.1, 0.1]).mark)).toBe(true);
  });
});

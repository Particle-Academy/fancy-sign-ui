import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { SignaturePad } from "./SignaturePad";
import type { Mark, SignActivityEvent } from "./types";

afterEach(cleanup);
beforeEach(() => {
  // jsdom has no 2D context; the pad must work (and emit strokes) without one.
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  vi.spyOn(HTMLCanvasElement.prototype, "getBoundingClientRect").mockReturnValue({
    left: 0, top: 0, width: 200, height: 100, right: 200, bottom: 100, x: 0, y: 0, toJSON: () => ({}),
  } as DOMRect);
});

function Harness(props: { initial?: Mark | null; onMark?: (m: Mark | null) => void; maxStrokes?: number; onActivity?: (e: SignActivityEvent) => void }) {
  const [mark, setMark] = useState<Mark | null>(props.initial ?? null);
  return (
    <SignaturePad
      value={mark}
      maxStrokes={props.maxStrokes}
      onActivity={props.onActivity}
      onChange={(next) => {
        props.onMark?.(next);
        setMark(next);
      }}
    />
  );
}

function canvas(): HTMLCanvasElement {
  const el = document.querySelector<HTMLCanvasElement>('[data-fancy-sign-pad-canvas]');
  if (!el) throw new Error("no canvas");
  return el;
}

function stroke(points: Array<[number, number]>) {
  const [first, ...rest] = points;
  fireEvent.pointerDown(canvas(), { clientX: first![0], clientY: first![1], pointerId: 1 });
  for (const [x, y] of rest) fireEvent.pointerMove(canvas(), { clientX: x, clientY: y, pointerId: 1 });
  fireEvent.pointerUp(canvas(), { pointerId: 1 });
}

describe("SignaturePad caps (failure paths first)", () => {
  it("refuses a stroke past the cap, keeps the mark, and says so", () => {
    const marks: Array<Mark | null> = [];
    const activity: SignActivityEvent[] = [];
    render(<Harness maxStrokes={2} onMark={(m) => marks.push(m)} onActivity={(e) => activity.push(e)} />);
    stroke([[10, 10], [50, 50]]);
    stroke([[60, 10], [90, 50]]);
    stroke([[100, 10], [150, 50]]);

    const last = marks[marks.length - 1] as Extract<Mark, { kind: "drawn" }>;
    expect(last.strokes).toHaveLength(2);
    expect(document.querySelector('[data-fancy-sign-pad-limit="strokes"]')).not.toBeNull();
    expect(activity.some((e) => e.action === "mark-limit")).toBe(true);
  });

  it("never lets typed text exceed 128 characters", () => {
    const marks: Array<Mark | null> = [];
    render(<Harness initial={{ kind: "typed", text: "" }} onMark={(m) => marks.push(m)} />);
    const input = document.querySelector<HTMLInputElement>('[data-fancy-sign-pad-typed]')!;
    fireEvent.change(input, { target: { value: "z".repeat(400) } });
    const last = marks[marks.length - 1] as Extract<Mark, { kind: "typed" }>;
    expect(last.text).toHaveLength(128);
    expect(input.maxLength).toBe(128);
  });
});

describe("SignaturePad drawing", () => {
  it("emits normalised strokes, y down, and never an image", () => {
    const marks: Array<Mark | null> = [];
    render(<Harness onMark={(m) => marks.push(m)} />);
    stroke([[0, 0], [100, 50], [200, 100]]);
    const last = marks[marks.length - 1]!;
    expect(last).toEqual({ kind: "drawn", strokes: [[[0, 0], [0.5, 0.5], [1, 1]]] });
    expect(JSON.stringify(last)).not.toContain("data:");
  });

  it("clears and undoes through stable handles", () => {
    const marks: Array<Mark | null> = [];
    render(<Harness onMark={(m) => marks.push(m)} />);
    stroke([[10, 10], [20, 20]]);
    stroke([[30, 30], [40, 40]]);
    act(() => {
      document.querySelector<HTMLButtonElement>('[data-fancy-sign-action="undo-stroke"]')!.click();
    });
    expect((marks[marks.length - 1] as Extract<Mark, { kind: "drawn" }>).strokes).toHaveLength(1);
    act(() => {
      document.querySelector<HTMLButtonElement>('[data-fancy-sign-action="clear-mark"]')!.click();
    });
    expect(marks[marks.length - 1]).toBeNull();
  });

  it("switches to typed mode and emits a typed mark", () => {
    const marks: Array<Mark | null> = [];
    render(<Harness onMark={(m) => marks.push(m)} />);
    act(() => {
      document.querySelector<HTMLButtonElement>('[data-fancy-sign-action="mark-mode-typed"]')!.click();
    });
    const input = document.querySelector<HTMLInputElement>('[data-fancy-sign-pad-typed]')!;
    fireEvent.change(input, { target: { value: "Ada Lovelace" } });
    expect(marks[marks.length - 1]).toEqual({ kind: "typed", text: "Ada Lovelace" });
  });
});

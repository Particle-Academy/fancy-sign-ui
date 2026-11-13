import { useCallback, useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { Button, Callout, Card, Input, cn } from "@particle-academy/react-fancy";
import { activityEvent } from "./activity";
import {
  MARK_LIMITS,
  countPoints,
  extendStroke,
  normalisePoint,
  setTypedText,
  startStroke,
  undoStroke,
  type MarkLimit,
  type MarkLimits,
} from "./mark";
import type { DrawnMark, Mark, SignActivityEvent } from "./types";

export interface SignaturePadProps {
  /** The current mark, or `null` for none. */
  value: Mark | null;
  /** Always the full next mark (or `null` once cleared). */
  onChange: (next: Mark | null) => void;
  /** Caps. Defaults are the contract's: 64 strokes, 2048 points, 128 typed characters. */
  maxStrokes?: number;
  maxPoints?: number;
  maxTypedLength?: number;
  disabled?: boolean;
  /** Root handle. Default `"signature-pad"`. */
  surfaceId?: string;
  onActivity?: (event: SignActivityEvent) => void;
  /** Canvas height in CSS pixels. Default 160. */
  height?: number;
  /** Placeholder for typed mode. */
  typedPlaceholder?: string;
  className?: string;
}

/**
 * Draw or type a signature. Emits `{ kind: "drawn", strokes }` with every point
 * normalised to `[0, 1]` (y down), or `{ kind: "typed", text }`.
 *
 * **It never produces an image.** The canvas is only a view of the strokes; the
 * strokes are the value. A PNG from the browser would be hostile input to the
 * backend with nothing to gain, so there is no code path that makes one
 * (`packaging.test.ts` greps the bundle for `toDataURL`).
 */
export function SignaturePad({
  value,
  onChange,
  maxStrokes = MARK_LIMITS.strokes,
  maxPoints = MARK_LIMITS.points,
  maxTypedLength = MARK_LIMITS.typedLength,
  disabled = false,
  surfaceId = "signature-pad",
  onActivity,
  height = 160,
  typedPlaceholder = "Type your full name",
  className,
}: SignaturePadProps) {
  const limits: MarkLimits = { strokes: maxStrokes, points: maxPoints, typedLength: maxTypedLength };
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawing = useRef(false);
  // The mark being drawn, ahead of the host's re-render, so fast pointer moves
  // between renders extend the right stroke.
  const working = useRef<DrawnMark | null>(value?.kind === "drawn" ? value : null);
  const [preferTyped, setPreferTyped] = useState(false);
  const [limitHit, setLimitHit] = useState<MarkLimit | null>(null);

  const mode: "drawn" | "typed" = value ? value.kind : preferTyped ? "typed" : "drawn";

  useEffect(() => {
    if (!drawing.current) working.current = value?.kind === "drawn" ? value : null;
  }, [value]);

  // Paint the strokes. Purely a view: nothing is ever read back from the canvas.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || mode !== "drawn") return;
    let ctx: CanvasRenderingContext2D | null = null;
    try {
      ctx = canvas.getContext("2d");
    } catch {
      ctx = null;
    }
    if (!ctx) return;
    const { width, height: h } = canvas;
    ctx.clearRect(0, 0, width, h);
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = getComputedStyle(canvas).color || "#000";
    const strokes = value?.kind === "drawn" ? value.strokes : [];
    for (const stroke of strokes) {
      const [first, ...rest] = stroke;
      if (!first) continue;
      ctx.beginPath();
      ctx.moveTo(first[0] * width, first[1] * h);
      if (rest.length === 0) ctx.lineTo(first[0] * width + 0.5, first[1] * h + 0.5);
      for (const [x, y] of rest) ctx.lineTo(x * width, y * h);
      ctx.stroke();
    }
  }, [value, mode]);

  const emit = useCallback(
    (action: string, detail?: Record<string, unknown>) => {
      onActivity?.(activityEvent(surfaceId, action, undefined, detail));
    },
    [onActivity, surfaceId],
  );

  const refuse = useCallback(
    (limit: MarkLimit) => {
      if (limitHit !== limit) emit("mark-limit", { limit });
      setLimitHit(limit);
    },
    [emit, limitHit],
  );

  const point = (event: ReactPointerEvent<HTMLCanvasElement>): [number, number] => {
    const rect = event.currentTarget.getBoundingClientRect();
    return normalisePoint(event.clientX, event.clientY, rect);
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (disabled) return;
    const step = startStroke(working.current, point(event), limits);
    if (!step.accepted) {
      refuse(step.limit!);
      return;
    }
    try {
      event.currentTarget.setPointerCapture?.(event.pointerId);
    } catch {
      // A synthetic or already-released pointer: capture is a nicety, not a need.
    }
    drawing.current = true;
    working.current = step.mark;
    onChange(step.mark);
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current || !working.current) return;
    const step = extendStroke(working.current, point(event), limits);
    if (!step.accepted) {
      refuse(step.limit!);
      return;
    }
    if (step.mark !== working.current) {
      working.current = step.mark;
      onChange(step.mark);
    }
  };

  const endStroke = () => {
    if (!drawing.current) return;
    drawing.current = false;
    if (working.current) {
      emit("mark-stroke", { strokes: working.current.strokes.length, points: countPoints(working.current) });
    }
  };

  const clear = () => {
    working.current = null;
    setLimitHit(null);
    emit("mark-cleared");
    onChange(mode === "typed" ? { kind: "typed", text: "" } : null);
  };

  const undo = () => {
    const next = undoStroke(working.current);
    working.current = next;
    setLimitHit(null);
    emit("mark-undo");
    onChange(next);
  };

  const switchMode = (next: "drawn" | "typed") => {
    if (next === mode) return;
    setPreferTyped(next === "typed");
    working.current = null;
    setLimitHit(null);
    emit("mark-mode", { mode: next });
    onChange(next === "typed" ? { kind: "typed", text: "" } : null);
  };

  const strokes = value?.kind === "drawn" ? value.strokes.length : 0;

  return (
    <div
      data-fancy-sign-surface={surfaceId}
      data-fancy-sign-pad-mode={mode}
      className={cn("fancy-sign fancy-sign-pad", className)}
    >
      <div className="fancy-sign-pad__modes">
        <Button
          type="button"
          size="sm"
          variant={mode === "drawn" ? "default" : "ghost"}
          active={mode === "drawn"}
          disabled={disabled}
          data-fancy-sign-action="mark-mode-drawn"
          onClick={() => switchMode("drawn")}
        >
          Draw
        </Button>
        <Button
          type="button"
          size="sm"
          variant={mode === "typed" ? "default" : "ghost"}
          active={mode === "typed"}
          disabled={disabled}
          data-fancy-sign-action="mark-mode-typed"
          onClick={() => switchMode("typed")}
        >
          Type
        </Button>
      </div>

      {mode === "drawn" ? (
        <Card variant="outlined" padding="none" className="fancy-sign-pad__surface">
          <canvas
            ref={canvasRef}
            data-fancy-sign-pad-canvas={surfaceId}
            data-fancy-sign-pad-strokes={String(strokes)}
            aria-label="Signature drawing area"
            role="img"
            width={600}
            height={Math.round(height * 1.5)}
            style={{ height, touchAction: "none" }}
            className="fancy-sign-pad__canvas"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endStroke}
            onPointerCancel={endStroke}
            onPointerLeave={endStroke}
          />
        </Card>
      ) : (
        <Input
          type="text"
          value={value?.kind === "typed" ? value.text : ""}
          maxLength={maxTypedLength}
          placeholder={typedPlaceholder}
          disabled={disabled}
          aria-label="Typed signature"
          data-fancy-sign-pad-typed={surfaceId}
          onChange={(event) => onChange(setTypedText(event.target.value, limits))}
        />
      )}

      {limitHit ? (
        <div data-fancy-sign-pad-limit={limitHit}>
          <Callout color="amber">
            {limitHit === "strokes"
              ? `That is the most strokes a signature can have (${maxStrokes}). Clear or undo to keep drawing.`
              : `That is the most detail a signature can have (${maxPoints} points). Clear or undo to keep drawing.`}
          </Callout>
        </div>
      ) : null}

      <div className="fancy-sign-pad__actions">
        {mode === "drawn" ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            icon="undo-2"
            disabled={disabled || strokes === 0}
            data-fancy-sign-action="undo-stroke"
            onClick={undo}
          >
            Undo
          </Button>
        ) : null}
        <Button
          type="button"
          size="sm"
          variant="ghost"
          icon="eraser"
          disabled={disabled || value === null}
          data-fancy-sign-action="clear-mark"
          onClick={clear}
        >
          Clear
        </Button>
      </div>
    </div>
  );
}

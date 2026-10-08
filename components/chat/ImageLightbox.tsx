/**
 * components/chat/ImageLightbox.tsx — view an image attachment properly, and
 * zoom into it.
 *
 * WHY THIS EXISTS
 * Clicking an image in a chat used to do nothing at all: the bubble rendered a
 * plain `<img className="max-h-64 object-cover">`, so a screenshot arrived
 * cropped and there was no way to see the whole thing, let alone read small
 * text in it. The request was "image sundor kore open hobe ebong zoom kora jabe".
 *
 * WHAT IT DOES
 *   - opens the image full-screen over a dark scrim, fitted (never cropped);
 *   - zooms: wheel, trackpad pinch, touch pinch, double-click, buttons, and
 *     `+`/`-`/`0` on the keyboard — always anchored on the pointer, so the
 *     detail under the cursor stays under the cursor;
 *   - pans by dragging once zoomed, clamped so the image cannot be lost
 *     off-screen;
 *   - steps through the other images of the same message with the arrow keys,
 *     the on-screen arrows, or a swipe;
 *   - downloads the image, using the same route the bubble's button uses.
 *
 * ACCESSIBILITY
 * A real modal: `role="dialog"` + `aria-modal`, focus trapped, body scroll
 * locked, Escape closes, and the previously focused element gets focus back
 * (all four come from `components/ui/use-overlay`). It is portalled to
 * `document.body` so no ancestor's `overflow` or `transform` can clip it.
 *
 * THE WHEEL LISTENER IS ATTACHED BY HAND, NOT VIA `onWheel`.
 * React registers `wheel` at the root as PASSIVE, so `preventDefault()` inside
 * an `onWheel` handler is ignored and the page scrolls behind the lightbox
 * while the image zooms. A native listener with `{ passive: false }` is the
 * only way to own the gesture.
 */
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Button, Icon, cn } from "@/components/ui";
import { useEscapeKey, useFocusTrap, useMounted, useScrollLock } from "@/components/ui/use-overlay";
import { downloadFileName, downloadUrl } from "@/lib/download";
import { formatBytes } from "@/lib/format";

export interface LightboxImage {
  id: string;
  url: string;
  name?: string | null;
  mimeType?: string | null;
  sizeBytes?: number | null;
}

export interface ImageLightboxProps {
  images: LightboxImage[];
  /** Index into `images`; `null` keeps the lightbox closed. */
  index: number | null;
  onIndexChange: (index: number) => void;
  onClose: () => void;
}

const MIN_SCALE = 1;
const MAX_SCALE = 8;
/** Double-click / "fit" toggle target. */
const TOGGLE_SCALE = 2.5;
/** Multiplier per wheel notch. */
const WHEEL_STEP = 1.15;
/** Percentage steps for the +/- buttons and keys. */
const BUTTON_STEP = 1.4;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function ImageLightbox({ images, index, onIndexChange, onClose }: ImageLightboxProps) {
  const mounted = useMounted();
  const open = index !== null && index >= 0 && index < images.length && images.length > 0;
  const current = open ? images[index] : null;

  const containerRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);

  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [dragging, setDragging] = useState(false);

  /** Live pointer positions, so a two-finger pinch can be measured. */
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinchStart = useRef<{ distance: number; scale: number } | null>(null);
  const dragStart = useRef<{ x: number; y: number; offsetX: number; offsetY: number } | null>(null);

  useScrollLock(open);
  useFocusTrap(containerRef, open);
  useEscapeKey(open, onClose);

  /* ── Reset when the image changes or the lightbox closes ─────────────── */

  useEffect(() => {
    // Resetting the view for a different image is exactly what an effect is
    // for: the zoom, the pan, the pointer bookkeeping and the load state all
    // belong to the image that was on screen a moment ago, and every one of
    // them would be wrong — or actively confusing, like a 400% zoom carried
    // onto the next photo — if it survived the switch.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- view state is keyed to the current image
    setScale(1);
    setOffset({ x: 0, y: 0 });
    setLoaded(false);
    setFailed(false);
    setDragging(false);
    pointers.current.clear();
    pinchStart.current = null;
    dragStart.current = null;
  }, [current?.id]);

  /* ── Clamping ────────────────────────────────────────────────────────── */

  /**
   * Keep the image from being dragged out of view.
   *
   * The limits are half the OVERFLOW of the scaled image over the stage, per
   * axis. At scale 1 there is no overflow, so the offset is pinned to 0 and the
   * image cannot be nudged off-centre — which is what makes "fit" mean fit.
   */
  const clampOffset = useCallback((next: { x: number; y: number }, atScale: number) => {
    const stage = stageRef.current;
    const image = imageRef.current;
    if (!stage || !image) return next;
    const maxX = Math.max(0, (image.offsetWidth * atScale - stage.clientWidth) / 2);
    const maxY = Math.max(0, (image.offsetHeight * atScale - stage.clientHeight) / 2);
    return { x: clamp(next.x, -maxX, maxX), y: clamp(next.y, -maxY, maxY) };
  }, []);

  /**
   * Zoom to `nextScale` keeping the point under (`clientX`, `clientY`) fixed.
   *
   * `t' = q - (q - t) * (s'/s)` where `q` is the pointer's offset from the
   * stage centre. Without this the image zooms about its own centre and the
   * thing the user aimed at slides away.
   */
  const zoomTo = useCallback(
    (nextScale: number, clientX?: number, clientY?: number) => {
      const target = clamp(nextScale, MIN_SCALE, MAX_SCALE);
      setScale((previous) => {
        if (previous === target) return previous;
        const stage = stageRef.current;
        if (stage && clientX !== undefined && clientY !== undefined) {
          const rect = stage.getBoundingClientRect();
          const q = {
            x: clientX - (rect.left + rect.width / 2),
            y: clientY - (rect.top + rect.height / 2),
          };
          const ratio = target / previous;
          setOffset((current) =>
            clampOffset(
              { x: q.x - (q.x - current.x) * ratio, y: q.y - (q.y - current.y) * ratio },
              target,
            ),
          );
        } else {
          setOffset((current) => clampOffset(current, target));
        }
        return target;
      });
    },
    [clampOffset],
  );

  const reset = useCallback(() => {
    setScale(1);
    setOffset({ x: 0, y: 0 });
  }, []);

  /* ── Wheel / trackpad zoom (non-passive, attached by hand) ───────────── */

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage || !open) return;

    const onWheel = (event: WheelEvent) => {
      // Claim the gesture: otherwise the page behind scrolls too.
      event.preventDefault();
      const factor = event.deltaY < 0 ? WHEEL_STEP : 1 / WHEEL_STEP;
      const rect = stage.getBoundingClientRect();
      // Ctrl+wheel is the trackpad pinch gesture and reports much smaller
      // deltas, so it needs a firmer step to feel the same.
      const tuned = event.ctrlKey ? 1 + (factor - 1) * 3 : factor;
      setScale((previous) => {
        const target = clamp(previous * tuned, MIN_SCALE, MAX_SCALE);
        if (target === previous) return previous;
        const q = {
          x: event.clientX - (rect.left + rect.width / 2),
          y: event.clientY - (rect.top + rect.height / 2),
        };
        const ratio = target / previous;
        setOffset((current) =>
          clampOffset(
            { x: q.x - (q.x - current.x) * ratio, y: q.y - (q.y - current.y) * ratio },
            target,
          ),
        );
        return target;
      });
    };

    stage.addEventListener("wheel", onWheel, { passive: false });
    return () => stage.removeEventListener("wheel", onWheel);
  }, [open, clampOffset]);

  /* ── Keyboard: zoom + navigate ───────────────────────────────────────── */

  const step = useCallback(
    (direction: 1 | -1) => {
      const next = index === null ? null : index + direction;
      if (next === null || next < 0 || next >= images.length) return;
      onIndexChange(next);
    },
    [images.length, index, onIndexChange],
  );

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      switch (event.key) {
        case "ArrowLeft":
          event.preventDefault();
          step(-1);
          return;
        case "ArrowRight":
          event.preventDefault();
          step(1);
          return;
        case "+":
        case "=":
          event.preventDefault();
          zoomTo(scale * BUTTON_STEP);
          return;
        case "-":
        case "_":
          event.preventDefault();
          zoomTo(scale / BUTTON_STEP);
          return;
        case "0":
          event.preventDefault();
          reset();
          return;
        default:
          return;
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, reset, scale, step, zoomTo]);

  /* ── Pointer: pan, pinch, swipe ──────────────────────────────────────── */

  const onPointerDown = useCallback(
    (event: React.PointerEvent) => {
      pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });

      if (pointers.current.size === 2) {
        const [a, b] = [...pointers.current.values()];
        pinchStart.current = {
          distance: Math.hypot(a!.x - b!.x, a!.y - b!.y),
          scale,
        };
        dragStart.current = null;
        return;
      }

      if (scale > MIN_SCALE) {
        dragStart.current = {
          x: event.clientX,
          y: event.clientY,
          offsetX: offset.x,
          offsetY: offset.y,
        };
        setDragging(true);
        (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
      }
    },
    [offset.x, offset.y, scale],
  );

  const onPointerMove = useCallback(
    (event: React.PointerEvent) => {
      if (!pointers.current.has(event.pointerId)) return;
      pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });

      // Two fingers: scale by the change in distance between them.
      if (pointers.current.size === 2 && pinchStart.current) {
        const [a, b] = [...pointers.current.values()];
        const distance = Math.hypot(a!.x - b!.x, a!.y - b!.y);
        if (pinchStart.current.distance > 0) {
          const target = clamp(
            (pinchStart.current.scale * distance) / pinchStart.current.distance,
            MIN_SCALE,
            MAX_SCALE,
          );
          setScale(target);
          setOffset((current) => clampOffset(current, target));
        }
        return;
      }

      const start = dragStart.current;
      if (!start) return;
      setOffset(
        clampOffset(
          {
            x: start.offsetX + (event.clientX - start.x),
            y: start.offsetY + (event.clientY - start.y),
          },
          scale,
        ),
      );
    },
    [clampOffset, scale],
  );

  const endPointer = useCallback((event: React.PointerEvent) => {
    pointers.current.delete(event.pointerId);
    if (pointers.current.size < 2) pinchStart.current = null;
    if (pointers.current.size === 0) {
      dragStart.current = null;
      setDragging(false);
    }
  }, []);

  /* ── Render ──────────────────────────────────────────────────────────── */

  const label = useMemo(() => {
    if (!current) return "";
    return (
      downloadFileName({
        name: current.name,
        url: current.url,
        mimeType: current.mimeType,
        prefix: "image",
      })
    );
  }, [current]);

  if (!mounted || !open || !current) return null;

  const zoomPercent = Math.round(scale * 100);
  const hasMany = images.length > 1;

  return createPortal(
    <div
      ref={containerRef}
      role="dialog"
      aria-modal="true"
      aria-label={`Image ${index! + 1} of ${images.length}`}
      tabIndex={-1}
      className="fixed inset-0 z-modal flex flex-col bg-black/92 backdrop-blur-sm outline-none"
      // A click on the scrim closes, but a click on the image or the toolbar
      // must not — hence the target check rather than a plain onClick.
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      {/* Toolbar */}
      <div className="flex shrink-0 items-center gap-2 px-3 py-2 text-white/90 sm:px-4">
        <p className="min-w-0 flex-1 truncate text-body-sm font-medium">
          {label}
          {current.sizeBytes != null && (
            <span className="ml-2 font-normal text-white/50">
              {formatBytes(current.sizeBytes)}
            </span>
          )}
          {hasMany && (
            <span className="ml-2 font-normal text-white/50">
              {index! + 1} / {images.length}
            </span>
          )}
        </p>

        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={() => zoomTo(scale / BUTTON_STEP)}
            disabled={scale <= MIN_SCALE}
            aria-label="Zoom out"
            className="flex h-9 w-9 items-center justify-center rounded-full hover:bg-white/10 disabled:opacity-35"
          >
            <span aria-hidden className="text-xl leading-none">−</span>
          </button>
          <button
            type="button"
            onClick={reset}
            aria-label={`Zoom, currently ${zoomPercent} percent. Reset`}
            className="min-w-14 rounded-full px-2 py-1.5 text-caption tabular-nums hover:bg-white/10"
          >
            {zoomPercent}%
          </button>
          <button
            type="button"
            onClick={() => zoomTo(scale * BUTTON_STEP)}
            disabled={scale >= MAX_SCALE}
            aria-label="Zoom in"
            className="flex h-9 w-9 items-center justify-center rounded-full hover:bg-white/10 disabled:opacity-35"
          >
            <span aria-hidden className="text-xl leading-none">+</span>
          </button>

          <a
            href={downloadUrl(current.url, label)}
            // Same-origin proxy: the `download` attribute is ignored for a
            // cross-origin URL, which is what S3 returns in production.
            download={label}
            aria-label={`Download ${label}`}
            className="ml-1 flex h-9 items-center gap-1.5 rounded-full bg-white/10 px-3 text-caption font-medium hover:bg-white/20"
          >
            <Icon name="download" size={15} aria-hidden />
            <span className="hidden sm:inline">Download</span>
          </a>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="ml-1 flex h-9 w-9 items-center justify-center rounded-full hover:bg-white/10"
          >
            <Icon name="x" size={18} aria-hidden />
          </button>
        </div>
      </div>

      {/* Stage */}
      <div
        ref={stageRef}
        className={cn(
          "relative flex min-h-0 flex-1 items-center justify-center overflow-hidden",
          scale > MIN_SCALE ? (dragging ? "cursor-grabbing" : "cursor-grab") : "cursor-zoom-in",
          "touch-none",
        )}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endPointer}
        onPointerCancel={endPointer}
        onDoubleClick={(event) => {
          // Toggle between fit and a useful reading zoom, anchored on the click.
          zoomTo(scale > MIN_SCALE ? MIN_SCALE : TOGGLE_SCALE, event.clientX, event.clientY);
        }}
      >
        {hasMany && index! > 0 && (
          <LightboxArrow direction="previous" onClick={() => step(-1)} />
        )}

        {failed ? (
          <div className="flex flex-col items-center gap-3 px-6 text-center">
            <Icon name="image" size={40} aria-hidden className="text-white/40" />
            <p className="text-body-sm text-white/70">
              This image could not be loaded.
            </p>
            <Button size="sm" variant="secondary" onClick={onClose}>
              Close
            </Button>
          </div>
        ) : (
          <>
            {!loaded && (
              <div
                aria-hidden
                className="absolute h-10 w-10 animate-spin rounded-full border-2 border-white/25 border-t-white/80"
              />
            )}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              ref={imageRef}
              src={current.url}
              alt={current.name ?? "Image attachment"}
              draggable={false}
              onLoad={() => setLoaded(true)}
              onError={() => {
                setFailed(true);
                setLoaded(true);
              }}
              className={cn(
                "max-h-full max-w-full select-none object-contain",
                loaded ? "opacity-100" : "opacity-0",
                // No transition while the user is actively dragging or
                // pinching; it would lag the pointer.
                !dragging && "transition-[transform,opacity] duration-150 ease-out",
              )}
              style={{
                transform: `translate3d(${offset.x}px, ${offset.y}px, 0) scale(${scale})`,
                transformOrigin: "center center",
              }}
            />
          </>
        )}

        {hasMany && index! < images.length - 1 && (
          <LightboxArrow direction="next" onClick={() => step(1)} />
        )}
      </div>

      <p className="shrink-0 px-4 py-2 text-center text-caption text-white/45">
        Scroll or pinch to zoom · drag to pan · double-click to fit · arrow keys to browse · Esc to close
      </p>
    </div>,
    document.body,
  );
}

function LightboxArrow({
  direction,
  onClick,
}: {
  direction: "previous" | "next";
  onClick: () => void;
}) {
  const isPrevious = direction === "previous";
  return (
    <button
      type="button"
      onClick={(event) => {
        // The stage's own handlers must not see this as a drag.
        event.stopPropagation();
        onClick();
      }}
      onPointerDown={(event) => event.stopPropagation()}
      aria-label={isPrevious ? "Previous image" : "Next image"}
      className={cn(
        "absolute top-1/2 z-10 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-black/45 text-white transition-colors hover:bg-black/70",
        isPrevious ? "left-2 sm:left-4" : "right-2 sm:right-4",
      )}
    >
      <Icon name={isPrevious ? "chevronLeft" : "chevronRight"} size={22} aria-hidden />
    </button>
  );
}

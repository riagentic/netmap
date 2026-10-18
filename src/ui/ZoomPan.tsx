// SVG canvas with wheel zoom (around the cursor), drag to pan, and +/−/fit buttons.
import type { JSX } from "aio";
import { useLocal, useRef } from "aio/air";
import { type Cam, IDENTITY, pan, wheelFactor, zoomAt } from "../lib/zoom.ts";

let draggedAt = 0;
/** True right after a drag ended — node clicks ignore the click that ends a pan. */
export const justDragged = () => Date.now() - draggedAt < 200;

type Props = { w: number; h: number; label: string; children: JSX.Children };

export function ZoomPan({ w, h, label, children }: Props): JSX.Element {
  const [cam, setCam] = useLocal<Cam>(IDENTITY);
  const drag = useRef<{ x: number; y: number; moved: number } | null>(null);

  /** Client px → viewBox units (preserveAspectRatio "meet": uniform scale + centring). */
  const toView = (el: Element, cx: number, cy: number) => {
    const r = el.getBoundingClientRect();
    const s = Math.min(r.width / w, r.height / h) || 1;
    return {
      x: (cx - r.left - (r.width - w * s) / 2) / s,
      y: (cy - r.top - (r.height - h * s) / 2) / s,
      s,
    };
  };

  return (
    <div class="zoompan">
      <svg
        viewBox={`0 0 ${w} ${h}`}
        role="img"
        aria-label={label}
        onWheel={(e: WheelEvent) => {
          e.preventDefault();
          const p = toView(e.currentTarget as Element, e.clientX, e.clientY);
          setCam((c) => zoomAt(c, wheelFactor(e.deltaY), p.x, p.y));
        }}
        onPointerDown={(e: PointerEvent) => {
          if (e.button !== 0) return;
          drag.current = { x: e.clientX, y: e.clientY, moved: 0 };
        }}
        onPointerMove={(e: PointerEvent) => {
          const d = drag.current;
          if (!d) return;
          const { s } = toView(
            e.currentTarget as Element,
            e.clientX,
            e.clientY,
          );
          const dx = e.clientX - d.x, dy = e.clientY - d.y;
          d.moved += Math.abs(dx) + Math.abs(dy);
          if (d.moved > 4) {
            (e.currentTarget as Element).setPointerCapture?.(
              e.pointerId,
            );
          }
          drag.current = { ...d, x: e.clientX, y: e.clientY };
          setCam((c) => pan(c, dx / s, dy / s));
        }}
        onPointerUp={() => {
          if ((drag.current?.moved ?? 0) > 4) draggedAt = Date.now();
          drag.current = null;
        }}
        onPointerLeave={() => (drag.current = null)}
      >
        <g transform={`translate(${cam.x} ${cam.y}) scale(${cam.k})`}>
          {children}
        </g>
      </svg>
      <div class="zoombar">
        <button
          type="button"
          aria-label="Zoom in"
          onClick={() => setCam((c) => zoomAt(c, 1.3, w / 2, h / 2))}
        >
          ＋
        </button>
        <button
          type="button"
          aria-label="Zoom out"
          onClick={() => setCam((c) => zoomAt(c, 1 / 1.3, w / 2, h / 2))}
        >
          －
        </button>
        <button type="button" aria-label="Fit" onClick={() => setCam(IDENTITY)}>
          ⤢
        </button>
        <span class="muted">{Math.round(cam.k * 100)}%</span>
      </div>
    </div>
  );
}

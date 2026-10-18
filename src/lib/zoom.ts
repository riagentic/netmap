// Pan/zoom camera math for SVG diagrams — pure, so it is tested without a DOM.

/** World → screen: screen = world * k + (x, y). */
export type Cam = { x: number; y: number; k: number };

export const IDENTITY: Cam = { x: 0, y: 0, k: 1 };
const MIN = 0.25, MAX = 8;

export const clampK = (k: number) => Math.min(MAX, Math.max(MIN, k));

/** Zoom by `factor`, keeping the world point under (px, py) fixed on screen. */
export const zoomAt = (c: Cam, factor: number, px: number, py: number): Cam => {
  const k = clampK(c.k * factor);
  const f = k / c.k;
  return { k, x: px - (px - c.x) * f, y: py - (py - c.y) * f };
};

export const pan = (c: Cam, dx: number, dy: number): Cam => ({
  ...c,
  x: c.x + dx,
  y: c.y + dy,
});

/** Wheel delta → zoom factor (smooth on trackpads, one notch ≈ 15 %). */
export const wheelFactor = (deltaY: number) => Math.exp(-deltaY * 0.0015);

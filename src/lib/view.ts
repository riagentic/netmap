// Pure presentation helpers: names, icons, map layout.
import type { Device, Kind } from "./types.ts";

export const ICON: Record<Kind, string> = {
  router: "📡",
  computer: "🖥️",
  laptop: "💻",
  phone: "📱",
  tablet: "📲",
  printer: "🖨️",
  nas: "🗄️",
  tv: "📺",
  speaker: "🔊",
  camera: "📷",
  iot: "💡",
  server: "🧰",
  vm: "📦",
  unknown: "❔",
};

export const KIND: Record<Kind, string> = {
  router: "Router / AP",
  computer: "Computer",
  laptop: "Laptop",
  phone: "Phone",
  tablet: "Tablet",
  printer: "Printer",
  nas: "NAS / file server",
  tv: "TV / media",
  speaker: "Speaker",
  camera: "Camera",
  iot: "Smart home",
  server: "Server",
  vm: "Virtual machine",
  unknown: "Unknown",
};

/** Best human name we have, most specific first. */
export const label = (d: Device): string =>
  d.upnp?.friendlyName || d.names.find((n) =>
    !/^Android_|nearby-presence/.test(n)
  ) || d.model ||
  d.netbios || (d.vendor ? d.vendor.split(/[ ,]/)[0] + " device" : "") || d.ip;

export type Node = { ip: string; x: number; y: number; ring: 0 | 1 | 2 };

const ORDER: Kind[] = [
  "router",
  "server",
  "nas",
  "computer",
  "laptop",
  "vm",
  "printer",
  "camera",
  "tv",
  "speaker",
  "iot",
  "tablet",
  "phone",
  "unknown",
];

/** Gateway in the centre, network gear on the inner ring, the rest outside,
 *  grouped by kind; the top arc stays free for the internet uplink. */
export const layout = (devices: Device[], w: number, h: number): Node[] => {
  const cx = w / 2, cy = h * 0.52;
  const gw = devices.find((d) => d.gateway);
  const rest = devices.filter((d) => d !== gw)
    .sort((a, b) =>
      ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind) ||
      a.ip.localeCompare(b.ip, undefined, { numeric: true })
    );
  const inner = rest.filter((d) => d.kind === "router");
  const outer = rest.filter((d) => d.kind !== "router");
  const ring = (ds: Device[], rx: number, ry: number, r: 1 | 2): Node[] =>
    ds.map((d, i) => {
      const gap = 70 * (Math.PI / 180); // free arc at the top
      const a = -Math.PI / 2 + gap / 2 +
        ((2 * Math.PI - gap) * (i + 0.5)) / ds.length;
      return {
        ip: d.ip,
        x: cx + rx * Math.cos(a),
        y: cy + ry * Math.sin(a),
        ring: r,
      };
    });
  return [
    ...(gw ? [{ ip: gw.ip, x: cx, y: cy, ring: 0 as const }] : []),
    ...ring(inner, w * 0.24, h * 0.24, 1),
    ...ring(outer, w * 0.44, h * 0.36, 2),
  ];
};

export const ms = (
  n: number,
) => (n ? `${n < 10 ? n.toFixed(1) : Math.round(n)} ms` : "—");

/** Serpentine grid: left→right, then right→left on the next row, so a long
 *  route stays readable and neighbours stay adjacent. */
export const snake = (
  n: number,
  perRow: number,
  cellW: number,
  cellH: number,
  pad: number,
) =>
  Array.from({ length: n }, (_, i) => {
    const row = Math.floor(i / perRow), col = i % perRow;
    const c = row % 2 ? perRow - 1 - col : col;
    return { x: pad + c * cellW + cellW / 2, y: pad + row * cellH + cellH / 2 };
  });

// The route packets take from this computer to the internet, as a zoomable chain.
import type { JSX } from "aio";
import { net, view } from "../cell.ts";
import type { Hop } from "../lib/types.ts";
import { ms, snake } from "../lib/view.ts";
import { justDragged, ZoomPan } from "./ZoomPan.tsx";

export const ZONE: Record<Hop["zone"] | "self" | "vpn", string> = {
  lan: "LAN",
  private: "private",
  cgnat: "carrier NAT",
  public: "internet",
  unknown: "no reply",
  self: "this computer",
  vpn: "VPN tunnel",
};

type Step = {
  id: string;
  zone: keyof typeof ZONE;
  title: string;
  ip: string;
  sub: string;
  meta: string;
  ms: number;
};

/** This computer → gateway → (VPN) → every traced hop. */
export const steps = (): Step[] => {
  const l = net.local;
  if (!l) return [];
  const vpn = l.lan && l.egress && l.egress !== l.lan.name;
  return [
    {
      id: l.lan?.ip ?? "",
      zone: "self",
      title: "🖥️ this computer",
      ip: l.lan?.ip ?? "",
      sub: `${l.hostname} · ${l.lan?.name ?? ""}`,
      meta: "",
      ms: 0,
    },
    ...(l.gateway
      ? [{
        id: l.gateway,
        zone: "lan" as const,
        title: "📡 LAN gateway",
        ip: l.gateway,
        sub: vpn ? "carries the encrypted tunnel" : "first hop",
        meta: "",
        ms: 0,
      }]
      : []),
    ...(vpn
      ? [{
        id: "vpn",
        zone: "vpn" as const,
        title: "🔒 VPN tunnel",
        ip: l.egress,
        sub: l.ifaces.find((i) => i.name === l.egress)?.ip ?? "",
        meta: "",
        ms: 0,
      }]
      : []),
    ...net.path.map((h) => ({
      id: `hop:${h.n}`,
      zone: h.zone,
      title: `#${h.n} · ${ZONE[h.zone]}`,
      ip: h.ip || "* * *",
      sub: h.host,
      meta: [
        h.asn,
        h.ip ? ms(h.avg) : "",
        h.loss > 0 && h.ip ? `${Math.round(h.loss)}% loss` : "",
      ].filter(Boolean).join(" · "),
      ms: h.avg,
    })),
  ];
};

const PER = 4, CW = 250, CH = 170, PAD = 30, BW = 196, BH = 92;

export function PathView(): JSX.Element {
  const st = steps();
  const pos = snake(st.length, PER, CW, CH, PAD);
  const H = Math.max(240, PAD * 2 + Math.ceil(st.length / PER) * CH);
  return (
    <section class="pane">
      <header class="pane-head">
        <h2>
          🛣️ Path to the internet <span class="muted">→ {net.target}</span>
        </h2>
        <span class="muted">
          {net.path.length
            ? `${net.path.length} hops`
            : net.phase === "idle"
            ? "not traced yet"
            : "tracing… (mtr, ~15 s)"}
        </span>
      </header>
      <ZoomPan w={PAD * 2 + PER * CW} h={H} label="Path diagram">
        {st.slice(1).map((s, i) => {
          const a = pos[i], b = pos[i + 1];
          return (
            <g key={`l${s.id}`}>
              <line
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
                class={`edge path-edge ${
                  s.zone === "vpn" || st[i].zone === "vpn" ? "vpn" : ""
                }`}
              />
              <text
                x={(a.x + b.x) / 2 + (a.x === b.x ? 8 : 0)}
                y={(a.y + b.y) / 2 - (a.x === b.x ? -4 : 6)}
                class={`edge-label ${a.x === b.x ? "" : "mid"}`}
              >
                {s.ms ? ms(s.ms) : ""}
              </text>
            </g>
          );
        })}
        {st.map((s, i) => (
          <g
            key={s.id}
            class={`step ${view.selected === s.id ? "sel" : ""}`}
            tabIndex={0}
            aria-label={`Step ${s.ip}`}
            onClick={() => justDragged() || view.select(s.id)}
            onKeyDown={(e: KeyboardEvent) =>
              (e.key === "Enter" || e.key === " ") && view.select(s.id)}
          >
            <rect
              x={pos[i].x - BW / 2}
              y={pos[i].y - BH / 2}
              width={BW}
              height={BH}
              rx={10}
              class={`box zone-${s.zone}`}
            />
            <rect
              x={pos[i].x - BW / 2}
              y={pos[i].y - BH / 2}
              width={BW}
              height={6}
              rx={3}
              class={`band zone-${s.zone}`}
            />
            <text x={pos[i].x - BW / 2 + 12} y={pos[i].y - 22} class="t-sm">
              {s.title}
            </text>
            <text x={pos[i].x - BW / 2 + 12} y={pos[i].y - 2} class="t-ip">
              {s.ip}
            </text>
            <text x={pos[i].x - BW / 2 + 12} y={pos[i].y + 17} class="t-sm">
              {s.sub.length > 30 ? s.sub.slice(0, 29) + "…" : s.sub}
            </text>
            <text x={pos[i].x - BW / 2 + 12} y={pos[i].y + 35} class="t-meta">
              {s.meta}
            </text>
          </g>
        ))}
      </ZoomPan>
    </section>
  );
}

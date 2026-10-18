// Star map of the LAN: internet → gateway → network gear → every device.
import type { JSX } from "aio";
import { net, view } from "../cell.ts";
import { ICON, label, layout } from "../lib/view.ts";
import { justDragged, ZoomPan } from "./ZoomPan.tsx";

const W = 1000, H = 720;

const pick = (id: string) => () => justDragged() || view.select(id);
const key = (id: string) => (e: KeyboardEvent) =>
  (e.key === "Enter" || e.key === " ") && view.select(id);

export function NetMap(): JSX.Element {
  const nodes = layout(net.devices, W, H);
  const at = new Map(nodes.map((n) => [n.ip, n]));
  const gw = nodes.find((n) => n.ring === 0);
  const l = net.local;
  const vpn = l?.egress && l.lan && l.egress !== l.lan.name;
  return (
    <section class="pane">
      <header class="pane-head">
        <h2>
          🗺️ Network map{" "}
          <span class="muted">
            {l?.lan ? `${l.lan.ip.replace(/\.\d+$/, ".0")}/${l.lan.cidr}` : ""}
          </span>
        </h2>
        <span class="muted">
          {net.online()} online · {net.devices.length - net.online()} offline ·
          {" "}
          {net.openPorts()} open ports
        </span>
      </header>
      <ZoomPan w={W} h={H} label="Network map">
        {gw && (
          <g>
            <line
              x1={W / 2}
              y1={70}
              x2={gw.x}
              y2={gw.y}
              class={`edge up ${vpn ? "vpn" : ""}`}
            />
            <text x={W / 2 + 10} y={(70 + gw.y) / 2} class="edge-label">
              {vpn ? `🔒 ${l!.egress} tunnel` : "uplink"}
            </text>
          </g>
        )}
        <g
          class={`dev ${view.selected === "internet" ? "sel" : ""}`}
          aria-label="Internet"
          tabIndex={0}
          onClick={pick("internet")}
          onKeyDown={key("internet")}
        >
          <circle cx={W / 2} cy={46} r={30} class="node internet" />
          <text x={W / 2} y={56} class="icon">☁️</text>
          <text x={W / 2 + 40} y={42} class="lbl start">Internet</text>
          <text x={W / 2 + 40} y={58} class="sub start">
            {l?.publicIp ?? ""} {l?.isp ?? ""}
          </text>
        </g>
        {gw &&
          nodes.filter((n) => n.ring > 0).map((n) => (
            <line
              key={`e${n.ip}`}
              x1={gw.x}
              y1={gw.y}
              x2={n.x}
              y2={n.y}
              class={`edge ${
                net.devices.find((d) => d.ip === n.ip)?.online ? "" : "off"
              }`}
            />
          ))}
        {net.devices.map((d) => {
          const n = at.get(d.ip);
          if (!n) return null;
          const r = n.ring === 0 ? 34 : n.ring === 1 ? 28 : 24;
          return (
            <g
              key={d.ip}
              class={`dev ${d.online ? "" : "off"} ${
                view.selected === d.ip ? "sel" : ""
              } ${d.self ? "me" : ""}`}
              aria-label={`Device ${d.ip}`}
              tabIndex={0}
              onClick={pick(d.ip)}
              onKeyDown={key(d.ip)}
            >
              <circle cx={n.x} cy={n.y} r={r} class={`node k-${d.kind}`} />
              <text
                x={n.x}
                y={n.y + r * 0.36}
                class="icon"
                style={{ fontSize: `${r * 0.95}px` }}
              >
                {ICON[d.kind]}
              </text>
              <text x={n.x} y={n.y + r + 15} class="lbl">
                {label(d).slice(0, 26)}
              </text>
              <text x={n.x} y={n.y + r + 29} class="sub">
                {label(d) === d.ip ? "" : d.ip}
                {d.ports.length ? ` · ${d.ports.length}⚡` : ""}
              </text>
            </g>
          );
        })}
        {net.devices.length === 0 && (
          <text x={W / 2} y={H / 2} class="lbl">
            {net.phase === "idle" ? "Press Scan" : "Discovering devices…"}
          </text>
        )}
      </ZoomPan>
    </section>
  );
}

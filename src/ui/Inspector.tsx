// Right panel: details of whatever is selected, or the network overview.
import type { JSX } from "aio";
import { net, view } from "../cell.ts";
import type { Hop, Kind } from "../lib/types.ts";
import { ICON, KIND, ms } from "../lib/view.ts";
import { DeviceDetail, Fact } from "./DeviceDetail.tsx";
import { ZONE } from "./PathView.tsx";

const MEANS: Record<Hop["zone"], string> = {
  private:
    "Private address — inside a home, office, VPN or provider network; not routable on the internet.",
  cgnat:
    "Carrier-grade NAT (100.64/10) — your provider shares one public IP among many customers.",
  public: "Public internet router, run by the network named in its ASN.",
  lan: "Your local network.",
  unknown:
    "This router does not answer traceroute probes (normal; it still forwards traffic).",
};

function HopDetail({ h }: { h: Hop }): JSX.Element {
  const prev = net.path.filter((x) => x.n < h.n && x.ip).at(-1);
  return (
    <>
      <h2>🛰️ Hop #{h.n}</h2>
      <span class={`badge zone-chip zone-${h.zone}`}>{ZONE[h.zone]}</span>
      <dl class="facts">
        <Fact k="IP" v={h.ip || "no reply"} />
        <Fact k="Name" v={h.host} />
        <Fact k="ASN" v={h.asn} />
        <Fact k="Avg" v={h.ip && ms(h.avg)} />
        <Fact k="Best" v={h.ip && ms(h.best)} />
        <Fact k="Worst" v={h.ip && ms(h.worst)} />
        <Fact k="Jitter" v={h.ip && ms(h.worst - h.best)} />
        <Fact
          k="Added"
          v={h.ip && prev
            ? `${(h.avg - prev.avg).toFixed(1)} ms vs hop #${prev.n}`
            : ""}
        />
        <Fact k="Loss" v={`${Math.round(h.loss)}%`} />
      </dl>
      <p class="muted">{MEANS[h.zone]}</p>
      {h.loss > 0 && h.loss < 100 && h.n < net.path.length && (
        <p class="muted">
          ⚠️ Loss on a middle hop that later hops do not show is usually ICMP
          rate-limiting, not real packet loss.
        </p>
      )}
    </>
  );
}

function InternetDetail(): JSX.Element {
  const l = net.local, last = net.path.at(-1);
  return (
    <>
      <h2>☁️ Internet</h2>
      <dl class="facts">
        <Fact k="Public IP" v={l?.publicIp} />
        <Fact k="Provider" v={l?.isp} />
        <Fact k="Location" v={l?.location} />
        <Fact k="Target" v={net.target} />
        <Fact k="Hops" v={net.path.length} />
        <Fact k="Latency" v={last?.ip && ms(last.avg)} />
        <Fact k="DNS" v={l?.dns.join(", ")} />
      </dl>
      <p class="muted">
        Public IP, provider and location come from ipinfo.io: what websites see.
      </p>
    </>
  );
}

function VpnDetail(): JSX.Element {
  const l = net.local!, i = l.ifaces.find((x) => x.name === l.egress);
  return (
    <>
      <h2>🔒 VPN tunnel</h2>
      <dl class="facts">
        <Fact k="Interface" v={l.egress} />
        <Fact k="Address" v={i && `${i.ip}/${i.cidr}`} />
        <Fact k="LAN via" v={l.lan ? `${l.lan.name} → ${l.gateway}` : ""} />
      </dl>
      <p class="muted">
        Internet traffic leaves through{" "}
        <b>{l.egress}</b>, not the LAN interface: the LAN router only sees
        encrypted tunnel packets. The public IP shown is the VPN server's, not
        your provider's.
      </p>
    </>
  );
}

function Overview(): JSX.Element {
  const l = net.local;
  const kinds = Object.entries(
    net.devices.reduce(
      (a, d) => ({ ...a, [d.kind]: (a[d.kind] ?? 0) + 1 }),
      {} as Record<string, number>,
    ),
  ).sort((a, b) => b[1] - a[1]) as [Kind, number][];
  const services = Object.entries(
    net.devices.flatMap((d) => d.ports.map((p) => p.service || String(p.port)))
      .reduce(
        (a, s) => ({ ...a, [s]: (a[s] ?? 0) + 1 }),
        {} as Record<string, number>,
      ),
  ).sort((a, b) => b[1] - a[1]).slice(0, 10);
  return (
    <>
      <h2>📊 Overview</h2>
      <dl class="facts">
        <Fact k="Host" v={l?.hostname} />
        <Fact
          k="LAN"
          v={l?.lan ? `${l.lan.name} ${l.lan.ip}/${l.lan.cidr}` : ""}
        />
        <Fact k="Gateway" v={l?.gateway} />
        <Fact k="Egress" v={l?.egress} />
        <Fact k="DNS" v={l?.dns.join(", ")} />
        <Fact k="Public IP" v={l?.publicIp} />
        <Fact
          k="Last scan"
          v={net.finishedAt
            ? `${new Date(net.finishedAt).toLocaleString()} (${
              Math.round((net.finishedAt - net.startedAt) / 1000)
            } s)`
            : ""}
        />
      </dl>
      <h3>🧩 Devices ({net.online()} online / {net.devices.length})</h3>
      <div class="chips">
        {kinds.map(([k, n]) => (
          <span key={k} class="badge">{ICON[k]} {KIND[k]} · {n}</span>
        ))}
      </div>
      <h3>⚡ Services ({net.openPorts()} open ports)</h3>
      <div class="chips">
        {services.map(([s, n]) => <span key={s} class="badge">{s} · {n}</span>)}
      </div>
      <h3>🔌 Interfaces</h3>
      <table class="ports">
        <tbody>
          {l?.ifaces.map((i) => (
            <tr key={i.name}>
              <td>{i.name}</td>
              <td class="mono">{i.ip}/{i.cidr}</td>
              <td class="mono muted">{i.mac}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p class="muted">
        👆 Click anything on a diagram or a table row for its details.
      </p>
    </>
  );
}

const content = (sel: string): JSX.Element => {
  const d = net.devices.find((x) => x.ip === sel);
  if (d) return <DeviceDetail d={d} />;
  const h = sel.startsWith("hop:")
    ? net.path.find((x) => `hop:${x.n}` === sel)
    : undefined;
  if (h) return <HopDetail h={h} />;
  if (sel === "internet") return <InternetDetail />;
  if (sel === "vpn" && net.local) return <VpnDetail />;
  return <Overview />;
};

export function Inspector(): JSX.Element {
  return (
    <aside class="inspector" aria-label="Details">
      {view.selected && (
        <button
          type="button"
          class="ghost close"
          aria-label="Close detail"
          onClick={() => view.select(view.selected)}
        >
          ✕
        </button>
      )}
      {content(view.selected)}
    </aside>
  );
}

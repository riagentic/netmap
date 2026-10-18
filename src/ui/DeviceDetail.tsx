// Everything known about the selected device, and why we believe it.
import type { JSX } from "aio";
import { net } from "../cell.ts";
import type { Device, Port } from "../lib/types.ts";
import { ICON, KIND, label, ms } from "../lib/view.ts";

export const Fact = (
  { k, v }: { k: string; v: string | number | false | undefined },
): JSX.Element | null =>
  v || v === 0
    ? (
      <>
        <dt>{k}</dt>
        <dd class="mono">{String(v)}</dd>
      </>
    )
    : null;

const portInfo = (p: Port): string =>
  [
    p.http && `${p.http.status || ""} ${p.http.server}`.trim(),
    p.http?.title && `“${p.http.title}”`,
    p.http?.cert && `🔐 ${p.http.cert}`,
    p.banner,
  ]
    .filter(Boolean).join(" · ");

function Ports({ d }: { d: Device }): JSX.Element {
  const deep = net.deep === d.ip;
  const pct = deep && net.progress.total
    ? Math.round((net.progress.done / net.progress.total) * 100)
    : 0;
  return (
    <>
      <div class="row between">
        <h3>
          ⚡ Open TCP ports ({d.ports.length}){d.deepScanned
            ? " · all 65 535 checked"
            : " · common ports"}
        </h3>
        {deep
          ? (
            <button
              type="button"
              class="danger"
              aria-label="Stop deep scan"
              onClick={() => net.stop()}
            >
              Stop {pct}%
            </button>
          )
          : (
            <button
              type="button"
              aria-label="Deep scan"
              disabled={!!net.deep || net.busy()}
              onClick={() => net.deepScan(d.ip)}
            >
              Scan all ports
            </button>
          )}
      </div>
      {deep && <progress max={100} value={pct} />}
      {d.ports.length === 0
        ? <p class="muted">None answered (closed or firewalled).</p>
        : (
          <table class="ports">
            <tbody>
              {d.ports.map((p) => (
                <tr key={p.port}>
                  <td class="mono">{p.port}</td>
                  <td>{p.service || "?"}</td>
                  <td class="info">{portInfo(p)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
    </>
  );
}

export function DeviceDetail({ d }: { d: Device }): JSX.Element {
  return (
    <>
      <h2>{ICON[d.kind]} {label(d)}</h2>
      <div class="row wrap">
        <span class="badge">{KIND[d.kind]}</span>
        {d.gateway && <span class="badge accent">gateway</span>}
        {d.self && <span class="badge accent">this computer</span>}
        {!d.online && <span class="badge warn">offline</span>}
        <span class="conf" title="identification confidence">
          <i style={{ width: `${d.confidence}%` }} /> {d.confidence}%
        </span>
      </div>
      <dl class="facts">
        <Fact k="IP" v={d.ip} />
        <Fact
          k="MAC"
          v={d.mac && `${d.mac}${d.randomMac ? " (randomized / private)" : ""}`}
        />
        <Fact k="Vendor" v={d.vendor} />
        <Fact k="OS" v={d.os} />
        <Fact k="Model" v={d.model} />
        <Fact k="Names" v={d.names.join(", ")} />
        <Fact k="NetBIOS" v={d.netbios} />
        <Fact k="TTL" v={d.ttl || undefined} />
        <Fact
          k="Ping"
          v={d.rtt ? ms(d.rtt) : "no reply (ICMP blocked or asleep)"}
        />
        <Fact k="Seen" v={new Date(d.seenAt).toLocaleString()} />
      </dl>
      <Ports d={d} />
      {d.upnp && (
        <>
          <h3>🔌 UPnP</h3>
          <dl class="facts">
            <Fact k="Name" v={d.upnp.friendlyName} />
            <Fact k="Maker" v={d.upnp.manufacturer} />
            <Fact
              k="Model"
              v={`${d.upnp.model} ${d.upnp.modelNumber}`.trim()}
            />
            <Fact k="Type" v={d.upnp.deviceType} />
            <Fact k="Server" v={d.upnp.server} />
          </dl>
        </>
      )}
      {d.mdns.length > 0 && (
        <>
          <h3>📣 mDNS / Bonjour services ({d.mdns.length})</h3>
          <ul class="svc">
            {d.mdns.map((s) => (
              <li key={`${s.type}${s.port}`}>
                <b>{s.type}</b> <span class="muted">:{s.port} {s.name}</span>
                {s.txt.length > 0 && (
                  <div class="txt mono">{s.txt.join("  ")}</div>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
      <h3>🔎 Why we think so</h3>
      <ul class="evidence">{d.evidence.map((e) => <li key={e}>{e}</li>)}</ul>
    </>
  );
}

// About: what the app does, how, and what leaves this machine.
import type { JSX } from "aio";

export function About(): JSX.Element {
  return (
    <section class="pane about">
      <header class="pane-head">
        <h2>ℹ️ About NetMap</h2>
        <span class="muted">v0.1</span>
      </header>
      <div class="scroll prose">
        <p>
          Maps your local network and the route from this computer to the
          internet. Finds every device, lists its open ports, and works out what
          each device is.
        </p>
        <h3>🔍 How devices are found and identified</h3>
        <ul>
          <li>
            <b>Ping sweep</b>{" "}
            of the LAN subnet (up to /22), with TTL → OS family (64 Unix-like,
            128 Windows, 255 network gear).
          </li>
          <li>
            <b>ARP neighbour table</b>: MAC address → vendor (fresh IEEE
            registry, refreshed monthly). Locally administered MAC = randomized
            "private address" (phones, laptops).
          </li>
          <li>
            <b>mDNS / Bonjour</b>{" "}
            (avahi): names, services, model strings (printers, Apple, Android,
            Chromecast…).
          </li>
          <li>
            <b>SSDP / UPnP</b>: friendly name, maker, model (TVs, media boxes,
            routers).
          </li>
          <li>
            <b>NetBIOS</b> names and <b>reverse DNS</b>.
          </li>
          <li>
            <b>TCP connect scan</b>{" "}
            of ~130 common ports (all 65 535 on demand), passive{" "}
            <b>banners</b>, HTTP <b>titles / Server</b> headers,{" "}
            <b>TLS certificate</b> subjects.
          </li>
          <li>
            <b>Route</b>: <code>mtr</code>{" "}
            with per-hop ASN, latency, jitter, loss; reverse DNS per hop; VPN
            egress detection.
          </li>
          <li>
            Every signal votes; each device shows its <b>evidence</b>{" "}
            and a confidence score.
          </li>
        </ul>
        <h3>🖱️ Using it</h3>
        <ul>
          <li>
            Diagrams: <b>wheel</b> zooms at the cursor, <b>drag</b>{" "}
            pans, ＋ / － / ⤢ buttons, click a node for details.
          </li>
          <li>
            Devices that stop answering stay listed as <i>offline</i>{" "}
            until you forget them.
          </li>
        </ul>
        <h3>🔒 Privacy</h3>
        <ul>
          <li>
            Scan results stay on this computer (<code>~/.netmap/data</code>).
          </li>
          <li>
            Outside requests: <code>ipinfo.io</code> (public IP, provider),{" "}
            <code>standards-oui.ieee.org</code>{" "}
            (vendor list, monthly), the trace target, and DNS for hop names.
          </li>
          <li>
            No root needed: <code>ping</code> and <code>mtr</code>{" "}
            use their own capabilities.
          </li>
        </ul>
        <h3>⚠️ Limits</h3>
        <ul>
          <li>
            Which Wi-Fi access point a client uses is not visible from here, so
            all devices connect to the gateway on the map.
          </li>
          <li>
            Sleeping phones and firewalled hosts may only appear through the ARP
            table, with little detail.
          </li>
          <li>Only scan networks you own or may test.</li>
        </ul>
        <p class="muted">
          Built with aio (Deno + Electron). Tools used when present: ping, mtr,
          ip, avahi-browse, nmblookup, curl, dig, getent.
        </p>
      </div>
    </section>
  );
}

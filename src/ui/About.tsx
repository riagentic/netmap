// About: what the app does, how, and what leaves this machine.
import type { JSX } from "aio";
import { net } from "../cell.ts";

export function About(): JSX.Element {
  return (
    <section class="pane about">
      <header class="pane-head">
        <h2>ℹ️ About NetMap</h2>
        <span class="muted">{net.appVersion ? `v${net.appVersion}` : ""}</span>
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
            <b>mDNS / Bonjour</b>: names, services, model strings (printers,
            Apple, Android, Chromecast…), asked of each host directly, so it
            works beside VPNs.
          </li>
          <li>
            <b>SSDP / UPnP</b>: friendly name, maker, model (TVs, media boxes,
            routers).
          </li>
          <li>
            <b>NetBIOS</b> names (Windows, Samba) and <b>reverse DNS</b>.
          </li>
          <li>
            <b>TCP connect scan</b>{" "}
            of ~130 common ports (all 65 535 on demand), passive{" "}
            <b>banners</b>, HTTP <b>titles / Server</b> headers,{" "}
            <b>TLS certificate</b> subjects.
          </li>
          <li>
            <b>Route</b>: <code>mtr</code>, <code>traceroute</code> or{" "}
            <code>tracert</code>, with per-hop latency, jitter, loss, ASN and
            reverse DNS; VPN egress detection.
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
            (vendor list, monthly), the trace target, and DNS for hop names and
            ASNs (<code>asn.cymru.com</code>).
          </li>
          <li>
            No root or admin rights needed on Linux, macOS or Windows.
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
          Built with aio (Deno + Electron). Uses each OS's own tools: ping, arp,
          curl, traceroute / tracert (mtr when present), ip (Linux), netstat and
          scutil (macOS), PowerShell (Windows).
        </p>
      </div>
    </section>
  );
}

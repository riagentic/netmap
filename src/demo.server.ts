// Server-only: a made-up home network for demos and screenshots (NETMAP_DEMO=1).
// Same exports the cell uses from scan.server.ts; no probe touches the OS.
// Addresses are documentation ranges (RFC 5737, RFC 5398), never a real network.
import type * as Real from "./scan.server.ts";
import type { Device, Hop, Local, Port, Service, Upnp } from "./lib/types.ts";
import { serviceName } from "./lib/ports.ts";
export { pool } from "./scan.server.ts";

const NO_ETC = new Map<number, string>();

/** Sleep that ends early on abort, so Stop stays instant. */
const wait = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((done) => {
    const t = setTimeout(done, ms);
    signal?.addEventListener("abort", () => (clearTimeout(t), done()), {
      once: true,
    });
  });

type Http = NonNullable<Port["http"]>;
const p = (port: number, banner = "", http: Http | null = null): Port => ({
  port,
  service: serviceName(port, NO_ETC),
  banner,
  http,
});
const web = (title: string, server = "", status = 200): Http => ({
  status,
  server,
  title,
  cert: "",
});
const svc = (type: string, name: string, port: number, ...txt: string[]) => ({
  type,
  name,
  port,
  txt,
} satisfies Service);
const upnp = (u: Partial<Upnp>): Upnp => ({
  location: "",
  server: "",
  friendlyName: "",
  manufacturer: "",
  model: "",
  modelNumber: "",
  deviceType: "",
  ...u,
});

const LAN = "192.168.1";
const ME = `${LAN}.20`;

type Host = {
  dev: Partial<Device> & { ip: string };
  ports: Port[];
  /** Only a full scan finds these. */
  deep?: Port[];
  netbios?: string;
};

const HOSTS: Host[] = [
  {
    dev: {
      ip: `${LAN}.1`,
      mac: "3c:a6:2f:00:00:01",
      vendor: "AVM GmbH",
      names: ["fritz.box"],
      ttl: 64,
      rtt: 0.6,
      gateway: true,
      upnp: upnp({
        friendlyName: "FRITZ!Box 7590",
        manufacturer: "AVM Berlin",
        model: "FRITZ!Box 7590",
        deviceType: "InternetGatewayDevice:2",
      }),
    },
    ports: [
      p(53),
      p(80, "", web("FRITZ!Box")),
      p(443, "", web("FRITZ!Box")),
      p(49000, "", web("", "FRITZ!Box UPnP/1.0 AVM FRITZ!Box 7590", 404)),
    ],
    deep: [p(8181)],
  },
  {
    dev: {
      ip: `${LAN}.2`,
      mac: "74:83:c2:00:00:02",
      vendor: "Ubiquiti Inc",
      names: ["unifi-ap-upstairs"],
      ttl: 64,
      rtt: 1.9,
    },
    ports: [p(22, "SSH-2.0-dropbear_2019.78"), p(8080)],
  },
  {
    dev: {
      ip: `${LAN}.10`,
      mac: "00:11:32:00:00:10",
      vendor: "Synology Incorporated",
      names: ["diskstation"],
      ttl: 64,
      rtt: 0.9,
      mdns: [
        svc("Microsoft Windows Network", "diskstation", 445),
        svc("_adisk._tcp", "diskstation", 9),
        svc("Web Site", "diskstation", 5000, "vendor=Synology", "model=DS923+"),
      ],
    },
    ports: [
      p(22, "SSH-2.0-OpenSSH_8.2"),
      p(139),
      p(445),
      p(5000, "", web("Synology DiskStation", "nginx")),
      p(5001, "", web("Synology DiskStation", "nginx")),
    ],
    deep: [p(6690), p(32400, "", web("Plex Media Server"))],
  },
  {
    dev: {
      ip: `${LAN}.12`,
      mac: "f4:39:09:00:00:12",
      vendor: "HP Inc.",
      names: ["HP-LaserJet-M234"],
      ttl: 255,
      rtt: 3.1,
      mdns: [
        svc(
          "Internet Printer",
          "HP LaserJet MFP M234dw",
          631,
          "ty=HP LaserJet MFP M234dw",
          "pdl=application/pdf,image/urf",
        ),
        svc("_uscan._tcp", "HP LaserJet MFP M234dw", 80),
      ],
    },
    ports: [
      p(80, "", web("HP LaserJet MFP M234dw", "HP HTTP Server")),
      p(443, "", web("HP LaserJet MFP M234dw", "HP HTTP Server")),
      p(631),
      p(9100),
    ],
  },
  {
    dev: {
      ip: `${LAN}.15`,
      mac: "d8:3a:dd:00:00:15",
      vendor: "Raspberry Pi (Trading) Ltd",
      names: ["homeassistant"],
      ttl: 64,
      rtt: 1.1,
      mdns: [svc("_home-assistant._tcp", "Home", 8123)],
    },
    ports: [
      p(22, "SSH-2.0-OpenSSH_9.2p1 Debian-2+deb12u3"),
      p(1883),
      p(8123, "", web("Home Assistant")),
    ],
  },
  {
    dev: {
      ip: ME,
      mac: "a4:c3:f0:00:00:20",
      vendor: "Intel Corporate",
      names: ["demo-laptop"],
      self: true,
      os: "Linux (Ubuntu 24.04)",
    },
    ports: [p(22, "SSH-2.0-OpenSSH_9.6p1 Ubuntu-3ubuntu13.5")],
  },
  {
    dev: {
      ip: `${LAN}.23`,
      mac: "d8:bb:c1:00:00:23",
      vendor: "Micro-Star INTL CO., LTD.",
      ttl: 128,
      rtt: 0.8,
    },
    ports: [p(135), p(139), p(445), p(3389)],
    netbios: "DESKTOP-GAMING",
  },
  {
    dev: {
      ip: `${LAN}.30`,
      mac: "f0:18:98:00:00:30",
      vendor: "Apple, Inc.",
      names: ["Alex-MacBook-Air"],
      ttl: 64,
      rtt: 4.2,
      mdns: [svc("_airplay._tcp", "Alex’s MacBook Air", 7000)],
    },
    ports: [p(5000), p(7000)],
  },
  {
    dev: {
      ip: `${LAN}.31`,
      mac: "6a:2e:91:00:00:31",
      randomMac: true,
      names: ["iPhone"],
      ttl: 64,
      rtt: 38,
      mdns: [svc("_companion-link._tcp", "Alex’s iPhone", 49152)],
    },
    ports: [p(62078)],
  },
  {
    dev: {
      ip: `${LAN}.32`,
      mac: "ae:14:7b:00:00:32",
      randomMac: true,
      names: ["Pixel-8"],
      ttl: 64,
      rtt: 52,
    },
    ports: [],
  },
  {
    dev: {
      ip: `${LAN}.40`,
      mac: "44:bb:3b:00:00:40",
      vendor: "Google, Inc.",
      names: ["Living-Room-TV"],
      ttl: 64,
      rtt: 6.5,
      mdns: [svc("_googlecast._tcp", "Living Room TV", 8009, "md=Chromecast")],
    },
    ports: [p(8008), p(8009), p(8443)],
  },
  {
    dev: {
      ip: `${LAN}.41`,
      mac: "48:a6:b8:00:00:41",
      vendor: "Sonos, Inc.",
      names: ["Sonos-Kitchen"],
      ttl: 64,
      rtt: 2.4,
      mdns: [svc("_sonos._tcp", "Kitchen", 1443)],
      upnp: upnp({
        friendlyName: "Kitchen",
        manufacturer: "Sonos, Inc.",
        model: "Sonos One",
        deviceType: "ZonePlayer:1",
      }),
    },
    ports: [p(1400, "", web("", "Linux UPnP/1.0 Sonos/80.1", 404))],
  },
  {
    dev: {
      ip: `${LAN}.50`,
      mac: "bc:ba:c2:00:00:50",
      vendor: "Hangzhou Hikvision Digital Technology Co.,Ltd.",
      names: ["driveway-cam"],
      ttl: 64,
      rtt: 2.0,
    },
    ports: [p(80, "", web("Hikvision IP Camera", "webserver")), p(554)],
  },
  ...["a1b2c3", "d4e5f6"].map((id, i): Host => ({
    dev: {
      ip: `${LAN}.${60 + i}`,
      mac: `c8:c9:a3:00:00:6${i}`,
      vendor: "Espressif Inc.",
      names: [`shellyplug-s-${id}`],
      ttl: 255,
      rtt: 12 + i * 4,
    },
    ports: [p(80, "", web("Shelly Plug S"))],
  })),
];

const BY_IP = new Map(HOSTS.map((h) => [h.dev.ip, h]));

export const local: typeof Real.local = () =>
  Promise.resolve<Local>({
    hostname: "demo-laptop",
    ifaces: [{ name: "wlan0", ip: ME, cidr: 24, mac: "a4:c3:f0:00:00:20" }],
    lan: { name: "wlan0", ip: ME, cidr: 24, mac: "a4:c3:f0:00:00:20" },
    gateway: `${LAN}.1`,
    egress: "wlan0",
    dns: [`${LAN}.1`],
    publicIp: "203.0.113.42",
    isp: "AS64500 Example Broadband",
    location: "Springfield, Example Country",
  });

const hop = (
  n: number,
  ip: string,
  host: string,
  asn: string,
  avg: number,
  zone: Hop["zone"],
): Hop => ({
  n,
  ip,
  host,
  asn,
  loss: ip ? 0 : 100,
  avg,
  best: ip ? avg * 0.9 : 0,
  worst: ip ? avg * 1.3 : 0,
  zone,
});

export const trace: typeof Real.trace = async (target, signal) => {
  await wait(1800, signal);
  return [
    hop(1, `${LAN}.1`, "fritz.box", "", 1.2, "lan"),
    hop(2, "100.64.12.1", "", "", 7.9, "cgnat"),
    hop(3, "198.51.100.17", "core1.example.net", "AS64500", 9.4, "public"),
    hop(4, "", "", "", 0, "unknown"),
    hop(5, "198.51.100.130", "ix-peer.example.org", "AS64501", 13.8, "public"),
    hop(6, target, "", "AS64502", 14.6, "public"),
  ];
};

export const discover: typeof Real.discover = async (l, signal, onProgress) => {
  const total = 254;
  for (let done = 16; done <= total && !signal?.aborted; done += 16) {
    onProgress?.(done, total);
    await wait(60, signal);
  }
  const now = Date.now();
  return HOSTS.map(({ dev }): Device => ({
    mac: "",
    vendor: "",
    randomMac: false,
    names: [],
    ttl: 0,
    rtt: 0,
    ports: [],
    mdns: [],
    upnp: null,
    netbios: "",
    self: false,
    gateway: dev.ip === l.gateway,
    kind: "unknown",
    os: "",
    model: "",
    evidence: [],
    confidence: 0,
    deepScanned: false,
    online: true,
    seenAt: now,
    ...dev,
  }));
};

export const scanPorts: typeof Real.scanPorts = async (
  ip,
  ports,
  _opts,
  signal,
  onProgress,
) => {
  const h = BY_IP.get(ip);
  const full = ports.length > 1000;
  for (let done = 0; full && done < ports.length && !signal?.aborted;) {
    done = Math.min(ports.length, done + 4096);
    onProgress?.(done);
    await wait(120, signal);
  }
  if (!full) await wait(150 + Math.random() * 350, signal);
  const all = [...(h?.ports ?? []), ...(h?.deep ?? [])];
  return all.filter((x) => ports.includes(x.port));
};

export const netbios: typeof Real.netbios = (ip) =>
  Promise.resolve(BY_IP.get(ip)?.netbios ?? "");

export const reverseName: typeof Real.reverseName = (ip) =>
  Promise.resolve(BY_IP.get(ip)?.dev.names?.[0] ?? "");

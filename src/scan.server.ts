// Server-only: every probe that touches the OS or the network.
// No root needed — ping/mtr ship with cap_net_raw; the rest is TCP connect,
// mDNS (avahi), SSDP (UDP multicast), NetBIOS (nmblookup), HTTP (curl).
import dgram from "node:dgram";
import { join } from "@std/path";
import { appDirs } from "aio/server";
import {
  header,
  hostsOf,
  inSubnet,
  isRandomMac,
  parseAvahi,
  parseCurl,
  parseMtr,
  parseNeigh,
  parseNmb,
  parseOuiCsv,
  parsePing,
  parseServices,
  parseUpnp,
  vendorOf,
} from "./lib/parse.ts";
import { httpScheme, serviceName } from "./lib/ports.ts";
import { identify } from "./lib/classify.ts";
import type { Device, Hop, Iface, Local, Port, Upnp } from "./lib/types.ts";

/** Run a tool; return what it printed by the deadline (partial on timeout, "" if absent). */
export const run = async (
  cmd: string,
  args: string[],
  ms: number,
  signal?: AbortSignal,
): Promise<{ out: string; err: string }> => {
  try {
    const p = new Deno.Command(cmd, {
      args,
      stdout: "piped",
      stderr: "piped",
      stdin: "null",
    }).spawn();
    const kill = () => {
      try {
        p.kill("SIGKILL");
      } catch { /* exited */ }
    };
    const t = setTimeout(kill, ms);
    signal?.addEventListener("abort", kill, { once: true });
    const [out, err] = await Promise.all([
      new Response(p.stdout).text(),
      new Response(p.stderr).text(),
    ]);
    await p.status;
    clearTimeout(t);
    signal?.removeEventListener("abort", kill);
    return { out, err };
  } catch {
    return { out: "", err: "" };
  }
};

/** Map with bounded concurrency; stops picking new items once aborted. */
export const pool = async <T, R>(
  items: T[],
  n: number,
  fn: (x: T) => Promise<R>,
  signal?: AbortSignal,
): Promise<R[]> => {
  const out: R[] = new Array(items.length);
  let i = 0;
  const worker = async () => {
    while (i < items.length && !signal?.aborted) {
      const k = i++;
      out[k] = await fn(items[k]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
  return out;
};

const read = (path: string): Promise<string> =>
  Deno.readTextFile(path).catch(() => "");

// MAC vendor registry: fresh IEEE copy in the app cache (≤30 days), else the
// distro's ieee-data. New OUIs (e.g. Raspberry Pi 2C:CF:67) need the fresh one.
const IEEE = { "oui.csv": "oui", "mam.csv": "oui28", "oui36.csv": "oui36" };
const MONTH = 30 * 86_400_000;
let ouiCache: Map<string, string> | null = null;

const ieeeFile = async (dir: string, f: keyof typeof IEEE): Promise<string> => {
  const path = join(dir, f);
  const age = await Deno.stat(path).then((st) =>
    Date.now() - (st.mtime?.getTime() ?? 0)
  ).catch(() => Infinity);
  if (age > MONTH) {
    const csv = await fetch(`https://standards-oui.ieee.org/${IEEE[f]}/${f}`, {
      signal: AbortSignal.timeout(15_000),
    })
      .then((r) => (r.ok ? r.text() : "")).catch(() => "");
    if (csv.startsWith("Registry")) {
      await Deno.mkdir(dir, { recursive: true }).then(() =>
        Deno.writeTextFile(path, csv)
      );
    }
  }
  return (await read(path)) || read(`/usr/share/ieee-data/${f}`);
};

export const loadOui = async (): Promise<Map<string, string>> => {
  const dir = appDirs("netmap").cache;
  return ouiCache ??= new Map(
    (await Promise.all(
      (Object.keys(IEEE) as (keyof typeof IEEE)[]).map((f) => ieeeFile(dir, f)),
    )).flatMap((c) => [...parseOuiCsv(c)]),
  );
};

let etcCache: Map<number, string> | null = null;
const etcServices = async () =>
  etcCache ??= parseServices(await read("/etc/services"));

// ── this machine ─────────────────────────────────────────────────────────

const VIRTUAL =
  /^(lo|docker|br-|veth|virbr|vnet|tun|tap|wg|nordlynx|tailscale|zt)/;

export const local = async (): Promise<Local> => {
  const ifaces: Iface[] = Deno.networkInterfaces()
    .filter((i) => i.family === "IPv4" && i.name !== "lo")
    .map((i) => ({
      name: i.name,
      ip: i.address,
      cidr: Number(i.cidr.split("/")[1]),
      mac: i.mac,
    }));
  const [route, egress, dns, info] = await Promise.all([
    run("ip", ["-j", "route", "show", "default"], 2000),
    run("ip", ["-j", "route", "get", "1.1.1.1"], 2000),
    run("resolvectl", ["dns"], 2000),
    fetch("https://ipinfo.io/json", { signal: AbortSignal.timeout(4000) }).then(
      (r) => r.json(),
    ).catch(() => ({})),
  ]);
  const def =
    (JSON.parse(route.out || "[]") as { gateway?: string; dev: string }[]).sort(
      (a, b) => Number(VIRTUAL.test(a.dev)) - Number(VIRTUAL.test(b.dev)),
    )[0];
  const lan = ifaces.find((i) => i.name === def?.dev) ??
    ifaces.find((i) => !VIRTUAL.test(i.name)) ?? null;
  const servers = [...dns.out.matchAll(/\b(\d+\.\d+\.\d+\.\d+)\b/g)].map((m) =>
    m[1]
  );
  const resolv = [
    ...(await read("/etc/resolv.conf")).matchAll(/^nameserver\s+(\S+)/gm),
  ].map((m) => m[1]);
  return {
    hostname: Deno.hostname(),
    ifaces,
    lan,
    gateway: def?.gateway ?? "",
    egress: (JSON.parse(egress.out || "[{}]")[0]?.dev as string) ?? "",
    dns: [...new Set(servers.length ? servers : resolv)],
    publicIp: info.ip ?? "",
    isp: info.org ?? "",
    location: [info.city, info.region, info.country].filter(Boolean).join(", "),
  };
};

// ── path to the internet ─────────────────────────────────────────────────

const rdns = async (ip: string): Promise<string> =>
  (await run("dig", ["+short", "+time=1", "+tries=1", "-x", ip], 3000)).out
    .trim().split("\n")[0].replace(/\.$/, "");

export const trace = async (
  target: string,
  signal?: AbortSignal,
): Promise<Hop[]> => {
  const { out } = await run(
    "mtr",
    ["-j", "-n", "-z", "-c", "3", target],
    45_000,
    signal,
  );
  if (!out) return [];
  const hops = parseMtr(out);
  const names = await Promise.all(
    hops.map((h) => (h.ip ? rdns(h.ip) : Promise.resolve(""))),
  );
  return hops.map((h, i) => ({ ...h, host: h.host || names[i] }));
};

// ── discovery ────────────────────────────────────────────────────────────

const ping = async (ip: string, signal?: AbortSignal) =>
  parsePing(
    (await run("ping", ["-n", "-c", "1", "-W", "1", ip], 2500, signal)).out,
  );

/** SSDP M-SEARCH → ip → UPnP description (best effort; firewalls often drop replies). */
export const ssdp = (
  bindIp: string,
  ms = 3000,
): Promise<Map<string, { location: string; server: string }>> =>
  new Promise((done) => {
    const found = new Map<string, { location: string; server: string }>();
    const sock = dgram.createSocket({ type: "udp4", reuseAddr: true });
    const msg =
      'M-SEARCH * HTTP/1.1\r\nHOST: 239.255.255.250:1900\r\nMAN: "ssdp:discover"\r\nMX: 2\r\nST: ssdp:all\r\n\r\n';
    sock.on("message", (b, r) => {
      const t = b.toString();
      if (!found.has(r.address) && header(t, "location")) {
        found.set(r.address, {
          location: header(t, "location"),
          server: header(t, "server"),
        });
      }
    });
    sock.on("error", () => {});
    sock.bind(0, bindIp, () => {
      try {
        sock.setMulticastInterface(bindIp);
      } catch { /* default route interface */ }
      for (let k = 0; k < 2; k++) sock.send(msg, 1900, "239.255.255.250");
    });
    setTimeout(() => (sock.close(), done(found)), ms);
  });

const upnpOf = async (location: string, server: string): Promise<Upnp> => {
  const xml = await fetch(location, { signal: AbortSignal.timeout(3000) }).then(
    (r) => r.text(),
  ).catch(() => "");
  return parseUpnp(location, server, xml);
};

const blank = (ip: string, now: number): Device => ({
  ip,
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
  gateway: false,
  kind: "unknown",
  os: "",
  model: "",
  evidence: [],
  confidence: 0,
  deepScanned: false,
  online: true,
  seenAt: now,
});

/** Who is on the LAN: ping sweep + neighbour table + mDNS + SSDP, merged by IP. */
export const discover = async (
  l: Local,
  signal?: AbortSignal,
  onProgress?: (done: number, total: number) => void,
): Promise<Device[]> => {
  const lan = l.lan;
  if (!lan) return [];
  const targets = hostsOf(lan.ip, lan.cidr);
  let done = 0;
  const [pings, mdns, upnp, oui] = await Promise.all([
    pool(targets, 128, async (ip) => {
      const r = ip === lan.ip ? null : await ping(ip, signal);
      if (++done % 16 === 0) onProgress?.(done, targets.length);
      return [ip, r] as const;
    }, signal),
    run("avahi-browse", ["-aptr"], 10_000, signal).then((r) =>
      parseAvahi(r.out)
    ),
    ssdp(lan.ip),
    loadOui(),
  ]);
  const neigh = parseNeigh(
    (await run("ip", ["-j", "neigh"], 2000)).out || "[]",
  );
  const now = Date.now();
  const alive = new Set([
    lan.ip,
    ...pings.filter((p) => p?.[1]).map((p) => p[0]),
    ...[...neigh.keys(), ...mdns.keys(), ...upnp.keys()].filter((ip) =>
      inSubnet(ip, lan.ip, lan.cidr)
    ),
  ]);
  const replies = new Map(pings.filter(Boolean));
  const myOs = await selfOs();
  const upnpInfo = new Map(
    await Promise.all(
      [...upnp].map(async ([ip, u]) =>
        [ip, await upnpOf(u.location, u.server)] as const
      ),
    ),
  );
  return [...alive].map((ip) => {
    const mac = ip === lan.ip ? lan.mac : neigh.get(ip) ?? "";
    const p = replies.get(ip);
    const m = mdns.get(ip);
    return {
      ...blank(ip, now),
      mac,
      vendor: vendorOf(oui, mac),
      randomMac: isRandomMac(mac),
      ttl: p?.ttl ?? 0,
      rtt: p?.rtt ?? 0,
      names: ip === lan.ip ? [l.hostname, ...(m?.names ?? [])] : m?.names ?? [],
      os: ip === lan.ip ? myOs : "",
      mdns: m?.services ?? [],
      upnp: upnpInfo.get(ip) ?? null,
      self: ip === lan.ip,
      gateway: ip === l.gateway,
    };
  });
};

/** This machine's OS, read directly — no guessing needed. */
const selfOs = async (): Promise<string> =>
  /^PRETTY_NAME="?([^"\n]+)/m.exec(await read("/etc/os-release"))?.[1] ??
    Deno.build.os;

// ── per-device probes ────────────────────────────────────────────────────

const connect = async (
  ip: string,
  port: number,
  ms: number,
): Promise<Deno.TcpConn | null> => {
  const c = Deno.connect({ hostname: ip, port });
  const t = new Promise<null>((r) => setTimeout(() => r(null), ms));
  const win = await Promise.race([c.catch(() => null), t]);
  if (!win) c.then((x) => x.close()).catch(() => {});
  return win;
};

const grab = async (conn: Deno.TcpConn, ms: number): Promise<string> => {
  const buf = new Uint8Array(512);
  const t = setTimeout(() => conn.close(), ms);
  try {
    const n = await conn.read(buf);
    return n
      ? new TextDecoder().decode(buf.subarray(0, n)).replace(
        /[^\x20-\x7e]+/g,
        " ",
      ).trim().slice(0, 160)
      : "";
  } catch {
    return "";
  } finally {
    clearTimeout(t);
    try {
      conn.close();
    } catch { /* closed by timer */ }
  }
};

const http = async (
  ip: string,
  port: number,
  scheme: "http" | "https",
): Promise<Port["http"]> => {
  const { out, err } = await run("curl", [
    "-skvL",
    "--max-redirs",
    "3",
    "-m",
    "4",
    "-D",
    "-",
    "-o",
    "-",
    `${scheme}://${ip}:${port}/`,
  ], 5000);
  const r = parseCurl(out.slice(0, 65536), err);
  return r.status || r.cert ? r : null;
};

/** TCP connect scan; open ports get a passive banner or an HTTP(S) look. */
export const scanPorts = async (
  ip: string,
  ports: number[],
  opts: { conc: number; ms: number },
  signal?: AbortSignal,
  onProgress?: (done: number) => void,
): Promise<Port[]> => {
  let done = 0;
  const open = (await pool(ports, opts.conc, async (port) => {
    const c = await connect(ip, port, opts.ms);
    if (++done % 500 === 0) onProgress?.(done);
    return c ? [port, c] as const : null;
  }, signal)).filter((x) => x !== null);
  const etc = await etcServices();
  return await Promise.all(open.map(async ([port, c]) => {
    const scheme = httpScheme(port);
    const banner = scheme ? (c.close(), "") : await grab(c, 1500);
    const service = serviceName(port, etc);
    // Silent unknown port: often a web UI on an odd number — take one HTTP look.
    const h = scheme
      ? await http(ip, port, scheme)
      : !banner && !service
      ? await http(ip, port, "http")
      : null;
    return { port, service, banner, http: h };
  }));
};

export const netbios = async (ip: string) =>
  parseNmb((await run("nmblookup", ["-A", ip], 3000)).out);

export const reverseName = async (ip: string): Promise<string> =>
  (await run("getent", ["hosts", ip], 2500)).out.trim().split(/\s+/)[1] ?? "";

export { identify };

/** NETMAP_DEMO=1: scan the made-up network in demo.server.ts instead. */
export const demo = () => Deno.env.get("NETMAP_DEMO") === "1";

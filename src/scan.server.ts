// Server-only: every probe that touches the OS or the network.
// Linux, macOS and Windows, no root/admin: TCP connect, ping, ARP table,
// mDNS + SSDP + NetBIOS over our own UDP sockets, DNS via Deno, HTTP via curl,
// path via mtr / traceroute / tracert. Each OS uses only what it ships with.
import dgram from "node:dgram";
import { join } from "@std/path";
import { appDirs } from "aio/server";
import {
  header,
  hostsOf,
  inSubnet,
  intToIp,
  ipToInt,
  isRandomMac,
  parseCurl,
  parseMtr,
  parseNeigh,
  parseOuiCsv,
  parseServices,
  parseUpnp,
  vendorOf,
} from "./lib/parse.ts";
import {
  cymruAsn,
  dropProxyArp,
  normMac,
  type Os,
  osName,
  parseArp,
  parseNetstat,
  parsePing,
  parseRouteGet,
  parseScutil,
  parseTraceroute,
  parseTracert,
  parseWinNet,
  pingArgs,
  reversed,
  VIRTUAL,
  WIN_NET_PS,
} from "./lib/sys.ts";
import {
  COMMON_TYPES,
  dnsQuery,
  dnsRecords,
  mdnsFollowUps,
  type MdnsHost,
  mdnsHosts,
  META,
  nbstatName,
  nbstatQuery,
  PTR,
  type Rec,
} from "./lib/wire.ts";
import { httpScheme, serviceName } from "./lib/ports.ts";
import { identify } from "./lib/classify.ts";
import type { Device, Hop, Iface, Local, Port, Upnp } from "./lib/types.ts";

const OS = Deno.build.os as Os;

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
  etcCache ??= parseServices(
    await read(
      OS === "windows"
        ? `${
          Deno.env.get("SystemRoot") ?? "C:\\Windows"
        }\\System32\\drivers\\etc\\services`
        : "/etc/services",
    ),
  );

// ── this machine ─────────────────────────────────────────────────────────

/** Default gateway, the LAN interface (name or ip), the internet egress, DNS. */
type Routes = { gw: string; lan: string; egress: string; dns: string[] };

const linuxRoutes = async (): Promise<Routes> => {
  const [route, egress, dns] = await Promise.all([
    run("ip", ["-j", "route", "show", "default"], 2000),
    run("ip", ["-j", "route", "get", "1.1.1.1"], 2000),
    run("resolvectl", ["dns"], 2000),
  ]);
  const def =
    (JSON.parse(route.out || "[]") as { gateway?: string; dev: string }[]).sort(
      (a, b) => Number(VIRTUAL.test(a.dev)) - Number(VIRTUAL.test(b.dev)),
    )[0];
  const resolved = [...dns.out.matchAll(/\b(\d+\.\d+\.\d+\.\d+)\b/g)].map((
    m,
  ) => m[1]);
  const conf = [
    ...(await read("/etc/resolv.conf")).matchAll(/^nameserver\s+(\S+)/gm),
  ].map((m) => m[1]);
  return {
    gw: def?.gateway ?? "",
    lan: def?.dev ?? "",
    egress: (JSON.parse(egress.out || "[{}]")[0]?.dev as string) ?? "",
    dns: resolved.length ? resolved : conf,
  };
};

const macRoutes = async (): Promise<Routes> => {
  const [table, egress, dns] = await Promise.all([
    run("netstat", ["-rn", "-f", "inet"], 3000),
    run("route", ["-n", "get", "1.1.1.1"], 2000),
    run("scutil", ["--dns"], 2000),
  ]);
  const defs = parseNetstat(table.out);
  const def = defs.find((d) => !VIRTUAL.test(d.dev)) ?? defs[0];
  return {
    gw: def?.gw ?? "",
    lan: def?.dev ?? "",
    egress: parseRouteGet(egress.out),
    dns: parseScutil(dns.out),
  };
};

const winRoutes = async (): Promise<Routes> => {
  const w = parseWinNet(
    (await run(
      "powershell",
      ["-NoProfile", "-NonInteractive", "-Command", WIN_NET_PS],
      15_000,
    )).out,
  );
  const def = w.routes.find((r) => !VIRTUAL.test(r.name)) ?? w.routes[0];
  return {
    gw: def?.gw ?? "",
    lan: def?.ip ?? "",
    egress: w.egress,
    dns: w.dns,
  };
};

export const local = async (): Promise<Local> => {
  const ifaces: Iface[] = Deno.networkInterfaces()
    .filter((i) =>
      i.family === "IPv4" && !i.address.startsWith("127.") &&
      !i.address.startsWith("169.254.")
    )
    .map((i) => ({
      name: i.name,
      ip: i.address,
      cidr: Number(i.cidr.split("/")[1]),
      mac: normMac(i.mac),
    }));
  const [r, info] = await Promise.all([
    OS === "windows"
      ? winRoutes()
      : OS === "darwin"
      ? macRoutes()
      : linuxRoutes(),
    fetch("https://ipinfo.io/json", { signal: AbortSignal.timeout(4000) }).then(
      (r) => r.json(),
    ).catch(() => ({})),
  ]);
  // Windows reports interfaces by alias or by ip depending on the source: match both.
  const find = (k: string) =>
    k ? ifaces.find((i) => i.name === k || i.ip === k) : undefined;
  const lan = find(r.lan) ?? ifaces.find((i) => !VIRTUAL.test(i.name)) ?? null;
  return {
    hostname: Deno.hostname(),
    ifaces,
    lan,
    gateway: r.gw,
    egress: find(r.egress)?.name ?? r.egress,
    dns: [...new Set(r.dns)],
    publicIp: info.ip ?? "",
    isp: info.org ?? "",
    location: [info.city, info.region, info.country].filter(Boolean).join(", "),
  };
};

/** Reverse DNS through the system resolver; "" when there is no PTR. */
const ptr = (ip: string): Promise<string> =>
  Deno.resolveDns(reversed(ip, "in-addr.arpa"), "PTR", {
    signal: AbortSignal.timeout(2500),
  }).then((n) => n[0]?.replace(/\.$/, "") ?? "").catch(() => "");

/** Origin AS of a public ip (Team Cymru DNS; works with any resolver). */
const asnOf = (ip: string): Promise<string> =>
  Deno.resolveDns(reversed(ip, "origin.asn.cymru.com"), "TXT", {
    signal: AbortSignal.timeout(2500),
  }).then((t) => cymruAsn(t[0]?.join("") ?? "")).catch(() => "");

// ── path to the internet ─────────────────────────────────────────────────

/** mtr where it runs unprivileged (Linux); traceroute / tracert otherwise. */
const hopsTo = async (target: string, signal?: AbortSignal): Promise<Hop[]> => {
  if (OS === "windows") {
    return parseTracert(
      (await run(
        "tracert",
        ["-d", "-h", "20", "-w", "1000", target],
        70_000,
        signal,
      )).out,
    );
  }
  const mtr = await run(
    "mtr",
    ["-j", "-n", "-z", "-c", "3", target],
    45_000,
    signal,
  );
  const fromMtr = mtr.out.trim().startsWith("{") ? parseMtr(mtr.out) : [];
  if (fromMtr.length || signal?.aborted) return fromMtr;
  return parseTraceroute(
    (await run(
      "traceroute",
      ["-n", "-q", "3", "-w", "1", "-m", "20", target],
      60_000,
      signal,
    )).out,
  );
};

export const trace = async (
  target: string,
  signal?: AbortSignal,
): Promise<Hop[]> => {
  const hops = await hopsTo(target, signal);
  const extra = await Promise.all(hops.map(async (h) => ({
    host: h.host || (h.ip ? await ptr(h.ip) : ""),
    asn: h.asn || (h.zone === "public" ? await asnOf(h.ip) : ""),
  })));
  return hops.map((h, i) => ({ ...h, ...extra[i] }));
};

// ── discovery ────────────────────────────────────────────────────────────

const ping = async (ip: string, signal?: AbortSignal) =>
  parsePing((await run("ping", pingArgs(OS, ip), 2500, signal)).out);

/** ARP/neighbour table: ip → mac, from whatever this OS offers. */
const neighbours = async (): Promise<Map<string, string>> => {
  if (OS === "linux") {
    const n = parseNeigh((await run("ip", ["-j", "neigh"], 2000)).out || "[]");
    if (n.size) return n;
  }
  return parseArp(
    (await run("arp", OS === "windows" ? ["-a"] : ["-an"], 3000)).out,
  );
};

type Send = (b: Uint8Array, port: number, ip: string) => void;

/** One unbound UDP socket for `ms`, then `result()`. Unbound and without
 *  IP_MULTICAST_IF on purpose: in Deno's node:dgram either one makes multicast
 *  sends fail, and unicast replies reach an unbound socket from any interface. */
const udp = <T>(
  ms: number,
  start: (send: Send) => void,
  onMsg: (b: Uint8Array, from: string, send: Send) => void,
  result: () => T,
): Promise<T> =>
  new Promise((done) => {
    const sock = dgram.createSocket({ type: "udp4", reuseAddr: true });
    const send: Send = (b, port, ip) => {
      try {
        sock.send(b, port, ip, () => {/* unreachable hosts are expected */});
      } catch { /* closed */ }
    };
    sock.on("message", (b, r) => onMsg(new Uint8Array(b), r.address, send));
    sock.on("error", () => {});
    sock.bind(0, () => start(send));
    setTimeout(() => {
      try {
        sock.close();
      } catch { /* closed */ }
      done(result());
    }, ms);
  });

/** Send to every target in small bursts so the socket buffer never overflows. */
const sweep = async (targets: string[], each: (ip: string) => void) => {
  for (let i = 0; i < targets.length; i += 32) {
    targets.slice(i, i + 32).forEach(each);
    await new Promise((r) => setTimeout(r, 10));
  }
};

/** SSDP M-SEARCH, multicast plus unicast to each live host (UPnP 1.1):
 *  ip → description URL. Unicast still works when a VPN owns the multicast route. */
export const ssdp = (
  targets: string[],
  ms = 3500,
): Promise<Map<string, { location: string; server: string }>> => {
  const found = new Map<string, { location: string; server: string }>();
  const search = (host: string, st: string, mx: boolean) =>
    new TextEncoder().encode(
      `M-SEARCH * HTTP/1.1\r\nHOST: ${host}:1900\r\nMAN: "ssdp:discover"\r\n${
        mx ? "MX: 2\r\n" : ""
      }ST: ${st}\r\n\r\n`,
    );
  return udp(ms, (send) => {
    for (let k = 0; k < 2; k++) {
      send(
        search("239.255.255.250", "ssdp:all", true),
        1900,
        "239.255.255.250",
      );
    }
    void sweep(
      targets,
      (ip) => send(search(ip, "upnp:rootdevice", false), 1900, ip),
    );
  }, (b, from) => {
    const t = new TextDecoder().decode(b);
    if (!found.has(from) && header(t, "location")) {
      found.set(from, {
        location: header(t, "location"),
        server: header(t, "server"),
      });
    }
  }, () => found);
};

/** mDNS / DNS-SD browse, multicast plus unicast queries to each live host
 *  (RFC 6762 §5.5: responders answer those). Follow-ups go to whoever answered.
 *  Runs from an ephemeral port, so it never fights avahi / mDNSResponder. */
export const mdns = (targets: string[], ms = 4000) => {
  const MCAST = "224.0.0.251";
  const recs = new Map<string, Rec[]>();
  const asked = new Map<string, Set<string>>();
  const pending = new Map<string, ReturnType<typeof setTimeout>>();
  const first: [string, number][] = [META, ...COMMON_TYPES].map((
    t,
  ) => [t, PTR]);
  // One question per packet: many responders ignore multi-question queries.
  const ask = (send: Send, ip: string, qs: [string, number][]) =>
    qs.forEach((q) => send(dnsQuery([q]), 5353, ip));
  return udp(ms, (send) => {
    ask(send, MCAST, first);
    setTimeout(() => ask(send, MCAST, first), 1000);
    void sweep(targets, (ip) => ask(send, ip, first));
  }, (b, from, send) => {
    const mine = recs.get(from) ?? [];
    mine.push(...dnsRecords(b));
    recs.set(from, mine);
    if (pending.has(from)) return;
    pending.set(
      from,
      setTimeout(() => {
        pending.delete(from);
        const a = asked.get(from) ??
          new Set(first.map(([n, t]) => `${t} ${n}`));
        asked.set(from, a);
        ask(send, from, mdnsFollowUps(mine, a));
      }, 60),
    );
  }, () => {
    pending.forEach(clearTimeout);
    const out = new Map<string, MdnsHost>();
    for (const [from, r] of recs) {
      for (const [ip, h] of mdnsHosts(r, from)) {
        const o = out.get(ip);
        out.set(
          ip,
          o
            ? {
              names: [...new Set([...o.names, ...h.names])],
              services: [...o.services, ...h.services],
            }
            : h,
        );
      }
    }
    return out;
  });
};

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
  const [pings, oui] = await Promise.all([
    pool(targets, OS === "windows" ? 64 : 128, async (ip) => {
      const r = ip === lan.ip ? null : await ping(ip, signal);
      if (++done % 16 === 0) onProgress?.(done, targets.length);
      return [ip, r] as const;
    }, signal),
    loadOui(),
  ]);
  const neigh = dropProxyArp(await neighbours(), l.gateway);
  const size = 2 ** (32 - lan.cidr);
  const broadcast = intToIp(
    Math.floor(ipToInt(lan.ip) / size) * size + size - 1,
  );
  const lanOnly = (ips: Iterable<string>) =>
    [...ips].filter((ip) => inSubnet(ip, lan.ip, lan.cidr) && ip !== broadcast);
  // Second step: ask the hosts we now know about for names and services.
  const seen = lanOnly([
    ...pings.filter((p) => p?.[1]).map((p) => p[0]),
    ...neigh.keys(),
  ]).filter((ip) => ip !== lan.ip);
  if (signal?.aborted) return [];
  const [mdnsMap, upnp] = await Promise.all([mdns(seen), ssdp(seen)]);
  const now = Date.now();
  const alive = new Set([
    lan.ip,
    ...seen,
    ...lanOnly([...mdnsMap.keys(), ...upnp.keys()]),
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
    const m = mdnsMap.get(ip);
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
  osName(
    OS,
    Deno.osRelease(),
    OS === "darwin"
      ? (await run("sw_vers", ["-productVersion"], 2000)).out
      : OS === "linux"
      ? await read("/etc/os-release")
      : "",
  );

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

/** NetBIOS node status (UDP 137): Windows and Samba hosts say their name. */
export const netbios = (ip: string): Promise<string> => {
  let name = "";
  return udp(1500, (send) => {
    send(nbstatQuery(Math.floor(Math.random() * 65535)), 137, ip);
  }, (b, from) => {
    if (from === ip && !name) name = nbstatName(b);
  }, () => name);
};

export const reverseName = (ip: string): Promise<string> => ptr(ip);

export { identify };

/** NETMAP_DEMO=1: scan the made-up network in demo.server.ts instead. */
export const demo = () => Deno.env.get("NETMAP_DEMO") === "1";

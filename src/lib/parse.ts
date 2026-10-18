// Pure parsers for tool output and wire formats — no I/O, fully testable.
import type { Hop, Service, Upnp } from "./types.ts";

export const ipToInt = (ip: string): number =>
  ip.split(".").reduce((a, o) => a * 256 + Number(o), 0);

export const intToIp = (n: number): string =>
  [24, 16, 8, 0].map((s) => Math.floor(n / 2 ** s) % 256).join(".");

/** Host addresses of ip/cidr; prefixes wider than /maxWide shrink to it around ip. */
export const hostsOf = (ip: string, cidr: number, maxWide = 22): string[] => {
  const bits = Math.max(cidr, maxWide);
  if (bits >= 31) return [ip];
  const size = 2 ** (32 - bits);
  const net = Math.floor(ipToInt(ip) / size) * size;
  return Array.from({ length: size - 2 }, (_, i) => intToIp(net + i + 1));
};

export const inSubnet = (ip: string, net: string, cidr: number): boolean => {
  const size = 2 ** (32 - cidr);
  return Math.floor(ipToInt(ip) / size) === Math.floor(ipToInt(net) / size);
};

export const zoneOf = (ip: string): Hop["zone"] => {
  if (!/^\d+\.\d+\.\d+\.\d+$/.test(ip)) return "unknown";
  const [a, b] = ip.split(".").map(Number);
  if (
    a === 10 || (a === 172 && b >= 16 && b < 32) || (a === 192 && b === 168)
  ) {
    return "private";
  }
  if (a === 100 && b >= 64 && b < 128) return "cgnat";
  return "public";
};

/** `mtr -j -z -b` report → hops. `-b` writes "name (ip)" or a bare ip. */
export const parseMtr = (json: string): Hop[] => {
  type Hub = Record<string, number | string>;
  const hubs = (JSON.parse(json).report?.hubs ?? []) as Hub[];
  return hubs.map((h) => {
    const raw = String(h.host);
    const m = /^(.*) \((.+)\)$/.exec(raw);
    const ip = m ? m[2] : raw === "???" ? "" : raw;
    const host = m && m[1] !== m[2] ? m[1] : "";
    return {
      n: Number(h.count),
      ip,
      host,
      asn: String(h.ASN ?? "").replace("AS???", ""),
      loss: Number(h["Loss%"]),
      avg: Number(h.Avg),
      best: Number(h.Best),
      worst: Number(h.Wrst),
      zone: ip ? zoneOf(ip) : "unknown",
    };
  });
};

/** avahi writes non-ASCII as decimal byte escapes: `dev\226\128\153s\032Mac`. */
export const unescapeAvahi = (s: string): string => {
  const bytes: number[] = [];
  for (let i = 0; i < s.length; i++) {
    const m = /^\\(\d{3})/.exec(s.slice(i));
    if (m) (bytes.push(Number(m[1])), i += 3);
    else bytes.push(...new TextEncoder().encode(s[i]));
  }
  return new TextDecoder().decode(new Uint8Array(bytes));
};

export type MdnsHost = { names: string[]; services: Service[] };

/** `avahi-browse -aptr` resolved lines (`=;if;IPv4;name;type;domain;host;ip;port;txt`). */
export const parseAvahi = (text: string): Map<string, MdnsHost> => {
  const out = new Map<string, MdnsHost>();
  for (const line of text.split("\n")) {
    const f = line.split(";");
    if (f[0] !== "=" || f[2] !== "IPv4" || f.length < 10) continue;
    const ip = f[7];
    const h = out.get(ip) ?? { names: [], services: [] };
    const name = unescapeAvahi(f[3]);
    const host = f[6].replace(/\.local$/, "");
    for (const n of [host, name]) {
      if (n && !h.names.includes(n)) h.names.push(n);
    }
    const txt = [...f.slice(9).join(";").matchAll(/"([^"]*)"/g)].map((x) =>
      unescapeAvahi(x[1])
    );
    if (!h.services.some((s) => s.type === f[4] && s.port === Number(f[8]))) {
      h.services.push({
        type: unescapeAvahi(f[4]),
        name,
        port: Number(f[8]),
        txt,
      });
    }
    out.set(ip, h);
  }
  return out;
};

/** First header value in an HTTP-style message (SSDP replies, HTTP heads). */
export const header = (msg: string, name: string): string =>
  new RegExp(`^${name}:\\s*(.*)$`, "im").exec(msg)?.[1].trim() ?? "";

const tag = (xml: string, t: string): string =>
  new RegExp(`<${t}>([^<]*)</${t}>`, "i").exec(xml)?.[1].trim() ?? "";

export const parseUpnp = (
  location: string,
  server: string,
  xml: string,
): Upnp => ({
  location,
  server,
  friendlyName: tag(xml, "friendlyName"),
  manufacturer: tag(xml, "manufacturer"),
  model: tag(xml, "modelName"),
  modelNumber: tag(xml, "modelNumber"),
  deviceType: tag(xml, "deviceType").replace(
    /^urn:schemas-upnp-org:device:/,
    "",
  ),
});

/** `ping -c1` → ttl + rtt, or null when no reply. */
export const parsePing = (
  text: string,
): { ttl: number; rtt: number } | null => {
  const m = /ttl=(\d+) time=([\d.]+)/.exec(text);
  return m ? { ttl: Number(m[1]), rtt: Number(m[2]) } : null;
};

/** `nmblookup -A` → the unique <00> workstation name. */
export const parseNmb = (text: string): string =>
  /^\s+(\S+)\s+<00>\s+-\s+[^<]*<ACTIVE>/m.exec(text)?.[1] ?? "";

/** `curl -skvL -D -` → final status, Server, <title>, TLS subject. */
export const parseCurl = (out: string, err: string) => ({
  status: Number([...out.matchAll(/^HTTP\/[\d.]+ (\d{3})/gm)].at(-1)?.[1] ?? 0),
  server: header(out, "server"),
  title: (/<title[^>]*>([^<]*)<\/title>/i.exec(out)?.[1] ?? "").replace(
    /\s+/g,
    " ",
  ).trim()
    .slice(0, 120),
  cert: /^\*\s+subject:\s*(.*)$/m.exec(err)?.[1].trim() ?? "",
});

/** `ip -j neigh` → ip → mac for live entries. */
export const parseNeigh = (json: string): Map<string, string> =>
  new Map(
    (JSON.parse(json) as { dst: string; lladdr?: string; state?: string[] }[])
      .filter((n) =>
        n.lladdr && !n.state?.some((s) => s === "FAILED" || s === "INCOMPLETE")
      )
      .map((n) => [n.dst, n.lladdr!.toLowerCase()]),
  );

/** Bit 1 of the first octet = locally administered (randomized) address. */
export const isRandomMac = (mac: string): boolean =>
  mac !== "" && (parseInt(mac.slice(0, 2), 16) & 2) === 2;

/** IEEE registry CSV (oui.csv / mam.csv / oui36.csv) → hex prefix → org. */
export const parseOuiCsv = (csv: string): Map<string, string> => {
  const out = new Map<string, string>();
  for (const line of csv.split("\n").slice(1)) {
    const m = /^[^,]*,([0-9A-F]+),("(?:[^"]|"")*"|[^,]*)/.exec(line);
    if (m) out.set(m[1], m[2].replace(/^"|"$/g, "").replace(/""/g, '"').trim());
  }
  return out;
};

/** Longest registered prefix wins (MA-S 9 hex > MA-M 7 > MA-L 6). */
export const vendorOf = (oui: Map<string, string>, mac: string): string => {
  const hex = mac.replace(/[^0-9a-f]/gi, "").toUpperCase();
  for (const n of [9, 7, 6]) {
    const v = oui.get(hex.slice(0, n));
    if (v) return v;
  }
  return "";
};

/** `/etc/services` → tcp port → name. */
export const parseServices = (text: string): Map<number, string> => {
  const out = new Map<number, string>();
  for (const m of text.matchAll(/^([\w.-]+)\s+(\d+)\/tcp/gm)) {
    if (!out.has(Number(m[2]))) out.set(Number(m[2]), m[1]);
  }
  return out;
};

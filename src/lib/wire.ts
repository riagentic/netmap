// DNS wire format for mDNS (RFC 6762/6763) and NetBIOS node status (RFC 1002).
// Pure: bytes in, records out. The sockets live in scan.server.ts.
import type { Service } from "./types.ts";

export const A = 1, PTR = 12, TXT = 16, SRV = 33, NBSTAT = 33;

export type Rec =
  | { name: string; type: typeof A; data: string }
  | { name: string; type: typeof PTR; data: string }
  | { name: string; type: typeof TXT; data: string[] }
  | { name: string; type: typeof SRV; data: { target: string; port: number } };

const u16 = (n: number) => [n >> 8 & 255, n & 255];

const label = (s: string) => {
  const b = new TextEncoder().encode(s);
  return [b.length, ...b];
};

/** "Alex’s Mac._ipp._tcp.local" → labels; the instance part may hold dots. */
const encodeName = (name: string): number[] => {
  const m = /^(.*)\.(_[^.]+\._(?:tcp|udp)\.local)$/.exec(name);
  const parts = m && !m[1].startsWith("_")
    ? [m[1], ...m[2].split(".")]
    : name.split(".");
  return [...parts.filter(Boolean).flatMap(label), 0];
};

/** One query packet; class IN, unicast-response bit clear (legacy unicast). */
export const dnsQuery = (qs: [name: string, type: number][]): Uint8Array =>
  new Uint8Array([
    ...u16(0),
    ...u16(0),
    ...u16(qs.length),
    ...u16(0),
    ...u16(0),
    ...u16(0),
    ...qs.flatMap(([n, t]) => [...encodeName(n), ...u16(t), ...u16(1)]),
  ]);

/** Name at `at` (with compression pointers) → [name, offset after it]. */
const readName = (b: Uint8Array, at: number): [string, number] => {
  const parts: string[] = [];
  let i = at, end = -1;
  for (let hops = 0; hops < 64 && i < b.length; hops++) {
    const len = b[i];
    if (len === 0) {
      i++;
      break;
    }
    if ((len & 0xc0) === 0xc0) {
      if (end < 0) end = i + 2;
      i = ((len & 0x3f) << 8) | b[i + 1];
      continue;
    }
    parts.push(new TextDecoder().decode(b.subarray(i + 1, i + 1 + len)));
    i += 1 + len;
  }
  return [parts.join("."), end < 0 ? i : end];
};

const view = (b: Uint8Array) => new DataView(b.buffer, b.byteOffset);

/** Every A/PTR/TXT/SRV record in a DNS message (answers + authority + additional). */
export const dnsRecords = (b: Uint8Array): Rec[] => {
  try {
    const v = view(b);
    const qd = v.getUint16(4),
      rr = v.getUint16(6) + v.getUint16(8) +
        v.getUint16(10);
    let i = 12;
    for (let k = 0; k < qd; k++) i = readName(b, i)[1] + 4;
    const out: Rec[] = [];
    for (let k = 0; k < rr && i + 10 <= b.length; k++) {
      const [name, at] = readName(b, i);
      const type = v.getUint16(at), len = v.getUint16(at + 8), d = at + 10;
      i = d + len;
      if (i > b.length) break;
      if (type === A && len === 4) {
        out.push({ name, type, data: [...b.subarray(d, d + 4)].join(".") });
      } else if (type === PTR) {
        out.push({ name, type, data: readName(b, d)[0] });
      } else if (type === SRV) {
        out.push({
          name,
          type,
          data: { port: v.getUint16(d + 4), target: readName(b, d + 6)[0] },
        });
      } else if (type === TXT) {
        const txt: string[] = [];
        for (let j = d; j < i && b[j];) {
          txt.push(new TextDecoder().decode(b.subarray(j + 1, j + 1 + b[j])));
          j += 1 + b[j];
        }
        out.push({ name, type, data: txt });
      }
    }
    return out;
  } catch {
    return [];
  }
};

/** Human names for common DNS-SD types (unknown types stay raw). */
const TYPES: Record<string, string> = {
  _ipp: "Internet Printer",
  _ipps: "Internet Printer (TLS)",
  _printer: "Printer (LPD)",
  "_pdl-datastream": "Printer (raw)",
  _uscan: "Scanner (_uscan)",
  _scanner: "Scanner (_scanner)",
  _http: "Web Site",
  _https: "Web Site (TLS)",
  _smb: "Windows Network (SMB)",
  _afpovertcp: "Apple File Sharing",
  _adisk: "Time Machine (_adisk)",
  _ssh: "SSH",
  "_sftp-ssh": "SFTP",
  _workstation: "Workstation",
  _googlecast: "Google Cast (_googlecast)",
  _airplay: "AirPlay (_airplay)",
  _raop: "AirPlay audio (_raop)",
  "_spotify-connect": "Spotify Connect (_spotify-connect)",
  _sonos: "Sonos (_sonos)",
  "_companion-link": "Apple device (_companion-link)",
  _hap: "HomeKit (_hap)",
  _matter: "Matter (_matter)",
  "_home-assistant": "Home Assistant (_home-assistant)",
  "_device-info": "Device info",
};

/** Service types worth asking for directly: some devices skip the meta-query. */
export const COMMON_TYPES = [
  ...Object.keys(TYPES).map((t) => `${t}._tcp.local`),
  "_androidtvremote2._tcp.local",
  "_nearbypresence._tcp.local",
  "_rdlink._tcp.local",
  "_apple-mobdev2._tcp.local",
];

export const META = "_services._dns-sd._udp.local";

const split = (instance: string) =>
  /^(.*)\.(_[^.]+)\.(_tcp|_udp)\.local$/.exec(instance);

export type MdnsHost = { names: string[]; services: Service[] };

/** Records from one responder → ip → names + services. A target without an
 *  A record falls back to `from`, the address that answered. Pure. */
export const mdnsHosts = (
  recs: Rec[],
  from = "",
): Map<string, MdnsHost> => {
  const ipOf = new Map<string, string>();
  const srv = new Map<string, { target: string; port: number }>();
  const txt = new Map<string, string[]>();
  for (const r of recs) {
    if (r.type === A) ipOf.set(r.name.toLowerCase(), r.data);
    else if (r.type === SRV) srv.set(r.name, r.data);
    else if (r.type === TXT) txt.set(r.name, r.data.filter(Boolean));
  }
  const out = new Map<string, MdnsHost>();
  for (const [instance, { target, port }] of srv) {
    const ip = ipOf.get(target.toLowerCase()) ?? from;
    const m = split(instance);
    if (!ip || !m) continue;
    const h = out.get(ip) ?? { names: [], services: [] };
    for (const n of [target.replace(/\.local$/i, ""), m[1]]) {
      if (n && !h.names.includes(n)) h.names.push(n);
    }
    const type = TYPES[m[2]] ?? `${m[2]}.${m[3]}`;
    if (!h.services.some((s) => s.type === type && s.port === port)) {
      h.services.push({ type, name: m[1], port, txt: txt.get(instance) ?? [] });
    }
    out.set(ip, h);
  }
  return out;
};

/** What to ask next, given what is known: types → instances → SRV/TXT → A. */
export const mdnsFollowUps = (
  recs: Rec[],
  asked: Set<string>,
): [string, number][] => {
  const has = (t: number, n: string) =>
    recs.some((r) => r.type === t && r.name.toLowerCase() === n.toLowerCase());
  const want: [string, number][] = [];
  for (const r of recs) {
    if (r.type !== PTR) continue;
    if (r.name === META) want.push([r.data, PTR]);
    else if (split(r.data)) {
      if (!has(SRV, r.data)) want.push([r.data, SRV]);
      if (!has(TXT, r.data)) want.push([r.data, TXT]);
    }
  }
  for (const r of recs) {
    if (r.type === SRV && !has(A, r.data.target)) {
      want.push([r.data.target, A]);
    }
  }
  return want.filter(([n, t]) => {
    const k = `${t} ${n}`;
    return asked.has(k) ? false : (asked.add(k), true);
  });
};

// ── NetBIOS node status ──────────────────────────────────────────────────

/** NBSTAT query for "*": the Windows/Samba equivalent of "what is your name". */
export const nbstatQuery = (id: number): Uint8Array => {
  const raw = "*".padEnd(16, "\0");
  const enc = [...raw].flatMap((c) => {
    const n = c.charCodeAt(0);
    return [65 + (n >> 4), 65 + (n & 15)];
  });
  return new Uint8Array([
    ...u16(id),
    ...u16(0),
    ...u16(1),
    ...u16(0),
    ...u16(0),
    ...u16(0),
    32,
    ...enc,
    0,
    ...u16(NBSTAT),
    ...u16(1),
  ]);
};

/** NBSTAT reply → the unique workstation name (suffix 0x00), or "". */
export const nbstatName = (b: Uint8Array): string => {
  try {
    const v = view(b);
    if (v.getUint16(6) < 1) return "";
    let i = 12;
    for (let k = 0; k < v.getUint16(4); k++) i = readName(b, i)[1] + 4;
    const at = readName(b, i)[1];
    if (v.getUint16(at) !== NBSTAT) return "";
    const d = at + 10, count = b[d];
    const names = Array.from({ length: count }, (_, k) => {
      const o = d + 1 + k * 18;
      return {
        name: new TextDecoder().decode(b.subarray(o, o + 15)).trim(),
        suffix: b[o + 15],
        group: (v.getUint16(o + 16) & 0x8000) !== 0,
      };
    });
    const pick = (s: number) =>
      names.find((n) => n.suffix === s && !n.group)?.name;
    return pick(0) ?? pick(0x20) ?? "";
  } catch {
    return "";
  }
};

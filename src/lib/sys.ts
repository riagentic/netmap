// Pure parsers for each OS's built-in tools (Linux, macOS, Windows).
// Windows tools localise their text, so these key on numbers and symbols only.
import { zoneOf } from "./parse.ts";
import type { Hop } from "./types.ts";

export type Os = "linux" | "darwin" | "windows";

const IPV4 = /\b(\d{1,3}(?:\.\d{1,3}){3})\b/;

/** Tunnels, containers, VMs, loopback: never "the LAN". Case-insensitive for Windows aliases. */
export const VIRTUAL =
  /^(lo|docker|br-|veth|virbr|vnet|tun|tap|wg|nordlynx|tailscale|zt|utun|awdl|llw|bridge|gif|stf|anpi|ap\d|vethernet|vmware|virtualbox|hyper-v|wireguard|openvpn|zerotier|loopback|bluetooth)/i;

/** "0:11:32:a:b:c" / "00-11-32-0A-0B-0C" → "00:11:32:0a:0b:0c"; "" if not a MAC. */
export const normMac = (m: string): string => {
  const p = m.split(/[:-]/);
  return p.length === 6 && p.every((x) => /^[0-9a-f]{1,2}$/i.test(x))
    ? p.map((x) => x.padStart(2, "0").toLowerCase()).join(":")
    : "";
};

/** Ping args: one echo, ~1 s wait, numeric. */
export const pingArgs = (os: Os, ip: string): string[] =>
  os === "windows"
    ? ["-n", "1", "-w", "1000", ip]
    : os === "darwin"
    ? ["-n", "-c", "1", "-W", "1000", ip]
    : ["-n", "-c", "1", "-W", "1", ip];

/** Any OS, any language: "ttl=64 time=0.4 ms" · "time<1ms TTL=128" · "Zeit=3ms TTL=64". */
export const parsePing = (
  text: string,
): { ttl: number; rtt: number } | null => {
  const ttl = /\bttl[=:](\d+)/i.exec(text);
  const rtt = /[=<]\s*([\d.,]+)\s*ms\b/i.exec(text);
  return ttl
    ? { ttl: Number(ttl[1]), rtt: Number(rtt?.[1].replace(",", ".") ?? 0) }
    : null;
};

/** `arp -a` (Windows) / `arp -an` (macOS, Linux) → ip → mac; broadcast/multicast dropped. */
export const parseArp = (text: string): Map<string, string> => {
  const out = new Map<string, string>();
  for (const line of text.split("\n")) {
    const ip = IPV4.exec(line)?.[1];
    const mac = normMac(
      /([0-9a-f]{1,2}(?:[:-][0-9a-f]{1,2}){5})/i.exec(line)?.[1] ?? "",
    );
    if (!ip || !mac || mac === "ff:ff:ff:ff:ff:ff") continue;
    if (parseInt(mac.slice(0, 2), 16) & 1) continue; // multicast MAC
    out.set(ip, mac);
  }
  return out;
};

/** macOS `netstat -rn -f inet` → default routes in table order. */
export const parseNetstat = (text: string): { gw: string; dev: string }[] =>
  text.split("\n").map((l) => l.trim().split(/\s+/))
    .filter((f) => f[0] === "default" && IPV4.test(f[1]))
    .map((f) => ({ gw: f[1], dev: f[3] ?? "" }));

/** macOS `route -n get <ip>` → the interface that carries it. */
export const parseRouteGet = (text: string): string =>
  /^\s*interface:\s*(\S+)/m.exec(text)?.[1] ?? "";

/** macOS `scutil --dns` → resolver IPv4s, first resolver first. */
export const parseScutil = (text: string): string[] => [
  ...new Set(
    [...text.matchAll(/nameserver\[\d+\]\s*:\s*(\d{1,3}(?:\.\d{1,3}){3})/g)]
      .map((m) => m[1]),
  ),
];

/** The PowerShell probe below → routes (best first), egress source ip, DNS. */
export type WinNet = {
  routes: { gw: string; ip: string; name: string }[];
  egress: string;
  dns: string[];
};

/** Locale-free on purpose: cmdlet objects as JSON, not `ipconfig` text. */
export const WIN_NET_PS = [
  "$ErrorActionPreference='SilentlyContinue'",
  "$ip=@{}; Get-NetIPAddress -AddressFamily IPv4 | % { $ip[[int]$_.InterfaceIndex]=$_.IPAddress }",
  "$m=@{}; Get-NetIPInterface -AddressFamily IPv4 | % { $m[[int]$_.InterfaceIndex]=$_.InterfaceMetric }",
  "$r=Get-NetRoute -AddressFamily IPv4 -DestinationPrefix 0.0.0.0/0 | sort { $_.RouteMetric + $m[[int]$_.InterfaceIndex] } | % { @{gw=$_.NextHop; ip=$ip[[int]$_.InterfaceIndex]; name=$_.InterfaceAlias} }",
  "$e=(Find-NetRoute -RemoteIPAddress 1.1.1.1 | ? { $_.IPAddress } | select -First 1).IPAddress",
  "$d=Get-DnsClientServerAddress -AddressFamily IPv4 | % { $_.ServerAddresses }",
  "@{routes=@($r); egress=$e; dns=@($d)} | ConvertTo-Json -Compress -Depth 4",
].join("; ");

const arr = <T>(x: T | T[] | null | undefined): T[] =>
  x == null ? [] : Array.isArray(x) ? x : [x];

export const parseWinNet = (json: string): WinNet => {
  try {
    const j = JSON.parse(json.trim() || "{}");
    return {
      routes: arr<WinNet["routes"][number]>(j.routes)
        .filter((r) => r?.gw && r.gw !== "0.0.0.0")
        .map((r) => ({ gw: r.gw, ip: r.ip ?? "", name: r.name ?? "" })),
      egress: typeof j.egress === "string" ? j.egress : "",
      dns: [...new Set(arr<string>(j.dns).filter((d) => IPV4.test(d)))],
    };
  } catch {
    return { routes: [], egress: "", dns: [] };
  }
};

const stats = (n: number, ip: string, ms: number[], sent: number): Hop => ({
  n,
  ip,
  host: "",
  asn: "",
  loss: Math.round((1 - ms.length / sent) * 100),
  avg: ms.length ? ms.reduce((a, b) => a + b, 0) / ms.length : 0,
  best: ms.length ? Math.min(...ms) : 0,
  worst: ms.length ? Math.max(...ms) : 0,
  zone: ip ? zoneOf(ip) : "unknown",
});

/** `traceroute -n -q 3` (macOS, Linux) → hops; first replying ip per hop. */
export const parseTraceroute = (text: string): Hop[] =>
  text.split("\n").flatMap((l) => {
    const m = /^\s*(\d+)\s+(.*)$/.exec(l);
    if (!m) return [];
    const ms = [...m[2].matchAll(/([\d.]+)\s*ms/g)].map((x) => Number(x[1]));
    const sent = ms.length + (m[2].match(/\*/g)?.length ?? 0);
    return [stats(Number(m[1]), IPV4.exec(m[2])?.[1] ?? "", ms, sent || 3)];
  });

/** Windows `tracert -d` → hops. "<1 ms" counts as 1 ms. */
export const parseTracert = (text: string): Hop[] =>
  text.split("\n").flatMap((l) => {
    const m = /^\s*(\d+)\s+((?:(?:<?\d+\s*ms|\*)\s+){3})(.*)$/.exec(l);
    if (!m) return [];
    const ms = [...m[2].matchAll(/<?(\d+)\s*ms/g)].map((x) => Number(x[1]));
    return [stats(Number(m[1]), IPV4.exec(m[3])?.[1] ?? "", ms, 3)];
  });

/** Team Cymru origin TXT ("13335 | 1.1.1.0/24 | US | …") → "AS13335". */
export const cymruAsn = (txt: string): string => {
  const n = /^\s*(\d+)/.exec(txt)?.[1];
  return n ? `AS${n}` : "";
};

/** 1.2.3.4 → "4.3.2.1.<suffix>" (reverse-DNS style names). */
export const reversed = (ip: string, suffix: string): string =>
  `${ip.split(".").reverse().join(".")}.${suffix}`;

/** This machine's OS name from what each platform reports. */
export const osName = (
  os: Os,
  release: string,
  detail: string,
): string => {
  if (os === "windows") {
    const build = Number(release.split(".")[2] ?? 0);
    return build >= 22000 ? "Windows 11" : build ? "Windows 10" : "Windows";
  }
  if (os === "darwin") {
    return detail.trim() ? `macOS ${detail.trim()}` : "macOS";
  }
  return /^PRETTY_NAME="?([^"\n]+)/m.exec(detail)?.[1] ?? "Linux";
};

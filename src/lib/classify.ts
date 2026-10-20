// Device identification — every signal votes; strongest kind wins. Pure.
import type { Device, Kind } from "./types.ts";

type Vote = {
  kind?: Kind;
  os?: string;
  model?: string;
  w: number;
  why: string;
};
type Rule = [RegExp, Omit<Vote, "why">];

const VENDOR: Rule[] = [
  [/mikrotik|routerboard/i, {
    kind: "router",
    os: "RouterOS",
    model: "MikroTik RouterBOARD",
    w: 4,
  }],
  [
    /ubiquiti|tp-?link|netgear|zyxel|asustek|d-link|linksys|huawei|avm|juniper|cisco|aruba|ruckus|tenda|keenetic/i,
    { kind: "router", w: 2 },
  ],
  [/brother|canon|epson|lexmark|kyocera|xerox|ricoh|hewlett|hp inc/i, {
    kind: "printer",
    w: 3,
  }],
  [/synology|qnap|western digital|seagate|buffalo/i, { kind: "nas", w: 3 }],
  [/raspberry/i, { kind: "server", os: "Linux (Raspberry Pi)", w: 3 }],
  [
    /espressif|tuya|shelly|sonoff|itead|lumi|signify|philips lighting|nanoleaf|wiz|ecobee|nest/i,
    { kind: "iot", w: 3 },
  ],
  [/sonos|bose|harman|denon|yamaha/i, { kind: "speaker", w: 3 }],
  [/hikvision|dahua|axis|reolink|amcrest|ezviz|wyze/i, {
    kind: "camera",
    w: 3,
  }],
  [/lg electronics|sony|vizio|tcl|hisense|roku|panasonic/i, {
    kind: "tv",
    w: 2,
  }],
  [/apple/i, { os: "Apple", w: 1 }],
  [/samsung|xiaomi|oneplus|oppo|vivo|motorola|realme|google/i, {
    kind: "phone",
    w: 1,
  }],
  [
    /intel|realtek|micro-star|gigabyte|asrock|dell|lenovo|liteon|azurewave|hon hai|foxconn/i,
    { kind: "computer", w: 1 },
  ],
  [/qemu|vmware|virtualbox|xensource|parallels/i, { kind: "vm", w: 4 }],
];

const MDNS: Rule[] = [
  [/_ipp|_printer|_pdl-datastream|_uscan|_scanner|Printer/i, {
    kind: "printer",
    w: 5,
  }],
  [/_googlecast/i, { kind: "tv", w: 4 }],
  [/_airplay|_raop/i, { kind: "tv", w: 2 }],
  [/_spotify-connect|_sonos/i, { kind: "speaker", w: 3 }],
  [/_companion-link|_apple-mobdev|_rdlink/i, {
    kind: "phone",
    os: "iOS/iPadOS",
    w: 3,
  }],
  [/_nearbypresence|_androidtvremote|_adb/i, {
    kind: "phone",
    os: "Android",
    w: 3,
  }],
  [/_hap|_matter|_hue|_homekit/i, { kind: "iot", w: 3 }],
  [/_adisk|_afpovertcp|Windows Network|_smb/i, { kind: "nas", w: 1 }],
  [/_ssh|_sftp|SSH|SFTP/i, { kind: "computer", w: 1 }],
  [/_home-assistant/i, { kind: "server", os: "Home Assistant", w: 5 }],
];

const NAME: Rule[] = [
  [/iphone/i, { kind: "phone", os: "iOS", w: 5 }],
  [/ipad/i, { kind: "tablet", os: "iPadOS", w: 5 }],
  [/macbook/i, { kind: "laptop", os: "macOS", w: 5 }],
  [/imac|mac-?mini|mac-?pro|mac-?studio/i, {
    kind: "computer",
    os: "macOS",
    w: 5,
  }],
  [/android|galaxy|pixel|redmi/i, { kind: "phone", os: "Android", w: 4 }],
  [/nas|diskstation|truenas|unraid|openmediavault/i, { kind: "nas", w: 4 }],
  [/printer|brw|mfc-|laserjet|officejet|deskjet/i, { kind: "printer", w: 4 }],
  [/\btv\b|smart-?tv|chromecast|roku|fire-?tv|shield|bravia|webos/i, {
    kind: "tv",
    w: 3,
  }],
  [/\bcam|\bipc\b|\bnvr\b|\bdvr\b/i, { kind: "camera", w: 2 }],
  [/desktop|\bpc\b|workstation|^ws\d/i, { kind: "computer", w: 2 }],
  [/laptop|thinkpad|xps|notebook/i, { kind: "laptop", w: 3 }],
  [/router|gateway|mikrotik|fritz|openwrt/i, { kind: "router", w: 3 }],
];

const PORTS: [number[], Omit<Vote, "why">][] = [
  [[9100], { kind: "printer", w: 4 }],
  [[631, 515], { kind: "printer", w: 2 }],
  [[8291, 8728], { kind: "router", os: "RouterOS", w: 6 }],
  [[62078], { kind: "phone", os: "iOS", w: 5 }],
  [[5555], { kind: "phone", os: "Android", w: 3 }],
  [[8008, 8009], { kind: "tv", os: "Google Cast", w: 4 }],
  [[6466, 6467], { kind: "tv", os: "Android TV", w: 5 }],
  [[554, 8554, 37777], { kind: "camera", w: 3 }],
  [[3389], { kind: "computer", os: "Windows", w: 4 }],
  [[135, 139, 445], { os: "Windows", w: 1 }],
  [[548], { os: "macOS", w: 2 }],
  [[5000, 5001], { kind: "nas", w: 1 }],
  [[32400], { kind: "server", w: 2 }],
  [[2375, 2376, 6443], { kind: "server", w: 3 }],
  [[8123], { kind: "server", os: "Home Assistant", w: 5 }],
  [[1883, 8883], { kind: "server", w: 2 }],
  [[53], { kind: "router", w: 1 }],
  [[7547], { kind: "router", w: 3 }],
];

/** Text patterns found in banners, HTTP Server headers, page titles, certs. */
const TEXT: Rule[] = [
  [/routeros|mikrotik/i, { kind: "router", os: "RouterOS", w: 5 }],
  [/openwrt|luci|dd-wrt|fritz!?box|ubnt|unifi|edgeos/i, {
    kind: "router",
    w: 4,
  }],
  [/ubuntu/i, { os: "Linux (Ubuntu)", w: 3 }],
  [/debian|raspbian/i, { os: "Linux (Debian)", w: 3 }],
  [/fedora|centos|red ?hat|alma|rocky/i, { os: "Linux (RHEL family)", w: 3 }],
  [/freebsd|pfsense|opnsense/i, { os: "FreeBSD", w: 3 }],
  [/microsoft|windows|iis/i, { os: "Windows", w: 3 }],
  [/synology|diskstation|qnap|truenas/i, { kind: "nas", w: 4 }],
  [/samba|macsamba/i, { kind: "nas", w: 1 }],
  [/cups|ipp|jetdirect|brother|epson|hp http server/i, {
    kind: "printer",
    w: 3,
  }],
  [/hikvision|dahua|webcam|ip camera|onvif/i, { kind: "camera", w: 4 }],
  [/plex|jellyfin|emby|home assistant|grafana|portainer|proxmox|nextcloud/i, {
    kind: "server",
    w: 3,
  }],
  [/tplinkdeco|\bdeco\b/i, {
    kind: "router",
    model: "TP-Link Deco (mesh Wi-Fi)",
    w: 5,
  }],
  [/openssh_for_windows/i, { kind: "computer", os: "Windows", w: 4 }],
  [/openssh/i, { kind: "computer", os: "Unix-like", w: 1 }],
  [/RFB \d/i, { kind: "computer", w: 1 }],
  [/reolink/i, { kind: "camera", model: "Reolink camera", w: 5 }],
];

/** Exact versions some banners give away. */
const VERSIONS: [RegExp, (m: RegExpMatchArray) => string][] = [
  [/MikroTik (\d+\.[\d.]+)/i, (m) => `RouterOS ${m[1]}`],
  [/deb(\d+)u\d/i, (m) => `Linux (Debian ${m[1]})`],
  [/(\d+)ubuntu[\d.]+/i, () => "Linux (Ubuntu)"],
  [/OpenSSH_for_Windows_([\d.]+)/i, () => "Windows 10/11"],
  [/Microsoft-IIS\/([\d.]+)/i, (m) => `Windows (IIS ${m[1]})`],
];

const ttlOs = (ttl: number): Vote | null =>
  ttl <= 0 ? null : ttl <= 64
    ? {
      os: "Unix-like",
      w: 1,
      why: `TTL ${ttl} ≈ 64 → Unix-like stack (Linux/macOS/iOS/Android)`,
    }
    : ttl <= 128
    ? { os: "Windows", w: 2, why: `TTL ${ttl} ≈ 128 → Windows stack` }
    : { kind: "router", w: 1, why: `TTL ${ttl} ≈ 255 → network gear` };

const match = (rules: Rule[], text: string, src: string): Vote[] =>
  text
    ? rules.filter(([re]) => re.test(text)).map(([re, v]) => ({
      ...v,
      why: `${src} “${text.match(re)![0]}”`,
    }))
    : [];

/** Icon hints Samba/avahi publish as `model=`: not a real model. */
const FAKE_MODEL = /^(MacSamba|Xserve|RackMac)$/i;

const txtVal = (d: Device, keys: string[]): string => {
  for (const s of d.mdns) {
    for (const t of s.txt) {
      const [k, ...v] = t.split("=");
      const val = v.join("=");
      if (keys.includes(k.toLowerCase()) && val && !FAKE_MODEL.test(val)) {
        return val;
      }
    }
  }
  return "";
};

export const votes = (d: Device): Vote[] => {
  const open = new Set(d.ports.map((p) => p.port));
  const texts = d.ports.flatMap((
    p,
  ) => [
    p.banner,
    p.http?.server ?? "",
    p.http?.title ?? "",
    p.http?.cert ?? "",
  ]);
  if (d.upnp) {
    texts.push(
      d.upnp.server,
      d.upnp.manufacturer,
      d.upnp.model,
      d.upnp.friendlyName,
      d.upnp.deviceType,
    );
  }
  const model = txtVal(d, ["ty", "md", "model", "usb_mdl", "product", "fn"]) ||
    [d.upnp?.manufacturer, d.upnp?.model].filter(Boolean).join(" ");
  const v: Vote[] = [
    ...(d.gateway
      ? [{ kind: "router" as Kind, w: 8, why: "default gateway of this LAN" }]
      : []),
    ...(d.self
      ? [{
        kind: "computer" as Kind,
        os: d.os,
        w: 20,
        why: `this computer (${d.os})`,
      }]
      : []),
    ...VERSIONS.flatMap(([re, f]) =>
      texts.flatMap((
        t,
      ) => (t.match(re)
        ? [{ os: f(t.match(re)!), w: 6, why: `banner “${t.match(re)![0]}”` }]
        : [])
      )
    ),
    ...match(VENDOR, d.vendor, "MAC vendor"),
    ...d.mdns.flatMap((s) => match(MDNS, s.type, "mDNS service")),
    ...d.names.flatMap((n) => match(NAME, n, "name")),
    ...match(NAME, d.netbios, "NetBIOS"),
    ...PORTS.filter(([ps]) => ps.some((p) => open.has(p))).map(([ps, x]) => ({
      ...x,
      why: `open port ${ps.filter((p) => open.has(p)).join("/")}`,
    })),
    ...texts.flatMap((t) => match(TEXT, t, "fingerprint")),
    ...(d.upnp?.deviceType.match(/MediaRenderer/i)
      ? [{ kind: "tv" as Kind, w: 2, why: "UPnP MediaRenderer" }]
      : []),
    ...(d.upnp?.deviceType.match(/InternetGatewayDevice/i)
      ? [{ kind: "router" as Kind, w: 4, why: "UPnP InternetGatewayDevice" }]
      : []),
    ...(d.randomMac
      ? [{
        kind: "phone" as Kind,
        w: 1,
        why: "randomized (private) MAC → mobile OS",
      }]
      : []),
    ...(model
      ? match(NAME, model, "model").concat([{
        model,
        w: 5,
        why: `model “${model}”`,
      }])
      : []),
  ];
  const t = ttlOs(d.ttl);
  return t ? [...v, t] : v;
};

const top = <K extends string>(
  vs: Vote[],
  pick: (v: Vote) => K | undefined,
) => {
  const score = new Map<K, number>();
  for (const v of vs) {
    const k = pick(v);
    if (k) score.set(k, (score.get(k) ?? 0) + v.w);
  }
  const ranked = [...score].sort((a, b) => b[1] - a[1]);
  const total = ranked.reduce((a, [, s]) => a + s, 0);
  return {
    best: ranked[0]?.[0],
    share: total ? ranked[0][1] / total : 0,
    weight: ranked[0]?.[1] ?? 0,
  };
};

/** Specific OS beats a generic family label when both voted. */
/** Generic family → a specific vote; specific → its versioned form ("RouterOS" → "RouterOS 6.49.1"). */
const refineOs = (os: string | undefined, vs: Vote[]): string => {
  const all = vs.map((v) => v.os).filter((o): o is string => !!o);
  if (!os) return "";
  const generic = os.includes("/") || os === "Unix-like";
  const specific = generic
    ? all.find((o) =>
      !o.includes("/") && o !== "Unix-like" && !o.startsWith("Windows")
    )
    : os;
  const base = specific ?? os;
  const family = base.split(/[ (]/)[0];
  return all.filter((o) => o !== base && o.startsWith(family) && /\d/.test(o))
    .sort((a, b) => b.length - a.length)[0] ?? base;
};

export const identify = (
  d: Device,
): Pick<Device, "kind" | "os" | "model" | "evidence" | "confidence"> => {
  const vs = votes(d);
  const k = top(vs, (v) => v.kind);
  const os = top(vs, (v) => v.os);
  return {
    kind: k.best ?? "unknown",
    os: refineOs(os.best, vs),
    model: [...vs].sort((a, b) => b.w - a.w).find((v) => v.model)?.model ?? "",
    evidence: [...new Set(vs.map((v) => v.why))],
    confidence: Math.round(Math.min(1, k.weight / 8) * k.share * 100),
  };
};

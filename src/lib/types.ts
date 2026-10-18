// Shared data shapes — JSON only (they cross the wire and persist).

export type Kind =
  | "router"
  | "computer"
  | "laptop"
  | "phone"
  | "tablet"
  | "printer"
  | "nas"
  | "tv"
  | "speaker"
  | "camera"
  | "iot"
  | "server"
  | "vm"
  | "unknown";

export type Port = {
  port: number;
  service: string;
  banner: string;
  /** HTTP(S): page title, Server header, TLS cert subject. */
  http: { status: number; server: string; title: string; cert: string } | null;
};

export type Service = {
  type: string;
  name: string;
  port: number;
  txt: string[];
};

export type Upnp = {
  location: string;
  server: string;
  friendlyName: string;
  manufacturer: string;
  model: string;
  modelNumber: string;
  deviceType: string;
};

export type Device = {
  ip: string;
  mac: string;
  vendor: string;
  /** Locally administered MAC = randomized "private address" (phones, laptops). */
  randomMac: boolean;
  names: string[];
  ttl: number;
  rtt: number;
  ports: Port[];
  mdns: Service[];
  upnp: Upnp | null;
  netbios: string;
  self: boolean;
  gateway: boolean;
  kind: Kind;
  os: string;
  model: string;
  /** Why we believe kind/os/model — every signal, shown to the user. */
  evidence: string[];
  confidence: number;
  deepScanned: boolean;
  /** Answered in the latest scan; false = remembered from an earlier one. */
  online: boolean;
  seenAt: number;
};

export type Iface = { name: string; ip: string; cidr: number; mac: string };

export type Hop = {
  n: number;
  ip: string;
  host: string;
  asn: string;
  loss: number;
  avg: number;
  best: number;
  worst: number;
  zone: "lan" | "private" | "cgnat" | "public" | "unknown";
};

export type Local = {
  hostname: string;
  ifaces: Iface[];
  lan: Iface | null;
  gateway: string;
  /** Interface packets to the internet actually leave by (VPN shows here). */
  egress: string;
  dns: string[];
  publicIp: string;
  isp: string;
  location: string;
};

export type Phase =
  | "idle"
  | "local"
  | "discover"
  | "ports"
  | "identify"
  | "done"
  | "stopped"
  | "error";

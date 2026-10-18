// Test fixture: a blank device with overrides.
import type { Device } from "../src/lib/types.ts";

export const dev = (p: Partial<Device>): Device => ({
  ip: "192.168.1.9",
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
  seenAt: 0,
  ...p,
});

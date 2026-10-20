// Cells — the scan's whole truth lives here; the UI only reads it.
import { cell, type MethodDraftMeta, serverImport } from "aio";
import { identify } from "./lib/classify.ts";
import { ipToInt } from "./lib/parse.ts";
import { ALL_PORTS, QUICK_PORTS } from "./lib/ports.ts";
import type { Device, Hop, Local, Phase, Port } from "./lib/types.ts";

export type * from "./lib/types.ts";

export type NetState = {
  phase: Phase;
  progress: { done: number; total: number };
  /** IP of the device whose full 1–65535 scan is running, or "". */
  deep: string;
  local: Local | null;
  target: string;
  path: Hop[];
  devices: Device[];
  startedAt: number;
  finishedAt: number;
  error: string;
  /** This build, `major.minor.build` — read from the server at start. */
  appVersion: string;
};

type S = NetState & MethodDraftMeta;
type IO = typeof import("./scan.server.ts");
/** Server-only probes; tests swap them via bootCells({ stub }).
 *  NETMAP_DEMO=1 scans a made-up network instead (demos, screenshots). */
const scanner = async () => {
  const io = await serverImport<IO>("./scan.server.ts", import.meta.url);
  return io.demo() ? serverImport<IO>("./demo.server.ts", import.meta.url) : io;
};

const byIp = (a: Device, b: Device) => ipToInt(a.ip) - ipToInt(b.ip);

/** Fresh results win; devices seen before but silent now stay, marked offline. */
export const merge = (prev: Device[], found: Device[]): Device[] => {
  const ips = new Set(found.map((d) => d.ip));
  return [
    ...found,
    ...prev.filter((p) => !ips.has(p.ip)).map((p) => ({ ...p, online: false })),
  ].sort(byIp);
};

export const mergePorts = (a: Port[], b: Port[]): Port[] =>
  [...new Map([...a, ...b].map((p) => [p.port, p])).values()].sort((x, y) =>
    x.port - y.port
  );

const uniqNames = (names: string[]): string[] => {
  const seen = new Set<string>();
  return names.filter((n) =>
    n && !seen.has(n.toLowerCase()) && seen.add(n.toLowerCase())
  );
};

const put = (s: S, d: Device) => {
  const i = s.devices.findIndex((x) => x.ip === d.ip);
  if (i < 0) s.devices.push(d);
  else s.devices[i] = d;
};

const withId = (d: Device): Device => ({ ...d, ...identify(d) });

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
const isHost = (v: unknown) =>
  (typeof v === "string" &&
    (IPV4.test(v.trim()) || /^[a-z0-9.-]{1,253}$/i.test(v.trim()))) ||
  "IPv4 address or host name required";

export const net = cell("net", {
  version: 2,
  onMigrate: (s) => ({ ...s, appVersion: s.appVersion ?? "" }),
  state: {
    phase: "idle",
    progress: { done: 0, total: 0 },
    deep: "",
    local: null,
    target: "1.1.1.1",
    path: [],
    devices: [],
    startedAt: 0,
    finishedAt: 0,
    error: "",
    appVersion: "",
  } as NetState,
  // A restart kills any scan in flight; never restore a "running" look.
  persist: { exclude: ["phase", "progress", "deep", "appVersion"] },
  args: {
    deepScan: [
      (v) => (typeof v === "string" && IPV4.test(v)) || "IPv4 address required",
    ],
    setTarget: [isHost],
  },
  long: ["scan", "deepScan"],
  cancelOn: {
    scan: ["self", "net:stop"],
    deepScan: ["self", "net:stop", "net:scan"],
  },
  methods: {
    /** Full picture: this host → path to the internet → every LAN device + its ports.
     *  Re-reads s.devices after awaits on purpose: merges with the latest list. */
    // aio-ok
    async scan(s: S) {
      const target = s.target;
      const io = await scanner();
      if (s.$signal.aborted) return;
      s.phase = "local";
      s.error = "";
      s.deep = "";
      s.startedAt = Date.now();
      s.progress = { done: 0, total: 0 };
      try {
        const l = await io.local();
        if (s.$signal.aborted) return;
        s.local = l;
        s.path = [];
        const tracing = io.trace(target, s.$signal).then((h) => {
          if (!s.$signal.aborted) s.path = h;
        });
        s.phase = "discover";
        const found = await io.discover(l, s.$signal, (done, total) => {
          if (!s.$signal.aborted) s.progress = { done, total };
        });
        if (s.$signal.aborted) return;
        // Plain copy: draft refs follow their path, so they'd read the merged list.
        const before = new Map(
          s.devices.map((
            d,
          ) => [d.ip, {
            deepScanned: d.deepScanned,
            ports: JSON.parse(JSON.stringify(d.ports)) as Port[],
          }]),
        );
        s.devices = merge(s.devices, found.map(withId));
        s.phase = "ports";
        s.progress = { done: 0, total: found.length };
        await io.pool(found, 6, async (d) => {
          const [ports, netbios, rname] = await Promise.all([
            io.scanPorts(d.ip, QUICK_PORTS, { conc: 48, ms: 800 }, s.$signal),
            io.netbios(d.ip),
            io.reverseName(d.ip),
          ]);
          if (s.$signal.aborted) return;
          const prev = before.get(d.ip);
          put(
            s,
            withId({
              ...d,
              ports: prev?.deepScanned ? mergePorts(prev.ports, ports) : ports,
              deepScanned: prev?.deepScanned ?? false,
              netbios,
              names: uniqNames([...d.names, rname, netbios]),
            }),
          );
          s.progress = { done: s.progress.done + 1, total: found.length };
        }, s.$signal);
        if (s.$signal.aborted) return;
        s.phase = "identify";
        await tracing;
        if (s.$signal.aborted) return;
        s.phase = "done";
        s.finishedAt = Date.now();
      } catch (e) {
        if (s.$signal.aborted) return;
        s.phase = "error";
        s.error = e instanceof Error ? e.message : String(e);
      }
    },

    /** All 65 535 TCP ports of one device. Reads the device fresh after the scan on purpose. */
    // aio-ok
    async deepScan(s: S, ip: string) {
      const io = await scanner();
      if (s.$signal.aborted) return;
      if (!s.devices.some((d) => d.ip === ip)) {
        throw new Error(`no device ${ip}`);
      }
      s.deep = ip;
      s.progress = { done: 0, total: ALL_PORTS.length };
      const ports = await io.scanPorts(
        ip,
        ALL_PORTS,
        { conc: 600, ms: 700 },
        s.$signal,
        (done) => {
          if (!s.$signal.aborted) {
            s.progress = { done, total: ALL_PORTS.length };
          }
        },
      );
      if (s.$signal.aborted) return;
      const d = s.devices.find((x) => x.ip === ip);
      if (d) {
        put(
          s,
          withId({
            ...d,
            ports: mergePorts(d.ports, ports),
            deepScanned: true,
          }),
        );
      }
      s.deep = "";
      s.progress = { done: 0, total: 0 };
    },

    /** Stop button — cancelOn aborts the running scan; this resets the look at once. */
    stop(s: NetState) {
      if (s.phase !== "done" && s.phase !== "idle") s.phase = "stopped";
      s.deep = "";
    },

    setTarget(s: NetState, target: string) {
      s.target = target.trim();
    },

    /** Called at start: the version this running build reports. */
    async loadVersion(s: S) {
      const io = await serverImport<IO>("./scan.server.ts", import.meta.url);
      s.appVersion = await io.version();
    },

    forgetOffline(s: NetState) {
      s.devices = s.devices.filter((d) => d.online);
    },
  },
  selectors: {
    online: (s: NetState) => s.devices.filter((d) => d.online).length,
    openPorts: (s: NetState) =>
      s.devices.reduce((a, d) => a + d.ports.length, 0),
    busy: (s: NetState) =>
      !["idle", "done", "stopped", "error"].includes(s.phase),
  },
});

export type Tab = "path" | "map" | "devices" | "about";

/** Per-window UI: active tab + selected element ("<ip>" device, "hop:<n>", "internet", "vpn").
 *  Never synced, never persisted. */
export const view = cell("view", {
  scope: "client",
  state: { tab: "map" as Tab, selected: "" },
  methods: {
    select(s, id: string) {
      s.selected = s.selected === id ? "" : id;
    },
    setTab(s, tab: Tab) {
      s.tab = tab;
    },
  },
});

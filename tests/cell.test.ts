import { assertEquals } from "@std/assert";
import { bootCells, testCell } from "aio/testing";
import { merge, mergePorts, net, view } from "../src/cell.ts";
import type { Device, Local, Port } from "../src/lib/types.ts";
import { dev } from "./fixtures.ts";

const local: Local = {
  hostname: "host1",
  ifaces: [],
  lan: { name: "eth0", ip: "10.0.0.5", cidr: 24, mac: "9c:6b:00:00:00:01" },
  gateway: "10.0.0.1",
  egress: "eth0",
  dns: ["10.0.0.1"],
  publicIp: "1.2.3.4",
  isp: "AS1 Test",
  location: "Here",
};
const port = (n: number, banner = ""): Port => ({
  port: n,
  service: "",
  banner,
  http: null,
});

/** Offline stand-in for scan.server.ts: same exports the cell uses, canned answers. */
const fakeIo = (found: Device[]) => ({
  demo: () => false,
  local: () => Promise.resolve(local),
  trace: () =>
    Promise.resolve([{
      n: 1,
      ip: "10.0.0.1",
      host: "gw",
      asn: "",
      loss: 0,
      avg: 1,
      best: 1,
      worst: 1,
      zone: "private" as const,
    }]),
  discover: () => Promise.resolve(found),
  pool: async <T, R>(xs: T[], _n: number, fn: (x: T) => Promise<R>) => {
    const out: R[] = [];
    for (const x of xs) out.push(await fn(x));
    return out;
  },
  scanPorts: (ip: string, ports: number[]) =>
    Promise.resolve(
      ip === "10.0.0.1"
        ? [port(8291), ...(ports.length > 1000 ? [port(60000)] : [])]
        : [],
    ),
  netbios: (ip: string) =>
    Promise.resolve(ip === "10.0.0.7" ? "DESKTOP-7" : ""),
  reverseName: (ip: string) =>
    Promise.resolve(ip === "10.0.0.1" ? "router.lan" : ""),
});

Deno.test("scan: local → discover → ports → identify → path", async () => {
  const found = [
    dev({ ip: "10.0.0.1", gateway: true, ttl: 64 }),
    dev({ ip: "10.0.0.7", ttl: 128 }),
  ];
  await using _h = await bootCells([net], {
    stub: { "./scan.server.ts": fakeIo(found) },
  });
  await net.scan();
  assertEquals(net.phase, "done");
  assertEquals(net.local?.publicIp, "1.2.3.4");
  assertEquals(net.path.length, 1);
  const [gw, pc] = net.devices;
  assertEquals([gw.kind, gw.os, gw.names], ["router", "RouterOS", [
    "router.lan",
  ]]);
  assertEquals([pc.netbios, pc.os], ["DESKTOP-7", "Windows"]);
  assertEquals(net.online(), 2);
  assertEquals(net.openPorts(), 1);

  await net.deepScan("10.0.0.1");
  assertEquals(net.devices[0].ports.map((p) => p.port), [8291, 60000]);
  assertEquals([net.devices[0].deepScanned, net.deep], [true, ""]);
});

Deno.test("scan: ports from a full scan survive a quick rescan", async () => {
  await using _h = await bootCells([net], {
    stub: {
      "./scan.server.ts": fakeIo([dev({ ip: "10.0.0.1", gateway: true })]),
    },
  });
  await net.scan();
  await net.deepScan("10.0.0.1");
  await net.scan(); // deep-scanned ports survive a quick rescan
  assertEquals(net.devices[0].ports.map((p) => p.port), [8291, 60000]);
});

testCell(net, "setTarget, stop, forgetOffline, argument guards", async (t) => {
  t.init({
    devices: [dev({ ip: "10.0.0.2" }), dev({ ip: "10.0.0.3", online: false })],
    phase: "ports",
  });
  t.send.setTarget(" 8.8.8.8 ");
  t.expect.state((s) => s.target === "8.8.8.8");
  t.send.stop();
  t.expect.state((s) => s.phase === "stopped" && s.deep === "");
  t.send.forgetOffline();
  t.expect.state((s) =>
    s.devices.length === 1 && s.devices[0].ip === "10.0.0.2"
  );
  await t.expect.rejects(() => t.send.deepScan("not-an-ip"), /IPv4/);
  await t.expect.rejects(() => t.send.setTarget("bad host!"), /host name/);
  await t.expect.rejects(() => t.send.deepScan("10.9.9.9"), /no device/);
});

testCell(view, "select toggles", (t) => {
  t.send.select("10.0.0.2");
  t.expect.state((s) => s.selected === "10.0.0.2");
  t.send.select("10.0.0.2");
  t.expect.state((s) => s.selected === "");
});

Deno.test("merge + mergePorts are pure and ordered", () => {
  const m = merge([dev({ ip: "10.0.0.20" }), dev({ ip: "10.0.0.3" })], [
    dev({ ip: "10.0.0.3", vendor: "new" }),
    dev({ ip: "10.0.0.100" }),
  ]);
  assertEquals(m.map((d) => [d.ip, d.online, d.vendor]), [
    ["10.0.0.3", true, "new"],
    ["10.0.0.20", false, ""],
    ["10.0.0.100", true, ""],
  ]);
  assertEquals(
    mergePorts([port(80), port(22)], [port(22, "SSH"), port(443)]).map((
      p,
    ) => [p.port, p.banner]),
    [[22, "SSH"], [80, ""], [443, ""]],
  );
});

Deno.test("demo mode: a made-up network, fully identified", async () => {
  await using _h = await bootCells([net], {
    stub: { "./scan.server.ts": { ...fakeIo([]), demo: () => true } },
  });
  await net.scan();
  const kinds = new Set(net.devices.map((d) => d.kind));
  assertEquals(net.phase, "done");
  assertEquals(net.local?.publicIp, "203.0.113.42");
  assertEquals(net.path.at(-1)?.ip, net.target);
  assertEquals(net.devices.find((d) => d.gateway)?.kind, "router");
  assertEquals(
    ["printer", "nas", "phone", "tv", "speaker", "camera", "iot"].filter((
      k,
    ) => !kinds.has(k as Device["kind"])),
    [],
  );
});

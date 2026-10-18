import { assertEquals } from "@std/assert";
import { identify } from "../src/lib/classify.ts";
import {
  hostsOf,
  isRandomMac,
  parseAvahi,
  parseCurl,
  parseMtr,
  parseNeigh,
  parseNmb,
  parseOuiCsv,
  parsePing,
  parseUpnp,
  unescapeAvahi,
  vendorOf,
  zoneOf,
} from "../src/lib/parse.ts";
import { label, layout, snake } from "../src/lib/view.ts";
import { IDENTITY, pan, wheelFactor, zoomAt } from "../src/lib/zoom.ts";
import { dev } from "./fixtures.ts";

Deno.test("hostsOf: /24 = 254 hosts; wide nets shrink to /22 around the ip", () => {
  const h = hostsOf("192.168.1.50", 24);
  assertEquals([h.length, h[0], h.at(-1)], [
    254,
    "192.168.1.1",
    "192.168.1.254",
  ]);
  assertEquals(hostsOf("10.8.0.2", 16).length, 1022);
  assertEquals(hostsOf("10.8.0.2", 16)[0], "10.8.0.1");
});

Deno.test("zoneOf", () => {
  assertEquals(
    ["10.0.0.1", "172.20.1.1", "100.64.3.3", "8.8.8.8", "???"].map(zoneOf),
    ["private", "private", "cgnat", "public", "unknown"],
  );
});

Deno.test("parseMtr: ips, names, ASN, silent hops", () => {
  const hops = parseMtr(JSON.stringify({
    report: {
      hubs: [
        {
          count: 1,
          host: "10.8.0.1",
          ASN: "AS???",
          "Loss%": 0,
          Avg: 48.2,
          Best: 47,
          Wrst: 50,
        },
        {
          count: 2,
          host: "???",
          ASN: "AS???",
          "Loss%": 100,
          Avg: 0,
          Best: 0,
          Wrst: 0,
        },
        {
          count: 3,
          host: "one.one.one.one (1.1.1.1)",
          ASN: "AS13335",
          "Loss%": 0,
          Avg: 60,
          Best: 59,
          Wrst: 61,
        },
      ],
    },
  }));
  assertEquals(hops.map((h) => [h.ip, h.host, h.asn, h.zone]), [
    ["10.8.0.1", "", "", "private"],
    ["", "", "", "unknown"],
    ["1.1.1.1", "one.one.one.one", "AS13335", "public"],
  ]);
});

Deno.test("avahi: decimal escapes, services and TXT per ip", () => {
  assertEquals(
    unescapeAvahi("Sam\\226\\128\\153s\\032MacBook"),
    "Sam’s MacBook",
  );
  const m = parseAvahi([
    "+;eth0;IPv4;x;_ipp._tcp;local",
    '=;eth0;IPv4;Brother\\032HL;Internet Printer;local;PRINTER1.local;192.168.1.90;631;"ty=Brother HL-L2350DW" "rp=ipp/print"',
    "=;eth0;IPv4;Brother\\032HL;Web Site;local;PRINTER1.local;192.168.1.90;80;",
    "=;eth0;IPv6;Brother\\032HL;Web Site;local;PRINTER1.local;fe80::1;80;",
  ].join("\n"));
  const p = m.get("192.168.1.90")!;
  assertEquals(m.size, 1);
  assertEquals(p.names, ["PRINTER1", "Brother HL"]);
  assertEquals(p.services.map((s) => [s.type, s.port]), [[
    "Internet Printer",
    631,
  ], ["Web Site", 80]]);
  assertEquals(p.services[0].txt, ["ty=Brother HL-L2350DW", "rp=ipp/print"]);
});

Deno.test("ping, nmblookup, neigh, curl, upnp parsers", () => {
  assertEquals(
    parsePing("64 bytes from 192.168.1.1: icmp_seq=1 ttl=64 time=0.412 ms"),
    { ttl: 64, rtt: 0.412 },
  );
  assertEquals(parsePing("1 packets transmitted, 0 received"), null);
  assertEquals(
    parseNmb(
      "Looking up status\n\tNAS1         <00> -         B <ACTIVE> \n\tWORKGROUP <00> - <GROUP> B <ACTIVE>",
    ),
    "NAS1",
  );
  const n = parseNeigh(JSON.stringify([
    { dst: "192.168.1.1", lladdr: "4C:5E:0C:00:00:01", state: ["REACHABLE"] },
    { dst: "192.168.1.7", lladdr: "aa:bb:cc:dd:ee:ff", state: ["FAILED"] },
    { dst: "192.168.1.8", state: ["INCOMPLETE"] },
  ]));
  assertEquals([...n], [["192.168.1.1", "4c:5e:0c:00:00:01"]]);
  const c = parseCurl(
    "HTTP/1.1 301 Moved\r\nServer: a\r\n\r\nHTTP/1.1 200 OK\r\nServer: nginx\r\n\r\n<html><title>\n Router  Login </title>",
    "*  subject: CN=router.lan\n",
  );
  assertEquals(c, {
    status: 200,
    server: "a",
    title: "Router Login",
    cert: "CN=router.lan",
  });
  const u = parseUpnp(
    "http://x/d.xml",
    "Linux UPnP/1.0",
    "<root><device><deviceType>urn:schemas-upnp-org:device:MediaRenderer:1</deviceType><friendlyName>Living TV</friendlyName><manufacturer>LG</manufacturer><modelName>OLED55</modelName></device></root>",
  );
  assertEquals([u.friendlyName, u.manufacturer, u.model, u.deviceType], [
    "Living TV",
    "LG",
    "OLED55",
    "MediaRenderer:1",
  ]);
});

Deno.test("OUI: longest registered prefix wins; quoted org names", () => {
  const oui = parseOuiCsv(
    'Registry,Assignment,Organization Name,Organization Address\nMA-L,2CCF67,"Raspberry Pi (Trading) Ltd","x"\nMA-L,70B3D5,IEEE Registration Authority,x\nMA-S,70B3D5123,"Tiny, Inc.",x\n',
  );
  assertEquals(
    vendorOf(oui, "2c:cf:67:00:00:01"),
    "Raspberry Pi (Trading) Ltd",
  );
  assertEquals(vendorOf(oui, "70:b3:d5:12:34:56"), "Tiny, Inc.");
  assertEquals(vendorOf(oui, "00:00:00:00:00:01"), "");
  assertEquals([
    isRandomMac("96:00:00:00:00:01"),
    isRandomMac("4c:5e:0c:00:00:01"),
    isRandomMac(""),
  ], [true, false, false]);
});

Deno.test("identify: MikroTik gateway with version from a banner", () => {
  const r = identify(dev({
    gateway: true,
    vendor: "Routerboard.com",
    ttl: 64,
    ports: [{
      port: 21,
      service: "ftp",
      banner: "220 MikroTik FTP server (MikroTik 7.14.3) ready",
      http: null,
    }, { port: 8291, service: "winbox", banner: "", http: null }],
  }));
  assertEquals([r.kind, r.os, r.model, r.confidence], [
    "router",
    "RouterOS 7.14.3",
    "MikroTik RouterBOARD",
    100,
  ]);
});

Deno.test("identify: printer from mDNS, Debian NAS from SSH, Windows PC, phone from private MAC", () => {
  const printer = identify(
    dev({
      mdns: [{
        type: "Internet Printer",
        name: "x",
        port: 631,
        txt: ["ty=Brother HL-L2350DW"],
      }],
      ports: [{ port: 9100, service: "jetdirect", banner: "", http: null }],
    }),
  );
  assertEquals([printer.kind, printer.model], [
    "printer",
    "Brother HL-L2350DW",
  ]);
  const nas = identify(
    dev({
      names: ["nas1"],
      ttl: 64,
      ports: [{
        port: 22,
        service: "ssh",
        banner: "SSH-2.0-OpenSSH_9.2p1 Debian-2+deb12u6",
        http: null,
      }, { port: 445, service: "smb", banner: "", http: null }],
    }),
  );
  assertEquals([nas.kind, nas.os], ["nas", "Linux (Debian 12)"]);
  const win = identify(
    dev({
      ttl: 128,
      ports: [{
        port: 22,
        service: "ssh",
        banner: "SSH-2.0-OpenSSH_for_Windows_9.5",
        http: null,
      }],
    }),
  );
  assertEquals([win.kind, win.os], ["computer", "Windows 10/11"]);
  const phone = identify(dev({ randomMac: true, ttl: 64 }));
  assertEquals([phone.kind, phone.os], ["phone", "Unix-like"]);
  assertEquals(identify(dev({})).kind, "unknown");
});

Deno.test("label + layout: gateway centred, gear inside, rest outside", () => {
  assertEquals(label(dev({ names: ["Android_X", "pixel"] })), "pixel");
  assertEquals(
    label(dev({ vendor: "Raspberry Pi (Trading) Ltd" })),
    "Raspberry device",
  );
  assertEquals(label(dev({})), "192.168.1.9");
  const nodes = layout(
    [
      dev({ ip: "10.0.0.1", gateway: true, kind: "router" }),
      dev({ ip: "10.0.0.2", kind: "router" }),
      dev({ ip: "10.0.0.3", kind: "phone" }),
    ],
    1000,
    700,
  );
  assertEquals(nodes.map((n) => [n.ip, n.ring]), [["10.0.0.1", 0], [
    "10.0.0.2",
    1,
  ], ["10.0.0.3", 2]]);
  assertEquals([nodes[0].x, Math.round(nodes[0].y)], [500, 364]);
});

Deno.test("zoom: point under cursor stays put; clamped; pan; wheel direction", () => {
  const c = zoomAt(IDENTITY, 2, 100, 50);
  assertEquals(c, { k: 2, x: -100, y: -50 });
  assertEquals([100 * c.k + c.x, 50 * c.k + c.y], [100, 50]); // world (100,50) still at screen (100,50)
  assertEquals(zoomAt(IDENTITY, 100, 0, 0).k, 8);
  assertEquals(zoomAt(IDENTITY, 0.001, 0, 0).k, 0.25);
  assertEquals(pan(c, 5, -5), { k: 2, x: -95, y: -55 });
  assertEquals([wheelFactor(-100) > 1, wheelFactor(100) < 1, wheelFactor(0)], [
    true,
    true,
    1,
  ]);
});

Deno.test("snake: rows alternate direction", () => {
  assertEquals(snake(5, 2, 10, 20, 0).map((p) => [p.x, p.y]), [
    [5, 10],
    [15, 10],
    [15, 30],
    [5, 30],
    [5, 50],
  ]);
});

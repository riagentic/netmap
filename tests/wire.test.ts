import { assertEquals } from "@std/assert";
import {
  A,
  dnsQuery,
  dnsRecords,
  mdnsFollowUps,
  mdnsHosts,
  META,
  nbstatName,
  nbstatQuery,
  PTR,
  type Rec,
  SRV,
  TXT,
} from "../src/lib/wire.ts";

const enc = (s: string) => [...new TextEncoder().encode(s)];
const name = (n: string) => [
  ...n.split(".").flatMap((l) => [enc(l).length, ...enc(l)]),
  0,
];
const u16 = (n: number) => [n >> 8, n & 255];
const rr = (n: number[], type: number, data: number[]) => [
  ...n,
  ...u16(type),
  ...u16(0x8001), // IN + cache-flush bit
  0,
  0,
  0,
  120,
  ...u16(data.length),
  ...data,
];

/** A reply: PTR answer, then A, SRV (target via a compression pointer), TXT. */
const reply = (() => {
  const head = [0, 0, 0x84, 0, ...u16(0), ...u16(1), ...u16(0), ...u16(3)];
  const instance = [
    14,
    ...enc("Office Printer"),
    ...name("_ipp._tcp.local"),
  ];
  const ptr = rr(name("_ipp._tcp.local"), PTR, instance);
  const aAt = head.length + ptr.length;
  const a = rr(name("printer1.local"), A, [192, 168, 1, 12]);
  const srv = rr(instance, SRV, [0, 0, 0, 0, ...u16(631), 0xc0, aAt]);
  const txt = rr(instance, TXT, [
    10,
    ...enc("ty=HP M234"),
    12,
    ...enc("rp=ipp/print"),
  ]);
  return new Uint8Array([...head, ...ptr, ...a, ...srv, ...txt]);
})();

Deno.test("dnsQuery: one question, instance names keep their dots", () => {
  const q = dnsQuery([["My.Printer._ipp._tcp.local", SRV]]);
  assertEquals([...q.subarray(0, 6)], [0, 0, 0, 0, 0, 1]);
  assertEquals(q[12], 10); // "My.Printer" is ONE label
  assertEquals(new TextDecoder().decode(q.subarray(13, 23)), "My.Printer");
  assertEquals([...q.subarray(-4)], [0, SRV, 0, 1]);
});

Deno.test("dnsRecords: PTR, A, SRV via compression pointer, TXT", () => {
  const recs = dnsRecords(reply);
  assertEquals(recs.map((r) => [r.type, r.name]), [
    [PTR, "_ipp._tcp.local"],
    [A, "printer1.local"],
    [SRV, "Office Printer._ipp._tcp.local"],
    [TXT, "Office Printer._ipp._tcp.local"],
  ]);
  assertEquals(recs[2].data, { port: 631, target: "printer1.local" });
  assertEquals(recs[3].data, ["ty=HP M234", "rp=ipp/print"]);
  assertEquals(dnsRecords(new Uint8Array([1, 2, 3])), []);
});

Deno.test("mdnsHosts: ip → names + friendly service; falls back to the sender", () => {
  const recs = dnsRecords(reply);
  const h = mdnsHosts(recs).get("192.168.1.12")!;
  assertEquals(h.names, ["printer1", "Office Printer"]);
  assertEquals(h.services, [{
    type: "Internet Printer",
    name: "Office Printer",
    port: 631,
    txt: ["ty=HP M234", "rp=ipp/print"],
  }]);
  const noA = recs.filter((r) => r.type !== A);
  assertEquals([...mdnsHosts(noA, "192.168.1.99").keys()], ["192.168.1.99"]);
});

Deno.test("mdnsFollowUps: types → instances → SRV/TXT → A, each asked once", () => {
  const asked = new Set<string>();
  const recs: Rec[] = [
    { name: META, type: PTR, data: "_hap._tcp.local" },
    { name: "_hap._tcp.local", type: PTR, data: "Lamp._hap._tcp.local" },
    {
      name: "Plug._hap._tcp.local",
      type: SRV,
      data: { target: "plug.local", port: 80 },
    },
  ];
  assertEquals(mdnsFollowUps(recs, asked), [
    ["_hap._tcp.local", PTR],
    ["Lamp._hap._tcp.local", SRV],
    ["Lamp._hap._tcp.local", TXT],
    ["plug.local", A],
  ]);
  assertEquals(mdnsFollowUps(recs, asked), []);
});

Deno.test("NetBIOS: NBSTAT query for '*'; reply → unique workstation name", () => {
  const q = nbstatQuery(0x1234);
  assertEquals([q.length, q[0], q[1], q[12]], [50, 0x12, 0x34, 32]);
  assertEquals(new TextDecoder().decode(q.subarray(13, 15)), "CK"); // "*"
  const entry = (n: string, suffix: number, flags: number) => [
    ...enc(n.padEnd(15)),
    suffix,
    ...u16(flags),
  ];
  const rdata = [
    3,
    ...entry("WORKGROUP", 0x00, 0x8400),
    ...entry("NAS1", 0x20, 0x0400),
    ...entry("NAS1", 0x00, 0x0400),
  ];
  const r = new Uint8Array([
    0x12,
    0x34,
    0x84,
    0,
    ...u16(0),
    ...u16(1),
    ...u16(0),
    ...u16(0),
    ...q.subarray(12, 46),
    ...u16(33),
    ...u16(1),
    0,
    0,
    0,
    0,
    ...u16(rdata.length),
    ...rdata,
  ]);
  assertEquals(nbstatName(r), "NAS1");
  assertEquals(nbstatName(new Uint8Array(4)), "");
});

import { assertEquals } from "@std/assert";
import {
  cymruAsn,
  normMac,
  osName,
  parseArp,
  parseNetstat,
  parsePing,
  parseRouteGet,
  parseScutil,
  parseTraceroute,
  parseTracert,
  parseWinNet,
  pingArgs,
  reversed,
  VIRTUAL,
} from "../src/lib/sys.ts";

Deno.test("ping: args per OS; replies in any OS and language", () => {
  assertEquals(pingArgs("windows", "1.2.3.4"), [
    "-n",
    "1",
    "-w",
    "1000",
    "1.2.3.4",
  ]);
  assertEquals(pingArgs("darwin", "1.2.3.4").slice(3, 5), ["-W", "1000"]);
  assertEquals(pingArgs("linux", "1.2.3.4").slice(3, 5), ["-W", "1"]);
  const cases: [string, { ttl: number; rtt: number } | null][] = [
    ["64 bytes from 192.168.1.1: icmp_seq=1 ttl=64 time=0.412 ms", {
      ttl: 64,
      rtt: 0.412,
    }],
    ["64 bytes from 192.168.1.1: icmp_seq=0 ttl=255 time=3.481 ms", {
      ttl: 255,
      rtt: 3.481,
    }],
    ["Reply from 192.168.1.1: bytes=32 time<1ms TTL=64", { ttl: 64, rtt: 1 }],
    ["Antwort von 192.168.1.1: Bytes=32 Zeit=3ms TTL=128", {
      ttl: 128,
      rtt: 3,
    }],
    ["Reply from 192.168.1.20: Destination host unreachable.", null],
    ["1 packets transmitted, 0 received, 100% packet loss", null],
  ];
  for (const [text, want] of cases) assertEquals(parsePing(text), want);
});

Deno.test("arp: Windows and macOS tables → ip → mac; broadcast/multicast/incomplete dropped", () => {
  const win = `
Interface: 192.168.1.20 --- 0x7
  Internet Address      Physical Address      Type
  192.168.1.1           3c-a6-2f-00-00-01     dynamic
  192.168.1.12          F4-39-09-00-00-12     dynamic
  192.168.1.255         ff-ff-ff-ff-ff-ff     static
  224.0.0.22            01-00-5e-00-00-16     static`;
  assertEquals([...parseArp(win)], [
    ["192.168.1.1", "3c:a6:2f:00:00:01"],
    ["192.168.1.12", "f4:39:09:00:00:12"],
  ]);
  const mac = `? (192.168.1.1) at 3c:a6:2f:0:0:1 on en0 ifscope [ethernet]
? (192.168.1.12) at (incomplete) on en0 ifscope [ethernet]
? (224.0.0.251) at 1:0:5e:0:0:fb on en0 ifscope permanent [ethernet]`;
  assertEquals([...parseArp(mac)], [["192.168.1.1", "3c:a6:2f:00:00:01"]]);
  assertEquals(normMac("0:11:32:A:b:c"), "00:11:32:0a:0b:0c");
  assertEquals(normMac("not-a-mac"), "");
});

Deno.test("macOS: default routes skip link# tunnels; route get; scutil DNS", () => {
  const netstat = `Routing tables

Internet:
Destination        Gateway            Flags               Netif Expire
default            link#22            UCSIg               utun3
default            192.168.1.1        UGScg                 en0
127                127.0.0.1          UCS                   lo0`;
  assertEquals(parseNetstat(netstat), [{ gw: "192.168.1.1", dev: "en0" }]);
  assertEquals(
    parseRouteGet(
      "   route to: 1.1.1.1\ndestination: default\n    gateway: 192.168.1.1\n  interface: utun3\n",
    ),
    "utun3",
  );
  const scutil = `DNS configuration

resolver #1
  search domain[0] : fritz.box
  nameserver[0] : 192.168.1.1
  nameserver[1] : fd00::1
  if_index : 6 (en0)

resolver #2
  domain   : local
  nameserver[0] : 192.168.1.1`;
  assertEquals(parseScutil(scutil), ["192.168.1.1"]);
});

Deno.test("Windows: PowerShell route/DNS JSON, single object or array", () => {
  assertEquals(
    parseWinNet(
      '{"routes":[{"gw":"192.168.1.1","ip":"192.168.1.20","name":"Wi-Fi"},{"gw":"0.0.0.0","ip":"10.8.0.2","name":"NordLynx"}],"egress":"10.8.0.2","dns":["192.168.1.1","192.168.1.1","fe80::1"]}',
    ),
    {
      routes: [{ gw: "192.168.1.1", ip: "192.168.1.20", name: "Wi-Fi" }],
      egress: "10.8.0.2",
      dns: ["192.168.1.1"],
    },
  );
  assertEquals(
    parseWinNet(
      '{"routes":{"gw":"192.168.1.1","ip":"192.168.1.20","name":"Ethernet"},"egress":"192.168.1.20","dns":"192.168.1.1"}',
    ).routes.length,
    1,
  );
  assertEquals(parseWinNet(""), { routes: [], egress: "", dns: [] });
  assertEquals(
    ["Wi-Fi", "Ethernet", "en0", "eth0", "wlan0"].some((n) => VIRTUAL.test(n)),
    false,
  );
  assertEquals(
    ["NordLynx", "vEthernet (WSL)", "utun3", "awdl0", "wg0", "Loopback"].every((
      n,
    ) => VIRTUAL.test(n)),
    true,
  );
});

Deno.test("traceroute (macOS/Linux) and tracert (Windows) → hops", () => {
  const tr = `traceroute to 1.1.1.1 (1.1.1.1), 20 hops max, 60 byte packets
 1  192.168.1.1  0.512 ms  0.401 ms  0.389 ms
 2  * * *
 3  198.51.100.17  9.1 ms *  9.9 ms
 4  198.51.100.130  13.0 ms 198.51.100.131  14.0 ms  15.0 ms`;
  const h = parseTraceroute(tr);
  assertEquals(h.map((x) => [x.n, x.ip, x.loss, x.best, x.worst, x.zone]), [
    [1, "192.168.1.1", 0, 0.389, 0.512, "private"],
    [2, "", 100, 0, 0, "unknown"],
    [3, "198.51.100.17", 33, 9.1, 9.9, "public"],
    [4, "198.51.100.130", 0, 13, 15, "public"],
  ]);
  const win = `
Tracing route to one.one.one.one [1.1.1.1]
over a maximum of 20 hops:

  1    <1 ms    <1 ms    <1 ms  192.168.1.1
  2     *        *        *     Request timed out.
  3     9 ms    10 ms     8 ms  198.51.100.17
  4    15 ms     *       14 ms  1.1.1.1

Trace complete.`;
  assertEquals(
    parseTracert(win).map((x) => [x.n, x.ip, x.loss, x.avg, x.zone]),
    [
      [1, "192.168.1.1", 0, 1, "private"],
      [2, "", 100, 0, "unknown"],
      [3, "198.51.100.17", 0, 9, "public"],
      [4, "1.1.1.1", 33, 14.5, "public"],
    ],
  );
});

Deno.test("ASN via Cymru TXT; reverse names; OS names", () => {
  assertEquals(
    cymruAsn("13335 | 1.1.1.0/24 | US | apnic | 2011-08-11"),
    "AS13335",
  );
  assertEquals(cymruAsn(""), "");
  assertEquals(
    reversed("1.2.3.4", "in-addr.arpa"),
    "4.3.2.1.in-addr.arpa",
  );
  assertEquals(osName("windows", "10.0.22631", ""), "Windows 11");
  assertEquals(osName("windows", "10.0.19045", ""), "Windows 10");
  assertEquals(osName("darwin", "24.1.0", "15.1\n"), "macOS 15.1");
  assertEquals(
    osName("linux", "6.8.0", 'NAME="Ubuntu"\nPRETTY_NAME="Ubuntu 24.04 LTS"\n'),
    "Ubuntu 24.04 LTS",
  );
});

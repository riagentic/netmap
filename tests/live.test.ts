// Real probes on the real OS — only with NETMAP_LIVE=1 (CI runs it on Linux,
// macOS and Windows). Asserts what every network has; logs the rest.
import { assert, assertMatch } from "@std/assert";
import { discover, local, run, trace } from "../src/scan.server.ts";
import { type Os, parsePing, pingArgs } from "../src/lib/sys.ts";

const live = Deno.env.get("NETMAP_LIVE") === "1";
const OS = Deno.build.os as Os;
const IP = /^\d{1,3}(\.\d{1,3}){3}$/;

Deno.test({
  name: `live (${OS}): ping output parses`,
  ignore: !live,
  fn: async () => {
    const { out } = await run("ping", pingArgs(OS, "127.0.0.1"), 5000);
    console.log(out.trim().split("\n").slice(0, 3).join("\n"));
    assert(parsePing(out), "ping reply not understood");
  },
});

Deno.test({
  name: `live (${OS}): local → discover → trace`,
  ignore: !live,
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const l = await local();
    console.log(JSON.stringify({ ...l, publicIp: "…" }, null, 1));
    assert(l.lan, "no LAN interface");
    assertMatch(l.gateway, IP, "no default gateway");
    assert(l.dns.length > 0, "no DNS servers");

    const t0 = Date.now();
    const ds = await discover(l);
    console.log(`discover: ${ds.length} device(s) in ${Date.now() - t0} ms`);
    for (const d of ds) {
      console.log(d.ip, d.mac, d.vendor, d.ttl, d.names.join("/"), d.os);
    }
    assert(ds.length < 64, `${ds.length} devices: proxy ARP leaking through?`);
    const me = ds.find((d) => d.self);
    assert(me, "this machine missing");
    assertMatch(
      me.os,
      { windows: /^Windows/, darwin: /^macOS/, linux: /./ }[OS],
    );

    const hops = await trace("1.1.1.1");
    console.log(hops.map((h) => `${h.n} ${h.ip || "*"} ${h.asn}`).join("\n"));
  },
});

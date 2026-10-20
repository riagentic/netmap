import { assert } from "@std/assert";
import { testUI } from "aio/testing";
import App from "../src/App.tsx";
import { net, view } from "../src/cell.ts";
import { dev } from "./fixtures.ts";

const seed = {
  net: {
    phase: "done",
    appVersion: "0.1.7",
    local: {
      hostname: "host1",
      ifaces: [{ name: "wg0", ip: "10.8.0.2", cidr: 16, mac: "" }],
      lan: { name: "eth0", ip: "10.0.0.5", cidr: 24, mac: "" },
      gateway: "10.0.0.1",
      egress: "wg0",
      dns: ["10.0.0.1"],
      publicIp: "1.2.3.4",
      isp: "AS1 Test",
      location: "Here",
    },
    path: [
      {
        n: 1,
        ip: "10.8.0.1",
        host: "",
        asn: "",
        loss: 0,
        avg: 9,
        best: 8,
        worst: 12,
        zone: "private",
      },
      {
        n: 2,
        ip: "1.1.1.1",
        host: "one.one.one.one",
        asn: "AS13335",
        loss: 0,
        avg: 20,
        best: 19,
        worst: 22,
        zone: "public",
      },
    ],
    devices: [
      dev({
        ip: "10.0.0.1",
        gateway: true,
        kind: "router",
        os: "RouterOS 6.49",
        model: "MikroTik RouterBOARD",
        evidence: ["default gateway of this LAN"],
        confidence: 100,
        ports: [{
          port: 80,
          service: "http",
          banner: "",
          http: {
            status: 200,
            server: "",
            title: "RouterOS router configuration page",
            cert: "",
          },
        }],
      }),
      dev({
        ip: "10.0.0.9",
        kind: "phone",
        randomMac: true,
        mac: "96:00:00:00:00:01",
        online: false,
      }),
    ],
  },
};

const page = () => document.body.textContent ?? "";

testUI(
  App,
  "nothing selected → overview; device row → details; close → overview",
  { seed },
  async (ui) => {
    assert(
      page().includes("Overview") && page().includes("Router / AP · 1"),
      "overview with kind counts",
    );
    ui.DevicesTab.click();
    await ui.expectCell(view, (s) => s.tab === "devices");
    ui.Row10001Row.click();
    await ui.expectCell(view, (s) => s.selected === "10.0.0.1");
    assert(
      page().includes("RouterOS router configuration page") &&
        page().includes("default gateway of this LAN"),
    );
    ui.CloseDetailButton.click();
    await ui.expectCell(view, (s) => s.selected === "");
  },
);

testUI(App, "filter devices; forget offline", { seed }, async (ui) => {
  ui.DevicesTab.click();
  ui.FilterDevicesInput.type("mikrotik");
  await ui.waitFor(() => ui.absent("Row10009Row"));
  ui.FilterDevicesInput.setValue("");
  await ui.waitFor(() => ui.present("Row10009Row"));
  ui.ForgetOfflineButton.click();
  await ui.expectCell(net, (s) => s.devices.length === 1);
});

testUI(App, "path tab: VPN step and hop details", { seed }, async (ui) => {
  ui.PathToTheInternetTab.click();
  await ui.expectCell(view, (s) => s.tab === "path");
  ui.Step1111Button.click();
  await ui.expectCell(view, (s) => s.selected === "hop:2");
  assert(
    page().includes("Hop #2") && page().includes("11.0 ms vs hop #1"),
    page(),
  );
  ui.StepWg0Button.click();
  await ui.expectCell(view, (s) => s.selected === "vpn");
  assert(page().includes("leaves through wg0"));
});

testUI(App, "map node and internet node select; zoom buttons; about tab", {
  seed,
}, async (ui) => {
  ui.Device10009Button.click();
  await ui.expectCell(view, (s) => s.selected === "10.0.0.9");
  assert(page().includes("randomized"));
  ui.InternetButton.click();
  await ui.expectCell(view, (s) => s.selected === "internet");
  assert(page().includes("1.2.3.4") && page().includes("AS1 Test"));
  ui.ZoomInButton.click();
  await ui.waitFor(() => page().includes("130%"));
  ui.FitButton.click();
  await ui.waitFor(() => page().includes("100%"));
  ui.AboutTab.click();
  await ui.waitFor(() => page().includes("How devices are found"));
  assert(page().includes("About NetMapv0.1.7"), "About shows the version");
});

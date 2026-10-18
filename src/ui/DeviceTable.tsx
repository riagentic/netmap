// Every device in one list, filterable by any visible text.
import type { JSX } from "aio";
import { useLocal } from "aio/air";
import { net, view } from "../cell.ts";
import type { Device } from "../lib/types.ts";
import { ICON, KIND, label } from "../lib/view.ts";

const haystack = (d: Device) =>
  [
    label(d),
    d.ip,
    d.mac,
    d.vendor,
    KIND[d.kind],
    d.os,
    d.model,
    ...d.names,
    ...d.ports.map((p) => `${p.port} ${p.service}`),
  ]
    .join(" ").toLowerCase();

export function DeviceTable(): JSX.Element {
  const [q, setQ] = useLocal("");
  const shown = net.devices.filter((d) =>
    haystack(d).includes(q.trim().toLowerCase())
  );
  return (
    <section class="pane">
      <header class="pane-head">
        <h2>
          📋 Devices{" "}
          <span class="muted">{shown.length}/{net.devices.length}</span>
        </h2>
        <div class="row">
          <input
            class="filter"
            aria-label="Filter devices"
            placeholder="Filter: name, ip, vendor, port…"
            value={q}
            onInput={(e: Event) =>
              setQ((e.currentTarget as HTMLInputElement).value)}
          />
          {net.devices.some((d) => !d.online) && (
            <button
              type="button"
              class="ghost"
              aria-label="Forget offline"
              onClick={() => net.forgetOffline()}
            >
              Forget offline
            </button>
          )}
        </div>
      </header>
      <div class="scroll">
        <table class="devices">
          <thead>
            <tr>
              <th />
              <th>Name</th>
              <th>IP</th>
              <th>MAC · vendor</th>
              <th>Type</th>
              <th>OS</th>
              <th>Ports</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((d) => (
              <tr
                key={d.ip}
                aria-label={`Row ${d.ip}`}
                class={`${view.selected === d.ip ? "sel" : ""} ${
                  d.online ? "" : "off"
                }`}
                tabIndex={0}
                onClick={() => view.select(d.ip)}
                onKeyDown={(e: KeyboardEvent) =>
                  (e.key === "Enter" || e.key === " ") && view.select(d.ip)}
              >
                <td>{ICON[d.kind]}</td>
                <td>{label(d)}{d.self ? " (you)" : ""}</td>
                <td class="mono">{d.ip}</td>
                <td>
                  <span class="mono">{d.mac}</span>{" "}
                  <span class="muted">
                    {d.randomMac ? "private MAC" : d.vendor}
                  </span>
                </td>
                <td>
                  {KIND[d.kind]} <span class="muted">{d.confidence}%</span>
                </td>
                <td>{d.os}</td>
                <td class="mono">{d.ports.map((p) => p.port).join(" ")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

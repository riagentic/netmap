// Left panel: brand, vertical tabs, scan controls.
import type { JSX } from "aio";
import { net, type Tab, view } from "../cell.ts";
import type { Phase } from "../lib/types.ts";

const TABS: [Tab, string, string][] = [
  ["path", "🛣️", "Path to the internet"],
  ["map", "🗺️", "Network map"],
  ["devices", "📋", "Devices"],
  ["about", "ℹ️", "About"],
];

const PHASE: Record<Phase, string> = {
  idle: "Ready",
  local: "Reading this computer…",
  discover: "Discovering devices…",
  ports: "Scanning ports…",
  identify: "Finishing route trace…",
  done: "Done",
  stopped: "Stopped",
  error: "Error",
};

export function Sidebar(): JSX.Element {
  const busy = net.busy();
  const { done, total } = net.progress;
  return (
    <nav class="sidebar">
      <h1>🛰️ NetMap</h1>
      <div class="tabs" role="tablist" aria-orientation="vertical">
        {TABS.map(([id, icon, text]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={view.tab === id}
            aria-label={text}
            class={`tab ${view.tab === id ? "on" : ""}`}
            onClick={() => view.setTab(id)}
          >
            <span class="ti">{icon}</span>
            {text}
            {id === "devices" && net.devices.length > 0 && (
              <span class="count">{net.devices.length}</span>
            )}
            {id === "path" && net.path.length > 0 && (
              <span class="count">{net.path.length}</span>
            )}
          </button>
        ))}
      </div>
      <div class="scanbox">
        <label class="muted small" for="target">Trace target</label>
        <input
          id="target"
          class="mono target"
          aria-label="Trace target"
          value={net.target}
          disabled={busy}
          onChange={(e: Event) =>
            net.setTarget((e.currentTarget as HTMLInputElement).value)}
        />
        {busy
          ? (
            <button
              type="button"
              class="danger wide"
              aria-label="Stop"
              onClick={() => net.stop()}
            >
              ⏹ Stop
            </button>
          )
          : (
            <button
              type="button"
              class="primary wide"
              aria-label="Scan"
              onClick={() => net.scan()}
            >
              🔍 Scan network
            </button>
          )}
        {busy && <progress max={total || 1} value={done} />}
        <div
          class={`small ${net.phase === "error" ? "warn" : "muted"}`}
          aria-label="Status"
        >
          {PHASE[net.phase]}
          {busy && total ? ` ${done}/${total}` : ""}
          {net.phase === "error" && `: ${net.error}`}
          {net.phase === "done" && net.finishedAt
            ? ` · ${Math.round((net.finishedAt - net.startedAt) / 1000)} s · ${
              new Date(net.finishedAt).toLocaleTimeString()
            }`
            : ""}
        </div>
      </div>
    </nav>
  );
}

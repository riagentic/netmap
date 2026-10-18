// Entry — cells self-register on import.
import "./cell.ts";
import { aio } from "aio";
import { net } from "./cell.ts";

// Single-user local desktop app: every client may see every key. aio-ok
await aio.run({
  ui: { theme: "auto", title: "NetMap", width: 1440, height: 940 },
  electron: { ignoreDebugEnv: true, strictPin: true },
  wire: { refuseShortCalls: true },
  // First launch: nothing known yet — start scanning right away.
  onStart: () => {
    if (net.devices.length === 0) void net.scan();
  },
});

// UI root — left: tabs + scan controls · middle: active tab · right: details.
import type { JSX } from "aio";
import { view } from "./cell.ts";
import { About } from "./ui/About.tsx";
import { DeviceTable } from "./ui/DeviceTable.tsx";
import { Inspector } from "./ui/Inspector.tsx";
import { NetMap } from "./ui/NetMap.tsx";
import { PathView } from "./ui/PathView.tsx";
import { Sidebar } from "./ui/Sidebar.tsx";

export default function App(): JSX.Element {
  const t = view.tab;
  return (
    <main class="shell">
      <Sidebar />
      <div class="content">
        {t === "path" && <PathView />}
        {t === "map" && <NetMap />}
        {t === "devices" && <DeviceTable />}
        {t === "about" && <About />}
      </div>
      <Inspector />
    </main>
  );
}

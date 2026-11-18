import { Network } from "lucide-react";
import {
  usePermission,
  type PanelProps,
  type TermixApp,
} from "@termix-ssh/plugin-sdk/frontend";
import { NetbirdPeersPanel } from "./NetbirdPeersPanel";

export function activate(app: TermixApp): void {
  function Panel({ shell }: PanelProps) {
    const canImport = usePermission("peers.import");
    const canReconcile = usePermission("peers.reconcile");
    return (
      <NetbirdPeersPanel
        api={app.api}
        canImport={canImport}
        canReconcile={canReconcile}
        confirm={(options) => app.confirm(options)}
        // A panel in a frame (plugin API 2) gets no shell handle, so the
        // single "add as host" button needs the host editor from the page.
        onAddHost={
          shell?.openHostEditor
            ? (draft) => shell.openHostEditor!(draft)
            : undefined
        }
      />
    );
  }

  app.registerRailItem({
    id: "netbird",
    icon: Network,
    titleKey: "nav.netbird",
    group: "objects",
    permission: "peers.view",
  });
  app.registerPanel("netbird", Panel);
}

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
    return (
      <NetbirdPeersPanel
        api={app.api}
        canImport={canImport}
        onAddHost={
          shell.openHostEditor
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

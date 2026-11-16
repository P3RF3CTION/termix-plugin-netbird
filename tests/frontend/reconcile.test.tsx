import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { PluginApiClient } from "@termix-ssh/plugin-sdk/frontend";
import { NetbirdPeersPanel } from "../../src/frontend/NetbirdPeersPanel";
import { ReconcileView } from "../../src/frontend/ReconcileView";

vi.mock("@termix-ssh/plugin-sdk/frontend", async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, vars?: Record<string, unknown>) =>
        vars ? `${key} ${JSON.stringify(vars)}` : key,
    }),
    useToast: () => ({ success: vi.fn(), error: vi.fn() }),
  };
});

const findings = {
  complete: true,
  staleDays: 30,
  findings: [
    {
      hostId: 1,
      hostName: "web-1",
      hostIp: "100.64.0.30",
      port: 22,
      kind: "ip-changed",
      peerId: "p-web",
      peerName: "web-1",
      peerIp: "100.64.0.31",
      lastSeen: null,
      loginExpired: false,
      offlineDays: null,
      certain: true,
      actions: ["update-ip", "delete"],
    },
    {
      hostId: 2,
      hostName: "nap-1",
      hostIp: "100.64.0.60",
      port: 22,
      kind: "offline",
      peerId: "p-nap",
      peerName: "nap-1",
      peerIp: null,
      lastSeen: null,
      loginExpired: false,
      offlineDays: 2,
      certain: true,
      actions: [],
    },
  ],
};

describe("ReconcileView", () => {
  it("lists findings and sends only the selected primary action after confirming", async () => {
    const post = vi.fn(async () => ({
      data: {
        updated: [{ hostId: 1, ip: "100.64.0.31" }],
        deleted: [],
        skipped: [],
        failed: [],
      },
    }));
    const api = {
      get: vi.fn(async () => ({ data: findings })),
      post,
    } as unknown as PluginApiClient;
    const confirm = vi.fn(async () => true);
    const onChanged = vi.fn();
    render(
      <ReconcileView
        api={api}
        confirm={confirm}
        onClose={vi.fn()}
        onChanged={onChanged}
      />,
    );
    await waitFor(() => expect(screen.getByTestId("finding-1")).toBeTruthy());
    expect(screen.getByTestId("finding-2").textContent).toContain(
      "reconcile.offlineDays",
    );
    // The offline host has no action and so no checkbox.
    expect(screen.getAllByRole("checkbox")).toHaveLength(1);

    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByTestId("reconcile-apply"));
    await waitFor(() => expect(post).toHaveBeenCalled());
    expect(confirm).toHaveBeenCalled();
    expect(post).toHaveBeenCalledWith("/hosts/reconcile", {
      actions: [{ hostId: 1, action: "update-ip" }],
    });
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });

  it("changes nothing when the user cancels", async () => {
    const post = vi.fn();
    const api = {
      get: vi.fn(async () => ({ data: findings })),
      post,
    } as unknown as PluginApiClient;
    render(
      <ReconcileView api={api} confirm={async () => false} onClose={vi.fn()} />,
    );
    await waitFor(() => expect(screen.getByTestId("finding-1")).toBeTruthy());
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByTestId("reconcile-apply"));
    await new Promise((r) => setTimeout(r, 10));
    expect(post).not.toHaveBeenCalled();
  });
});

describe("posture in the peer list", () => {
  it("shows a peer blocked by posture checks and opens the host check", async () => {
    const api = {
      get: vi.fn(async (path: string) => ({
        data:
          path === "/peers"
            ? {
                configured: true,
                termixPeer: "termix",
                termixPeerMissing: false,
                policiesReadable: true,
                peers: [
                  {
                    id: "p-web",
                    name: "web-1",
                    ip: "100.64.0.30",
                    dnsLabel: "",
                    os: "Darwin 13.6",
                    connected: true,
                    lastSeen: null,
                    groups: [],
                    sshPort: 22,
                    reachability: {
                      state: "blocked",
                      policies: ["Termix to web"],
                      postureChecks: true,
                      posture: "fail",
                    },
                  },
                ],
              }
            : findings,
      })),
      post: vi.fn(),
    } as unknown as PluginApiClient;
    render(<NetbirdPeersPanel api={api} canReconcile />);
    await waitFor(() => expect(screen.getByTestId("reach-p-web")).toBeTruthy());
    expect(screen.getByTestId("reach-p-web").textContent).toContain(
      "reach.postureBlocked",
    );
    fireEvent.click(screen.getByTestId("open-reconcile"));
    await waitFor(() => expect(screen.getByTestId("reconcile")).toBeTruthy());
  });

  it("hides the host check without the permission", async () => {
    const api = {
      get: vi.fn(async () => ({
        data: {
          configured: true,
          termixPeer: null,
          termixPeerMissing: false,
          policiesReadable: true,
          peers: [],
        },
      })),
    } as unknown as PluginApiClient;
    render(<NetbirdPeersPanel api={api} />);
    await waitFor(() => expect(api.get).toHaveBeenCalled());
    expect(screen.queryByTestId("open-reconcile")).toBeNull();
  });
});

import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import type { PluginApiClient } from "@termix-ssh/plugin-sdk/frontend";
import { NetbirdPeersPanel } from "../../src/frontend/NetbirdPeersPanel";

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

function apiReturning(data: unknown): PluginApiClient {
  return {
    get: vi.fn(async () => ({ data })),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  } as unknown as PluginApiClient;
}

describe("NetbirdPeersPanel", () => {
  it("shows the setup hint without a token", async () => {
    render(
      <NetbirdPeersPanel
        api={apiReturning({
          configured: false,
          termixPeer: null,
          termixPeerMissing: false,
          peers: [],
        })}
      />,
    );
    expect(await screen.findByText("panel.notConfigured")).toBeTruthy();
  });

  it("lists peers with their reachability and offers add as host", async () => {
    const onAddHost = vi.fn();
    render(
      <NetbirdPeersPanel
        onAddHost={onAddHost}
        api={apiReturning({
          configured: true,
          termixPeer: "termix",
          termixPeerMissing: false,
          peers: [
            {
              id: "p-cloud",
              name: "cloud-1",
              ip: "100.64.0.20",
              dnsLabel: "cloud-1.netbird.example",
              os: "Ubuntu",
              connected: true,
              lastSeen: null,
              groups: ["Cloud"],
              sshPort: 2222,
              reachability: {
                state: "blocked",
                policies: [],
                postureChecks: false,
              },
            },
          ],
        })}
      />,
    );
    await waitFor(() =>
      expect(screen.getByTestId("peer-p-cloud")).toBeTruthy(),
    );
    expect(screen.getByTestId("reach-p-cloud").textContent).toContain(
      "reach.blocked",
    );
    screen.getByText("panel.addHost").click();
    expect(onAddHost).toHaveBeenCalledWith({
      name: "cloud-1",
      ip: "100.64.0.20",
      port: 2222,
    });
  });
});

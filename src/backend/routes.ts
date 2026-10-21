import type { Request, Response, Router } from "express";
import type { PluginContext } from "@termix-ssh/plugin-sdk/backend";
import { loadPeersAndPolicies, NetbirdApiError } from "./netbird-api.js";
import { evaluate, findPeer, type Reachability } from "./reachability.js";

export interface PeerView {
  id: string;
  name: string;
  ip: string;
  dnsLabel: string;
  os: string;
  connected: boolean;
  lastSeen: string | null;
  groups: string[];
  sshPort: number;
  reachability: Reachability;
}

export interface PeersResponse {
  configured: boolean;
  termixPeer: string | null;
  /** The Termix peer setting is filled in but matches no peer. */
  termixPeerMissing: boolean;
  peers: PeerView[];
  error?: "token" | "api";
}

function clampPort(value: unknown): number {
  const n =
    typeof value === "number"
      ? value
      : Number.parseInt(String(value ?? ""), 10);
  return Number.isInteger(n) && n >= 1 && n <= 65535 ? n : 22;
}

export function registerRoutes(router: Router, ctx: PluginContext): void {
  // The peer list is a full inventory of the NetBird network: admins only by
  // default (peers.view, see manifest).
  router.use(ctx.rbac.require("peers.view") as never);

  /**
   * @openapi
   * /plugin-api/netbird/peers:
   *   get:
   *     summary: List NetBird peers with an SSH reachability check
   *     description: >
   *       Reads peers and access policies from the configured NetBird management
   *       API with the stored token and reports, per peer, whether a policy lets
   *       the Termix server's own peer open TCP to the SSH port. Requires the
   *       netbird.peers.view permission.
   *     tags:
   *       - NetBird
   *     responses:
   *       200:
   *         description: Peers with reachability; configured=false when no token is set.
   *       401:
   *         description: NetBird rejected the API token.
   *       502:
   *         description: The NetBird management API could not be read.
   */
  router.get("/peers", async (_req: Request, res: Response) => {
    const token = ((await ctx.settings.get<string>("apiToken")) ?? "").trim();
    if (!token) {
      const empty: PeersResponse = {
        configured: false,
        termixPeer: null,
        termixPeerMissing: false,
        peers: [],
      };
      return res.json(empty);
    }

    try {
      const { peers, policies } = await loadPeersAndPolicies(ctx);
      const sshPort = clampPort(await ctx.settings.get<number>("sshPort"));
      const reference = (
        (await ctx.settings.get<string>("termixPeer")) ?? ""
      ).trim();
      const termix = reference ? findPeer(peers, reference) : null;

      const body: PeersResponse = {
        configured: true,
        termixPeer: termix?.name ?? null,
        termixPeerMissing: reference.length > 0 && termix === null,
        peers: peers
          .map((p) => ({
            id: p.id,
            name: p.name,
            ip: (p.ip ?? "").split("/")[0],
            dnsLabel: p.dns_label ?? "",
            os: p.os ?? "",
            connected: p.connected === true,
            lastSeen: p.last_seen ?? null,
            groups: (p.groups ?? [])
              .map((g) => g.name)
              .filter((n) => n !== "All"),
            sshPort,
            reachability: evaluate(policies, termix, p, sshPort),
          }))
          .sort((a, b) => a.name.localeCompare(b.name)),
      };
      return res.json(body);
    } catch (err) {
      const status = err instanceof NetbirdApiError ? err.status : 502;
      ctx.log.warn(
        `NetBird peers could not be read: ${(err as Error).message}`,
      );
      const body: PeersResponse = {
        configured: true,
        termixPeer: null,
        termixPeerMissing: false,
        peers: [],
        error: status === 401 ? "token" : "api",
      };
      return res.status(status === 401 ? 401 : 502).json(body);
    }
  });
}

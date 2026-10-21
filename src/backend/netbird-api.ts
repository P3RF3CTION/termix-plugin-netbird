import type { PluginContext } from "@termix-ssh/plugin-sdk/backend";
import type { NetbirdPeer, NetbirdPolicy } from "./reachability.js";

export const DEFAULT_MANAGEMENT_URL = "https://api.netbird.io";

/**
 * "https://vpn.example.com/" or "https://vpn.example.com/api" ->
 * "https://vpn.example.com/api". Empty -> NetBird Cloud.
 */
export function apiBase(raw: string | null | undefined): string {
  const trimmed =
    (raw ?? "").trim().replace(/\/+$/, "") || DEFAULT_MANAGEMENT_URL;
  const url = new URL(trimmed);
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("The management URL must start with https://");
  }
  return trimmed.endsWith("/api") ? trimmed : `${trimmed}/api`;
}

export class NetbirdApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/**
 * GET against the NetBird management API with the admin's token. Only the
 * configured host is reachable (it may be a self-hosted server on the LAN),
 * redirects are refused, and the token never leaves this function.
 */
export async function netbirdGet<T>(
  ctx: PluginContext,
  path: "/peers" | "/policies",
): Promise<T> {
  const token = ((await ctx.settings.get<string>("apiToken")) ?? "").trim();
  if (!token) throw new NetbirdApiError("No NetBird API token is set", 412);
  const base = apiBase(await ctx.settings.get<string>("managementUrl"));

  const response = await ctx.fetch(`${base}${path}`, {
    headers: {
      Authorization: `Token ${token}`,
      Accept: "application/json",
      "User-Agent": "Termix-NetBird-Plugin",
    },
    allowPrivateHosts: [new URL(base).hostname],
    timeoutMs: 15_000,
  });
  if (response.status === 401 || response.status === 403) {
    throw new NetbirdApiError("NetBird rejected the API token", 401);
  }
  if (!response.ok) {
    throw new NetbirdApiError(`NetBird API answered ${response.status}`, 502);
  }
  return (await response.json()) as T;
}

export async function loadPeersAndPolicies(ctx: PluginContext): Promise<{
  peers: NetbirdPeer[];
  policies: NetbirdPolicy[];
}> {
  const [peers, policies] = await Promise.all([
    netbirdGet<NetbirdPeer[]>(ctx, "/peers"),
    netbirdGet<NetbirdPolicy[]>(ctx, "/policies"),
  ]);
  return {
    peers: Array.isArray(peers) ? peers : [],
    policies: Array.isArray(policies) ? policies : [],
  };
}

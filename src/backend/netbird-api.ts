import type { PluginContext } from "@termix-ssh/plugin-sdk/backend";
import type { NetbirdCredential } from "./auth.js";
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

/** NetBird peer ids are xid strings; anything else never reaches the URL. */
export function isPeerId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(value);
}

type ApiPath =
  | "/users/current"
  | "/peers"
  | "/policies"
  | `/peers/${string}`
  | `/peers/${string}/accessible-peers`;

/**
 * GET against the NetBird management API with the given credential. Only the
 * configured host is reachable (it may be a self-hosted server on the LAN),
 * redirects are refused, and the credential never leaves this function.
 */
export async function netbirdGet<T>(
  ctx: PluginContext,
  credential: NetbirdCredential,
  path: ApiPath,
): Promise<T> {
  const base = apiBase(await ctx.settings.get<string>("managementUrl"));
  const response = await ctx.fetch(`${base}${path}`, {
    headers: {
      Authorization: credential.header,
      Accept: "application/json",
      "User-Agent": "Termix-NetBird-Plugin",
    },
    allowPrivateHosts: [new URL(base).hostname],
    timeoutMs: 15_000,
  });
  if (response.status === 401) {
    throw new NetbirdApiError("NetBird rejected the credential", 401);
  }
  if (response.status === 403) {
    throw new NetbirdApiError("NetBird denied access", 403);
  }
  if (response.status === 404) {
    throw new NetbirdApiError("Not found in NetBird", 404);
  }
  if (!response.ok) {
    throw new NetbirdApiError(`NetBird API answered ${response.status}`, 502);
  }
  return (await response.json()) as T;
}

export interface NetbirdIdentity {
  name: string;
  role: string;
  serviceUser: boolean;
}

/**
 * Who the credential belongs to in NetBird (GET /users/current). NetBird
 * shows a user with the role "user" only their own peers, which is the usual
 * reason a personal token lists fewer peers than the service token. Null
 * when the server is too old for the endpoint or refuses it.
 */
export async function whoAmI(
  ctx: PluginContext,
  credential: NetbirdCredential,
): Promise<NetbirdIdentity | null> {
  try {
    const user = await netbirdGet<{
      name?: string;
      email?: string;
      role?: string;
      is_service_user?: boolean;
    }>(ctx, credential, "/users/current");
    return {
      name: user.name || user.email || "",
      role: typeof user.role === "string" ? user.role : "",
      serviceUser: user.is_service_user === true,
    };
  } catch {
    return null;
  }
}

export async function loadPeersAndPolicies(
  ctx: PluginContext,
  credential: NetbirdCredential,
): Promise<{
  peers: NetbirdPeer[];
  policies: NetbirdPolicy[];
  policiesReadable: boolean;
}> {
  const peers = await netbirdGet<NetbirdPeer[]>(ctx, credential, "/peers");
  // A regular NetBird user may list peers but not policies. The check then
  // reports "unknown" instead of failing the whole list.
  let policies: NetbirdPolicy[] = [];
  let policiesReadable = true;
  try {
    const result = await netbirdGet<NetbirdPolicy[]>(
      ctx,
      credential,
      "/policies",
    );
    policies = Array.isArray(result) ? result : [];
  } catch (err) {
    if (err instanceof NetbirdApiError && err.status === 403) {
      policiesReadable = false;
    } else {
      throw err;
    }
  }
  return {
    peers: Array.isArray(peers) ? peers : [],
    policies,
    policiesReadable,
  };
}

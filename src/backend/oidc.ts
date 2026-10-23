// Single sign-on against the identity provider that issues tokens for the
// NetBird management API (OpenID Connect, authorization code flow with PKCE).
//
// Nothing here is specific to one IdP: the issuer, client and extra
// parameters come from the admin settings. The plugin never sees the
// user's IdP password; it receives tokens from the token endpoint over TLS
// (back channel) and keeps the refresh token encrypted per user
// (ctx.secrets). A user who is already signed in at the IdP, for example
// because Termix uses the same IdP, gets through the login window without
// typing anything.

import { createHash, randomBytes } from "node:crypto";
import type { PluginContext } from "@termix-ssh/plugin-sdk/backend";

export interface OidcConfig {
  issuer: string;
  clientId: string;
  clientSecret: string;
  scopes: string;
  audience: string;
  /** Extra authorization request parameters, like "connector_id=keycloak". */
  extraParams: Record<string, string>;
  /** Send the ID token instead of the access token to NetBird. */
  useIdToken: boolean;
}

export interface OidcEndpoints {
  authorization_endpoint: string;
  token_endpoint: string;
  end_session_endpoint?: string;
}

export interface TokenSet {
  access_token?: string;
  id_token?: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
}

/** What is stored in ctx.kv while a login window is open. */
export interface PendingLogin {
  userId: string;
  verifier: string;
  nonce: string;
  redirectUri: string;
  /** Unix ms. */
  created: number;
}

export const STATE_PREFIX = "oidc-state:";
/**
 * A finished sign-in waiting to be taken over by the user's next request.
 * The callback has no acting user (the IdP redirects the browser there), and
 * ctx.secrets needs one; storing the refresh token sealed under the user id
 * avoids asking for users:impersonate.
 */
export const DONE_PREFIX = "oidc-done:";

export interface FinishedLogin {
  /** The refresh token, sealed with ctx.secrets.seal. */
  sealed: string;
  identity: string;
  /** Unix ms. */
  created: number;
}
export const STATE_TTL_MS = 10 * 60 * 1000;
export const REFRESH_SECRET = "oidc.refresh";
export const IDENTITY_SECRET = "oidc.identity";

const discoveryCache = new Map<string, { at: number; doc: OidcEndpoints }>();
const DISCOVERY_TTL_MS = 10 * 60 * 1000;

export function base64Url(buf: Buffer): string {
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export function randomToken(bytes = 32): string {
  return base64Url(randomBytes(bytes));
}

export function pkceChallenge(verifier: string): string {
  return base64Url(createHash("sha256").update(verifier).digest());
}

/** "a=1&b=2" or one pair per line -> { a: "1", b: "2" }. Ignores junk. */
export function parseExtraParams(
  raw: string | null | undefined,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of String(raw ?? "").split(/[&\n]/)) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    // These belong to the flow itself and must not be overridden.
    if (
      [
        "client_id",
        "redirect_uri",
        "response_type",
        "state",
        "nonce",
        "code_challenge",
        "code_challenge_method",
        "scope",
      ].includes(key)
    )
      continue;
    out[key] = value;
  }
  return out;
}

export async function readOidcConfig(
  ctx: PluginContext,
): Promise<OidcConfig | null> {
  const issuer = ((await ctx.settings.get<string>("oidcIssuer")) ?? "")
    .trim()
    .replace(/\/+$/, "");
  const clientId = (
    (await ctx.settings.get<string>("oidcClientId")) ?? ""
  ).trim();
  if (!issuer || !clientId) return null;
  const url = new URL(issuer);
  if (url.protocol !== "https:") {
    throw new Error("The OIDC issuer must use https://");
  }
  return {
    issuer,
    clientId,
    clientSecret: (
      (await ctx.settings.get<string>("oidcClientSecret")) ?? ""
    ).trim(),
    scopes:
      ((await ctx.settings.get<string>("oidcScopes")) ?? "").trim() ||
      "openid profile email offline_access",
    audience: ((await ctx.settings.get<string>("oidcAudience")) ?? "").trim(),
    extraParams: parseExtraParams(
      await ctx.settings.get<string>("oidcExtraParams"),
    ),
    useIdToken: (await ctx.settings.get<boolean>("oidcUseIdToken")) === true,
  };
}

function hostOf(url: string): string {
  return new URL(url).hostname;
}

export async function discover(
  ctx: PluginContext,
  issuer: string,
): Promise<OidcEndpoints> {
  const cached = discoveryCache.get(issuer);
  if (cached && Date.now() - cached.at < DISCOVERY_TTL_MS) return cached.doc;
  const response = await ctx.fetch(
    `${issuer}/.well-known/openid-configuration`,
    {
      headers: { Accept: "application/json" },
      allowPrivateHosts: [hostOf(issuer)],
      timeoutMs: 10_000,
    },
  );
  if (!response.ok) {
    throw new Error(`OIDC discovery answered ${response.status}`);
  }
  const doc = (await response.json()) as Partial<OidcEndpoints>;
  if (
    typeof doc.authorization_endpoint !== "string" ||
    typeof doc.token_endpoint !== "string"
  ) {
    throw new Error("OIDC discovery document has no endpoints");
  }
  for (const endpoint of [doc.authorization_endpoint, doc.token_endpoint]) {
    if (new URL(endpoint).protocol !== "https:") {
      throw new Error("OIDC endpoints must use https://");
    }
  }
  const result: OidcEndpoints = {
    authorization_endpoint: doc.authorization_endpoint,
    token_endpoint: doc.token_endpoint,
    end_session_endpoint: doc.end_session_endpoint,
  };
  discoveryCache.set(issuer, { at: Date.now(), doc: result });
  return result;
}

export function buildAuthorizeUrl(
  endpoints: OidcEndpoints,
  config: OidcConfig,
  login: {
    state: string;
    nonce: string;
    verifier: string;
    redirectUri: string;
  },
): string {
  const url = new URL(endpoints.authorization_endpoint);
  const params: Record<string, string> = {
    ...config.extraParams,
    response_type: "code",
    client_id: config.clientId,
    redirect_uri: login.redirectUri,
    scope: config.scopes,
    state: login.state,
    nonce: login.nonce,
    code_challenge: pkceChallenge(login.verifier),
    code_challenge_method: "S256",
  };
  if (config.audience) params.audience = config.audience;
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return url.toString();
}

async function tokenRequest(
  ctx: PluginContext,
  endpoints: OidcEndpoints,
  config: OidcConfig,
  form: Record<string, string>,
): Promise<TokenSet> {
  const body = new URLSearchParams({ ...form, client_id: config.clientId });
  const headers: Record<string, string> = {
    "Content-Type": "application/x-www-form-urlencoded",
    Accept: "application/json",
  };
  if (config.clientSecret) {
    // client_secret_basic, the default every IdP supports.
    const basic = Buffer.from(
      `${encodeURIComponent(config.clientId)}:${encodeURIComponent(config.clientSecret)}`,
    ).toString("base64");
    headers.Authorization = `Basic ${basic}`;
  }
  const response = await ctx.fetch(endpoints.token_endpoint, {
    method: "POST",
    headers,
    body: body.toString(),
    allowPrivateHosts: [hostOf(endpoints.token_endpoint)],
    timeoutMs: 15_000,
  });
  if (!response.ok) {
    // The IdP's error text can name the client; it is logged, not returned.
    let detail = "";
    try {
      const err = (await response.json()) as { error?: string };
      detail = err.error ? ` (${err.error})` : "";
    } catch {
      // not JSON
    }
    throw new Error(`Token endpoint answered ${response.status}${detail}`);
  }
  return (await response.json()) as TokenSet;
}

export function exchangeCode(
  ctx: PluginContext,
  endpoints: OidcEndpoints,
  config: OidcConfig,
  code: string,
  login: PendingLogin,
): Promise<TokenSet> {
  return tokenRequest(ctx, endpoints, config, {
    grant_type: "authorization_code",
    code,
    redirect_uri: login.redirectUri,
    code_verifier: login.verifier,
  });
}

export function refresh(
  ctx: PluginContext,
  endpoints: OidcEndpoints,
  config: OidcConfig,
  refreshToken: string,
): Promise<TokenSet> {
  return tokenRequest(ctx, endpoints, config, {
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });
}

/** Payload of a JWT, without verifying it. Null when it is not a JWT. */
export function jwtPayload(
  token: string | undefined,
): Record<string, unknown> | null {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const json = Buffer.from(
      parts[1].replace(/-/g, "+").replace(/_/g, "/"),
      "base64",
    ).toString("utf8");
    const payload = JSON.parse(json) as unknown;
    return payload && typeof payload === "object"
      ? (payload as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/**
 * Checks the ID token from the token endpoint. It came over TLS straight from
 * the IdP (OIDC Core 3.1.3.7: TLS server validation may replace the
 * signature check), so iss, aud, nonce and expiry are what is left to check.
 */
export function checkIdToken(
  idToken: string | undefined,
  config: OidcConfig,
  nonce: string,
  now = Date.now(),
): { ok: true; subject: string; name: string } | { ok: false; reason: string } {
  const payload = jwtPayload(idToken);
  if (!payload) return { ok: false, reason: "no id_token" };
  if (String(payload.iss ?? "").replace(/\/+$/, "") !== config.issuer) {
    return { ok: false, reason: "issuer mismatch" };
  }
  const aud = payload.aud;
  const audiences = Array.isArray(aud) ? aud.map(String) : [String(aud ?? "")];
  if (!audiences.includes(config.clientId)) {
    return { ok: false, reason: "audience mismatch" };
  }
  if (payload.nonce !== nonce) return { ok: false, reason: "nonce mismatch" };
  const exp = Number(payload.exp);
  if (Number.isFinite(exp) && exp * 1000 < now - 60_000) {
    return { ok: false, reason: "id_token expired" };
  }
  const name = String(
    payload.preferred_username ?? payload.email ?? payload.name ?? payload.sub,
  );
  return { ok: true, subject: String(payload.sub ?? ""), name };
}

/**
 * Drops login states and unclaimed finished logins older than the TTL.
 * Called on every new login.
 */
export async function sweepStates(ctx: PluginContext): Promise<void> {
  const now = Date.now();
  for (const key of await ctx.kv.list()) {
    if (!key.startsWith(STATE_PREFIX) && !key.startsWith(DONE_PREFIX)) continue;
    const value = (await ctx.kv.get(key)) as { created?: number } | undefined;
    if (!value || now - (value.created ?? 0) > STATE_TTL_MS) {
      await ctx.kv.delete(key);
    }
  }
}

// Which NetBird credential a request uses.
//
// Three sources, picked per request for the signed-in Termix user:
//   sso      the user's own OIDC session (refresh token in ctx.secrets)
//   user     the user's own NetBird personal access token (user setting)
//   service  the admin's token, a NetBird service user's PAT (admin setting)
//
// authMode decides which sources count:
//   service          only the service token (the 1.0 behaviour, default)
//   user             only the user's own sign-in, nothing shared
//   user-or-service  the user's own sign-in, else the service token
//
// With sso or user, NetBird applies that user's own permissions: a NetBird
// user who may only see their own peers sees only those in Termix too.

import type { PluginContext } from "@termix-ssh/plugin-sdk/backend";
import {
  discover,
  DONE_PREFIX,
  type FinishedLogin,
  IDENTITY_SECRET,
  STATE_TTL_MS,
  readOidcConfig,
  refresh,
  REFRESH_SECRET,
  jwtPayload,
} from "./oidc.js";

export type AuthMode = "service" | "user" | "user-or-service";
export type CredentialSource = "sso" | "user" | "service";

export interface NetbirdCredential {
  header: string;
  source: CredentialSource;
  /** Who the credential belongs to, for display. */
  identity: string | null;
}

export interface AuthStatus {
  mode: AuthMode;
  ssoAvailable: boolean;
  serviceTokenSet: boolean;
  userTokenSet: boolean;
  ssoSignedIn: boolean;
  ssoIdentity: string | null;
  /** The source the next request would use, or null when none fits. */
  active: CredentialSource | null;
}

interface CachedToken {
  token: string;
  /** Unix ms. */
  expires: number;
}

const accessTokens = new Map<string, CachedToken>();
const SKEW_MS = 60_000;

export function clearCachedToken(userId: string): void {
  accessTokens.delete(userId);
}

export function cacheToken(userId: string, token: string, expiresIn?: number) {
  const fromJwt = Number(jwtPayload(token)?.exp) * 1000;
  const expires = Number.isFinite(fromJwt)
    ? fromJwt
    : Date.now() + (expiresIn ?? 300) * 1000;
  accessTokens.set(userId, { token, expires });
}

export async function authMode(ctx: PluginContext): Promise<AuthMode> {
  const raw = await ctx.settings.get<string>("authMode");
  return raw === "user" || raw === "user-or-service" ? raw : "service";
}

async function serviceToken(ctx: PluginContext): Promise<string> {
  return ((await ctx.settings.get<string>("apiToken")) ?? "").trim();
}

async function userToken(ctx: PluginContext, userId: string): Promise<string> {
  return (
    (await ctx.settings.getUser<string>(userId, "userApiToken")) ?? ""
  ).trim();
}

/**
 * Takes over a sign-in the public callback finished for this user: unseals
 * the refresh token and stores it in the user's own secrets. Runs on the
 * user's next request, which has an acting user.
 */
export async function adoptFinishedLogin(
  ctx: PluginContext,
  userId: string,
): Promise<void> {
  const key = `${DONE_PREFIX}${userId}`;
  const done = (await ctx.kv.get(key)) as FinishedLogin | undefined;
  if (!done) return;
  await ctx.kv.delete(key);
  if (Date.now() - done.created > STATE_TTL_MS) return;
  const refreshToken = await ctx.secrets.unseal(done.sealed);
  if (!refreshToken) return;
  await ctx.secrets.set(REFRESH_SECRET, refreshToken);
  await ctx.secrets.set(IDENTITY_SECRET, done.identity);
  await ctx.audit.record({
    action: "netbird_sso_login",
    resourceType: "netbird",
    resourceName: done.identity,
    success: true,
  });
}

/** Ends the user's SSO session in Termix, including an unclaimed sign-in. */
export async function forgetSso(
  ctx: PluginContext,
  userId: string,
): Promise<void> {
  await ctx.kv.delete(`${DONE_PREFIX}${userId}`);
  await ctx.secrets.delete(REFRESH_SECRET);
  await ctx.secrets.delete(IDENTITY_SECRET);
  clearCachedToken(userId);
}

/**
 * A valid bearer token from the user's SSO session, refreshed when needed.
 * Null when the user has not signed in or the session cannot be renewed (the
 * stored refresh token is then dropped, so the panel asks to sign in again).
 */
export async function ssoToken(
  ctx: PluginContext,
  userId: string,
): Promise<string | null> {
  await adoptFinishedLogin(ctx, userId);
  const cached = accessTokens.get(userId);
  if (cached && cached.expires - SKEW_MS > Date.now()) return cached.token;

  const config = await readOidcConfig(ctx);
  if (!config) return null;
  const refreshToken = await ctx.secrets.get(REFRESH_SECRET);
  if (!refreshToken) return null;

  try {
    const endpoints = await discover(ctx, config.issuer);
    const tokens = await refresh(ctx, endpoints, config, refreshToken);
    const token = config.useIdToken ? tokens.id_token : tokens.access_token;
    if (!token) throw new Error("token endpoint returned no token");
    if (tokens.refresh_token && tokens.refresh_token !== refreshToken) {
      await ctx.secrets.set(REFRESH_SECRET, tokens.refresh_token);
    }
    cacheToken(userId, token, tokens.expires_in);
    return token;
  } catch (err) {
    ctx.log.warn(`SSO session could not be renewed: ${(err as Error).message}`);
    await forgetSso(ctx, userId);
    return null;
  }
}

/** The credential for this request, or null when nothing usable is set. */
export async function resolveCredential(
  ctx: PluginContext,
  userId: string,
): Promise<NetbirdCredential | null> {
  const mode = await authMode(ctx);
  if (mode !== "service") {
    const sso = await ssoToken(ctx, userId);
    if (sso) {
      return {
        header: `Bearer ${sso}`,
        source: "sso",
        identity: await ctx.secrets.get(IDENTITY_SECRET),
      };
    }
    const own = await userToken(ctx, userId);
    if (own) return { header: `Token ${own}`, source: "user", identity: null };
    if (mode === "user") return null;
  }
  const service = await serviceToken(ctx);
  return service
    ? { header: `Token ${service}`, source: "service", identity: null }
    : null;
}

export async function authStatus(
  ctx: PluginContext,
  userId: string,
): Promise<AuthStatus> {
  const mode = await authMode(ctx);
  await adoptFinishedLogin(ctx, userId);
  let ssoAvailable = false;
  try {
    ssoAvailable = mode !== "service" && (await readOidcConfig(ctx)) !== null;
  } catch {
    ssoAvailable = false;
  }
  const serviceTokenSet = (await serviceToken(ctx)).length > 0;
  const userTokenSet = (await userToken(ctx, userId)).length > 0;
  const ssoSignedIn =
    ssoAvailable && (await ctx.secrets.get(REFRESH_SECRET)) !== null;
  let active: CredentialSource | null = null;
  if (mode !== "service" && ssoSignedIn) active = "sso";
  else if (mode !== "service" && userTokenSet) active = "user";
  else if (mode !== "user" && serviceTokenSet) active = "service";
  return {
    mode,
    ssoAvailable,
    serviceTokenSet,
    userTokenSet,
    ssoSignedIn,
    ssoIdentity: ssoSignedIn ? await ctx.secrets.get(IDENTITY_SECRET) : null,
    active,
  };
}

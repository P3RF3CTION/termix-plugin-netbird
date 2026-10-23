import type { Request, Response, Router } from "express";
import type { PluginContext } from "@termix-ssh/plugin-sdk/backend";
import {
  authStatus,
  cacheToken,
  forgetSso,
  resolveCredential,
  type AuthStatus,
  type CredentialSource,
} from "./auth.js";
import {
  isPeerId,
  loadPeersAndPolicies,
  NetbirdApiError,
  netbirdGet,
} from "./netbird-api.js";
import {
  buildAuthorizeUrl,
  checkIdToken,
  discover,
  DONE_PREFIX,
  exchangeCode,
  type FinishedLogin,
  randomToken,
  readOidcConfig,
  STATE_PREFIX,
  STATE_TTL_MS,
  sweepStates,
  type PendingLogin,
} from "./oidc.js";
import {
  evaluate,
  explain,
  findPeer,
  type Explanation,
  type NetbirdPeer,
  type Reachability,
} from "./reachability.js";

export const CALLBACK_PATH = "/auth/callback";

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
  /** A Termix host with this IP and port exists for the user. */
  imported: boolean;
}

export interface PeersResponse {
  configured: boolean;
  /** Which credential was used; null when none fits. */
  source: CredentialSource | null;
  termixPeer: string | null;
  /** The Termix peer setting is filled in but matches no peer. */
  termixPeerMissing: boolean;
  /** False when the credential may list peers but not read policies. */
  policiesReadable: boolean;
  peers: PeerView[];
  error?: "token" | "api" | "signin";
}

export interface PeerDetail {
  id: string;
  name: string;
  ip: string;
  connectionIp: string | null;
  dnsLabel: string;
  extraDnsLabels: string[];
  hostname: string;
  os: string;
  kernel: string;
  version: string;
  connected: boolean;
  lastSeen: string | null;
  lastLogin: string | null;
  location: string | null;
  loginExpirationEnabled: boolean;
  loginExpired: boolean;
  approvalRequired: boolean;
  ephemeral: boolean;
  sshServerEnabled: boolean;
  accessiblePeers: number | null;
  groups: string[];
  explanation: Explanation;
  policiesReadable: boolean;
}

export interface ImportResult {
  created: Array<{ peerId: string; hostId: number; name: string }>;
  skipped: Array<{ peerId: string; reason: "exists" | "no-ip" | "unknown" }>;
  failed: Array<{ peerId: string }>;
}

function clampPort(value: unknown, fallback = 22): number {
  const n =
    typeof value === "number"
      ? value
      : Number.parseInt(String(value ?? ""), 10);
  return Number.isInteger(n) && n >= 1 && n <= 65535 ? n : fallback;
}

/** "22, 3389,5900" -> [22, 3389, 5900]; invalid entries are dropped. */
export function parsePorts(raw: unknown): number[] {
  return String(raw ?? "")
    .split(/[\s,;]+/)
    .map((v) => Number.parseInt(v, 10))
    .filter((n) => Number.isInteger(n) && n >= 1 && n <= 65535);
}

function plainIp(ip: string | undefined): string {
  return (ip ?? "").split("/")[0];
}

function groupNames(peer: NetbirdPeer): string[] {
  return (peer.groups ?? []).map((g) => g.name).filter((n) => n !== "All");
}

function sendError(res: Response, err: unknown, ctx: PluginContext) {
  const status = err instanceof NetbirdApiError ? err.status : 502;
  ctx.log.warn(`NetBird request failed: ${(err as Error).message}`);
  if (status === 401) return res.status(401).json({ error: "token" });
  if (status === 403) return res.status(403).json({ error: "forbidden" });
  if (status === 404) return res.status(404).json({ error: "not-found" });
  return res.status(502).json({ error: "api" });
}

function callbackPage(ok: boolean, message: string, origin: string): string {
  // No user or IdP text is placed in the page except the fixed message.
  const payload = JSON.stringify({ type: "netbird-sso", ok });
  const target = JSON.stringify(origin);
  return `<!doctype html><html><head><meta charset="utf-8"><title>NetBird</title></head><body style="font-family:sans-serif;padding:2rem">
<p>${message}</p>
<script>try{if(window.opener){window.opener.postMessage(${payload},${target});}}catch(e){}setTimeout(function(){window.close();},${ok ? 300 : 4000});</script>
</body></html>`;
}

export function registerRoutes(router: Router, ctx: PluginContext): void {
  const view = ctx.rbac.require("peers.view") as never;
  const importer = ctx.rbac.require("peers.import") as never;

  const actor = () => ctx.currentActor() as string;

  async function ownHostKeys(): Promise<Set<string>> {
    try {
      const hosts = await ctx.hosts.list();
      return new Set(hosts.map((h) => `${h.ip}:${h.port}`));
    } catch {
      return new Set();
    }
  }

  // ------------------------------------------------------------------ auth

  /**
   * @openapi
   * /plugin-api/netbird/auth/status:
   *   get:
   *     summary: How the signed-in user reaches the NetBird API
   *     description: >
   *       Reports the sign-in mode, whether single sign-on is set up, whether the
   *       user has a session or an own token, and the redirect URI to register at
   *       the identity provider. Requires netbird.peers.view.
   *     tags:
   *       - NetBird
   *     responses:
   *       200:
   *         description: The sign-in state.
   */
  router.get("/auth/status", view, async (req: Request, res: Response) => {
    const status: AuthStatus & { redirectUri: string } = {
      ...(await authStatus(ctx, actor())),
      redirectUri: `${ctx.http.baseUrl(req)}/plugin-api/${ctx.pluginId}${CALLBACK_PATH}`,
    };
    res.json(status);
  });

  /**
   * @openapi
   * /plugin-api/netbird/auth/login:
   *   post:
   *     summary: Start single sign-on
   *     description: >
   *       Returns the identity provider's authorization URL (code flow with PKCE)
   *       for a login window. The state is single use and expires after ten
   *       minutes. Requires netbird.peers.view.
   *     tags:
   *       - NetBird
   *     responses:
   *       200:
   *         description: The URL to open.
   *       409:
   *         description: Single sign-on is not set up or not enabled by the sign-in mode.
   *       502:
   *         description: The identity provider's discovery document could not be read.
   */
  router.post("/auth/login", view, async (req: Request, res: Response) => {
    const status = await authStatus(ctx, actor());
    if (!status.ssoAvailable) {
      return res.status(409).json({ error: "sso-not-configured" });
    }
    try {
      const config = (await readOidcConfig(ctx))!;
      const endpoints = await discover(ctx, config.issuer);
      await sweepStates(ctx);
      const login: PendingLogin = {
        userId: actor(),
        verifier: randomToken(48),
        nonce: randomToken(24),
        redirectUri: `${ctx.http.baseUrl(req)}/plugin-api/${ctx.pluginId}${CALLBACK_PATH}`,
        created: Date.now(),
      };
      const state = randomToken(32);
      await ctx.kv.set(`${STATE_PREFIX}${state}`, login);
      res.json({
        url: buildAuthorizeUrl(endpoints, config, { ...login, state }),
      });
    } catch (err) {
      ctx.log.warn(`SSO login could not start: ${(err as Error).message}`);
      res.status(502).json({ error: "idp" });
    }
  });

  /**
   * @openapi
   * /plugin-api/netbird/auth/callback:
   *   get:
   *     summary: Single sign-on callback (redirect URI)
   *     description: >
   *       The identity provider redirects the login window here. Public, because
   *       the IdP calls it: the single-use state binds the answer to the Termix
   *       user who started the login. Exchanges the code with PKCE, checks the ID
   *       token's issuer, audience and nonce, and stores the refresh token
   *       encrypted for that user.
   *     tags:
   *       - NetBird
   *     parameters:
   *       - in: query
   *         name: code
   *         schema:
   *           type: string
   *       - in: query
   *         name: state
   *         required: true
   *         schema:
   *           type: string
   *     responses:
   *       200:
   *         description: A small page that tells the opener and closes itself.
   *       400:
   *         description: Unknown, expired or used state, or the IdP returned an error.
   */
  router.get(CALLBACK_PATH, async (req: Request, res: Response) => {
    const origin = new URL(ctx.http.baseUrl(req)).origin;
    const state = typeof req.query.state === "string" ? req.query.state : "";
    const code = typeof req.query.code === "string" ? req.query.code : "";
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Content-Type", "text/html; charset=utf-8");

    const key = `${STATE_PREFIX}${state}`;
    const login =
      /^[A-Za-z0-9_-]{20,128}$/.test(state) &&
      ((await ctx.kv.get(key)) as PendingLogin | undefined);
    if (login) await ctx.kv.delete(key);
    if (!login || Date.now() - login.created > STATE_TTL_MS) {
      return res
        .status(400)
        .send(
          callbackPage(false, "Sign-in expired. Please try again.", origin),
        );
    }
    if (!code || typeof req.query.error === "string") {
      return res
        .status(400)
        .send(callbackPage(false, "Sign-in was cancelled.", origin));
    }

    try {
      const config = (await readOidcConfig(ctx))!;
      const endpoints = await discover(ctx, config.issuer);
      const tokens = await exchangeCode(ctx, endpoints, config, code, login);
      const check = checkIdToken(tokens.id_token, config, login.nonce);
      if (check.ok === false) throw new Error(check.reason);
      const token = config.useIdToken ? tokens.id_token : tokens.access_token;
      if (!token) throw new Error("token endpoint returned no token");
      if (!tokens.refresh_token) {
        throw new Error(
          "no refresh token (add offline_access to the scopes or allow refresh tokens for the client)",
        );
      }
      const finished: FinishedLogin = {
        sealed: await ctx.secrets.seal(tokens.refresh_token),
        identity: check.name,
        created: Date.now(),
      };
      await ctx.kv.set(`${DONE_PREFIX}${login.userId}`, finished);
      cacheToken(login.userId, token, tokens.expires_in);
      return res.send(
        callbackPage(true, "Signed in. You can close this window.", origin),
      );
    } catch (err) {
      ctx.log.warn(`SSO callback failed: ${(err as Error).message}`);
      return res
        .status(400)
        .send(
          callbackPage(
            false,
            "Sign-in failed. The Termix log has the reason.",
            origin,
          ),
        );
    }
  });

  /**
   * @openapi
   * /plugin-api/netbird/auth/logout:
   *   post:
   *     summary: End the user's NetBird single sign-on session in Termix
   *     tags:
   *       - NetBird
   *     responses:
   *       200:
   *         description: The stored session is gone.
   */
  router.post("/auth/logout", view, async (_req: Request, res: Response) => {
    await forgetSso(ctx, actor());
    res.json({ success: true });
  });

  // ----------------------------------------------------------------- peers

  /**
   * @openapi
   * /plugin-api/netbird/peers:
   *   get:
   *     summary: List NetBird peers with an SSH reachability check
   *     description: >
   *       Reads peers and access policies from the NetBird management API with the
   *       user's single sign-on session, the user's own token or the service
   *       token (see the sign-in mode), and reports per peer whether a policy lets
   *       the Termix server's own peer open TCP to the SSH port, and whether a
   *       Termix host with that address already exists. Requires
   *       netbird.peers.view.
   *     tags:
   *       - NetBird
   *     responses:
   *       200:
   *         description: Peers; configured=false when no credential fits.
   *       401:
   *         description: NetBird rejected the credential.
   *       502:
   *         description: The NetBird management API could not be read.
   */
  router.get("/peers", view, async (_req: Request, res: Response) => {
    const base: PeersResponse = {
      configured: false,
      source: null,
      termixPeer: null,
      termixPeerMissing: false,
      policiesReadable: true,
      peers: [],
    };
    const credential = await resolveCredential(ctx, actor());
    if (!credential) {
      const status = await authStatus(ctx, actor());
      return res.json({
        ...base,
        error: status.mode === "service" ? undefined : "signin",
      });
    }

    try {
      const { peers, policies, policiesReadable } = await loadPeersAndPolicies(
        ctx,
        credential,
      );
      const sshPort = clampPort(await ctx.settings.get<number>("sshPort"));
      const reference = (
        (await ctx.settings.get<string>("termixPeer")) ?? ""
      ).trim();
      const termix = reference ? findPeer(peers, reference) : null;
      const existing = await ownHostKeys();

      const body: PeersResponse = {
        configured: true,
        source: credential.source,
        termixPeer: termix?.name ?? null,
        termixPeerMissing: reference.length > 0 && termix === null,
        policiesReadable,
        peers: peers
          .map((p) => {
            const ip = plainIp(p.ip);
            return {
              id: p.id,
              name: p.name,
              ip,
              dnsLabel: p.dns_label ?? "",
              os: p.os ?? "",
              connected: p.connected === true,
              lastSeen: p.last_seen ?? null,
              groups: groupNames(p),
              sshPort,
              reachability: policiesReadable
                ? evaluate(policies, termix, p, sshPort)
                : {
                    state: "unknown" as const,
                    policies: [],
                    postureChecks: false,
                  },
              imported: ip.length > 0 && existing.has(`${ip}:${sshPort}`),
            };
          })
          .sort((a, b) => a.name.localeCompare(b.name)),
      };
      return res.json(body);
    } catch (err) {
      const status = err instanceof NetbirdApiError ? err.status : 502;
      ctx.log.warn(
        `NetBird peers could not be read: ${(err as Error).message}`,
      );
      return res.status(status === 401 ? 401 : 502).json({
        ...base,
        configured: true,
        source: credential.source,
        error: status === 401 ? "token" : "api",
      });
    }
  });

  /**
   * @openapi
   * /plugin-api/netbird/peers/{peerId}:
   *   get:
   *     summary: One peer with details and a per-port policy explanation
   *     description: >
   *       Version, location, login expiry, accessible peers and, for the SSH port
   *       and the ports in the "Ports to check" setting, which policy rule allows
   *       the Termix peer to reach it, which rules connect the two on other ports
   *       and which matching rules are switched off. Requires netbird.peers.view.
   *     tags:
   *       - NetBird
   *     parameters:
   *       - in: path
   *         name: peerId
   *         required: true
   *         schema:
   *           type: string
   *     responses:
   *       200:
   *         description: The peer.
   *       400:
   *         description: Invalid peer id.
   *       404:
   *         description: No such peer, or not visible with this credential.
   */
  router.get("/peers/:peerId", view, async (req: Request, res: Response) => {
    const peerId = req.params.peerId;
    if (!isPeerId(peerId)) return res.status(400).json({ error: "peer-id" });
    const credential = await resolveCredential(ctx, actor());
    if (!credential) return res.status(412).json({ error: "signin" });

    try {
      const [{ peers, policies, policiesReadable }, peer] = await Promise.all([
        loadPeersAndPolicies(ctx, credential),
        netbirdGet<NetbirdPeer>(ctx, credential, `/peers/${peerId}`),
      ]);
      let accessible: number | null =
        typeof peer.accessible_peers_count === "number"
          ? peer.accessible_peers_count
          : null;
      if (accessible === null) {
        try {
          const list = await netbirdGet<unknown[]>(
            ctx,
            credential,
            `/peers/${peerId}/accessible-peers`,
          );
          accessible = Array.isArray(list) ? list.length : null;
        } catch {
          accessible = null;
        }
      }
      const sshPort = clampPort(await ctx.settings.get<number>("sshPort"));
      const extraPorts = parsePorts(
        await ctx.settings.get<string>("checkPorts"),
      );
      const reference = (
        (await ctx.settings.get<string>("termixPeer")) ?? ""
      ).trim();
      const termix = reference ? findPeer(peers, reference) : null;
      const location = [peer.city_name, peer.country_code]
        .filter((v) => v)
        .join(", ");

      const detail: PeerDetail = {
        id: peer.id,
        name: peer.name,
        ip: plainIp(peer.ip),
        connectionIp: peer.connection_ip ?? null,
        dnsLabel: peer.dns_label ?? "",
        extraDnsLabels: peer.extra_dns_labels ?? [],
        hostname: peer.hostname ?? "",
        os: peer.os ?? "",
        kernel: peer.kernel_version ?? "",
        version: peer.version ?? "",
        connected: peer.connected === true,
        lastSeen: peer.last_seen ?? null,
        lastLogin: peer.last_login ?? null,
        location: location || null,
        loginExpirationEnabled: peer.login_expiration_enabled === true,
        loginExpired: peer.login_expired === true,
        approvalRequired: peer.approval_required === true,
        ephemeral: peer.ephemeral === true,
        sshServerEnabled: peer.ssh_enabled === true,
        accessiblePeers: accessible,
        groups: groupNames(peer),
        explanation: policiesReadable
          ? explain(policies, termix, peer, [sshPort, ...extraPorts])
          : explain([], null, peer, [sshPort, ...extraPorts]),
        policiesReadable,
      };
      return res.json(detail);
    } catch (err) {
      return sendError(res, err, ctx);
    }
  });

  // ---------------------------------------------------------------- import

  /**
   * @openapi
   * /plugin-api/netbird/credentials:
   *   get:
   *     summary: The user's saved credentials, for the import dialog
   *     description: Names and ids only, no secrets. Requires netbird.peers.import.
   *     tags:
   *       - NetBird
   *     responses:
   *       200:
   *         description: Credential summaries.
   */
  router.get("/credentials", importer, async (_req: Request, res: Response) => {
    try {
      const list = await ctx.credentials.list();
      res.json(
        list.map((c) => ({
          id: c.id,
          name: c.name,
          username: c.username ?? "",
        })),
      );
    } catch (err) {
      ctx.log.warn(
        `Credentials could not be listed: ${(err as Error).message}`,
      );
      res.json([]);
    }
  });

  /**
   * @openapi
   * /plugin-api/netbird/hosts/import:
   *   post:
   *     summary: Add the selected NetBird peers as Termix hosts
   *     description: >
   *       Creates one host per peer for the signed-in user, with the NetBird IP,
   *       in the given folder. A peer whose IP and port already exist as a host is
   *       skipped. The peers are read from NetBird again, so only peers the
   *       user's credential can see are imported. Requires netbird.peers.import.
   *     tags:
   *       - NetBird
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [peerIds]
   *             properties:
   *               peerIds:
   *                 type: array
   *                 items:
   *                   type: string
   *               folder:
   *                 type: string
   *               username:
   *                 type: string
   *               port:
   *                 type: integer
   *               credentialId:
   *                 type: integer
   *                 nullable: true
   *               tagGroups:
   *                 type: boolean
   *     responses:
   *       200:
   *         description: Created, skipped and failed peers.
   *       400:
   *         description: Invalid request.
   */
  router.post(
    "/hosts/import",
    importer,
    async (req: Request, res: Response) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const peerIds = Array.isArray(body.peerIds)
        ? [...new Set(body.peerIds.filter(isPeerId))]
        : [];
      if (peerIds.length === 0 || peerIds.length > 200) {
        return res.status(400).json({ error: "peerIds" });
      }
      const folder =
        typeof body.folder === "string" ? body.folder.trim().slice(0, 100) : "";
      const username =
        typeof body.username === "string"
          ? body.username.trim().slice(0, 64)
          : "";
      const port = clampPort(
        body.port,
        clampPort(await ctx.settings.get<number>("sshPort")),
      );
      const credentialId =
        typeof body.credentialId === "number" &&
        Number.isInteger(body.credentialId)
          ? body.credentialId
          : null;
      const tagGroups = body.tagGroups !== false;

      const credential = await resolveCredential(ctx, actor());
      if (!credential) return res.status(412).json({ error: "signin" });

      let peers: NetbirdPeer[];
      try {
        peers = await netbirdGet<NetbirdPeer[]>(ctx, credential, "/peers");
      } catch (err) {
        return sendError(res, err, ctx);
      }
      if (credentialId !== null) {
        const own = await ctx.credentials.list().catch(() => []);
        if (!own.some((c) => c.id === credentialId)) {
          return res.status(400).json({ error: "credentialId" });
        }
      }

      const byId = new Map(peers.map((p) => [p.id, p]));
      const existing = await ownHostKeys();
      const result: ImportResult = { created: [], skipped: [], failed: [] };
      if (folder) {
        await ctx.hosts.folders
          .ensure(folder, { icon: "Network" })
          .catch(() => undefined);
      }

      for (const peerId of peerIds) {
        const peer = byId.get(peerId);
        if (!peer) {
          result.skipped.push({ peerId, reason: "unknown" });
          continue;
        }
        const ip = plainIp(peer.ip);
        if (!ip) {
          result.skipped.push({ peerId, reason: "no-ip" });
          continue;
        }
        if (existing.has(`${ip}:${port}`)) {
          result.skipped.push({ peerId, reason: "exists" });
          continue;
        }
        try {
          const host = await ctx.hosts.create({
            name: peer.name,
            // The NetBird IP, not the DNS label: the label only resolves where
            // NetBird DNS is on, which servers often switch off.
            ip,
            port,
            username,
            authType: credentialId !== null ? "credential" : "none",
            credentialId,
            folder: folder || null,
            tags: tagGroups ? ["netbird", ...groupNames(peer)] : ["netbird"],
            notes: `NetBird peer ${peer.name} (${peer.id})`,
          });
          existing.add(`${ip}:${port}`);
          result.created.push({ peerId, hostId: host.id, name: peer.name });
        } catch (err) {
          ctx.log.warn(
            `Host for peer ${peer.id} could not be created: ${(err as Error).message}`,
          );
          result.failed.push({ peerId });
        }
      }
      return res.json(result);
    },
  );
}

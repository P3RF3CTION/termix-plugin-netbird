import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import express, { type Router } from "express";
import {
  createMockCtx,
  type MockPluginContext,
} from "@termix-ssh/plugin-sdk/testing";
import type { PluginManifest } from "@termix-ssh/plugin-sdk/manifest";
import manifestJson from "../../manifest.json";
import { activate } from "../../src/backend/index.js";

const manifest = manifestJson as unknown as PluginManifest;
const ISSUER = "https://idp.example.com/oauth2";

const peers = [
  {
    id: "p-termix",
    name: "termix",
    ip: "100.79.103.251",
    groups: [{ id: "g-t", name: "Termix" }],
  },
  {
    id: "p-web",
    name: "web-1",
    ip: "100.79.10.10",
    groups: [
      { id: "g-all", name: "All" },
      { id: "g-w", name: "Web" },
    ],
  },
  { id: "p-db", name: "db-1", ip: "100.79.10.20", groups: [] },
];

function b64(v: unknown) {
  return Buffer.from(JSON.stringify(v)).toString("base64url");
}
function jwt(payload: Record<string, unknown>) {
  return `${b64({ alg: "RS256" })}.${b64(payload)}.sig`;
}

let mock: MockPluginContext;
let server: http.Server;
let port: number;
let lastNonce = "";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function start(permissions: string[], hosts: unknown[] = []) {
  let router: Router | null = null;
  mock = createMockCtx({
    pluginId: manifest.id,
    manifest,
    capabilities: manifest.capabilities,
    router: () => (router = express.Router()),
    permissions,
    hosts: hosts as never,
    credentialSummaries: [
      {
        id: 7,
        name: "deploy key",
        username: "deploy",
        authType: "key",
        folder: null,
      },
    ] as never,
    fetch: async (url, init) => {
      if (url === `${ISSUER}/.well-known/openid-configuration`) {
        return json({
          issuer: ISSUER,
          authorization_endpoint: `${ISSUER}/auth`,
          token_endpoint: `${ISSUER}/token`,
        });
      }
      if (url === `${ISSUER}/token`) {
        const form = new URLSearchParams(init?.body ?? "");
        if (form.get("grant_type") === "authorization_code") {
          expect(form.get("code_verifier")).toBeTruthy();
          return json({
            access_token: jwt({ exp: Math.floor(Date.now() / 1000) + 600 }),
            refresh_token: "rt-1",
            id_token: jwt({
              iss: ISSUER,
              aud: "netbird-dashboard",
              nonce: lastNonce,
              sub: "u-1",
              preferred_username: "max",
              exp: Math.floor(Date.now() / 1000) + 600,
            }),
          });
        }
        return json({ error: "invalid_grant" }, 400);
      }
      if (url.endsWith("/api/peers")) return json(peers);
      if (url.endsWith("/api/policies")) return json([]);
      if (url.endsWith("/api/peers/p-web")) {
        return json({
          ...peers[1],
          version: "0.60.0",
          accessible_peers_count: 3,
        });
      }
      return json({}, 404);
    },
  });
  await activate(mock.ctx);
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    if (!req.path.endsWith("/auth/callback")) mock.setActor("user-1");
    next();
  });
  app.use((req, res, next) => router!(req, res, next));
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  port = (server.address() as AddressInfo).port;
}

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

async function call(method: string, path: string, body?: unknown) {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    redirect: "manual",
  });
  const text = await response.text();
  let parsed: unknown = text;
  try {
    parsed = JSON.parse(text);
  } catch {
    // HTML
  }
  return { status: response.status, body: parsed as Record<string, unknown> };
}

async function configureSso() {
  await mock.ctx.settings.set("managementUrl", "https://vpn.example.com");
  await mock.ctx.settings.set("authMode", "user");
  await mock.ctx.settings.set("oidcIssuer", ISSUER);
  await mock.ctx.settings.set("oidcClientId", "netbird-dashboard");
}

describe("single sign-on", () => {
  it("asks to sign in when the mode wants an own sign-in", async () => {
    await start(["netbird.peers.view"]);
    await configureSso();
    const res = await call("GET", "/peers");
    expect(res.body.error).toBe("signin");
    expect(mock.fetches.some((f) => f.url.includes("/api/"))).toBe(false);
  });

  it("signs in through the callback and then calls NetBird with the bearer token", async () => {
    await start(["netbird.peers.view"]);
    await configureSso();

    const login = await call("POST", "/auth/login");
    expect(login.status).toBe(200);
    const url = new URL(String(login.body.url));
    const state = url.searchParams.get("state")!;
    lastNonce = url.searchParams.get("nonce")!;
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");

    const cb = await call(
      "GET",
      `/auth/callback?code=c-1&state=${encodeURIComponent(state)}`,
    );
    expect(cb.status).toBe(200);

    // The state is single use.
    const again = await call(
      "GET",
      `/auth/callback?code=c-1&state=${encodeURIComponent(state)}`,
    );
    expect(again.status).toBe(400);

    const status = await call("GET", "/auth/status");
    expect(status.body).toMatchObject({
      ssoSignedIn: true,
      ssoIdentity: "max",
      active: "sso",
    });

    const list = await call("GET", "/peers");
    expect(list.status).toBe(200);
    expect(list.body.source).toBe("sso");
    const peersCall = mock.fetches.find((f) => f.url.endsWith("/api/peers"));
    expect(String(peersCall?.init?.headers?.Authorization)).toMatch(/^Bearer /);

    await call("POST", "/auth/logout");
    const after = await call("GET", "/auth/status");
    expect(after.body.ssoSignedIn).toBe(false);
  });

  it("refuses an unknown state", async () => {
    await start(["netbird.peers.view"]);
    await configureSso();
    const cb = await call(
      "GET",
      `/auth/callback?code=c-1&state=${"x".repeat(43)}`,
    );
    expect(cb.status).toBe(400);
  });

  it("falls back to the service token in user-or-service mode", async () => {
    await start(["netbird.peers.view"]);
    await configureSso();
    await mock.ctx.settings.set("authMode", "user-or-service");
    await mock.ctx.settings.set("apiToken", "nbp_service");
    const res = await call("GET", "/peers");
    expect(res.body.source).toBe("service");
  });
});

describe("POST /hosts/import", () => {
  it("creates hosts for the selected peers and skips existing ones", async () => {
    await start(
      ["netbird.peers.view", "netbird.peers.import"],
      [
        {
          id: 1,
          userId: "user-1",
          name: "db",
          ip: "100.79.10.20",
          port: 22,
          username: "root",
          tags: null,
          folder: null,
          authType: "password",
        },
      ],
    );
    await mock.ctx.settings.set("apiToken", "nbp_service");
    const res = await call("POST", "/hosts/import", {
      peerIds: ["p-web", "p-db", "nope"],
      folder: "NetBird",
      username: "admin",
      port: 22,
      credentialId: 7,
    });
    expect(res.status).toBe(200);
    expect(res.body.created).toEqual([
      expect.objectContaining({ peerId: "p-web", name: "web-1" }),
    ]);
    expect(res.body.skipped).toEqual(
      expect.arrayContaining([
        { peerId: "p-db", reason: "exists" },
        { peerId: "nope", reason: "unknown" },
      ]),
    );
  });

  it("refuses a credential the user does not own", async () => {
    await start(["netbird.peers.view", "netbird.peers.import"]);
    await mock.ctx.settings.set("apiToken", "nbp_service");
    const res = await call("POST", "/hosts/import", {
      peerIds: ["p-web"],
      credentialId: 99,
    });
    expect(res.status).toBe(400);
  });

  it("needs netbird.peers.import", async () => {
    await start(["netbird.peers.view"]);
    const res = await call("POST", "/hosts/import", { peerIds: ["p-web"] });
    expect(res.status).toBe(403);
  });
});

describe("GET /peers/:peerId and /credentials", () => {
  it("returns the details with the access explanation", async () => {
    await start(["netbird.peers.view"]);
    await mock.ctx.settings.set("apiToken", "nbp_service");
    await mock.ctx.settings.set("termixPeer", "termix");
    const res = await call("GET", "/peers/p-web");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ accessiblePeers: 3 });
    expect(JSON.stringify(res.body)).toContain("0.60.0");
  });

  it("refuses a malformed peer id", async () => {
    await start(["netbird.peers.view"]);
    await mock.ctx.settings.set("apiToken", "nbp_service");
    const res = await call("GET", "/peers/..%2Fpolicies");
    expect(res.status).toBe(400);
  });

  it("lists only id, name and username of the user's credentials", async () => {
    await start(["netbird.peers.view", "netbird.peers.import"]);
    const res = await call("GET", "/credentials");
    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      { id: 7, name: "deploy key", username: "deploy" },
    ]);
  });
});

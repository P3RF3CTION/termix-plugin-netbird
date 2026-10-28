// 1.2.0: why a personal access token shows nothing, and the fallback.
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
import { normalizeToken } from "../../src/backend/auth.js";

const manifest = manifestJson as unknown as PluginManifest;

const allPeers = [
  {
    id: "p-a",
    name: "alpha",
    ip: "100.64.0.1",
    connected: true,
    ssh_enabled: true,
    groups: [{ id: "g1", name: "Server" }],
  },
  {
    id: "p-b",
    name: "beta",
    ip: "100.64.0.2",
    connected: false,
    login_expired: true,
    approval_required: true,
    groups: [{ id: "g2", name: "Laptops" }],
  },
];

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** NetBird stand-in: answers per token. */
type Behaviour = { peers: number; role: string; name: string };
let tokens: Record<string, Behaviour> = {};

let mock: MockPluginContext;
let server: http.Server | null = null;
let port: number;

async function start() {
  let router: Router | null = null;
  mock = createMockCtx({
    pluginId: manifest.id,
    manifest,
    capabilities: manifest.capabilities,
    router: () => (router = express.Router()),
    permissions: ["netbird.peers.view"],
    fetch: async (url, init) => {
      const auth = String(
        (init?.headers as Record<string, string> | undefined)?.Authorization ??
          "",
      );
      const b = tokens[auth.replace(/^Token /, "")];
      if (!b) return json({ message: "unauthorized" }, 401);
      if (url.endsWith("/api/users/current")) {
        return json({ name: b.name, role: b.role, is_service_user: false });
      }
      if (url.endsWith("/api/peers")) {
        return b.peers < 0
          ? json({ message: "forbidden" }, 403)
          : json(allPeers.slice(0, b.peers));
      }
      if (url.endsWith("/api/policies")) return json([], 403);
      return json({}, 404);
    },
  });
  await activate(mock.ctx);
  const app = express();
  app.use((_req, _res, next) => {
    mock.setActor("user-1");
    next();
  });
  app.use((req, res, next) => router!(req, res, next));
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  port = (server!.address() as AddressInfo).port;
}

async function get(path: string) {
  const response = await fetch(`http://127.0.0.1:${port}${path}`);
  return { status: response.status, body: await response.json() };
}

afterEach(async () => {
  tokens = {};
  if (!server) return;
  const running = server;
  server = null;
  await new Promise<void>((resolve) => running.close(() => resolve()));
});

describe("normalizeToken", () => {
  it("strips the scheme, quotes and whitespace people paste along", () => {
    expect(normalizeToken("nbp_abc")).toBe("nbp_abc");
    expect(normalizeToken("  Token nbp_abc \n")).toBe("nbp_abc");
    expect(normalizeToken("Bearer nbp_abc")).toBe("nbp_abc");
    expect(normalizeToken('"nbp_abc"')).toBe("nbp_abc");
    expect(normalizeToken("nbp_a\nbc")).toBe("nbp_abc");
    expect(normalizeToken(undefined)).toBe("");
  });
});

describe("personal access token diagnostics", () => {
  it("uses a pasted 'Token nbp_...' value and names a restricted role", async () => {
    tokens = { nbp_own: { peers: 1, role: "user", name: "Max" } };
    await start();
    await mock.ctx.settings.set("authMode", "user");
    await mock.ctx.settings.setUser("user-1", "userApiToken", "Token nbp_own");
    const res = await get("/peers");
    expect(res.status).toBe(200);
    expect(res.body.source).toBe("user");
    expect(res.body.identity).toMatchObject({ name: "Max", role: "user" });
    expect(res.body.restricted).toBe(true);
    expect(res.body.peers).toHaveLength(1);
  });

  it("falls back to the service token when NetBird rejects the own token", async () => {
    tokens = { nbp_service: { peers: 2, role: "admin", name: "svc" } };
    await start();
    await mock.ctx.settings.set("authMode", "user-or-service");
    await mock.ctx.settings.set("apiToken", "nbp_service");
    await mock.ctx.settings.setUser("user-1", "userApiToken", "nbp_revoked");
    const res = await get("/peers");
    expect(res.status).toBe(200);
    expect(res.body.source).toBe("service");
    expect(res.body.fallbackFrom).toBe("user");
    expect(res.body.restricted).toBe(false);
    const beta = res.body.peers.find((p: { id: string }) => p.id === "p-b");
    expect(beta).toMatchObject({
      loginExpired: true,
      approvalRequired: true,
      sshEnabled: false,
    });
  });

  it("does not fall back in the 'user' mode", async () => {
    tokens = { nbp_service: { peers: 2, role: "admin", name: "svc" } };
    await start();
    await mock.ctx.settings.set("authMode", "user");
    await mock.ctx.settings.set("apiToken", "nbp_service");
    await mock.ctx.settings.setUser("user-1", "userApiToken", "nbp_revoked");
    const res = await get("/peers");
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("token");
  });

  it("names a valid token that may not list peers", async () => {
    tokens = { nbp_blocked: { peers: -1, role: "user", name: "Max" } };
    await start();
    await mock.ctx.settings.set("apiToken", "nbp_blocked");
    const res = await get("/peers");
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("forbidden");
  });

  it("reports an own token that the 'service' mode ignores", async () => {
    await start();
    await mock.ctx.settings.setUser("user-1", "userApiToken", "nbp_own");
    const res = await get("/auth/status");
    expect(res.body.mode).toBe("service");
    expect(res.body.userTokenIgnored).toBe(true);
  });
});

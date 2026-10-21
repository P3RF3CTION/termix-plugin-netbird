import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import express, { type Router } from "express";
import {
  createMockCtx,
  type MockPluginContext,
} from "@termix-ssh/plugin-sdk/testing";
import type { PluginManifest } from "@termix-ssh/plugin-sdk/manifest";
import manifestJson from "../../manifest.json";
import { activate } from "../../src/backend/index.js";

const manifest = manifestJson as unknown as PluginManifest;

const peers = [
  {
    id: "p-termix",
    name: "termix",
    ip: "100.79.103.251",
    connected: true,
    groups: [
      { id: "g-all", name: "All" },
      { id: "g-t", name: "Termix" },
    ],
  },
  {
    id: "p-oracle",
    name: "oracle-2",
    ip: "100.79.185.105",
    os: "Ubuntu 26.04",
    connected: true,
    last_seen: "2026-10-21T09:00:00Z",
    groups: [
      { id: "g-all", name: "All" },
      { id: "g-o", name: "Oracle" },
    ],
  },
];
const policies = [
  {
    id: "pol-1",
    name: "Termix zu Oracle (SSH)",
    enabled: true,
    rules: [
      {
        enabled: true,
        action: "accept",
        protocol: "tcp",
        ports: ["2222"],
        sources: [{ id: "g-t", name: "Termix" }],
        destinations: [{ id: "g-o", name: "Oracle" }],
      },
    ],
  },
];

let mock: MockPluginContext;
let server: http.Server;
let port: number;
let apiStatus = 200;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function start(permissions: string[]) {
  let router: Router | null = null;
  mock = createMockCtx({
    pluginId: manifest.id,
    manifest,
    capabilities: manifest.capabilities,
    router: () => (router = express.Router()),
    permissions,
    fetch: async (url) => {
      if (apiStatus !== 200) return json({ message: "no" }, apiStatus);
      if (url.endsWith("/api/peers")) return json(peers);
      if (url.endsWith("/api/policies")) return json(policies);
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
  port = (server.address() as AddressInfo).port;
}

async function get(path: string) {
  const response = await fetch(`http://127.0.0.1:${port}${path}`);
  return { status: response.status, body: await response.json() };
}

beforeEach(() => {
  apiStatus = 200;
});

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("GET /peers", () => {
  it("reports not configured without a token and never calls NetBird", async () => {
    await start(["netbird.peers.view"]);
    const res = await get("/peers");
    expect(res.status).toBe(200);
    expect(res.body.configured).toBe(false);
    expect(mock.fetches).toHaveLength(0);
  });

  it("lists peers with reachability from the Termix peer", async () => {
    await start(["netbird.peers.view"]);
    await mock.ctx.settings.set("apiToken", "nbp_test");
    await mock.ctx.settings.set("managementUrl", "https://vpn.example.com/");
    await mock.ctx.settings.set("termixPeer", "termix");
    await mock.ctx.settings.set("sshPort", 2222);

    const res = await get("/peers");
    expect(res.status).toBe(200);
    expect(res.body.termixPeer).toBe("termix");
    const oracle = res.body.peers.find(
      (p: { id: string }) => p.id === "p-oracle",
    );
    expect(oracle).toMatchObject({
      ip: "100.79.185.105",
      groups: ["Oracle"],
      sshPort: 2222,
      reachability: { state: "allowed", policies: ["Termix zu Oracle (SSH)"] },
    });

    // The token goes to the configured server only, as a NetBird token header.
    expect(mock.fetches.map((f) => f.url).sort()).toEqual([
      "https://vpn.example.com/api/peers",
      "https://vpn.example.com/api/policies",
    ]);
    expect(mock.fetches[0].init?.headers?.Authorization).toBe("Token nbp_test");
  });

  it("names a rejected token", async () => {
    await start(["netbird.peers.view"]);
    await mock.ctx.settings.set("apiToken", "nbp_wrong");
    apiStatus = 401;
    const res = await get("/peers");
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("token");
  });

  it("refuses users without netbird.peers.view", async () => {
    await start([]);
    const res = await fetch(`http://127.0.0.1:${port}/peers`);
    expect(res.status).toBe(403);
  });
});

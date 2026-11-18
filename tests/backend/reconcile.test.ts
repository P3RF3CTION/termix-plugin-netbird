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
import {
  isNetbirdIp,
  peerIdFromNotes,
  reconcile,
  type ReconcileHost,
} from "../../src/backend/reconcile.js";
import type { NetbirdPeer } from "../../src/backend/reachability.js";

const manifest = manifestJson as unknown as PluginManifest;
const NOW = Date.parse("2026-11-16T12:00:00Z");
const daysAgo = (d: number) => new Date(NOW - d * 86_400_000).toISOString();

const peers: NetbirdPeer[] = [
  { id: "p-web", name: "web-1", ip: "100.64.0.31", connected: true },
  {
    id: "p-old",
    name: "old-1",
    ip: "100.64.0.50",
    connected: false,
    last_seen: daysAgo(90),
    login_expired: true,
  },
  {
    id: "p-nap",
    name: "nap-1",
    ip: "100.64.0.60",
    connected: false,
    last_seen: daysAgo(2),
  },
];

const host = (
  id: number,
  ip: string,
  extra: Partial<ReconcileHost> = {},
): ReconcileHost => ({
  id,
  name: `host-${id}`,
  ip,
  port: 22,
  tags: "netbird",
  notes: null,
  ...extra,
});

describe("reconcile (pure)", () => {
  it("reads the peer id the import wrote and knows NetBird addresses", () => {
    expect(peerIdFromNotes("NetBird peer web-1 (p-web)")).toBe("p-web");
    expect(peerIdFromNotes("my own notes")).toBeNull();
    expect(isNetbirdIp("100.64.0.1")).toBe(true);
    expect(isNetbirdIp("100.127.255.254")).toBe(true);
    expect(isNetbirdIp("100.128.0.1")).toBe(false);
    expect(isNetbirdIp("192.168.1.10")).toBe(false);
  });

  const hosts = [
    // Imported, peer moved from .30 to .31.
    host(1, "100.64.0.30", { notes: "NetBird peer web-1 (p-web)" }),
    // Imported, peer deleted in NetBird.
    host(2, "100.64.0.40", { notes: "NetBird peer db-1 (p-gone)" }),
    // Offline for 90 days.
    host(3, "100.64.0.50", { notes: "NetBird peer old-1 (p-old)" }),
    // Offline for 2 days, matched by IP without notes.
    host(4, "100.64.0.60"),
    // Not NetBird at all: left alone.
    host(5, "192.168.1.5", { tags: null }),
    // Tagged netbird, NetBird IP, no peer there: missing.
    host(6, "100.64.0.99"),
    // Up to date and online: no finding.
    host(7, "100.64.0.31", { notes: "NetBird peer web-1 (p-web)" }),
  ];

  it("finds gone, moved, stale and offline hosts", () => {
    const findings = reconcile(hosts, peers, {
      staleDays: 30,
      complete: true,
      now: NOW,
    });
    expect(
      findings.map((f) => [f.hostId, f.kind, f.actions.join("+")]),
    ).toEqual([
      [2, "missing", "delete"],
      [6, "missing", "delete"],
      [1, "ip-changed", "update-ip+delete"],
      [3, "stale", "delete"],
      [4, "offline", ""],
    ]);
    expect(findings.find((f) => f.hostId === 1)?.peerIp).toBe("100.64.0.31");
    expect(findings.find((f) => f.hostId === 3)).toMatchObject({
      offlineDays: 90,
      loginExpired: true,
    });
  });

  it("offers no removal of a missing peer when the sign-in sees only some peers", () => {
    const findings = reconcile(hosts, peers, {
      staleDays: 30,
      complete: false,
      now: NOW,
    });
    const missing = findings.filter((f) => f.kind === "missing");
    expect(missing).toHaveLength(2);
    expect(missing.every((f) => !f.certain && f.actions.length === 0)).toBe(
      true,
    );
  });

  it("switches stale detection off with 0 days", () => {
    const findings = reconcile(hosts, peers, {
      staleDays: 0,
      complete: true,
      now: NOW,
    });
    expect(findings.find((f) => f.hostId === 3)?.kind).toBe("offline");
  });
});

// ------------------------------------------------------------------ routes

let mock: MockPluginContext;
let server: http.Server | undefined;
let port: number;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function start(permissions: string[], role = "admin") {
  let router: Router | null = null;
  mock = createMockCtx({
    sandbox: true,
    pluginId: manifest.id,
    manifest,
    capabilities: manifest.capabilities,
    router: () => (router = express.Router()),
    permissions,
    fetch: async (url) => {
      if (url.endsWith("/api/peers")) {
        // last_seen relative to the real clock, so "stale" holds today.
        return json(
          peers.map((p) =>
            p.id === "p-old"
              ? {
                  ...p,
                  last_seen: new Date(
                    Date.now() - 90 * 86_400_000,
                  ).toISOString(),
                }
              : p,
          ),
        );
      }
      if (url.endsWith("/api/users/current")) {
        return json({ name: "svc", role, is_service_user: role !== "user" });
      }
      return json({}, 404);
    },
  });
  await activate(mock.ctx);
  await mock.ctx.settings.set("apiToken", "nbp_service");
  mock.setActor("user-1");
  for (const [ip, notes] of [
    ["100.64.0.30", "NetBird peer web-1 (p-web)"],
    ["100.64.0.40", "NetBird peer db-1 (p-gone)"],
    ["100.64.0.50", "NetBird peer old-1 (p-old)"],
    ["100.64.0.31", "NetBird peer web-2 (p-other)"],
  ]) {
    await mock.ctx.hosts.create({
      name: notes.split(" ")[2],
      ip,
      port: 22,
      username: "root",
      authType: "none",
      tags: ["netbird"],
      notes,
    } as never);
  }
  const app = express();
  app.use(express.json());
  app.use((_req, _res, next) => {
    mock.setActor("user-1");
    next();
  });
  app.use((req, res, next) => router!(req, res, next));
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  port = (server.address() as AddressInfo).port;
}

afterEach(async () => {
  if (!server) return;
  await new Promise<void>((resolve) => server!.close(() => resolve()));
  server = undefined;
});

async function call(method: string, path: string, body?: unknown) {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  return {
    status: response.status,
    body: (await response.json()) as Record<string, unknown>,
  };
}

async function hostIdByIp(ip: string): Promise<number> {
  const owned = await mock.ctx.hosts.listOwned();
  return owned.find((h) => h.ip === ip)!.id;
}

describe("/hosts/reconcile", () => {
  it("needs the reconcile permission", async () => {
    await start(["netbird.peers.view", "netbird.peers.import"]);
    const res = await call("GET", "/hosts/reconcile");
    expect(res.status).toBe(403);
  });

  it("lists the findings for the user's own hosts", async () => {
    await start(["netbird.peers.reconcile"]);
    const res = await call("GET", "/hosts/reconcile");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ complete: true, staleDays: 30 });
    const kinds = (res.body.findings as Array<{ kind: string; hostIp: string }>)
      .map((f) => `${f.hostIp}:${f.kind}`)
      .sort();
    expect(kinds).toEqual([
      "100.64.0.30:ip-changed",
      "100.64.0.31:missing",
      "100.64.0.40:missing",
      "100.64.0.50:stale",
    ]);
  });

  it("updates an IP, removes a gone host and writes audit lines", async () => {
    await start(["netbird.peers.reconcile"]);
    const moved = await hostIdByIp("100.64.0.30");
    const gone = await hostIdByIp("100.64.0.40");
    const res = await call("POST", "/hosts/reconcile", {
      actions: [
        { hostId: moved, action: "update-ip" },
        { hostId: gone, action: "delete" },
      ],
    });
    // 100.64.0.31:22 is already taken by another host, so the update is
    // skipped instead of creating a duplicate.
    expect(res.body).toMatchObject({
      skipped: [{ hostId: moved, reason: "exists" }],
      deleted: [{ hostId: gone }],
      failed: [],
    });
    const owned = await mock.ctx.hosts.listOwned();
    expect(owned.some((h) => h.id === gone)).toBe(false);
    expect(mock.audits.map((a) => a.action)).toContain("netbird_host_removed");
  });

  it("sets the new NetBird IP when the address is free", async () => {
    await start(["netbird.peers.reconcile"]);
    await mock.ctx.hosts.delete(await hostIdByIp("100.64.0.31"));
    const moved = await hostIdByIp("100.64.0.30");
    const res = await call("POST", "/hosts/reconcile", {
      actions: [{ hostId: moved, action: "update-ip" }],
    });
    expect(res.body).toMatchObject({
      updated: [{ hostId: moved, ip: "100.64.0.31" }],
    });
    expect(
      (await mock.ctx.hosts.listOwned()).find((h) => h.id === moved)?.ip,
    ).toBe("100.64.0.31");
    expect(mock.audits.at(-1)).toMatchObject({
      action: "netbird_host_ip_updated",
      resourceId: String(moved),
      success: true,
    });
  });

  it("refuses actions the server did not find", async () => {
    await start(["netbird.peers.reconcile"]);
    const moved = await hostIdByIp("100.64.0.30");
    const res = await call("POST", "/hosts/reconcile", {
      actions: [
        // delete is allowed for a moved host, but update-ip on a stale one is not
        { hostId: await hostIdByIp("100.64.0.50"), action: "update-ip" },
        { hostId: 9999, action: "delete" },
      ],
    });
    expect(res.status).toBe(200);
    expect(res.body.skipped).toHaveLength(2);
    expect(res.body.updated).toEqual([]);
    expect(res.body.deleted).toEqual([]);
    expect(moved).toBeGreaterThan(0);
  });

  it("never removes a missing peer's host for a sign-in with the role user", async () => {
    await start(["netbird.peers.reconcile"], "user");
    const list = await call("GET", "/hosts/reconcile");
    expect(list.body.complete).toBe(false);
    const gone = await hostIdByIp("100.64.0.40");
    const res = await call("POST", "/hosts/reconcile", {
      actions: [{ hostId: gone, action: "delete" }],
    });
    expect(res.body.skipped).toEqual([{ hostId: gone, reason: "stale" }]);
    expect((await mock.ctx.hosts.listOwned()).some((h) => h.id === gone)).toBe(
      true,
    );
  });

  it("treats a sign-in without a NetBird role as incomplete", async () => {
    await start(["netbird.peers.reconcile"], "");
    const list = await call("GET", "/hosts/reconcile");
    expect(list.body.complete).toBe(false);
  });

  it("rejects an empty or malformed request", async () => {
    await start(["netbird.peers.reconcile"]);
    expect(
      (await call("POST", "/hosts/reconcile", { actions: [] })).status,
    ).toBe(400);
    expect(
      (
        await call("POST", "/hosts/reconcile", {
          actions: [{ hostId: "1", action: "rm -rf" }],
        })
      ).status,
    ).toBe(400);
  });
});

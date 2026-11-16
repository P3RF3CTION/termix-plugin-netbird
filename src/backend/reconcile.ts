// Compares the user's Termix hosts with the NetBird peers they point at and
// finds what went stale: hosts whose peer is gone, whose NetBird IP changed,
// or whose peer has been offline for longer than the configured days.
//
// Pure functions only. The route recomputes the findings before it changes
// anything, so a client can only ask for an action the server itself found.

import type { NetbirdPeer } from "./reachability.js";

export interface ReconcileHost {
  id: number;
  name: string | null;
  ip: string;
  port: number;
  tags: string | null;
  notes: string | null;
}

/**
 * missing: the host points at a peer NetBird no longer lists.
 * ip-changed: the peer still exists under a different NetBird IP.
 * stale: the peer has been offline for longer than the configured days.
 * offline: the peer is offline, but not for that long (no action).
 */
export type FindingKind = "missing" | "ip-changed" | "stale" | "offline";

export type ReconcileAction = "update-ip" | "delete";

export interface HostFinding {
  hostId: number;
  hostName: string;
  hostIp: string;
  port: number;
  kind: FindingKind;
  peerId: string | null;
  peerName: string | null;
  /** The peer's current NetBird IP (ip-changed). */
  peerIp: string | null;
  lastSeen: string | null;
  loginExpired: boolean;
  /** Whole days since the peer was last seen, when NetBird says. */
  offlineDays: number | null;
  /**
   * False when the credential may not see every peer (NetBird role "user"):
   * a missing peer may only be hidden, so no action is offered.
   */
  certain: boolean;
  actions: ReconcileAction[];
}

export interface ReconcileOptions {
  /** Offline for more days than this is stale; 0 switches it off. */
  staleDays: number;
  /** The credential sees every peer of the account. */
  complete: boolean;
  now?: number;
}

const DAY_MS = 86_400_000;

/** The peer id the import wrote into the notes: "NetBird peer <name> (<id>)". */
export function peerIdFromNotes(
  notes: string | null | undefined,
): string | null {
  const match = /NetBird peer .*\(([A-Za-z0-9_-]{1,64})\)/.exec(notes ?? "");
  return match ? match[1] : null;
}

/** NetBird hands out addresses from 100.64.0.0/10 (CGNAT). */
export function isNetbirdIp(ip: string): boolean {
  const parts = ip
    .trim()
    .split(".")
    .map((p) => Number.parseInt(p, 10));
  if (parts.length !== 4 || parts.some((p) => !(p >= 0 && p <= 255))) {
    return false;
  }
  return parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127;
}

function hasTag(tags: string | null, tag: string): boolean {
  return (tags ?? "")
    .split(",")
    .map((t) => t.trim().toLowerCase())
    .includes(tag);
}

function plainIp(ip: string | undefined): string {
  return (ip ?? "").split("/")[0];
}

/**
 * Findings for every host that belongs to NetBird: imported by this plugin
 * (peer id in the notes), tagged "netbird", or pointing at a peer's NetBird
 * IP. Other hosts are left alone. Sorted by kind, then host name.
 */
export function reconcile(
  hosts: ReconcileHost[],
  peers: NetbirdPeer[],
  options: ReconcileOptions,
): HostFinding[] {
  const now = options.now ?? Date.now();
  const byId = new Map(peers.map((p) => [p.id, p]));
  const byIp = new Map(
    peers.filter((p) => plainIp(p.ip)).map((p) => [plainIp(p.ip), p]),
  );
  const findings: HostFinding[] = [];

  for (const host of hosts) {
    const ref = peerIdFromNotes(host.notes);
    const tagged = hasTag(host.tags, "netbird");
    const peer = ref ? byId.get(ref) : byIp.get(host.ip.trim());
    const base = {
      hostId: host.id,
      hostName: host.name || host.ip,
      hostIp: host.ip,
      port: host.port,
      peerId: peer?.id ?? ref,
      peerName: peer?.name ?? null,
      peerIp: null,
      lastSeen: peer?.last_seen ?? null,
      loginExpired: peer?.login_expired === true,
      offlineDays: null,
      certain: true,
    };

    if (!peer) {
      // Only hosts that clearly belong to NetBird count as missing.
      if (!ref && !(tagged && isNetbirdIp(host.ip))) continue;
      findings.push({
        ...base,
        kind: "missing",
        certain: options.complete,
        actions: options.complete ? ["delete"] : [],
      });
      continue;
    }

    const peerIp = plainIp(peer.ip);
    if (ref && peerIp && peerIp !== host.ip.trim()) {
      findings.push({
        ...base,
        kind: "ip-changed",
        peerIp,
        actions: ["update-ip", "delete"],
      });
      continue;
    }

    if (peer.connected === true) continue;
    const seen = peer.last_seen ? Date.parse(peer.last_seen) : Number.NaN;
    const offlineDays = Number.isNaN(seen)
      ? null
      : Math.max(0, Math.floor((now - seen) / DAY_MS));
    const stale =
      options.staleDays > 0 &&
      offlineDays !== null &&
      offlineDays > options.staleDays;
    findings.push({
      ...base,
      kind: stale ? "stale" : "offline",
      offlineDays,
      actions: stale ? ["delete"] : [],
    });
  }

  const order: Record<FindingKind, number> = {
    missing: 0,
    "ip-changed": 1,
    stale: 2,
    offline: 3,
  };
  return findings.sort(
    (a, b) =>
      order[a.kind] - order[b.kind] || a.hostName.localeCompare(b.hostName),
  );
}

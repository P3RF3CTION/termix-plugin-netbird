// Answers one question per peer: does a NetBird access policy let the Termix
// server's own peer open TCP to this peer's SSH port?
//
// Pure functions only, so the rules can be tested without a NetBird server.
// The answer is what the policies say, not a live connection test: posture
// checks, a peer that is offline or a host firewall can still block the
// connection. Those cases are reported as notes, never guessed away.

export interface NetbirdGroupRef {
  id: string;
  name: string;
}

export interface NetbirdPeer {
  id: string;
  name: string;
  ip: string;
  dns_label?: string;
  hostname?: string;
  os?: string;
  connected?: boolean;
  last_seen?: string;
  groups?: NetbirdGroupRef[];
  ssh_enabled?: boolean;
}

export interface NetbirdPortRange {
  start: number;
  end: number;
}

export interface NetbirdPolicyRule {
  id?: string;
  name?: string;
  enabled?: boolean;
  action?: string;
  bidirectional?: boolean;
  protocol?: string;
  ports?: string[] | null;
  port_ranges?: NetbirdPortRange[] | null;
  sources?: NetbirdGroupRef[] | null;
  destinations?: NetbirdGroupRef[] | null;
  destinationResource?: { id: string; type: string } | null;
}

export interface NetbirdPolicy {
  id: string;
  name: string;
  enabled?: boolean;
  rules?: NetbirdPolicyRule[];
  source_posture_checks?: string[] | null;
}

export type ReachabilityState = "allowed" | "blocked" | "unknown" | "self";

export interface Reachability {
  state: ReachabilityState;
  /** Names of the policies that allow the connection. */
  policies: string[];
  /** Posture checks apply to at least one allowing policy. */
  postureChecks: boolean;
}

/** Finds the Termix server's own peer by id, name, DNS label or NetBird IP. */
export function findPeer(
  peers: NetbirdPeer[],
  reference: string,
): NetbirdPeer | null {
  const ref = reference.trim().toLowerCase();
  if (!ref) return null;
  return (
    peers.find(
      (p) =>
        p.id.toLowerCase() === ref ||
        p.name.toLowerCase() === ref ||
        (p.dns_label ?? "").toLowerCase() === ref ||
        (p.dns_label ?? "").toLowerCase().split(".")[0] === ref ||
        p.ip.split("/")[0] === ref,
    ) ?? null
  );
}

/** True when the rule's ports cover `port` (no ports and no ranges = all). */
export function rulePortMatches(
  rule: NetbirdPolicyRule,
  port: number,
): boolean {
  const protocol = (rule.protocol ?? "all").toLowerCase();
  if (protocol !== "tcp" && protocol !== "all") return false;
  const ports = rule.ports ?? [];
  const ranges = rule.port_ranges ?? [];
  if (ports.length === 0 && ranges.length === 0) return true;
  for (const p of ports) {
    const [a, b] = String(p)
      .split("-")
      .map((v) => Number.parseInt(v, 10));
    if (b === undefined || Number.isNaN(b)) {
      if (a === port) return true;
    } else if (port >= a && port <= b) {
      return true;
    }
  }
  return ranges.some((r) => port >= r.start && port <= r.end);
}

function groupIds(refs: NetbirdGroupRef[] | null | undefined): Set<string> {
  return new Set((refs ?? []).map((g) => g.id));
}

function intersects(a: Set<string>, b: Set<string>): boolean {
  for (const v of a) if (b.has(v)) return true;
  return false;
}

/** Does this rule let `from` open TCP `port` on `to`? */
export function ruleAllows(
  rule: NetbirdPolicyRule,
  from: NetbirdPeer,
  to: NetbirdPeer,
  port: number,
): boolean {
  if (rule.enabled === false) return false;
  if ((rule.action ?? "accept").toLowerCase() !== "accept") return false;
  if (!rulePortMatches(rule, port)) return false;

  const fromGroups = groupIds(from.groups);
  const toGroups = groupIds(to.groups);
  const sources = groupIds(rule.sources);
  const destinations = groupIds(rule.destinations);
  const resource = rule.destinationResource;

  const forward =
    intersects(sources, fromGroups) &&
    (intersects(destinations, toGroups) ||
      (resource?.type === "peer" && resource.id === to.id));
  if (forward) return true;

  // Bidirectional: the destination side may open connections to the source
  // side as well, on the same ports.
  return (
    rule.bidirectional === true &&
    intersects(sources, toGroups) &&
    intersects(destinations, fromGroups)
  );
}

/** Reachability of `to` from the Termix peer, `termixPeer` null = not set. */
export function evaluate(
  policies: NetbirdPolicy[],
  termixPeer: NetbirdPeer | null,
  to: NetbirdPeer,
  port: number,
): Reachability {
  if (!termixPeer)
    return { state: "unknown", policies: [], postureChecks: false };
  if (termixPeer.id === to.id)
    return { state: "self", policies: [], postureChecks: false };

  const allowing = policies.filter(
    (policy) =>
      policy.enabled !== false &&
      (policy.rules ?? []).some((rule) =>
        ruleAllows(rule, termixPeer, to, port),
      ),
  );
  return {
    state: allowing.length > 0 ? "allowed" : "blocked",
    policies: allowing.map((p) => p.name),
    postureChecks: allowing.some(
      (p) => (p.source_posture_checks ?? []).length > 0,
    ),
  };
}

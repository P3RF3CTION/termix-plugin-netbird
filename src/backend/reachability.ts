// Answers one question per peer: does a NetBird access policy let the Termix
// server's own peer open TCP to this peer's SSH port?
//
// Pure functions only, so the rules can be tested without a NetBird server.
// The answer is what the policies and their posture checks say, not a live
// connection test: a peer that is offline or a host firewall can still block
// the connection. Posture checks NetBird's API cannot answer (network range,
// processes) are reported as unknown, never guessed away.

import {
  evaluatePosture,
  type NetbirdPostureCheck,
  type PostureResult,
} from "./posture.js";

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
  // Detail fields (GET /peers and /peers/{id}); all optional, older
  // management servers leave some out.
  version?: string;
  kernel_version?: string;
  connection_ip?: string;
  country_code?: string;
  city_name?: string;
  login_expiration_enabled?: boolean;
  login_expired?: boolean;
  last_login?: string;
  approval_required?: boolean;
  user_id?: string;
  serial_number?: string;
  extra_dns_labels?: string[];
  ephemeral?: boolean;
  accessible_peers_count?: number;
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

/**
 * none: no allowing policy has posture checks. pass: at least one allowing
 * policy's checks pass (or it has none). unknown: allowed only through
 * policies whose checks the API cannot answer. fail: every allowing policy's
 * checks fail, so NetBird leaves the peer out and the state is blocked.
 */
export type PostureSummary = "none" | "pass" | "unknown" | "fail";

export interface Reachability {
  state: ReachabilityState;
  /**
   * Names of the policies that allow the connection; with posture "fail" the
   * policies whose posture checks block it.
   */
  policies: string[];
  /** Posture checks apply to at least one allowing policy. */
  postureChecks: boolean;
  posture: PostureSummary;
}

/**
 * The posture checks of the account. null: they could not be read (NetBird
 * role), so every policy with posture checks is "unknown".
 */
export type PostureChecks = NetbirdPostureCheck[] | null;

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

/**
 * forward when `from` is on the rule's source side and `to` on its
 * destination side; reverse when a bidirectional rule connects them the other
 * way round (the destination side may open connections to the source side
 * on the same ports); null when the rule's groups do not connect them.
 */
function groupDirection(
  rule: NetbirdPolicyRule,
  from: NetbirdPeer,
  to: NetbirdPeer,
): "forward" | "reverse" | null {
  const fromGroups = groupIds(from.groups);
  const toGroups = groupIds(to.groups);
  const sources = groupIds(rule.sources);
  const destinations = groupIds(rule.destinations);
  const resource = rule.destinationResource;
  if (
    intersects(sources, fromGroups) &&
    (intersects(destinations, toGroups) ||
      (resource?.type === "peer" && resource.id === to.id))
  ) {
    return "forward";
  }
  if (
    rule.bidirectional === true &&
    intersects(sources, toGroups) &&
    intersects(destinations, fromGroups)
  ) {
    return "reverse";
  }
  return null;
}

/** The direction in which this rule lets `from` open TCP `port` on `to`. */
function ruleDirection(
  rule: NetbirdPolicyRule,
  from: NetbirdPeer,
  to: NetbirdPeer,
  port: number,
): "forward" | "reverse" | null {
  if (rule.enabled === false) return null;
  if ((rule.action ?? "accept").toLowerCase() !== "accept") return null;
  if (!rulePortMatches(rule, port)) return null;
  return groupDirection(rule, from, to);
}

/** Does this rule let `from` open TCP `port` on `to`? Ignores posture checks. */
export function ruleAllows(
  rule: NetbirdPolicyRule,
  from: NetbirdPeer,
  to: NetbirdPeer,
  port: number,
): boolean {
  return ruleDirection(rule, from, to, port) !== null;
}

/**
 * Posture checks belong to the policy's source side: forward that is the
 * Termix peer, reverse (bidirectional) the target peer.
 */
function postureFor(
  policy: NetbirdPolicy,
  direction: "forward" | "reverse",
  from: NetbirdPeer,
  to: NetbirdPeer,
  checks: PostureChecks,
): PostureResult | null {
  return evaluatePosture(
    checks,
    policy.source_posture_checks,
    direction === "forward" ? from : to,
  );
}

/**
 * Reachability of `to` from the Termix peer, `termixPeer` null = not set.
 * `postureChecks` are the account's posture checks (null: not readable).
 */
export function evaluate(
  policies: NetbirdPolicy[],
  termixPeer: NetbirdPeer | null,
  to: NetbirdPeer,
  port: number,
  postureChecks: PostureChecks = [],
): Reachability {
  const none = { policies: [], postureChecks: false, posture: "none" } as const;
  if (!termixPeer) return { state: "unknown", ...none, policies: [] };
  if (termixPeer.id === to.id) return { state: "self", ...none, policies: [] };

  // One entry per allowing policy, with the best posture result among its
  // allowing rules (a forward rule may pass where a reverse one fails).
  const rank = { pass: 0, none: 0, unknown: 1, fail: 2 } as const;
  const allowing: Array<{ policy: NetbirdPolicy; posture: PostureSummary }> =
    [];
  for (const policy of policies) {
    if (policy.enabled === false) continue;
    let best: PostureSummary | null = null;
    for (const rule of policy.rules ?? []) {
      const direction = ruleDirection(rule, termixPeer, to, port);
      if (!direction) continue;
      const result = postureFor(
        policy,
        direction,
        termixPeer,
        to,
        postureChecks,
      );
      const state: PostureSummary = result ? result.state : "none";
      if (best === null || rank[state] < rank[best]) best = state;
    }
    if (best !== null) allowing.push({ policy, posture: best });
  }

  const hasChecks = allowing.some(
    (a) => (a.policy.source_posture_checks ?? []).length > 0,
  );
  const effective = allowing.filter((a) => a.posture !== "fail");
  const certain = effective.filter(
    (a) => a.posture === "pass" || a.posture === "none",
  );
  if (allowing.length === 0) {
    return {
      state: "blocked",
      policies: [],
      postureChecks: false,
      posture: "none",
    };
  }
  if (effective.length === 0) {
    return {
      state: "blocked",
      policies: allowing.map((a) => a.policy.name),
      postureChecks: true,
      posture: "fail",
    };
  }
  return {
    state: "allowed",
    policies: effective.map((a) => a.policy.name),
    postureChecks: hasChecks,
    posture: !hasChecks ? "none" : certain.length > 0 ? "pass" : "unknown",
  };
}

// ---------------------------------------------------------------- Explain
// The detail view answers more than yes/no: which rule allows which port,
// and which rules connect the two peers but on other ports or are switched
// off. That is usually the reason a connection fails.

export interface RuleMatch {
  policy: string;
  rule: string;
  protocol: string;
  /** "all" or the ports and ranges as NetBird shows them. */
  ports: string;
  bidirectional: boolean;
  /** forward: Termix side is the source; reverse: allowed via bidirectional. */
  direction: "forward" | "reverse";
  postureChecks: boolean;
  /** The posture checks for the rule's source side; null without checks. */
  posture: PostureResult | null;
  /** The policy or the rule is switched off. */
  disabled: boolean;
}

export interface PortCheck {
  port: number;
  state: ReachabilityState;
  /** Rules that allow the port, including ones whose posture checks fail. */
  allowedBy: RuleMatch[];
  /** Rules allow the port, but every one fails its posture checks. */
  postureBlocked: boolean;
}

export interface Explanation {
  ports: PortCheck[];
  /** Rules whose groups connect the peers but whose ports leave these out. */
  otherPorts: RuleMatch[];
  /** Rules that would connect the peers but are switched off. */
  disabled: RuleMatch[];
}

function portsLabel(rule: NetbirdPolicyRule): string {
  const ports = (rule.ports ?? []).map(String);
  const ranges = (rule.port_ranges ?? []).map((r) => `${r.start}-${r.end}`);
  const all = [...ports, ...ranges];
  return all.length > 0 ? all.join(", ") : "all";
}

/** Explains reachability of `to` from `from` for each port in `ports`. */
export function explain(
  policies: NetbirdPolicy[],
  from: NetbirdPeer | null,
  to: NetbirdPeer,
  ports: number[],
  postureChecks: PostureChecks = [],
): Explanation {
  const unique = [...new Set(ports)].filter(
    (p) => Number.isInteger(p) && p >= 1 && p <= 65535,
  );
  if (!from || from.id === to.id) {
    const state: ReachabilityState = from ? "self" : "unknown";
    return {
      ports: unique.map((port) => ({
        port,
        state,
        allowedBy: [],
        postureBlocked: false,
      })),
      otherPorts: [],
      disabled: [],
    };
  }

  const matches: Array<{ rule: NetbirdPolicyRule; match: RuleMatch }> = [];
  for (const policy of policies) {
    for (const rule of policy.rules ?? []) {
      if ((rule.action ?? "accept").toLowerCase() !== "accept") continue;
      const direction = groupDirection(rule, from, to);
      if (!direction) continue;
      matches.push({
        rule,
        match: {
          policy: policy.name,
          rule: rule.name ?? "",
          protocol: (rule.protocol ?? "all").toLowerCase(),
          ports: portsLabel(rule),
          bidirectional: rule.bidirectional === true,
          direction,
          postureChecks: (policy.source_posture_checks ?? []).length > 0,
          posture: postureFor(policy, direction, from, to, postureChecks),
          disabled: policy.enabled === false || rule.enabled === false,
        },
      });
    }
  }

  const active = matches.filter((m) => !m.match.disabled);
  const portChecks: PortCheck[] = unique.map((port) => {
    const allowedBy = active
      .filter((m) => rulePortMatches(m.rule, port))
      .map((m) => m.match);
    const passing = allowedBy.filter((m) => m.posture?.state !== "fail");
    return {
      port,
      state: passing.length > 0 ? "allowed" : "blocked",
      allowedBy,
      postureBlocked: allowedBy.length > 0 && passing.length === 0,
    };
  });
  const otherPorts = active
    .filter((m) => !unique.some((port) => rulePortMatches(m.rule, port)))
    .map((m) => m.match);
  return {
    ports: portChecks,
    otherPorts,
    disabled: matches.filter((m) => m.match.disabled).map((m) => m.match),
  };
}

// Evaluates NetBird posture checks against what the management API says about
// a peer. NetBird applies a policy's source posture checks to the peers on the
// source side of its rules: a peer that fails them is left out of the rule.
//
// Pure functions only. The API shows the client version, OS, kernel and
// location of a peer, so those checks are evaluated. The network range and
// process checks need data only the client sees (local addresses, running
// processes); they are reported as "unknown", never guessed.

import type { NetbirdPeer } from "./reachability.js";

export interface NetbirdMinVersion {
  min_version?: string;
}

export interface NetbirdMinKernelVersion {
  min_kernel_version?: string;
}

export interface NetbirdPostureCheck {
  id: string;
  name: string;
  description?: string;
  checks?: {
    nb_version_check?: NetbirdMinVersion | null;
    os_version_check?: {
      android?: NetbirdMinVersion | null;
      darwin?: NetbirdMinVersion | null;
      ios?: NetbirdMinVersion | null;
      linux?: NetbirdMinKernelVersion | null;
      windows?: NetbirdMinKernelVersion | null;
    } | null;
    geo_location_check?: {
      locations?: Array<{ country_code: string; city_name?: string }> | null;
      action?: string;
    } | null;
    peer_network_range_check?: {
      ranges?: string[] | null;
      action?: string;
    } | null;
    process_check?: { processes?: unknown[] | null } | null;
  } | null;
}

export type PostureState = "pass" | "fail" | "unknown";

export type PostureKind =
  "version" | "os" | "geo" | "network" | "process" | "missing";

export interface PostureFinding {
  /** Name of the posture check in NetBird. */
  check: string;
  kind: PostureKind;
  state: PostureState;
  /** What the check asks for, e.g. "0.28.0" or "allow DE, AT/Vienna". */
  required: string;
  /** What the peer has, e.g. "0.27.1"; empty when NetBird does not say. */
  actual: string;
}

export interface PostureResult {
  state: PostureState;
  /** The peer the checks were evaluated for (source side of the rule). */
  peer: string;
  findings: PostureFinding[];
}

/**
 * Leading numeric parts of a version: "v0.28.4-rc1" -> [0, 28, 4],
 * "6.8.0-45-generic" -> [6, 8, 0]. Null when there is no number to compare
 * (for example "development" builds).
 */
export function versionParts(raw: string | null | undefined): number[] | null {
  const match = /^\s*v?(\d+(?:\.\d+)*)/i.exec(raw ?? "");
  if (!match) return null;
  return match[1].split(".").map((n) => Number.parseInt(n, 10));
}

/** -1, 0 or 1 like a comparator; null when either side has no version. */
export function compareVersions(a: string, b: string): number | null {
  const pa = versionParts(a);
  const pb = versionParts(b);
  if (!pa || !pb) return null;
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

export type OsFamily = "android" | "darwin" | "ios" | "linux" | "windows";

/**
 * NetBird's API shows the OS as "<name> <version>" (e.g. "Darwin 14.4.1",
 * "Ubuntu 24.04", "Microsoft Windows 11 Pro") plus the kernel version. The
 * family and the version NetBird's OS check compares come from those.
 */
export function osOf(
  peer: Pick<NetbirdPeer, "os" | "kernel_version">,
): { family: OsFamily; version: string } | null {
  const os = (peer.os ?? "").trim();
  const kernel = (peer.kernel_version ?? "").trim();
  const trailing = /(\d+(?:\.\d+)*)\s*$/.exec(os)?.[1] ?? "";
  if (/android/i.test(os)) return { family: "android", version: trailing };
  if (/\b(ios|ipados)\b|iphone|ipad/i.test(os)) {
    return { family: "ios", version: trailing };
  }
  if (/darwin|mac\s?os/i.test(os)) {
    return { family: "darwin", version: trailing };
  }
  // NetBird compares the kernel version on Windows and Linux.
  if (/windows/i.test(os)) return { family: "windows", version: kernel };
  if (kernel) return { family: "linux", version: kernel.split("-")[0] };
  return null;
}

/** An empty or "0" minimum allows every version. */
function noMinimum(min: string | undefined): boolean {
  const v = (min ?? "").trim();
  return v === "" || /^0(\.0)*$/.test(v);
}

function minVersionFinding(
  check: string,
  kind: PostureKind,
  min: string | undefined,
  actual: string,
): PostureFinding {
  const required = (min ?? "").trim();
  if (noMinimum(min)) {
    return { check, kind, state: "pass", required, actual };
  }
  const cmp = compareVersions(actual, required);
  return {
    check,
    kind,
    state: cmp === null ? "unknown" : cmp >= 0 ? "pass" : "fail",
    required,
    actual,
  };
}

function evaluateOne(
  check: NetbirdPostureCheck,
  peer: NetbirdPeer,
): PostureFinding[] {
  const c = check.checks ?? {};
  const name = check.name || check.id;
  const findings: PostureFinding[] = [];

  if (c.nb_version_check) {
    findings.push(
      minVersionFinding(
        name,
        "version",
        c.nb_version_check.min_version,
        peer.version ?? "",
      ),
    );
  }

  if (c.os_version_check) {
    const os = osOf(peer);
    if (!os) {
      findings.push({
        check: name,
        kind: "os",
        state: "unknown",
        required: "",
        actual: peer.os ?? "",
      });
    } else {
      const rule = c.os_version_check[os.family];
      const min =
        rule && "min_kernel_version" in rule
          ? rule.min_kernel_version
          : (rule as NetbirdMinVersion | null | undefined)?.min_version;
      if (!rule) {
        // NetBird refuses an OS the check does not list.
        findings.push({
          check: name,
          kind: "os",
          state: "fail",
          required: `${os.family}: -`,
          actual: `${os.family} ${os.version}`.trim(),
        });
      } else {
        const f = minVersionFinding(name, "os", min, os.version);
        findings.push({
          ...f,
          required: `${os.family} >= ${f.required || "0"}`,
          actual: `${os.family} ${os.version}`.trim(),
        });
      }
    }
  }

  if (c.geo_location_check) {
    const geo = c.geo_location_check;
    const action = (geo.action ?? "allow").toLowerCase();
    const locations = geo.locations ?? [];
    const required = `${action} ${locations
      .map((l) =>
        l.city_name ? `${l.country_code}/${l.city_name}` : l.country_code,
      )
      .join(", ")}`.trim();
    const country = (peer.country_code ?? "").toUpperCase();
    const city = (peer.city_name ?? "").toLowerCase();
    const actual = [peer.country_code, peer.city_name]
      .filter(Boolean)
      .join("/");
    if (!country) {
      findings.push({
        check: name,
        kind: "geo",
        state: "unknown",
        required,
        actual,
      });
    } else {
      const matches = locations.some(
        (l) =>
          l.country_code.toUpperCase() === country &&
          (!l.city_name || l.city_name.toLowerCase() === city),
      );
      const pass = action === "deny" ? !matches : matches;
      findings.push({
        check: name,
        kind: "geo",
        state: pass ? "pass" : "fail",
        required,
        actual,
      });
    }
  }

  if (c.peer_network_range_check) {
    const r = c.peer_network_range_check;
    findings.push({
      check: name,
      kind: "network",
      state: "unknown",
      required:
        `${(r.action ?? "allow").toLowerCase()} ${(r.ranges ?? []).join(", ")}`.trim(),
      actual: "",
    });
  }

  if (c.process_check) {
    findings.push({
      check: name,
      kind: "process",
      state: "unknown",
      required: String((c.process_check.processes ?? []).length),
      actual: "",
    });
  }

  return findings;
}

function combine(findings: PostureFinding[]): PostureState {
  if (findings.some((f) => f.state === "fail")) return "fail";
  if (findings.some((f) => f.state === "unknown")) return "unknown";
  return "pass";
}

/**
 * Evaluates the posture checks `ids` (a policy's source_posture_checks) for
 * `peer`. `checks` null means they could not be read: every check is then
 * unknown. Returns null when the policy has no posture checks.
 */
export function evaluatePosture(
  checks: NetbirdPostureCheck[] | null,
  ids: string[] | null | undefined,
  peer: NetbirdPeer,
): PostureResult | null {
  const wanted = [...new Set(ids ?? [])];
  if (wanted.length === 0) return null;
  const byId = new Map((checks ?? []).map((c) => [c.id, c]));
  const findings: PostureFinding[] = [];
  for (const id of wanted) {
    const check = byId.get(id);
    if (!check) {
      findings.push({
        check: id,
        kind: "missing",
        state: "unknown",
        required: "",
        actual: "",
      });
      continue;
    }
    const own = evaluateOne(check, peer);
    // A check with nothing in it that NetBird knows passes.
    findings.push(...own);
  }
  return { state: combine(findings), peer: peer.name, findings };
}

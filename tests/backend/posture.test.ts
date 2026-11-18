import { describe, expect, it } from "vitest";
import {
  compareVersions,
  evaluatePosture,
  osOf,
  type NetbirdPostureCheck,
} from "../../src/backend/posture.js";
import {
  evaluate,
  explain,
  type NetbirdPeer,
  type NetbirdPolicy,
} from "../../src/backend/reachability.js";

const g = (id: string) => ({ id, name: id });

const termix: NetbirdPeer = {
  id: "p-termix",
  name: "termix",
  ip: "100.64.0.10",
  os: "Debian GNU/Linux 12",
  kernel_version: "6.1.0-27-amd64",
  version: "0.30.2",
  country_code: "DE",
  city_name: "Berlin",
  groups: [g("Termix")],
};
const web: NetbirdPeer = {
  id: "p-web",
  name: "web-1",
  ip: "100.64.0.30",
  os: "Darwin 13.6.1",
  kernel_version: "22.6.0",
  version: "0.27.0",
  groups: [g("Web")],
};

const checks: NetbirdPostureCheck[] = [
  {
    id: "pc-version",
    name: "NetBird 0.28+",
    checks: { nb_version_check: { min_version: "0.28.0" } },
  },
  {
    id: "pc-linux",
    name: "Kernel 6+",
    checks: {
      os_version_check: { linux: { min_kernel_version: "6.0" } },
    },
  },
  {
    id: "pc-geo",
    name: "Only Germany",
    checks: {
      geo_location_check: {
        action: "allow",
        locations: [{ country_code: "DE" }],
      },
    },
  },
  {
    id: "pc-range",
    name: "Office network",
    checks: {
      peer_network_range_check: { action: "allow", ranges: ["10.0.0.0/8"] },
    },
  },
];

describe("versions and OS", () => {
  it("compares the numeric parts", () => {
    expect(compareVersions("0.28.4", "0.28.0")).toBe(1);
    expect(compareVersions("v0.28", "0.28.0")).toBe(0);
    expect(compareVersions("0.9.9", "0.28.0")).toBe(-1);
    expect(compareVersions("development", "0.28.0")).toBeNull();
  });

  it("finds the OS family and the version NetBird compares", () => {
    expect(osOf(termix)).toEqual({ family: "linux", version: "6.1.0" });
    expect(osOf(web)).toEqual({ family: "darwin", version: "13.6.1" });
    expect(
      osOf({ os: "Microsoft Windows 11 Pro", kernel_version: "10.0.22631" }),
    ).toEqual({ family: "windows", version: "10.0.22631" });
    expect(osOf({ os: "", kernel_version: "" })).toBeNull();
  });
});

describe("evaluatePosture", () => {
  it("returns null without posture checks", () => {
    expect(evaluatePosture(checks, [], termix)).toBeNull();
  });

  it("passes version, kernel and location checks", () => {
    const r = evaluatePosture(
      checks,
      ["pc-version", "pc-linux", "pc-geo"],
      termix,
    );
    expect(r?.state).toBe("pass");
    expect(r?.findings.map((f) => f.kind)).toEqual(["version", "os", "geo"]);
  });

  it("fails an old client and an OS the check does not list", () => {
    expect(evaluatePosture(checks, ["pc-version"], web)?.state).toBe("fail");
    const os = evaluatePosture(checks, ["pc-linux"], web);
    expect(os?.state).toBe("fail");
    expect(os?.findings[0]).toMatchObject({
      kind: "os",
      actual: "darwin 13.6.1",
    });
  });

  it("reports what the API cannot answer as unknown", () => {
    expect(evaluatePosture(checks, ["pc-range"], termix)?.state).toBe(
      "unknown",
    );
    // No location for the peer.
    expect(evaluatePosture(checks, ["pc-geo"], web)?.state).toBe("unknown");
    // Check not readable or deleted.
    expect(
      evaluatePosture(null, ["pc-version"], termix)?.findings[0].kind,
    ).toBe("missing");
  });

  it("lets a deny rule block a matching location", () => {
    const deny: NetbirdPostureCheck = {
      id: "pc-deny",
      name: "Not Berlin",
      checks: {
        geo_location_check: {
          action: "deny",
          locations: [{ country_code: "DE", city_name: "Berlin" }],
        },
      },
    };
    expect(evaluatePosture([deny], ["pc-deny"], termix)?.state).toBe("fail");
  });

  it("fails as a whole when one check fails, before unknown", () => {
    expect(
      evaluatePosture(checks, ["pc-range", "pc-version"], web)?.state,
    ).toBe("fail");
  });
});

describe("posture in the reachability check", () => {
  const rule = {
    name: "ssh",
    enabled: true,
    action: "accept",
    protocol: "tcp",
    ports: ["22"],
    sources: [g("Termix")],
    destinations: [g("Web")],
  };
  const policy = (ids: string[], extra: object = {}): NetbirdPolicy => ({
    id: "pol",
    name: "Termix to web",
    enabled: true,
    rules: [{ ...rule, ...extra }],
    source_posture_checks: ids,
  });

  it("allows when the Termix peer passes", () => {
    expect(evaluate([policy(["pc-version"])], termix, web, 22, checks)).toEqual(
      {
        state: "allowed",
        policies: ["Termix to web"],
        postureChecks: true,
        posture: "pass",
      },
    );
  });

  it("blocks when every allowing policy fails its posture checks", () => {
    const old = { ...termix, version: "0.20.0" };
    const r = evaluate([policy(["pc-version"])], old, web, 22, checks);
    expect(r).toMatchObject({ state: "blocked", posture: "fail" });
    expect(r.policies).toEqual(["Termix to web"]);
  });

  it("still allows through another policy without posture checks", () => {
    const old = { ...termix, version: "0.20.0" };
    const open = { ...policy([]), id: "pol-2", name: "Open" };
    const r = evaluate([policy(["pc-version"]), open], old, web, 22, checks);
    expect(r).toMatchObject({
      state: "allowed",
      policies: ["Open"],
      posture: "pass",
    });
  });

  it("is unknown when the checks cannot be read", () => {
    expect(
      evaluate([policy(["pc-version"])], termix, web, 22, null),
    ).toMatchObject({ state: "allowed", posture: "unknown" });
  });

  it("checks the target peer for a reverse (bidirectional) rule", () => {
    // Web is the source side; the Termix peer is the destination.
    const reverse = policy(["pc-version"], {
      sources: [g("Web")],
      destinations: [g("Termix")],
      bidirectional: true,
    });
    // web runs 0.27.0 < 0.28.0, so NetBird leaves it out of the rule.
    expect(evaluate([reverse], termix, web, 22, checks)).toMatchObject({
      state: "blocked",
      posture: "fail",
    });
  });

  it("explains the posture result per rule and marks a blocked port", () => {
    const old = { ...termix, version: "0.20.0" };
    const ex = explain([policy(["pc-version"])], old, web, [22], checks);
    expect(ex.ports[0]).toMatchObject({
      state: "blocked",
      postureBlocked: true,
    });
    expect(ex.ports[0].allowedBy[0].posture).toMatchObject({
      state: "fail",
      peer: "termix",
      findings: [{ kind: "version", required: "0.28.0", actual: "0.20.0" }],
    });
  });
});

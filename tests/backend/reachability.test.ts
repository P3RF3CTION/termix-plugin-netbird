import { describe, expect, it } from "vitest";
import {
  evaluate,
  findPeer,
  ruleAllows,
  rulePortMatches,
  type NetbirdPeer,
  type NetbirdPolicy,
} from "../../src/backend/reachability.js";

const g = (id: string) => ({ id, name: id });

const termix: NetbirdPeer = {
  id: "p-termix",
  name: "termix",
  ip: "100.79.103.251",
  dns_label: "termix.netbird.selfhosted",
  groups: [g("All"), g("Termix")],
};
const oracle: NetbirdPeer = {
  id: "p-oracle",
  name: "oracle-2",
  ip: "100.79.185.105",
  groups: [g("All"), g("Oracle")],
};
const rackpi: NetbirdPeer = {
  id: "p-rackpi",
  name: "rackpi",
  ip: "100.79.10.10",
  groups: [g("All"), g("Rack-Pi")],
};

describe("rulePortMatches", () => {
  it("matches single ports, ranges and 'all'", () => {
    expect(rulePortMatches({ protocol: "tcp", ports: ["2222"] }, 2222)).toBe(
      true,
    );
    expect(rulePortMatches({ protocol: "tcp", ports: ["22"] }, 2222)).toBe(
      false,
    );
    expect(
      rulePortMatches({ protocol: "tcp", ports: ["2000-3000"] }, 2222),
    ).toBe(true);
    expect(
      rulePortMatches(
        { protocol: "tcp", port_ranges: [{ start: 2200, end: 2300 }] },
        2222,
      ),
    ).toBe(true);
    expect(rulePortMatches({ protocol: "all" }, 22)).toBe(true);
    expect(rulePortMatches({ protocol: "udp", ports: ["22"] }, 22)).toBe(false);
  });
});

describe("ruleAllows", () => {
  const rule = {
    enabled: true,
    action: "accept",
    protocol: "tcp",
    ports: ["2222"],
    sources: [g("Termix")],
    destinations: [g("Oracle")],
  };

  it("allows the forward direction only when not bidirectional", () => {
    expect(ruleAllows(rule, termix, oracle, 2222)).toBe(true);
    expect(ruleAllows(rule, oracle, termix, 2222)).toBe(false);
    expect(
      ruleAllows({ ...rule, bidirectional: true }, oracle, termix, 2222),
    ).toBe(true);
  });

  it("ignores disabled and drop rules", () => {
    expect(ruleAllows({ ...rule, enabled: false }, termix, oracle, 2222)).toBe(
      false,
    );
    expect(ruleAllows({ ...rule, action: "drop" }, termix, oracle, 2222)).toBe(
      false,
    );
  });

  it("matches a peer destination resource", () => {
    expect(
      ruleAllows(
        {
          ...rule,
          destinations: null,
          destinationResource: { id: "p-rackpi", type: "peer" },
        },
        termix,
        rackpi,
        2222,
      ),
    ).toBe(true);
  });
});

describe("evaluate", () => {
  const policies: NetbirdPolicy[] = [
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
          sources: [g("Termix")],
          destinations: [g("Oracle")],
        },
      ],
    },
    {
      id: "pol-2",
      name: "Disabled",
      enabled: false,
      rules: [
        { protocol: "all", sources: [g("All")], destinations: [g("All")] },
      ],
    },
  ];

  it("names the allowing policy", () => {
    expect(evaluate(policies, termix, oracle, 2222)).toEqual({
      state: "allowed",
      policies: ["Termix zu Oracle (SSH)"],
      postureChecks: false,
    });
  });

  it("reports blocked when no enabled policy fits", () => {
    expect(evaluate(policies, termix, rackpi, 2222).state).toBe("blocked");
    expect(evaluate(policies, termix, oracle, 22).state).toBe("blocked");
  });

  it("flags posture checks and handles self and unknown", () => {
    const withPosture = [{ ...policies[0], source_posture_checks: ["pc-1"] }];
    expect(evaluate(withPosture, termix, oracle, 2222).postureChecks).toBe(
      true,
    );
    expect(evaluate(policies, termix, termix, 2222).state).toBe("self");
    expect(evaluate(policies, null, oracle, 2222).state).toBe("unknown");
  });
});

describe("findPeer", () => {
  it("finds by name, DNS label, short label and IP", () => {
    const peers = [termix, oracle];
    expect(findPeer(peers, "termix")?.id).toBe("p-termix");
    expect(findPeer(peers, "termix.netbird.selfhosted")?.id).toBe("p-termix");
    expect(findPeer(peers, "100.79.185.105")?.id).toBe("p-oracle");
    expect(findPeer(peers, "nope")).toBeNull();
    expect(findPeer(peers, "  ")).toBeNull();
  });
});

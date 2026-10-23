import { describe, expect, it } from "vitest";
import {
  buildAuthorizeUrl,
  checkIdToken,
  parseExtraParams,
  pkceChallenge,
  type OidcConfig,
} from "../../src/backend/oidc.js";
import { explain, type NetbirdPeer } from "../../src/backend/reachability.js";

const config: OidcConfig = {
  issuer: "https://idp.example.com/realms/main",
  clientId: "netbird-dashboard",
  clientSecret: "",
  scopes: "openid profile email offline_access",
  audience: "",
  extraParams: { connector_id: "corp" },
  useIdToken: false,
};

function jwt(payload: Record<string, unknown>): string {
  const b64 = (v: unknown) =>
    Buffer.from(JSON.stringify(v)).toString("base64url");
  return `${b64({ alg: "RS256" })}.${b64(payload)}.sig`;
}

describe("parseExtraParams", () => {
  it("reads key=value pairs and drops flow parameters", () => {
    expect(
      parseExtraParams("connector_id=corp&prompt=login&state=x&redirect_uri=y"),
    ).toEqual({ connector_id: "corp", prompt: "login" });
    expect(parseExtraParams("a=1\nb = 2\njunk")).toEqual({ a: "1", b: "2" });
    expect(parseExtraParams(undefined)).toEqual({});
  });
});

describe("buildAuthorizeUrl", () => {
  it("builds a code flow request with PKCE S256 and the extra parameters", () => {
    const url = new URL(
      buildAuthorizeUrl(
        {
          authorization_endpoint: "https://idp.example.com/auth",
          token_endpoint: "https://idp.example.com/token",
        },
        config,
        {
          state: "s".repeat(32),
          nonce: "n".repeat(24),
          verifier: "v".repeat(48),
          redirectUri:
            "https://termix.example.com/plugin-api/netbird/auth/callback",
        },
      ),
    );
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("client_id")).toBe("netbird-dashboard");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("code_challenge")).toBe(
      pkceChallenge("v".repeat(48)),
    );
    expect(url.searchParams.get("connector_id")).toBe("corp");
    expect(url.searchParams.has("audience")).toBe(false);
  });
});

describe("checkIdToken", () => {
  const good = {
    iss: config.issuer,
    aud: ["netbird-dashboard"],
    nonce: "abc",
    exp: Math.floor(Date.now() / 1000) + 300,
    sub: "u1",
    preferred_username: "max",
  };

  it("accepts a matching token and names the user", () => {
    expect(checkIdToken(jwt(good), config, "abc")).toEqual({
      ok: true,
      subject: "u1",
      name: "max",
    });
  });

  it("refuses wrong nonce, issuer, audience or an expired token", () => {
    expect(checkIdToken(jwt(good), config, "other").ok).toBe(false);
    expect(
      checkIdToken(jwt({ ...good, iss: "https://evil" }), config, "abc").ok,
    ).toBe(false);
    expect(
      checkIdToken(jwt({ ...good, aud: "someone-else" }), config, "abc").ok,
    ).toBe(false);
    expect(checkIdToken(jwt({ ...good, exp: 1000 }), config, "abc").ok).toBe(
      false,
    );
    expect(checkIdToken(undefined, config, "abc").ok).toBe(false);
  });
});

describe("explain", () => {
  const termix: NetbirdPeer = {
    id: "t",
    name: "termix",
    ip: "100.64.0.1",
    groups: [{ id: "g-t", name: "Termix" }],
  };
  const target: NetbirdPeer = {
    id: "s",
    name: "server",
    ip: "100.64.0.2",
    groups: [{ id: "g-s", name: "Servers" }],
  };
  const policies = [
    {
      id: "p1",
      name: "SSH",
      rules: [
        {
          protocol: "tcp",
          ports: ["22"],
          sources: [{ id: "g-t", name: "Termix" }],
          destinations: [{ id: "g-s", name: "Servers" }],
        },
      ],
    },
    {
      id: "p2",
      name: "Web",
      rules: [
        {
          protocol: "tcp",
          ports: ["80", "443"],
          sources: [{ id: "g-t", name: "Termix" }],
          destinations: [{ id: "g-s", name: "Servers" }],
        },
      ],
    },
    {
      id: "p3",
      name: "RDP (off)",
      enabled: false,
      rules: [
        {
          protocol: "tcp",
          ports: ["3389"],
          sources: [{ id: "g-t", name: "Termix" }],
          destinations: [{ id: "g-s", name: "Servers" }],
        },
      ],
    },
  ];

  it("names the allowing rule per port, other-port rules and switched off ones", () => {
    const ex = explain(policies, termix, target, [22, 3389]);
    expect(ex.ports).toEqual([
      expect.objectContaining({
        port: 22,
        state: "allowed",
        allowedBy: [expect.objectContaining({ policy: "SSH", ports: "22" })],
      }),
      expect.objectContaining({ port: 3389, state: "blocked", allowedBy: [] }),
    ]);
    expect(ex.otherPorts.map((m) => m.policy)).toEqual(["Web"]);
    expect(ex.disabled.map((m) => m.policy)).toEqual(["RDP (off)"]);
  });

  it("is unknown without a Termix peer", () => {
    const ex = explain(policies, null, target, [22]);
    expect(ex.ports[0].state).toBe("unknown");
  });
});

// Shapes the backend routes answer with (src/backend/routes.ts, auth.ts).

export type CredentialSource = "sso" | "user" | "service";
export type ReachabilityState = "allowed" | "blocked" | "unknown" | "self";

export interface PeerView {
  id: string;
  name: string;
  ip: string;
  dnsLabel: string;
  os: string;
  connected: boolean;
  lastSeen: string | null;
  groups: string[];
  sshPort: number;
  reachability: {
    state: ReachabilityState;
    policies: string[];
    postureChecks: boolean;
  };
  imported: boolean;
}

export interface PeersResponse {
  configured: boolean;
  source: CredentialSource | null;
  termixPeer: string | null;
  termixPeerMissing: boolean;
  policiesReadable: boolean;
  peers: PeerView[];
  error?: "token" | "api" | "signin";
}

export interface AuthStatus {
  mode: "service" | "user" | "user-or-service";
  ssoAvailable: boolean;
  serviceTokenSet: boolean;
  userTokenSet: boolean;
  ssoSignedIn: boolean;
  ssoIdentity: string | null;
  active: CredentialSource | null;
  redirectUri: string;
}

export interface RuleMatch {
  policy: string;
  rule: string;
  protocol: string;
  ports: string;
  bidirectional: boolean;
  direction: "forward" | "reverse";
  postureChecks: boolean;
  disabled: boolean;
}

export interface PeerDetail {
  id: string;
  name: string;
  ip: string;
  connectionIp: string | null;
  dnsLabel: string;
  extraDnsLabels: string[];
  hostname: string;
  os: string;
  kernel: string;
  version: string;
  connected: boolean;
  lastSeen: string | null;
  lastLogin: string | null;
  location: string | null;
  loginExpirationEnabled: boolean;
  loginExpired: boolean;
  approvalRequired: boolean;
  ephemeral: boolean;
  sshServerEnabled: boolean;
  accessiblePeers: number | null;
  groups: string[];
  policiesReadable: boolean;
  explanation: {
    ports: Array<{
      port: number;
      state: ReachabilityState;
      allowedBy: RuleMatch[];
    }>;
    otherPorts: RuleMatch[];
    disabled: RuleMatch[];
  };
}

export interface CredentialOption {
  id: number;
  name: string;
  username: string;
}

export interface ImportResult {
  created: Array<{ peerId: string; hostId: number; name: string }>;
  skipped: Array<{ peerId: string; reason: string }>;
  failed: Array<{ peerId: string }>;
}

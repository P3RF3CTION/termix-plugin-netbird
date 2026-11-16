// Shapes the backend routes answer with (src/backend/routes.ts, auth.ts).

export type CredentialSource = "sso" | "user" | "service";
export type ReachabilityState = "allowed" | "blocked" | "unknown" | "self";
export type PostureSummary = "none" | "pass" | "unknown" | "fail";
export type PostureState = "pass" | "fail" | "unknown";

export interface PostureFinding {
  check: string;
  kind: "version" | "os" | "geo" | "network" | "process" | "missing";
  state: PostureState;
  required: string;
  actual: string;
}

export interface PostureResult {
  state: PostureState;
  peer: string;
  findings: PostureFinding[];
}

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
    /** Older backends leave it out. */
    posture?: PostureSummary;
  };
  imported: boolean;
  sshEnabled: boolean;
  loginExpired: boolean;
  approvalRequired: boolean;
}

export interface NetbirdIdentity {
  name: string;
  role: string;
  serviceUser: boolean;
}

export interface PeersResponse {
  configured: boolean;
  source: CredentialSource | null;
  termixPeer: string | null;
  termixPeerMissing: boolean;
  policiesReadable: boolean;
  peers: PeerView[];
  identity?: NetbirdIdentity | null;
  restricted?: boolean;
  fallbackFrom?: CredentialSource | null;
  error?: "token" | "api" | "signin" | "forbidden";
}

export interface AuthStatus {
  mode: "service" | "user" | "user-or-service";
  userTokenIgnored: boolean;
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
  posture?: PostureResult | null;
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
      postureBlocked?: boolean;
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
  peerIp: string | null;
  lastSeen: string | null;
  loginExpired: boolean;
  offlineDays: number | null;
  certain: boolean;
  actions: ReconcileAction[];
}

export interface ReconcileResponse {
  findings: HostFinding[];
  complete: boolean;
  staleDays: number;
}

export interface ReconcileApplyResult {
  updated: Array<{ hostId: number; ip: string }>;
  deleted: Array<{ hostId: number }>;
  skipped: Array<{ hostId: number; reason: string }>;
  failed: Array<{ hostId: number }>;
}

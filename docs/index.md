NetBird shows the peers of your [NetBird](https://netbird.io) network in a Termix sidebar panel, adds a peer as a host in one click and tells you, per peer, whether your NetBird access policies let the Termix server reach its SSH port.

It works with NetBird Cloud and with a self-hosted management server.

## Turn it on

1. In NetBird, create a service account and a personal access token for it. Read access is enough: give the service account the **Auditor** role if your NetBird version has it. The plugin never writes to NetBird.
2. Install NetBird from the Plugins tab.
3. Open Settings, Plugins, NetBird and fill in:
   - **Management URL**: your self-hosted server, for example `https://vpn.example.com`. Leave it empty for NetBird Cloud. `/api` is added for you.
   - **API token**: the token from step 1. Termix stores it encrypted and it never reaches the browser.
   - **Termix peer** (optional): the NetBird peer the Termix server runs on, by name, DNS label or NetBird IP. Without it the panel lists peers but skips the reachability check.
   - **SSH port**: the port to check and to put into new hosts, `22` by default.
4. Open the NetBird panel from the sidebar.

Seeing the panel needs the **View NetBird peers** permission. Only admins get it by default, because the list is a full inventory of your network.

## Use it

Each peer shows its NetBird IP, DNS label, OS, groups and whether it is online (hover for the last seen time).

**Add as host** opens the Termix host editor with the name, NetBird IP and SSH port filled in. You pick the username and login there and save. The plugin itself never creates hosts and never sees credentials.

### SSH reachability

When a Termix peer is set, each peer gets one of:

- **SSH \<port\> allowed**: at least one enabled NetBird policy lets the Termix peer open TCP to this port on this peer. Hover to see which policies. If a policy has posture checks, the hint says so: they can still block the connection.
- **No policy allows SSH \<port\>**: no enabled policy fits. Add a policy from a group of the Termix peer to a group of this peer for TCP \<port\>.
- **Not checked**: no Termix peer is set, or it is not in the network.

The check reads the policies, it does not open a connection. A rule counts when it is enabled, accepts traffic, uses TCP or all protocols, covers the port (single ports, ranges or no port limit) and either goes from a group of the Termix peer to a group of the target (or to the peer itself as a destination resource) or is bidirectional the other way round. An offline peer, a host firewall or a posture check can still block a connection the policies allow.

## Privacy and security

- The plugin only talks to the management URL you set, with the token you set. No telemetry.
- Capabilities: `network:outbound` (the NetBird API), `network:serve` (one read-only route), `ui:surface` (the panel). It has no access to hosts, credentials or SSH.
- Use a read-only token. If the token leaks, it shows your network's peers and policies, nothing more.

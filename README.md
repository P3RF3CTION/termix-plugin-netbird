<div align="center">

<img src="https://termix.site/img/logo.svg" width="120" alt="Termix Logo" />

<h1>NetBird for Termix</h1>

<p>See your NetBird peers in Termix, add them as hosts in one click and find out whether your policies let Termix reach their SSH port</p>

</div>

<br />

## What it does

[NetBird](https://netbird.io) connects your machines in a private network. [Termix](https://github.com/Termix-SSH/Termix) is where you open SSH sessions to them. This plugin connects the two:

- **Peer list.** A NetBird panel in the Termix sidebar lists every peer with its NetBird IP, DNS label, operating system, groups and online state. Search it, copy an IP, refresh.
- **Add as host.** One click opens the Termix host editor with the name, NetBird IP and SSH port filled in. You choose the username and login, then save.
- **SSH reachability check.** For each peer the plugin reads your NetBird access policies and tells you whether the Termix server may open its SSH port, and which policy allows it. You know why a connection fails before you read a timeout.

It works with NetBird Cloud and with a self-hosted management server. It only reads from NetBird and changes nothing there.

<br />

## Requirements

- Termix 26.10 or newer, and an admin account in it
- A NetBird network (Cloud or self-hosted) and the right to create a service user there
- For the reachability check: the Termix server is itself a NetBird peer

<br />

## Install

**From the plugin list.** In Termix, open **Plugins**, search for **NetBird** and install it.

> The plugin is not in the community registry yet. Until it is, use the file install below.

**From a file.** Download `netbird-<version>.tmxplug` from the [Releases](https://github.com/P3RF3CTION/termix-plugin-netbird/releases) page and install it in Termix under **Plugins, Install from file**. Termix marks a file install as unverified. Before you install, compare the file's `sha256` with the one in the release notes.

<br />

## Set it up

### 1. Create a read-only token in NetBird

1. In the NetBird dashboard, create a service user, for example `termix`.
2. Give it the **Auditor** role if your NetBird version offers it, otherwise the lowest role that can read peers and policies.
3. Create a personal access token for it and copy it. NetBird shows it only once.

Use a service user, not your own account. The token then keeps working when people leave, and it can do no more than the plugin needs.

### 2. Fill in the settings

In Termix, open **Settings, Plugins, NetBird**:

| Setting        | What to enter                                                                                                                      |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Management URL | Your self-hosted server, for example `https://vpn.example.com`. Leave it empty for NetBird Cloud. `/api` is added for you.         |
| API token      | The token from step 1. Termix stores it encrypted, and it never reaches the browser.                                               |
| Termix peer    | The peer the Termix server runs on: its name, DNS label or NetBird IP. Optional, but without it the reachability check is skipped. |
| SSH port       | The port to check and to put into new hosts. Default `22`.                                                                         |

### 3. Decide who sees it

The panel needs the **View NetBird peers** permission. Only admins have it by default, because the list shows your whole network. Grant it to other roles in Termix if they should see it.

<br />

## Use it

Open **NetBird** in the sidebar. Each peer shows a badge:

| Badge                         | Meaning                                                                                                  |
| ----------------------------- | -------------------------------------------------------------------------------------------------------- |
| **SSH 22 allowed**            | At least one enabled policy lets the Termix peer open TCP 22 to this peer. Hover to see which policies.  |
| **No policy allows SSH 22**   | No enabled policy fits. Add a policy from a group of the Termix peer to a group of this peer for TCP 22. |
| **Not checked**               | No Termix peer is set, or it was not found in the network.                                               |
| **This is the Termix server** | The peer Termix runs on.                                                                                 |

The check reads the policies; it does not open a connection. A connection the policies allow can still fail when the peer is offline, a firewall on the host blocks the port, or a posture check fails. If a matching policy has posture checks, the badge says so.

<br />

## Troubleshooting

| Message                                                     | What to do                                                                                                    |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| _Set the NetBird API token in Settings, Plugins, NetBird._  | No token is saved yet. See [Set it up](#set-it-up).                                                           |
| _NetBird rejected the API token._                           | The token is wrong, expired or was deleted. Create a new one and save it again.                               |
| _The NetBird management API could not be read._             | Check the Management URL, and that the Termix server can reach it (DNS, firewall, TLS certificate).           |
| _The Termix peer from the settings is not in this network._ | Check the spelling. Name, DNS label and NetBird IP all work. The peer must be in the network the token reads. |
| The NetBird panel is missing                                | Your role lacks **View NetBird peers**, or the plugin is disabled under **Plugins**.                          |

<br />

## Privacy and security

- The plugin talks only to the Management URL you set, with the token you set. No telemetry, no other servers.
- It reads the NetBird peers and policies and never writes to NetBird.
- It has no access to Termix hosts, credentials or SSH sessions. A host is only created when you save it in the host editor.
- The token is stored encrypted on the Termix server and never sent to the browser. If it leaks, it reveals your peers and policies; revoke it in NetBird.

Capabilities the plugin asks for:

| Capability         | Why                                                                             |
| ------------------ | ------------------------------------------------------------------------------- |
| `network:outbound` | Read the NetBird management API at the URL you set                              |
| `network:serve`    | One read-only route for the panel, behind the **View NetBird peers** permission |
| `ui:surface`       | The sidebar panel                                                               |

Found a security problem? Please report it privately through [GitHub security advisories](https://github.com/P3RF3CTION/termix-plugin-netbird/security/advisories/new), not in a public issue.

<br />

## Contributing

Bug reports and ideas are welcome as [issues](https://github.com/P3RF3CTION/termix-plugin-netbird/issues). For development, see [CONTRIBUTING.md](CONTRIBUTING.md).

<br />

## License

Apache-2.0. Not affiliated with NetBird GmbH; "NetBird" names the service this plugin connects to.

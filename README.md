<div align="center">

<img src="https://termix.site/img/logo.svg" width="120" alt="Termix Logo" />

<h1>NetBird for Termix</h1>

<p>See your NetBird peers in Termix, sign in with your own identity provider, add peers as hosts in bulk and find out which policy lets Termix reach them</p>

</div>

<br />

## What it does

[NetBird](https://netbird.io) connects your machines in a private network. [Termix](https://github.com/Termix-SSH/Termix) is where you open SSH sessions to them. This plugin connects the two:

- **Peer list.** A NetBird panel in the Termix sidebar lists every peer with its NetBird IP, DNS label, operating system, groups and online state. Search it, copy an IP, refresh.
- **Sign in your way.** A shared, read-only service token, each user's own NetBird token, or single sign-on with any OpenID Connect provider NetBird trusts (NetBird's built-in IdP, Keycloak, Zitadel, Authentik, Entra ID, Auth0 …). With an own sign-in, every user sees NetBird with their own NetBird permissions.
- **Add hosts, one or many.** One click opens the host editor with name, NetBird IP and SSH port filled in. Or tick several peers and add them in one go, into a folder, with username, port, a saved login and tags from the NetBird groups. Peers that already are a host are skipped.
- **Peer details.** NetBird version, system, public address and location, login expiry, approval state, NetBird SSH server and DNS names.
- **Reachability and why.** For each peer the plugin reads your NetBird access policies and tells you whether the Termix server may open its SSH port, and which rule allows it. The details also list rules on other ports and matching rules that are switched off. You know why a connection fails before you read a timeout.

It works with NetBird Cloud and with a self-hosted management server. It only reads from NetBird and changes nothing there.

<br />

## Requirements

- Termix 26.10.3 or newer, and an admin account in it
- A NetBird network (Cloud or self-hosted), and either the right to create a service user there or an identity provider NetBird signs in with
- For the reachability check: the Termix server is itself a NetBird peer

<br />

## Install

**From the plugin list.** In Termix, open **Plugins**, search for **NetBird** and install it.

> The plugin is not in the community registry yet. Until it is, use the file install below.

**From a file.** Download `netbird-<version>.tmxplug` from the [Releases](https://github.com/P3RF3CTION/termix-plugin-netbird/releases) page and install it in Termix under **Plugins, Install from file**. Termix marks a file install as unverified. Before you install, compare the file's `sha256` with the one in the release notes.

<br />

## Set it up

In Termix, open **Settings, Plugins, NetBird**. The full guide, including single sign-on per identity provider, is in [docs/index.md](docs/index.md).

| Setting                  | What to enter                                                                                                                                       |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Management URL           | Your self-hosted server, for example `https://vpn.example.com`. Leave it empty for NetBird Cloud.                                                   |
| Sign-in mode             | Service token for everyone (default), own sign-in with the service token as fallback, or own sign-in only.                                          |
| Service token            | A personal access token of a read-only NetBird service user (Auditor role if available). Stored encrypted, never sent to the browser.               |
| Issuer URL, Client ID    | For single sign-on: the OpenID Connect issuer and a client whose tokens NetBird accepts. Register the redirect URI the panel shows at the provider. |
| Termix peer              | The peer the Termix server runs on: name, DNS label or NetBird IP. Without it the reachability check is skipped.                                    |
| SSH port, Ports to check | The port to check and to put into new hosts (default `22`), and more ports for the details.                                                         |

Users can also enter their **own NetBird access token** in their personal plugin settings.

Two permissions decide who may do what: **View NetBird peers** (the panel) and **Import NetBird peers as hosts**. Only admins have them by default, because with a service token the list shows your whole network.

<br />

## Use it

Open **NetBird** in the sidebar. With an own sign-in mode, click **Sign in with SSO** first. Each peer shows a badge:

| Badge                         | Meaning                                                                                                  |
| ----------------------------- | -------------------------------------------------------------------------------------------------------- |
| **SSH 22 allowed**            | At least one enabled policy lets the Termix peer open TCP 22 to this peer. Hover to see which policies.  |
| **No policy allows SSH 22**   | No enabled policy fits. Add a policy from a group of the Termix peer to a group of this peer for TCP 22. |
| **Not checked**               | No Termix peer is set, it was not found, or your NetBird account may not read policies.                  |
| **This is the Termix server** | The peer Termix runs on.                                                                                 |
| **Host exists**               | The peer's NetBird IP and SSH port are already one of your hosts.                                        |

Tick peers and click **Add selected as hosts** to add them in bulk. **Details** opens the peer details and the access explanation.

The check reads the policies; it does not open a connection. A connection the policies allow can still fail when the peer is offline, a firewall on the host blocks the port, or a posture check fails.

<br />

## Troubleshooting

| Message                                                      | What to do                                                                                                        |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| _Set a NetBird token … or ask your admin to set up sign-in._ | No service token and no own sign-in. See [Set it up](#set-it-up).                                                 |
| _Sign in to NetBird to see your peers._                      | The sign-in mode needs an own sign-in. Click **Sign in with SSO** or set your own token.                          |
| _NetBird rejected the credential._                           | The token is wrong, expired or deleted, or NetBird does not accept tokens from this issuer or client.             |
| _Sign-in failed. The Termix log has the reason._             | Usually the redirect URI is not registered, refresh tokens are not allowed for the client, or the issuer differs. |
| _The NetBird management API could not be read._              | Check the Management URL, and that the Termix server can reach it (DNS, firewall, TLS certificate).               |
| _The Termix peer from the settings is not in this network._  | Check the spelling. Name, DNS label and NetBird IP all work. The peer must be visible to the account in use.      |
| The NetBird panel or the import is missing                   | Your role lacks **View NetBird peers** or **Import NetBird peers as hosts**, or the plugin is disabled.           |

<br />

## Privacy and security

- The plugin talks only to the Management URL and the identity provider you set. No telemetry, no other servers.
- It reads NetBird peers and policies and never writes to NetBird.
- Single sign-on uses the authorization code flow with PKCE, a nonce and a single-use state. The refresh token is stored encrypted per user; the access token stays in server memory. **Sign out** deletes both.
- Hosts are created only on an explicit import, as the user who imports them, and only for peers that user's NetBird sign-in can see. The plugin sees names and usernames of saved logins, never their secrets.
- The service token is stored encrypted on the Termix server and never sent to the browser. If it leaks, it reveals your peers and policies; revoke it in NetBird.

Capabilities the plugin asks for:

| Capability                  | Why                                                                                                |
| --------------------------- | -------------------------------------------------------------------------------------------------- |
| `network:outbound`          | Read the NetBird management API and talk to the identity provider                                  |
| `network:serve`             | The panel's routes, behind the plugin's permissions; the sign-in callback takes a single-use state |
| `ui:surface`                | The sidebar panel                                                                                  |
| `hosts:read`, `hosts:write` | Mark peers that already are a host, and create hosts on import                                     |
| `credentials:use`           | Offer the user's saved logins (name and username) in the import                                    |
| `kv:own`, `secrets:own`     | Sign-in state and the encrypted refresh token                                                      |

Found a security problem? Please report it privately through [GitHub security advisories](https://github.com/P3RF3CTION/termix-plugin-netbird/security/advisories/new), not in a public issue.

<br />

## Contributing

Bug reports and ideas are welcome as [issues](https://github.com/P3RF3CTION/termix-plugin-netbird/issues). For development, see [CONTRIBUTING.md](CONTRIBUTING.md).

<br />

## License

Apache-2.0. Not affiliated with NetBird GmbH; "NetBird" names the service this plugin connects to.

NetBird shows the peers of your [NetBird](https://netbird.io) network in a Termix sidebar panel, adds peers as hosts (one at a time or in bulk) and tells you, per peer, whether your NetBird access policies let the Termix server reach it, and through which rule.

It works with NetBird Cloud and with a self-hosted management server, and with any OpenID Connect identity provider NetBird is set up with.

## Choose how the plugin signs in to NetBird

The plugin always reads NetBird as somebody. **Sign-in mode** in the admin settings decides who:

| Mode                                     | Who the plugin is in NetBird                                                     | Good for                                                        |
| ---------------------------------------- | -------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| **Service token for everyone** (default) | One NetBird service user, the same for every Termix user                         | A small team that may all see the whole network                 |
| **Own sign-in, else service token**      | The Termix user's own NetBird account when signed in, otherwise the service user | Moving to per-user access without breaking the panel for others |
| **Own sign-in only**                     | Only the Termix user's own NetBird account                                       | Teams where NetBird permissions differ per person               |

An own sign-in is either **single sign-on** (the user clicks _Sign in with SSO_ in the panel) or the user's **own NetBird access token** in their personal plugin settings. With an own sign-in, NetBird applies that user's own permissions: someone who may only see their own peers sees only those in Termix too.

### When your own token shows fewer peers, or none

- **The mode ignores it.** With _Service token for everyone_, an own access token is saved but never used. The panel says so; an admin switches the mode.
- **Your NetBird role is "user".** NetBird lists a user with that role only the peers they own (devices they logged in themselves). The panel shows your NetBird user and role and explains a short or empty list. For the whole network, give the user the role **admin** or **auditor** in NetBird, or use the service token.
- **NetBird blocks regular users.** If the NetBird account blocks the dashboard and API for regular users, a valid token gets 403. The panel names this instead of a generic error.
- **The token was rejected.** Paste only the token (it starts with `nbp_`). The plugin removes a pasted `Token `/`Bearer ` prefix, quotes and line breaks. In _Own sign-in, else service token_, a rejected own token or SSO session falls back to the service token and the panel shows a notice.

## Set up a service token

1. In NetBird, create a service user and a personal access token for it. Read access is enough: give it the **Auditor** role if your NetBird version has it. The plugin never writes to NetBird.
2. In Termix, open Settings, Plugins, NetBird:
   - **Management URL**: your self-hosted server, for example `https://vpn.example.com`. Leave it empty for NetBird Cloud. `/api` is added for you.
   - **Service token**: the token from step 1. Termix stores it encrypted and it never reaches the browser.

## Set up single sign-on

Single sign-on uses the OpenID Connect authorization code flow with PKCE. The token the plugin gets is sent to NetBird as `Authorization: Bearer`, so it has to be a token your NetBird management server accepts: same issuer, and an audience NetBird is configured for.

1. Find the issuer and client NetBird uses. They are in your NetBird management configuration (the IdP or `HttpConfig` section), or in what the NetBird dashboard uses to sign in:
   - **NetBird's built-in IdP** (self-hosted with the embedded Dex): the issuer is usually `https://<your management host>/oauth2`, and the client is the dashboard client.
   - **An external IdP** (Keycloak, Zitadel, Authentik, Entra ID, Okta, Google and others): the realm or tenant URL NetBird trusts, and the client whose ID NetBird expects as audience.
2. Open the NetBird panel in Termix once. Under the sign-in bar it shows the **redirect URI** of your Termix installation, for example `https://termix.example.com/plugin-api/netbird/auth/callback`.
3. At the identity provider, add that redirect URI to the client. If the client is public (as dashboard clients usually are), PKCE is all it needs. Allow refresh tokens for it so users stay signed in.
4. In Termix, Settings, Plugins, NetBird:
   - **Sign-in mode**: one of the two own sign-in modes.
   - **Issuer URL** and **Client ID** from step 1.
   - **Client secret**: only for a confidential client.
   - **Scopes**: `openid profile email offline_access` by default. `offline_access` gives the refresh token.
   - **Audience**: only for providers that need it to issue an API token (Auth0 does).
   - **Extra authorization parameters**: optional, for example `connector_id=<id>` to skip the connector choice of a Dex based IdP.
   - **Send the ID token**: only if your NetBird validates ID tokens instead of access tokens.
5. Users click **Sign in with SSO** in the panel. A pop-up opens the identity provider; after the sign-in it closes and the panel reloads.

What the plugin keeps: the refresh token and the display name, encrypted per user in Termix. The access token lives only in the Termix server's memory until it expires. **Sign out** in the panel deletes both. The plugin checks issuer, audience, nonce and expiry of the ID token; it comes straight from the token endpoint over TLS, so its signature is not checked again (OpenID Connect Core 3.1.3.7).

If the sign-in fails, the pop-up says so and the reason is in the Termix log. The common ones: the redirect URI is not registered, the client does not allow refresh tokens (`no refresh token`), or the issuer in the settings differs from the one in the token (`issuer mismatch`).

## Set up the reachability check

- **Termix peer** (optional): the NetBird peer the Termix server runs on, by name, DNS label or NetBird IP. Without it the panel lists peers but skips the check.
- **SSH port**: the port to check and to put into new hosts, `22` by default.
- **Ports to check**: more ports for the access explanation in the peer details, for example `3389, 5900`.

The check needs an account that may read NetBird policies. If the account may not (a NetBird user role often may not), the panel still lists peers and says that reachability is not checked.

## Permissions

| Permission                        | Default | Allows                                                  |
| --------------------------------- | ------- | ------------------------------------------------------- |
| **View NetBird peers**            | admins  | The panel, the peer details and the sign-in             |
| **Import NetBird peers as hosts** | admins  | Selecting peers and adding them as the user's own hosts |

Only admins get them by default, because with a service token the list is a full inventory of your network.

## Use it

Each peer shows its NetBird IP, DNS label, OS, groups and whether it is online (hover for the last seen time). **Host exists** marks peers whose NetBird IP and SSH port are already one of your hosts.

**Add as host** opens the Termix host editor with name, NetBird IP and SSH port filled in. You pick the username and login there and save.

### Add many peers at once

Tick peers (or **Select all shown**, which follows the search and leaves out existing hosts and the Termix server) and click **Add selected as hosts**. Choose:

- **Folder**: `NetBird` by default; created if it does not exist.
- **Username** and **SSH port** for all of them.
- **Login**: one of your saved credentials, or none to set it later per host.
- **Tag hosts with their NetBird groups**: every host gets the tag `netbird`, and with this option also one tag per NetBird group.

The plugin reads the peers from NetBird again before it creates anything, so it only adds peers your sign-in may see. A peer whose NetBird IP and port already exist as one of your hosts is skipped. The result says how many were added, skipped and failed. The hosts belong to you, as if you had created them yourself.

### Filter the list

Search by name, IP, DNS name, system or group, show only online peers, or pick one NetBird group. Badges mark peers whose login expired, peers waiting for approval and peers running the NetBird SSH server.

### Peer details

**Details** on a peer shows the NetBird version, system, public address and location, last login and login expiry, whether the peer waits for approval, whether the NetBird SSH server is on, its DNS names and how many peers it can reach.

Under **Access from the Termix peer** it lists, per checked port, the rules that allow it (policy, protocol and ports, and whether it works through a bidirectional rule or has posture checks), the rules between the two peers on other ports, and matching rules that are switched off. That is usually the answer to "why can I not connect".

### How the check decides

The check reads the policies, it does not open a connection. A rule counts when it is enabled, accepts traffic, uses TCP or all protocols, covers the port (single ports, ranges or no port limit) and either goes from a group of the Termix peer to a group of the target (or to the peer itself as a destination resource) or is bidirectional the other way round. An offline peer, a host firewall or a posture check can still block a connection the policies allow.

## Privacy and security

- The plugin talks only to the management URL and the identity provider you set. No telemetry.
- It only reads NetBird (peers, one peer, its reachable peers, policies). It never writes there.
- Capabilities:
  - `network:outbound`: the NetBird API and the identity provider.
  - `network:serve`: the panel's routes. All but the sign-in callback need **View NetBird peers**; the callback only accepts a single-use state that a signed-in user started less than ten minutes before.
  - `ui:surface`: the panel.
  - `hosts:read`, `hosts:write`: mark existing hosts and create hosts on import, always as the acting user.
  - `credentials:use`: list the user's own saved logins (name and username only) for the import.
  - `kv:own`, `secrets:own`: the sign-in state and the encrypted refresh token.
- Use a read-only service token. If it leaks, it shows your network's peers and policies, nothing more.

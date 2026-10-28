# Changelog

## 1.2.0

### Added

- The panel names the NetBird user and role behind the credential. With the role "user" NetBird lists only that user's own peers; the panel now says so instead of showing a short or empty list without a reason
- In the "own sign-in, else service token" mode, a personal access token or SSO session that NetBird rejects falls back to the service token, with a notice
- Filters for online peers and for a NetBird group
- Badges for an expired peer login, a peer waiting for approval and peers running the NetBird SSH server
- A notice when your own access token is saved but the sign-in mode ignores it

### Fixed

- A personal or service token pasted with the scheme ("Token nbp_...", "Bearer ..."), in quotes or with a line break was sent as is and NetBird answered 401. Tokens are now cleaned before use
- A valid token that may not list peers (NetBird answers 403, for example when regular users are blocked) is reported as such instead of as a generic API error

## 1.1.0

### Added

- Single sign-on with any OpenID Connect provider NetBird trusts (authorization code flow with PKCE, refresh tokens): NetBird's built-in IdP, Keycloak, Zitadel, Authentik, Entra ID, Auth0 and others. Each user then sees NetBird with their own NetBird permissions
- Own NetBird access token per user as a second way to sign in
- Sign-in modes: service token for everyone (default, the 1.0 behaviour), own sign-in only, or own sign-in with the service token as fallback
- Bulk import: select peers (or all shown) and add them as hosts in one step, with folder, username, SSH port, a saved login and optional tags from the NetBird groups. Peers that already exist as a host are skipped
- Peer details: NetBird version, system, public address and location, login expiry, approval state, NetBird SSH server, DNS names and reachable peers
- Access explanation per peer: which rule allows each checked port, rules between the two peers on other ports, and matching rules that are switched off. Extra ports to check in the settings
- New permission **Import NetBird peers as hosts**

### Changed

- Needs Termix 26.10.3 or newer (plugin API 1.8 for host folders)
- New capabilities `hosts:read`, `hosts:write`, `credentials:use`, `kv:own` and `secrets:own` for the import and the sign-in
- If the NetBird account may not read policies, the panel lists peers and says why reachability is not checked, instead of failing

## 1.0.0

### Added

- A NetBird sidebar panel that lists peers with NetBird IP, DNS label, OS, groups and online state
- Add as host: opens the host editor with name, NetBird IP and SSH port filled in
- SSH reachability per peer from the NetBird access policies, with the allowing policies and a posture check hint
- Settings for the management URL (NetBird Cloud or self-hosted), API token, Termix peer and SSH port
- English and German translations

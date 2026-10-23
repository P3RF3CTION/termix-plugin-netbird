# Changelog

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

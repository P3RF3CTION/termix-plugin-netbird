# AGENTS.md

This repo is a [Termix](https://github.com/Termix-SSH/Termix) plugin. These notes are for AI coding tools.

## Read first

Before changing anything, read `node_modules/@termix-ssh/plugin-sdk/PLUGIN-GUIDE.md`. It covers the
manifest, backend, database, frontend, UI, testing, releasing and submitting to the community registry,
and it matches the SDK version installed here. If it is missing, run `npm install`. If it is still missing,
the SDK is older than 1.0.6: run `npm install -D @termix-ssh/plugin-sdk@latest` or read
https://docs.termix.site/develop instead.

If the guide and the SDK's TypeScript types disagree, the types are right.

## First time setup

If `manifest.json` still has the id `hello-world`, this plugin was just made from the template. Ask the
user for the plugin's id, name and description, then:

1. In `manifest.json`, set `id`, `name`, `description`, `author`, `repository`, `docs`, `category`,
   `icon` and `features`. The id is lowercase with dashes and can't change after the first release.
2. Rename every `hello-world`, `hello_world` and `Hello World` to match: `package.json`,
   `locales/en.json`, the index name in `src/backend/tables.ts`, the API paths in `src/backend/routes.ts`,
   the tab id in `src/frontend/index.tsx`, the tests, `docs/index.md`, `CONTRIBUTING.md` and `README.md`.
3. Delete `migrations/` and run `npm run migrations` so the tables use the new id.
4. Replace the example notes feature with the real one, and fill in "About this plugin" below.

## Commands

```bash
npm run build        # bundle into dist/
npm test             # run the tests
npm run typecheck    # type check
npm run validate     # check manifest.json, migrations, changelog and docs
npm run migrations   # write migrations after changing src/backend/tables.ts
npm run pack         # write <id>-<version>.tmxplug
npm run format       # format with Prettier
```

`npx termix-plugin dev --server <url> --key <tmx_...>` installs the plugin on a Termix server with
developer mode on and reinstalls it on every save. Don't start it unless the user asks.

## Layouts and themes

A plugin can also be a layout (`contributes.layouts`, capability `ui:layout`, `app.registerLayout` in the
frontend, shell state from `useShell()`) or add themes (`contributes.themes`, capability `ui:theme`, one CSS
file per theme scoped under `.<id>`). A theme only plugin has no `src/`: just `manifest.json`, `themes/*.css`,
`locales/` and a test that runs `validateThemeCss()`. The guide's "Layouts and themes" section has the rules.

## Done means

- `npm test`, `npm run typecheck`, `npm run validate`, `npm run build` and `npm run format:check` pass
- `npx termix-plugin migrations --check` passes
- New UI text is in `locales/en.json`, new routes have an `@openapi` block and a test
- `docs/` and the section below still match what the plugin does
- User facing changes are in `CHANGELOG.md` under the version they ship in

## About this plugin

Keep this section current when the plugin changes: what it does, how it is put together, decisions that
aren't obvious from the code, and anything that has bitten you before.

- What it does: lists NetBird peers in a sidebar panel (`netbird`), signs the user in to NetBird
  (service token, own PAT or OIDC single sign-on), adds peers as hosts (one through
  `shell.openHostEditor`, many through `POST /hosts/import`), shows peer details, explains per
  port which NetBird rule lets the Termix server's own peer reach a peer (including the policy's
  posture checks), and checks the user's own hosts against NetBird (`/hosts/reconcile`: peer gone,
  NetBird IP changed, offline longer than `staleDays`).
- How it is put together:
  - `src/backend/oidc.ts`: discovery, PKCE, authorize URL, code exchange, refresh, ID token claim
    checks. Pure apart from `ctx.fetch`; unit tests in `tests/backend/oidc.test.ts`.
  - `src/backend/auth.ts`: which credential a request uses (`sso` → own PAT → service, filtered by
    `authMode`), the in-memory access token cache and the hand-over of a finished sign-in.
  - `src/backend/netbird-api.ts`: GET only, on an allow-list of paths (`/users/current`, `/peers`, `/peers/{id}`,
    `/peers/{id}/accessible-peers`, `/policies`, `/posture-checks`), only the configured host via
    `allowPrivateHosts`. Posture checks are fetched only when a policy references them.
  - `src/backend/reachability.ts`: pure policy evaluation (`evaluate`, `explain`), tested in
    `tests/backend/reachability.test.ts` and `oidc.test.ts`.
  - `src/backend/posture.ts`: pure posture check evaluation (client version, OS/kernel version,
    location; network range and process are "unknown"), tested in `tests/backend/posture.test.ts`.
  - `src/backend/reconcile.ts`: pure host/peer comparison, tested with the routes in
    `tests/backend/reconcile.test.ts`.
  - `src/backend/routes.ts`: `/auth/*`, `/peers`, `/peers/:peerId`, `/credentials`,
    `/hosts/import`, `/hosts/reconcile` (GET findings, POST actions); route tests in `tests/backend/routes.test.ts` and `sso-import.test.ts`.
  - Frontend: `NetbirdPeersPanel.tsx`, `AuthBar.tsx`, `ImportDialog.tsx`, `PeerDetails.tsx`,
    `ReconcileView.tsx` (opens in place of the list; confirms through `app.confirm`).
- Decisions:
  - SSO is generic OIDC, nothing provider specific. The token goes to NetBird as Bearer, so the
    issuer and client must be ones NetBird accepts; the docs say how to find them.
  - The callback is public (the IdP redirects the browser, there is no actor). It does not use
    `ctx.asUser`, which would need `users:impersonate`. It seals the refresh token
    (`ctx.secrets.seal`) into kv under `oidc-done:<userId>`; the user's next request
    (`adoptFinishedLogin`) moves it into that user's `ctx.secrets` and writes the audit line.
    States and unclaimed logins expire after ten minutes.
  - The ID token is checked for iss, aud, nonce and exp, not its signature: it comes from the token
    endpoint over TLS (OIDC Core 3.1.3.7). The access token is the one NetBird validates.
  - 1.0 had no `hosts:write` and relied on the host editor. 1.1 adds it for the bulk import, which
    runs as the acting user, re-reads peers from NetBird (only peers that user's sign-in sees) and
    validates `credentialId` against `ctx.credentials.list`. Duplicates are matched by IP and port.
  - No `hosts:status-provide`: that capability makes the plugin the single source of every host's
    status dot and would push out the Host Status plugin. Peer state is shown in the panel instead.
  - No database: everything is read live from NetBird; kv holds only sign-in state.
  - New hosts use the NetBird IP, not the DNS label: the label only resolves where NetBird DNS is
    on, and servers often run with `--disable-dns`.
  - A 403 on `/policies` (NetBird user roles) degrades to "not checked" instead of failing the list.
  - Posture checks apply to the source side of a rule: the Termix peer for a forward rule, the
    target peer for a reverse (bidirectional) one. A policy whose checks fail does not count; if
    every allowing policy fails, the peer is "blocked" with posture "fail". An OS family missing
    from an OS check fails, as in NetBird. What the API cannot show (network range, processes,
    unreadable checks) is "unknown", never pass or fail.
  - Host check: only the user's own hosts (`listOwned`) that belong to NetBird (peer id in the
    notes the import writes, tag `netbird` on a 100.64.0.0/10 IP, or a peer's NetBird IP). The POST
    recomputes the findings and runs only actions the server found; every change is audited
    (`netbird_host_ip_updated`, `netbird_host_removed`). A missing peer is only offered for removal
    when the credential sees every peer (`/users/current` role not `user`): a NetBird user sees just
    their own peers. An IP update that would duplicate another host's ip:port is skipped.
    Permission `peers.reconcile`; removal also needs core `hosts.delete`.
  - Plugin API 2 (since 2.0.0, Termix 26.11.2): the backend runs in its own process (tests use
    `createMockCtx({ sandbox: true })`), the panel in a sandboxed frame (`tests/frontend/frame.test.tsx`
    with `checkFrameApp`/`checkFrameViews`). No `sandbox` block: no timers, events or registry keys.
    In a frame `window.open` goes to the shell (new tab, no opener, only within 5 s of a click), so SSO
    fetches the URL in the click and then polls `/auth/status`; the callback page has no script.
    The panel gets no `shell` handle in a frame. The group filter is still a native `select`
    (`validate` hint): `ToolbarSelect` takes no empty value for "all groups".
- Distribution: the repo is its own Termix plugin registry. `registry/index.json` is written by
  `scripts/registry-index.mjs` (job `registry` in `release.yml`) from the signed release files.
  Signing runs in this repo (job `sign`), not in the shared Termix-SSH release workflow:
  `secrets: inherit` does not reach a workflow of another organisation, and the private key should
  not go to code on `@main` of a foreign repo;
  `registry/public-key.txt` is the public half of `TERMIX_PLUGIN_SIGNING_KEY` (repo secret, key
  ID `f693b96cabb971be`). Never edit the index by hand. A new key means every installation has
  to add the registry again.
- CI: `ci.yml` calls the shared `plugin-ci.yml@main` of Termix-SSH, which changes without a commit
  here. It runs zizmor on our workflows (high severity fails: permissions only per job, every
  action outside `Termix-SSH/*` pinned to a commit SHA with the tag as comment) and osv-scanner on
  the lockfile (every known vulnerability with a fix fails). `overrides` in `package.json` lifts
  `glob` under `@deadendjs/swagger-jsdoc` (SDK build tool, only uses `glob.sync`) to 14; drop it
  once the SDK ships a fixed version. CI also runs weekly on Monday, so drift in the shared
  workflow shows on main first. Dependabot (`.github/dependabot.yml`, one week cooldown) bumps the
  action SHAs and npm, but not an SDK major: that one changes the plugin API and `engine` too.
- Release jobs `sign`/`registry` find the release by the manifest version (`X.Y.Z` or the newest
  `X.Y.Z-beta.N`), not by "newest release"; `concurrency: release` keeps runs from overlapping.
  Leave the `release` job (the `uses:` of Termix-SSH) as the template has it: the community
  registry checks provenance against it.
- Not yet: NetBird SSH as an auth type (would need `auth:provide`), network resources/routes,
  writing to NetBird.

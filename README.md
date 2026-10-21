<div align="center">

<img src="https://termix.site/img/logo.svg" width="120" alt="Termix Logo" />

<h1>NetBird for Termix</h1>

<p>List NetBird peers, add them as hosts and see whether your policies let Termix reach their SSH port</p>

</div>

<br />

## Overview

A [Termix](https://github.com/Termix-SSH/Termix) plugin for [NetBird](https://netbird.io). It reads your NetBird network through the management API and shows every peer in a sidebar panel. One click opens the host editor with the peer's NetBird IP and SSH port filled in.

Its own feature is the **SSH reachability check**: for each peer it evaluates your NetBird access policies and tells you whether the Termix server's own peer may open TCP to the SSH port, and through which policy. That answers "why can't I connect?" before you start reading connection errors.

Read the [docs](docs/index.md) to set it up.

<br />

## Features

- Peers with NetBird IP, DNS label, OS, groups and online state
- Add as host through the Termix host editor
- SSH reachability per peer from the NetBird access policies (ports, ranges, bidirectional rules, peer resources, posture check hint)
- NetBird Cloud and self-hosted management servers
- Read only by design: no access to hosts, credentials or SSH; the API token stays on the server
- English and German

<br />

## Capabilities

| Capability         | Why                                                                           |
| ------------------ | ----------------------------------------------------------------------------- |
| `network:outbound` | Read `/api/peers` and `/api/policies` from the management URL you set         |
| `network:serve`    | One read-only route for the panel, behind the `netbird.peers.view` permission |
| `ui:surface`       | The sidebar panel                                                             |

<br />

## Development

```bash
npm install
npm test
npm run typecheck
npm run validate
npm run build
```

In Termix, turn on Plugin developer mode (Settings, General), make an API key and run:

```bash
npx termix-plugin dev --server http://localhost:30001 --key tmx_your_key
```

Releases follow the template: work on a `dev-X.Y.Z` branch and run the Release workflow by hand. See [CONTRIBUTING.md](CONTRIBUTING.md).

<br />

## License

Apache-2.0. Not affiliated with NetBird GmbH; "NetBird" is used to name the service this plugin connects to.

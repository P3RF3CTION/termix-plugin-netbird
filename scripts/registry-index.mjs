#!/usr/bin/env node
// Writes registry/index.json, the index of this repo's own Termix plugin
// registry. Termix adds it under Settings, Plugins, Registries by its URL:
//
//   https://raw.githubusercontent.com/P3RF3CTION/termix-plugin-netbird/main/registry/index.json
//
// Every GitHub release that carries a signed .tmxplug (with its .sig) becomes
// one version. The signing key's public half is registry/public-key.txt; the
// private half is the TERMIX_PLUGIN_SIGNING_KEY secret and is never needed
// here.
//
// Needs GITHUB_REPOSITORY and GH_TOKEN (or GITHUB_TOKEN). Node 20+.

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const repo =
  process.env.GITHUB_REPOSITORY ?? "P3RF3CTION/termix-plugin-netbird";
const token = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN ?? "";
const manifest = JSON.parse(readFileSync("manifest.json", "utf8"));
const publicKey = readFileSync("registry/public-key.txt", "utf8").trim();

async function gh(url, accept = "application/vnd.github+json") {
  const response = await fetch(url, {
    headers: {
      Accept: accept,
      "User-Agent": "termix-registry-index",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  if (!response.ok) throw new Error(`${response.status} for ${url}`);
  return response;
}

const releases = await (
  await gh(`https://api.github.com/repos/${repo}/releases?per_page=100`)
).json();

const versions = [];
const prereleases = [];
for (const release of releases) {
  if (release.draft) continue;
  const plug = release.assets.find((a) => a.name.endsWith(".tmxplug"));
  const sig = release.assets.find((a) => a.name === `${plug?.name}.sig`);
  if (!plug || !sig) {
    console.warn(`skip ${release.tag_name}: no signed .tmxplug`);
    continue;
  }
  const octet = "application/octet-stream";
  const bytes = Buffer.from(await (await gh(plug.url, octet)).arrayBuffer());
  const signature = (await (await gh(sig.url, octet)).text()).trim();
  // api and capabilities as that release declared them, not as main does now.
  const tagged = JSON.parse(
    await (
      await gh(
        `https://api.github.com/repos/${repo}/contents/manifest.json?ref=${encodeURIComponent(release.tag_name)}`,
        "application/vnd.github.raw+json",
      )
    ).text(),
  );
  const entry = {
    version: release.tag_name.replace(/^v/, ""),
    api: tagged.engine?.api ?? "",
    url: plug.browser_download_url,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    signature,
    size: bytes.length,
    capabilities: tagged.capabilities ?? [],
    releaseNotesUrl: release.html_url,
    publishedAt: release.published_at,
  };
  (release.prerelease ? prereleases : versions).push(entry);
}

const index = {
  registry: "p3rf3ction",
  name: "P3RF3CTION plugins",
  updatedAt: new Date().toISOString(),
  publicKey,
  plugins: [
    {
      id: manifest.id,
      name: manifest.name,
      description: manifest.description,
      author: manifest.author?.name ?? "",
      category: manifest.category ?? "",
      repository: manifest.repository,
      icon: manifest.icon,
      docs: manifest.docs,
      features: manifest.features,
      versions,
      prereleases,
    },
  ],
};

mkdirSync("registry", { recursive: true });
writeFileSync("registry/index.json", `${JSON.stringify(index, null, 2)}\n`);
console.log(
  `registry/index.json: ${versions.length} versions, ${prereleases.length} prereleases`,
);

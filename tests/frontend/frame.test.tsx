import { describe, expect, it } from "vitest";
import { checkFrameApp, checkFrameViews } from "@termix-ssh/plugin-sdk/testing";
import type { PluginManifest } from "@termix-ssh/plugin-sdk/manifest";
import * as plugin from "../../src/frontend/index";
import manifestJson from "../../manifest.json";

const manifest = manifestJson as unknown as PluginManifest &
  Record<string, unknown>;

// Plugin API 2: the frontend runs in sandboxed frames (Termix 26.11.2).
describe(`${manifest.id} in a frame`, () => {
  it("registers only what reaches Termix from a frame", async () => {
    const { problems } = await checkFrameApp(plugin, { manifest });
    expect(problems).toEqual([]);
  });

  it("asks Termix only for what a frame may read", async () => {
    const { refused, errors } = await checkFrameViews(plugin, { manifest });
    expect(refused).toEqual([]);
    expect(errors).toEqual([]);
  });
});

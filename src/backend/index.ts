import type { Router } from "express";
import type { PluginContext } from "@termix-ssh/plugin-sdk/backend";
import { CALLBACK_PATH, registerRoutes } from "./routes.js";

export async function activate(ctx: PluginContext) {
  // The SSO callback is the one public route: the identity provider redirects
  // the login window there. It checks its single-use state itself.
  registerRoutes(ctx.http.router<Router>({ public: [CALLBACK_PATH] }), ctx);
}

export async function deactivate() {
  // Everything registered through ctx is disposed by core.
}

import express from "express";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ManagedIdentityCredential } from "@azure/identity";
import { allowedPrincipal, hostingConfig } from "./hosting.js";
import { resolveAgentUrl } from "./session.js";

// Set before importing the runtime: its telemetry singleton reads these on load.
process.env.COPILOTKIT_TELEMETRY_DISABLED = "true";
process.env.DO_NOT_TRACK = "1";
const { CopilotRuntime, InMemoryAgentRunner } = await import("@copilotkit/runtime/v2");
const { createCopilotExpressHandler } = await import("@copilotkit/runtime/v2/express");
const { HttpAgent } = await import("@ag-ui/client");

export function hostedSessionHome(platform, home) {
  return platform === "linux" ? "/home" : home;
}

export async function createApp({ port = 3100, agentUrl = "http://127.0.0.1:5100/agent", devMiddleware } = {}) {
  const config = hostingConfig(process.env, port, agentUrl);
  const { origin } = config;
  if (config.hosted && devMiddleware) throw new Error("Development middleware cannot run in hosted mode.");
  const credential = config.hosted ? new ManagedIdentityCredential() : undefined;
  const usesSessionCache = config.hosted && !new URL(agentUrl).searchParams.has("agent_session_id");
  const sessionHome = hostedSessionHome(process.platform, process.env.HOME);
  agentUrl = await resolveAgentUrl(agentUrl, config, credential, sessionHome);
  if (usesSessionCache) console.info(`Hosted session cache: ${join(sessionHome, ".agent-3d-ui", "hosted-session.json")}`);
  const app = express();
  app.disable("x-powered-by");
  app.use((req, res, next) => {
    const api = req.path.startsWith("/api/");
    if (req.headers.host !== new URL(origin).host ||
        (api && req.headers.origin && req.headers.origin !== origin) ||
        (api && req.headers["sec-fetch-site"] && !["same-origin", "none"].includes(req.headers["sec-fetch-site"]))) {
      res.status(403).json({ error: "Only same-origin loopback requests are accepted." });
      return;
    }
    if (!["GET", "HEAD"].includes(req.method) && req.headers.origin !== origin) {
      res.status(403).json({ error: "State-changing requests require the local UI Origin." });
      return;
    }
    if (config.hosted && !allowedPrincipal(req.headers, config)) {
      res.status(403).json({ error: "HTTPS and the configured Easy Auth tenant/operator identity are required." });
      return;
    }
    res.setHeader("X-Content-Type-Options", "nosniff");
    // Easy Auth requires same-origin Referer for cookie-authenticated POSTs.
    res.setHeader("Referrer-Policy", "same-origin");
    res.setHeader("Cache-Control", "no-store");
    next();
  });
  const runtime = new CopilotRuntime({
    agents: { default: new HttpAgent({
      url: agentUrl,
      fetch: async (url, init) => {
        if (String(url) !== agentUrl) throw new Error("Unexpected upstream URL.");
        const headers = new Headers(init?.headers);
        if (credential) {
          const token = await credential.getToken("https://ai.azure.com/.default");
          if (!token) throw new Error("Managed identity did not return a Foundry access token.");
          headers.set("Authorization", `Bearer ${token.token}`);
        }
        return fetch(url, { ...init, headers, redirect: "error" });
      },
    }) },
    runner: new InMemoryAgentRunner(),
    forwardHeaders: { deny: ["authorization", "cookie"], denyPrefixes: ["x-"] },
  });
  app.use(createCopilotExpressHandler({ runtime, basePath: "/api/copilotkit", cors: false }));
  if (devMiddleware) app.use(devMiddleware);
  else {
    app.use(express.static(resolve("dist")));
    app.get("/", (_req, res) => res.sendFile(resolve("dist/index.html")));
  }
  return app;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const port = Number(process.env.PORT ?? 3100);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("PORT must be an integer between 1024 and 65535.");
  const agentUrl = process.env.AGENT_URL ?? "http://127.0.0.1:5100/agent";
  const config = hostingConfig(process.env, port, agentUrl);
  const vite = process.argv.includes("--dev") ? await (await import("vite")).createServer({ server: { middlewareMode: true }, appType: "spa" }) : undefined;
  const app = await createApp({ port, agentUrl, devMiddleware: vite?.middlewares });
  app.listen(port, config.bindHost, () => {
    console.log(`Agent 3D UI: ${config.origin} (assets: ${resolve("dist")})`);
  });
}

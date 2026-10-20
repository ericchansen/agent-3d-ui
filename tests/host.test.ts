import { afterAll, beforeAll, expect, it } from "vitest";
import { request, type Server } from "node:http";
// @ts-expect-error The host is plain Node JavaScript, not a second TypeScript build.
import { createApp, hostedSessionHome } from "../server/host.js";

let server: Server;
const port = 3199;
const origin = `http://127.0.0.1:${port}`;

beforeAll(async () => {
  const app = await createApp({ port });
  server = await new Promise<Server>((resolve) => {
    const listener = app.listen(port, "127.0.0.1", () => resolve(listener));
  });
});
afterAll(() => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));

it("anchors Linux hosted sessions to persistent /home despite a different or missing process HOME", () => {
  expect(hostedSessionHome("linux", "/root")).toBe("/home");
  expect(hostedSessionHome("linux", undefined)).toBe("/home");
  expect(hostedSessionHome("win32", "C:\\home")).toBe("C:\\home");
});

it("serves native OSS runtime discovery without a license or telemetry", async () => {
  const response = await fetch(`${origin}/api/copilotkit/info`);
  const info = await response.json();
  expect(response.status).toBe(200);
  expect(info).toMatchObject({ mode: "sse", telemetryDisabled: true, agents: { default: {} } });
  expect(response.headers.has("access-control-allow-origin")).toBe(false);
  expect(response.headers.get("referrer-policy")).toBe("same-origin");
});

it("rejects DNS rebinding, cross-origin API reads and originless writes", async () => {
  for (const headers of [{ host: "evil.example" }, { origin: "https://evil.example" }, { "sec-fetch-site": "cross-site" }]) {
    const status = await new Promise<number | undefined>((resolve, reject) => {
      request(`${origin}/api/copilotkit/info`, { headers }, (response) => {
        response.resume();
        resolve(response.statusCode);
      }).on("error", reject).end();
    });
    expect(status, JSON.stringify(headers)).toBe(403);
  }
  expect((await fetch(`${origin}/api/copilotkit/agent/default/run`, { method: "POST" })).status).toBe(403);
});

it("refuses public, credential-bearing or arbitrary upstream configuration", async () => {
  for (const agentUrl of ["https://example.com/agent", "http://localhost/agent", "http://u:p@127.0.0.1/agent", "http://127.0.0.1/agent?url=http://example.com"]) {
    await expect(createApp({ port, agentUrl })).rejects.toThrow();
  }
});

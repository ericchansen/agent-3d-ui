import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
// @ts-expect-error The startup adapter is plain Node JavaScript.
import { resolveAgentUrl } from "../server/session.js";

const base = "https://example.services.ai.azure.com/api/projects/demo/agents/scene/endpoint/protocols/invocations?api-version=v1";
const config = { hosted: true, origin: "https://example.azurewebsites.net", tenantId: "tenant-1", operatorId: "operator-1" };
const credential = { getToken: vi.fn(async () => ({ token: "synthetic-test-token" })) };
let home: string;
let request: ReturnType<typeof vi.fn>;
beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "agent3d-session-"));
  credential.getToken.mockClear();
  request = vi.fn(async () => Response.json({ agent_session_id: "session-1", status: "active" }));
  vi.stubGlobal("fetch", request);
});
afterEach(async () => {
  vi.unstubAllGlobals();
  await rm(home, { recursive: true });
});

it("creates a managed-identity session once, atomically caches only its bound route, and reuses it", async () => {
  const first = await resolveAgentUrl(base, config, credential, home);
  expect(new URL(first).searchParams.get("agent_session_id")).toBe("session-1");
  expect(String(request.mock.calls[0][0])).toBe(base.replace("/protocols/invocations", "/sessions"));
  expect(request.mock.calls[0][1]).toMatchObject({
    method: "POST", body: "{}", redirect: "error",
    headers: { Authorization: "Bearer synthetic-test-token", "Content-Type": "application/json" },
  });
  expect(Object.keys(request.mock.calls[0][1].headers)).toEqual(["Authorization", "Content-Type"]);
  expect(credential.getToken).toHaveBeenCalledWith("https://ai.azure.com/.default");
  const cache = await readFile(join(home, ".agent-3d-ui", "hosted-session.json"), "utf8");
  expect(JSON.parse(cache)).toEqual({ binding: expect.stringMatching(/^[a-f0-9]{64}$/), agentSessionId: "session-1" });
  expect(cache).not.toContain("token");
  expect(await readdir(join(home, ".agent-3d-ui"))).toEqual(["hosted-session.json"]);
  expect(await resolveAgentUrl(base, config, credential, home)).toBe(first);
  expect(request).toHaveBeenCalledTimes(1);
  expect(credential.getToken).toHaveBeenCalledTimes(1);
});

it.each(["base", "operator", "site"])("creates a new route when the %s binding changes", async (changed) => {
  await resolveAgentUrl(base, config, credential, home);
  request.mockResolvedValue(Response.json({ agent_session_id: "session-2" }));
  const next = await resolveAgentUrl(
    changed === "base" ? base.replace("/scene/", "/other/") : base,
    { ...config, ...(changed === "operator" ? { operatorId: "operator-2" } : {}), ...(changed === "site" ? { origin: "https://other.azurewebsites.net" } : {}) },
    credential, home,
  );
  expect(new URL(next).searchParams.get("agent_session_id")).toBe("session-2");
  expect(request).toHaveBeenCalledTimes(2);
});

it("fails clearly on corrupt cache or denied creation without silently replacing state", async () => {
  await resolveAgentUrl(base, config, credential, home);
  const cacheFile = join(home, ".agent-3d-ui", "hosted-session.json");
  await writeFile(cacheFile, "{broken");
  await expect(resolveAgentUrl(base, config, credential, home)).rejects.toThrow("corrupt");
  expect(request).toHaveBeenCalledTimes(1);
  await rm(cacheFile);
  request.mockResolvedValue(new Response("", { status: 403 }));
  await expect(resolveAgentUrl(base, config, credential, home)).rejects.toThrow("HTTP 403");
  expect(await readdir(join(home, ".agent-3d-ui"))).toEqual([]);
});

it("bypasses bootstrap for local mode or an explicitly configured MI-owned route", async () => {
  expect(await resolveAgentUrl("http://127.0.0.1:5100/agent", { hosted: false }, undefined, undefined)).toContain("127.0.0.1");
  const explicit = `${base}&agent_session_id=configured`;
  expect(await resolveAgentUrl(explicit, config, credential, undefined)).toBe(explicit);
  expect(request).not.toHaveBeenCalled();
  expect(credential.getToken).not.toHaveBeenCalled();
  await expect(resolveAgentUrl(`${base}&agent_session_id=`, config, credential, home)).rejects.toThrow("nonempty");
  await expect(resolveAgentUrl(base, config, credential, "")).rejects.toThrow("persistent HOME");
});

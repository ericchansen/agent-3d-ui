import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";

function validSessionId(value) {
  return typeof value === "string" && value.length > 0 && value.length <= 1024 && !/\s/.test(value);
}

export async function resolveAgentUrl(agentUrl, config, credential, home) {
  if (!config.hosted) return agentUrl;
  const upstream = new URL(agentUrl);
  if (upstream.searchParams.has("agent_session_id")) {
    if (upstream.searchParams.getAll("agent_session_id").length !== 1 ||
        !validSessionId(upstream.searchParams.get("agent_session_id"))) {
      throw new Error("AGENT_URL must contain one nonempty agent_session_id when explicitly configured.");
    }
    return agentUrl;
  }
  if (!/\/endpoint\/protocols\/invocations\/?$/.test(upstream.pathname)) {
    throw new Error("Session bootstrap requires the documented /endpoint/protocols/invocations URL.");
  }
  if (!home || !isAbsolute(home)) throw new Error("Hosted session bootstrap requires an absolute persistent HOME directory.");
  const directory = join(home, ".agent-3d-ui");
  const cacheFile = join(directory, "hosted-session.json");
  const binding = createHash("sha256").update(JSON.stringify([
    agentUrl, config.origin, config.tenantId, config.operatorId,
  ])).digest("hex");
  let cached;
  try {
    cached = await readFile(cacheFile, "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") throw new Error("Cannot read the hosted session cache.", { cause: error });
  }
  if (cached !== undefined) {
    let entry;
    try { entry = JSON.parse(cached); }
    catch (error) { throw new Error("Hosted session cache is corrupt; inspect it before restarting.", { cause: error }); }
    if (cached.length > 4096 || !entry || Object.keys(entry).length !== 2 ||
        !/^[a-f0-9]{64}$/.test(entry.binding) || !validSessionId(entry.agentSessionId)) {
      throw new Error("Hosted session cache is invalid; inspect it before restarting.");
    }
    if (entry.binding === binding) {
      upstream.searchParams.set("agent_session_id", entry.agentSessionId);
      return upstream.href;
    }
  }
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const sessions = new URL(upstream);
  sessions.pathname = sessions.pathname.replace(/\/protocols\/invocations\/?$/, "/sessions");
  sessions.search = "?api-version=v1";
  const token = await credential.getToken("https://ai.azure.com/.default");
  if (!token) throw new Error("Managed identity did not return a hosted session access token.");
  const response = await fetch(sessions, {
    method: "POST",
    headers: { Authorization: `Bearer ${token.token}`, "Content-Type": "application/json" },
    body: "{}",
    redirect: "error",
    signal: AbortSignal.timeout(60000),
  });
  if (!response.ok) {
    throw new Error(`Hosted session bootstrap failed (HTTP ${response.status}); verify the managed identity's create-own-session permission and role propagation. No permissions were changed.`);
  }
  const created = await response.json();
  if (!created || !validSessionId(created.agent_session_id) ||
      (created.status !== undefined && (typeof created.status !== "string" || created.status.toLowerCase() === "failed"))) {
    throw new Error("Hosted session creation did not return a usable agent_session_id.");
  }
  const temporary = `${cacheFile}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, JSON.stringify({ binding, agentSessionId: created.agent_session_id }), { flag: "wx", mode: 0o600 });
    await rename(temporary, cacheFile);
  } finally {
    await rm(temporary, { force: true });
  }
  upstream.searchParams.set("agent_session_id", created.agent_session_id);
  return upstream.href;
}

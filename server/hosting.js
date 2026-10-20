const guid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function hostingConfig(env, port, agentUrl) {
  const upstream = new URL(agentUrl);
  if (upstream.username || upstream.password || upstream.hash) {
    throw new Error("AGENT_URL cannot contain credentials or a fragment.");
  }
  if ((env.HOSTING_MODE ?? "local") === "local") {
    if (env.WEBSITE_SITE_NAME || upstream.protocol !== "http:" ||
        !["127.0.0.1", "[::1]"].includes(upstream.hostname) || upstream.search) {
      throw new Error("Local mode requires a fixed loopback HTTP endpoint and cannot run on App Service.");
    }
    return { hosted: false, origin: `http://127.0.0.1:${port}`, bindHost: "127.0.0.1" };
  }
  if (env.HOSTING_MODE !== "appservice" || !env.WEBSITE_INSTANCE_ID ||
      env.WEBSITE_AUTH_ENABLED?.toLowerCase() !== "true" || !env.WEBSITE_HOSTNAME) {
    throw new Error("Hosted mode requires App Service with platform-enabled Easy Auth.");
  }
  if (!guid.test(env.ALLOWED_TENANT_ID ?? "") || !guid.test(env.ALLOWED_OPERATOR_ID ?? "")) {
    throw new Error("Hosted mode requires exactly one tenant and one demo operator object id.");
  }
  const origin = new URL(env.APP_ORIGIN ?? "");
  if (origin.protocol !== "https:" || origin.host !== env.WEBSITE_HOSTNAME ||
      origin.pathname !== "/" || origin.search || origin.hash || origin.username || origin.password) {
    throw new Error("APP_ORIGIN must be the HTTPS origin of this App Service site.");
  }
  if (upstream.protocol !== "https:") {
    throw new Error("Hosted AGENT_URL requires HTTPS.");
  }
  return {
    hosted: true, origin: origin.origin, bindHost: "0.0.0.0",
    tenantId: env.ALLOWED_TENANT_ID.toLowerCase(), operatorId: env.ALLOWED_OPERATOR_ID.toLowerCase(),
  };
}

export function allowedPrincipal(headers, config) {
  if (headers["x-forwarded-proto"] !== "https" || headers["x-ms-client-principal-idp"] !== "aad" ||
      headers["x-ms-client-principal-id"]?.toLowerCase() !== config.operatorId) return false;
  try {
    const principal = JSON.parse(Buffer.from(headers["x-ms-client-principal"] ?? "", "base64").toString("utf8"));
    if (principal.auth_typ !== "aad" || !Array.isArray(principal.claims)) return false;
    const hasClaim = (names, expected) => principal.claims.some((claim) =>
      names.includes(claim.typ) && typeof claim.val === "string" && claim.val.toLowerCase() === expected);
    return hasClaim(["tid", "http://schemas.microsoft.com/identity/claims/tenantid"], config.tenantId) &&
      hasClaim(["oid", "http://schemas.microsoft.com/identity/claims/objectidentifier"], config.operatorId);
  } catch {
    return false;
  }
}

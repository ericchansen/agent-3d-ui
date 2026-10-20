import { expect, it } from "vitest";
// @ts-expect-error Plain Node host configuration has no generated declarations.
import { allowedPrincipal, hostingConfig } from "../server/hosting.js";

const tenant = "00000000-0000-0000-0000-000000000001";
const operator = "00000000-0000-0000-0000-000000000002";
const env = {
  HOSTING_MODE: "appservice", WEBSITE_INSTANCE_ID: "platform-instance", WEBSITE_AUTH_ENABLED: "True",
  WEBSITE_HOSTNAME: "example.azurewebsites.net", APP_ORIGIN: "https://example.azurewebsites.net",
  ALLOWED_TENANT_ID: tenant, ALLOWED_OPERATOR_ID: operator,
};
const upstream = "https://example.services.ai.azure.com/invocations?agent_session_id=server-owned";
const headers = {
  "x-forwarded-proto": "https", "x-ms-client-principal-idp": "aad", "x-ms-client-principal-id": operator,
  "x-ms-client-principal": Buffer.from(JSON.stringify({ auth_typ: "aad", claims: [
    { typ: "tid", val: tenant }, { typ: "oid", val: operator },
  ] })).toString("base64"),
};

it("fails closed without the platform boundary or HTTPS upstream", () => {
  for (const change of [
    { WEBSITE_AUTH_ENABLED: "false" }, { WEBSITE_INSTANCE_ID: "" }, { ALLOWED_OPERATOR_ID: "*" },
    { ALLOWED_TENANT_ID: "" }, { APP_ORIGIN: "http://example.azurewebsites.net" },
  ]) expect(() => hostingConfig({ ...env, ...change }, 3100, upstream)).toThrow();
  expect(() => hostingConfig(env, 3100, "http://example.services.ai.azure.com/invocations")).toThrow("HTTPS");
  expect(() => hostingConfig({ WEBSITE_SITE_NAME: "public-site" }, 3100, "http://127.0.0.1:5100/agent")).toThrow();
});

it("accepts only the configured platform tenant/operator, never a client-supplied identity alone", () => {
  const config = hostingConfig(env, 3100, upstream);
  expect(allowedPrincipal(headers, config)).toBe(true);
  for (const change of [
    { "x-ms-client-principal": "" }, { "x-ms-client-principal": "not-json" },
    { "x-ms-client-principal-id": tenant }, { "x-forwarded-proto": "http" },
    { "x-ms-client-principal-idp": "github" },
  ]) expect(allowedPrincipal({ ...headers, ...change }, config)).toBe(false);
  expect(allowedPrincipal(headers, { ...config, tenantId: operator })).toBe(false);
});

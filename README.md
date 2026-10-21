# Agent 3D UI

Explore an original synthetic scene, ask an agent about its objects, and review color or position edits before the server commits them. The browser does not own scene mutations.

The UI uses [CopilotKit's self-hosted runtime and React components](https://github.com/CopilotKit/CopilotKit), [AG-UI](https://github.com/ag-ui-protocol/ag-ui), and [Three.js](https://threejs.org/). Custom code is limited to the scene view, application validation, domain preview, and host boundary. Chat, generic tool cards, streaming, interrupt resolution and conversation replay use the installed SDKs. There is no additional agent runtime, custom SSE parser or CopilotKit cloud account.

## Run locally

Requires Node.js 22.12 or newer, npm, and a compatible native AG-UI endpoint. The endpoint must seed the canonical scene and support the [application contract](contracts/README.md) and [transport behavior](contracts/transport.md).

```powershell
npm ci
npm run build
$env:AGENT_URL = "http://127.0.0.1:5100/agent"
npm start
```

Open `http://127.0.0.1:3100`. Set `PORT` to another unoccupied local port if necessary. `AGENT_URL` is server configuration, never browser input. Local mode accepts only fixed loopback HTTP upstreams and binds to `127.0.0.1`.

For development, use `npm run dev` instead of the build/start commands. Vite middleware and the runtime share the same origin and port; there is no second-origin development proxy.

The initial empty-message native request retrieves or seeds the authoritative scene. The UI does not substitute a fixture when the backend is unavailable. Reload uses the runtime's native read-only reconnect before falling back to the backend's empty-message hydration if no cached scene exists. A fresh scene/chat gets a new thread. Thread ids are navigation identifiers, not authorization credentials.

## Try the scene

Select an object to inspect it, or ask the agent to find objects and propose edits. Highlights outline objects; they do not hide them. On small screens, Scene and Assistant switch views without replacing the agent session.

Chat uses CopilotKit's native messages, composer, and suggestions without a welcome headline or an inactive attachment button.

The empty chat offers **Find blue cylinders**, **Inspect the scene**, and **Preview a color change** through CopilotKit's built-in [static suggestions](https://github.com/CopilotKit/CopilotKit/blob/main/showcase/shell-docs/src/content/reference/hooks/useConfigureSuggestions.mdx). They appear before the first message and return with a new scene/chat. Clicking one sends a normal user request; edits still require native approval. The starter text is fixed, so displaying it does not require an extra model call.

1. Filter the object list with `blue cylinder`. The two matching columns receive local outlines; materials and scene revision remain unchanged.
2. Select an object using its button or the viewport. Use drag to orbit, right-drag to pan, scroll to zoom, or **Fit scene**.
3. Ask `Find and highlight the blue cylinders`. Read the native tool cards and approve any native skill request after inspecting its arguments.
4. Ask `Move box-01 upward by 2 units`. Review the exact before/after table and ghost geometry. **Approve** resumes the native pending call; only the server's committed snapshot changes the solid object.
5. Request another change and **Reject** it; rejection does not undo committed work. **Cancel run** is available during an active run and uses the native runtime stop operation.

Object selection is a validated hint sent as top-level `state.selectedIds`. Filter outlines are browser-local and distinct from backend highlights. If WebGL is unavailable, the object list, properties and chat remain usable. Provider and trace metadata remain available in native state and backend telemetry, rather than in a separate UI gadget.

Coordinate displays always use x, y, z order, regardless of JSON property order. Mobile approval notices cover every native pending request, including requests without a valid geometry preview. Selecting, filtering, or receiving scene updates preserves the WebGL renderer and camera controls.

No geometry creation/deletion, CAD import, uploads, collaboration or undo history is included.

## Checks

```powershell
npm run lint
npm test
npm run build
npm run test:e2e
```

Browser tests use installed Microsoft Edge and a running compatible backend behind the UI host. `UI_URL` selects a different local review host. Default tests cover hydration/reconnect, new threads, keyboard selection, filtering, local-only browser requests and the WebGL fallback. Isolated native-event fixtures also cover coordinate ordering, mobile multi-selection, failed hydration, pending approvals, and hidden-viewport rendering without a model call.

Model-backed approval checks are opt-in because they invoke the configured model:

```powershell
$env:LIVE_AGENT = "1"
npm run test:e2e
```

They require native tool approval, preview, approval after reload, authoritative commit, and denial without another revision. Scripted/unit tests are not evidence of a real offline model or deployed hosted agent.

**Verified scope:** live Microsoft Edge checks against compatible native endpoints and the authenticated App Service UI-to-managed-identity-to-Foundry path covered the 12-object scene, exact highlights, native preview, selection and pending approval after reload, one committed revision, committed reload, and denial without another edit. Hosted checks also verified managed-identity-owned session creation, persistent route reuse across a UI host restart, and rejection of anonymous or forged-identity requests.

**Not qualified:** a fully local model-backed UI run with external network egress denied. Bundled assets and local-only browser requests do not, by themselves, prove offline inference.

## Offline and dependency boundaries

Stage Node, the locked npm packages, the built `dist` folder and the compatible endpoint's dependencies before disconnecting. Run `npm start`, not a package downloader. All browser scripts, fonts and styles are bundled locally. The host disables CopilotKit runtime telemetry before importing the runtime; Scarf installation telemetry is disabled in `package.json`.

This uses the OSS SSE runtime with `InMemoryAgentRunner`, `runtimeUrl`, stock chat, native interrupt hooks and state subscriptions. It does not use Intelligence, a license key, the gated rich threads drawer, `selfManagedAgents`, or a development-only agent bypass. Runtime conversation cache is in memory and bounded by SDK defaults. The backend remains responsible for durable scene state, native approval ownership and safe restart behavior.

Exact package versions and integrity hashes are in `package-lock.json`. `.npmrc` uses the public npm registry, npm's supported registry-independent lock setting, and the peer-resolution mode used to generate the lock. Do not weaken TLS validation to work around network restrictions.

## Hosted boundary

Local mode is a synthetic single-user example, not an anonymous public service. The optional `appservice` mode requires App Service's platform-enabled Easy Auth, HTTPS, the intended tenant and exactly one configured demo operator. The server uses `ManagedIdentityCredential` for a fixed Foundry Invocations endpoint and server-owned hosted session route. Local mode never constructs an Azure credential. No browser model/service credentials, incoming authorization headers or arbitrary upstream URLs are forwarded.

Before starting the hosted profile, configure an existing App Service through its supported CLI or ARM API: enable HTTPS-only, set Easy Auth `globalValidation.requireAuthentication` to `true`, use the tenant-specific Microsoft Entra issuer, and set `identityProviders.azureActiveDirectory.validation.defaultAuthorizationPolicy.allowedPrincipals.identities` to the single operator object id. Enable the site's system-assigned managed identity and assign **Foundry Agent Consumer** at the chosen project scope. This single-operator profile uses that identity to invoke the agent and create its own session; it does not require cross-user session administration. Keep the platform's [default Entra session isolation](https://learn.microsoft.com/en-us/azure/foundry/agents/how-to/manage-hosted-sessions#isolation-keys); a browser `threadId` is not platform session affinity.

For the demonstrated Easy Auth `code id_token` hybrid flow, enable `web.implicitGrantSettings.enableIdTokenIssuance` in this app's dedicated Microsoft Entra registration. Leave `enableAccessTokenIssuance` false: ID-token issuance does not require implicit access tokens or an organization-wide consent grant. Follow the [Microsoft Entra sign-in configuration](https://learn.microsoft.com/en-us/azure/app-service/configure-authentication-provider-aad).

For source/Oryx deployment, enable App Service **Always On** on a supported plan and set [`WEBSITES_CONTAINER_START_TIME_LIMIT`](https://learn.microsoft.com/en-us/azure/app-service/reference-app-settings) to `600` seconds to accommodate dependency extraction and cold startup. Wait for the new process's listening marker before judging a restart; a previous healthy instance can briefly continue serving responses.

Keep the host's `Referrer-Policy: same-origin`. It preserves the Referer on cookie-authenticated same-origin POSTs for [Easy Auth's CSRF checks](https://learn.microsoft.com/en-us/azure/app-service/overview-authentication-authorization#mitigation-of-cross-site-request-forgery), while withholding it cross-origin. Do not disable authentication/CSRF or broaden CORS to compensate for a missing Referer.

| App setting | Required value |
|---|---|
| `HOSTING_MODE` | `appservice` |
| `APP_ORIGIN` | `https://<site>.azurewebsites.net`, matching platform `WEBSITE_HOSTNAME` |
| `ALLOWED_TENANT_ID` | The intended tenant GUID |
| `ALLOWED_OPERATOR_ID` | One allowed operator's object GUID, not a list or wildcard |
| `AGENT_URL` | The fixed HTTPS `/endpoint/protocols/invocations` URL; an explicit MI-owned `agent_session_id` is optional |

When `AGENT_URL` has no session id, startup uses the same managed identity to call the [documented session creation endpoint](https://learn.microsoft.com/en-us/azure/foundry/agents/how-to/manage-hosted-sessions#create-a-session-explicitly-advanced), `POST <agent-endpoint>/sessions?api-version=v1` with `{}`. It atomically saves only the returned opaque route id and a binding hash at `/home/.agent-3d-ui/hosted-session.json` on App Service Linux, regardless of the process `HOME` value. Windows uses the platform `HOME` directory. Successful startup logs the cache path, never its session id or token. The binding covers the exact configured base URL, site origin, tenant and allowed operator. A matching restart reuses the route; a changed binding creates a new one. The file never contains access tokens or conversation state.

Use one UI process/instance and enable [persistent App Service storage](https://learn.microsoft.com/en-us/azure/app-service/configure-custom-container#use-persistent-shared-storage) for this demo. Data outside the persistent `/home` mount is not restart-safe on Linux. A corrupt/unreadable cache or denied session creation stops startup with a clear error; permissions are never elevated automatically. Existing explicit session ids must belong to the UI managed identity, not the CLI operator. An expired or deleted cached session requires deliberate operator recovery; the host does not silently replace it after an invocation failure. Browser requests cannot select a hosted route or an isolation header.

`WEBSITE_AUTH_ENABLED` and `WEBSITE_INSTANCE_ID` must come from the platform, not from a local imitation of Easy Auth. The host additionally checks the platform's `aad` principal, tenant, object id and HTTPS on every request. Its managed identity and fixed hosted session represent this one demo operator; no multi-user ownership claim is made. Broader access requires independently verified session isolation and a different supported configuration. A thread id alone is not authorization.

Use [App Service's built-in authorization policy](https://learn.microsoft.com/en-us/azure/app-service/configure-authentication-provider-aad#use-a-built-in-authorization-policy), not a custom login implementation. [Platform identity headers](https://learn.microsoft.com/en-us/azure/app-service/configure-authentication-user-identities) are trustworthy only behind that boundary; see the [read-only authentication environment variables](https://learn.microsoft.com/en-us/azure/app-service/reference-app-settings#authentication--authorization). Unit tests simulate rejection cases; deployed verification is separate, with its qualified scope recorded above. Repeat the identity, bootstrap and restart checks after changing hosting configuration. The repository does not provision Azure infrastructure; configured hosted startup can create the one platform session described above.

## Extend and license

A new scene tool belongs in the compatible endpoint and native registration, not in the UI runtime. Generic native tool activity already renders through CopilotKit. Add a domain renderer only when a new tool needs a trustworthy visual preview. Changes to application data require matching schema, validation, fixture and behavioral tests.

Original code and fixtures are [MIT licensed](LICENSE). Dependency licenses remain applicable. Vite generates `dist/licenses.md` with bundled browser dependency notices; the running host serves it at `/licenses.md`. Preserve it when redistributing built assets, and preserve npm packages' notices when distributing the host.

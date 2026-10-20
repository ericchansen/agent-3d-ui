import { test, expect, type Page, type Route } from "@playwright/test";
import type { Interrupt, RunAgentInput } from "@ag-ui/core";
import type { SceneSnapshot } from "../../src/scene";
import seed from "../../contracts/fixtures/seed.scene.json" with { type: "json" };

declare global {
  interface Window { reviewCameraMatrices?: number[][] }
}

function scene(): SceneSnapshot {
  return JSON.parse(JSON.stringify(seed));
}

async function respond(route: Route, input: RunAgentInput, snapshot: unknown, interrupts?: Interrupt[]) {
  const events = [
    { type: "RUN_STARTED", threadId: input.threadId, runId: input.runId },
    { type: "STATE_SNAPSHOT", snapshot },
    { type: "RUN_FINISHED", threadId: input.threadId, runId: input.runId,
      outcome: interrupts ? { type: "interrupt", interrupts } : { type: "success" } },
  ];
  await route.fulfill({ status: 200, contentType: "text/event-stream", body: events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("") });
}

async function mockRuns(page: Page, handler: (route: Route, input: RunAgentInput) => Promise<void>) {
  await page.route("**/api/copilotkit/agent/**", async (route) => {
    if (new URL(route.request().url()).pathname.endsWith("/run")) {
      await handler(route, route.request().postDataJSON());
    } else {
      await route.fulfill({ status: 200, contentType: "text/event-stream", body: "" });
    }
  });
}

function approval(name: string, args: unknown): Interrupt {
  return {
    id: "approval-1", reason: "tool_call", toolCallId: "call-1",
    responseSchema: { type: "object", properties: { approved: { type: "boolean" } }, required: ["approved"] },
    metadata: { agent_framework: { function_call: { call_id: "call-1", name, arguments: args } } },
  };
}

for (const y of [1, 3]) {
  test(`approval coordinates use named axes when JSON keys are reordered (y=${y})`, async ({ page }) => {
    const snapshot = scene();
    snapshot.objects[0].position = { z: -3, x: -4, y: 1 };
    snapshot.objects[0].dimensions = { z: 3, y: 2, x: 1 };
    const pending = approval("edit_objects", { ids: ["box-01"], expectedRevision: 0, edit: { position: { y, z: -3, x: -4 } } });
    await mockRuns(page, (route, input) => respond(route, input, { scene: snapshot }, input.messages.length ? [pending] : undefined));
    await page.goto("/");
    await expect(page.getByRole("button", { name: "New scene", exact: true })).toBeEnabled();
    await page.getByRole("button", { name: "Amber block" }).click();
    await expect(page.locator(".properties")).toContainText("-4, 1, -3");
    await expect(page.locator(".properties")).toContainText("1, 2, 3");
    const input = page.getByRole("textbox", { name: "Type a message..." });
    await input.fill("Preview moving box-01.");
    await input.press("Enter");
    const review = page.getByRole("region", { name: "Pending approval" });
    const position = review.getByRole("row").filter({ has: page.getByRole("rowheader", { name: /Position/ }) });
    await expect(position.getByRole("cell").nth(0)).toHaveText("-4, 1, -3");
    await expect(position.getByRole("cell").nth(1)).toHaveText(`-4, ${y}, -3`);
    await expect(position.getByRole("cell").nth(1)).toHaveAttribute("data-changed", String(y !== 1));
  });
}

for (const height of [844, 667]) {
  test(`mobile multi-selection leaves the object list usable at height ${height}`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height });
    await mockRuns(page, (route, input) => respond(route, input, { scene: scene() }));
    await page.goto("/");
    await expect(page.getByRole("button", { name: "New scene", exact: true })).toBeEnabled();
    await page.getByRole("button", { name: "Amber block" }).click();
    await page.getByRole("button", { name: "Blue block" }).click();
    await expect(page.getByRole("region", { name: "Object inspector" }).locator(".properties")).toHaveCount(2);
    await expect.poll(() => page.locator(".object-scroll").evaluate((element) => element.clientHeight)).toBeGreaterThanOrEqual(44);
    await page.getByRole("button", { name: "Green column", exact: true }).click();
    await expect(page.getByRole("region", { name: "Object inspector" }).locator(".properties")).toHaveCount(3);
    await page.getByRole("region", { name: "Object inspector" }).getByRole("heading", { name: "Amber block" }).scrollIntoViewIfNeeded();
    await page.getByRole("button", { name: "Amber block" }).click();
    await expect(page.getByRole("region", { name: "Object inspector" }).locator(".properties")).toHaveCount(2);
  });
}

test("a failed hydration retains the original transport error", async ({ page }) => {
  await mockRuns(page, (route) => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Backend unavailable" }) }));
  await page.goto("/");
  await expect(page.getByRole("alert")).toContainText("503");
  await expect(page.getByRole("button", { name: "New scene", exact: true })).toBeDisabled();
  await expect(page.locator("[data-copilotkit]")).toHaveCount(0);
});

test("malformed hydrated state still fails validation before chat is mounted", async ({ page }) => {
  await mockRuns(page, (route, input) => respond(route, input, { scene: {} }));
  await page.goto("/");
  await expect(page.getByRole("alert").first()).toContainText("Invalid scene state");
  await expect(page.getByRole("button", { name: "New scene", exact: true })).toBeDisabled();
  await expect(page.locator("[data-copilotkit]")).toHaveCount(0);
});

test("a successful hydration without scene state reports the missing scene", async ({ page }) => {
  await mockRuns(page, (route, input) => respond(route, input, {}));
  await page.goto("/");
  await expect(page.getByRole("alert")).toContainText("did not return a scene");
  await expect(page.getByRole("button", { name: "New scene", exact: true })).toBeDisabled();
  await expect(page.locator("[data-copilotkit]")).toHaveCount(0);
});

for (const [name, args] of [
  ["load_skill", { name: "inspect-scene" }],
  ["edit_objects", { ids: ["box-01"], expectedRevision: 99, edit: { color: "#16A34A" } }],
] as const) {
  test(`mobile approval awareness covers ${name} without a valid ghost preview`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    let rejected = false;
    await mockRuns(page, async (route, input) => {
      if (input.resume?.length) rejected = input.resume[0].payload?.approved === false;
      await respond(route, input, { scene: scene() }, input.messages.length && !input.resume?.length ? [approval(name, args)] : undefined);
    });
    await page.goto("/");
    await expect(page.getByRole("button", { name: "New scene", exact: true })).toBeEnabled();
    const views = page.getByRole("navigation", { name: "Workspace view" });
    const assistant = views.getByRole("button", { name: "Assistant", exact: true });
    await assistant.click();
    const input = page.getByRole("textbox", { name: "Type a message..." });
    await input.fill("Inspect the scene.");
    await input.press("Enter");
    const review = page.getByRole("region", { name: "Pending approval" });
    await expect(review).toBeVisible();
    if (name === "edit_objects") await expect(review.getByRole("button", { name: "Approve", exact: true })).toBeDisabled();
    await views.getByRole("button", { name: "Scene", exact: true }).click();
    await expect(assistant).toHaveAccessibleDescription("Approval required");
    await expect(views.locator(".review-marker")).toBeVisible();
    await assistant.click();
    await review.getByRole("button", { name: "Reject", exact: true }).click();
    await expect(review).toHaveCount(0);
    await expect(views.locator(".review-marker")).toHaveCount(0);
    expect(rejected).toBe(true);
  });
}

test("selection and filtering keep the same WebGL canvas", async ({ page }) => {
  await mockRuns(page, (route, input) => respond(route, input, { scene: scene() }));
  await page.goto("/");
  await expect(page.getByRole("button", { name: "New scene", exact: true })).toBeEnabled();
  const canvas = await page.locator(".viewport canvas").elementHandle();
  if (!canvas) throw new Error("The scene canvas is missing.");
  await page.getByRole("button", { name: "Amber block" }).click();
  await page.getByLabel("Filter", { exact: true }).fill("blue");
  await expect(page.locator(".object-list > li")).toHaveCount(4);
  expect(await canvas.evaluate((element) => element.isConnected)).toBe(true);
});

test("a viewport updated before first visibility fits when Scene is opened", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    const names = new WeakMap<WebGLUniformLocation, string>();
    const matrices: number[][] = [];
    window.reviewCameraMatrices = matrices;
    const prototype = WebGL2RenderingContext.prototype;
    const getUniformLocation = prototype.getUniformLocation;
    prototype.getUniformLocation = function (program, name) {
      const location = getUniformLocation.call(this, program, name);
      if (location) names.set(location, name);
      return location;
    };
    const uniformMatrix4fv = prototype.uniformMatrix4fv;
    prototype.uniformMatrix4fv = function (location, transpose, data, offset, length) {
      if (location && names.get(location) === "modelViewMatrix") {
        matrices.push(Array.from(data).slice(offset ?? 0, (offset ?? 0) + 16));
        if (matrices.length > 100) matrices.shift();
      }
      uniformMatrix4fv.call(this, location, transpose, data, offset, length);
    };
  });
  let releaseHydration = () => {};
  const hydrationGate = new Promise<void>((resolve) => { releaseHydration = resolve; });
  let hydrated = false;
  await mockRuns(page, async (route, input) => {
    if (!hydrated) {
      await hydrationGate;
      hydrated = true;
    }
    const snapshot = scene();
    if (input.messages.length) snapshot.highlightedIds = ["cylinder-01", "cylinder-02"];
    await respond(route, input, { scene: snapshot });
  });
  await page.goto("/");
  const views = page.getByRole("navigation", { name: "Workspace view" });
  await views.getByRole("button", { name: "Assistant", exact: true }).click();
  releaseHydration();
  await expect(page.getByRole("button", { name: "New scene", exact: true })).toBeEnabled();
  await expect(page.locator(".viewport canvas")).toHaveCount(1);
  const input = page.getByRole("textbox", { name: "Type a message..." });
  await input.fill("Find and highlight the blue cylinders.");
  await input.press("Enter");
  await expect(page.locator(".object-list [aria-label='Highlighted']")).toHaveCount(2);
  await views.getByRole("button", { name: "Scene", exact: true }).click();
  await expect.poll(() => page.evaluate(() => {
    const matrices = window.reviewCameraMatrices ?? [];
    return matrices.some((matrix) => Math.abs(matrix[0] - 1) > 0.01);
  })).toBe(true);
});

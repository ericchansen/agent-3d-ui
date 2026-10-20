import { test, expect } from "@playwright/test";

test("hydrate, reload and new chat preserve native thread semantics without model prompts", async ({ page }) => {
  const runs: { threadId: string; messages: unknown[] }[] = [];
  const external: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).hostname !== "127.0.0.1") external.push(request.url());
    if (/\/(run|connect)$/.test(request.url())) runs.push(request.postDataJSON());
  });
  await page.goto("/");
  await expect(page.getByRole("button", { name: "New scene" })).toBeEnabled();
  const first = runs[0].threadId;
  await page.reload();
  await expect(page.getByRole("button", { name: "New scene" })).toBeEnabled();
  expect(runs[1].threadId).toBe(first);
  await page.getByRole("button", { name: "New scene" }).click();
  await expect(page.getByRole("button", { name: "New scene" })).toBeEnabled();
  expect(runs[2].threadId).not.toBe(first);
  expect(runs.every((run) => !run.messages?.length)).toBe(true);
  expect(external).toEqual([]);
});

test("filter and keyboard selection stay local", async ({ page }) => {
  const requests: string[] = [];
  page.on("request", (request) => {
    if (/\/(run|connect)$/.test(request.url())) requests.push(request.url());
  });
  await page.goto("/");
  await expect(page.getByRole("button", { name: "New scene" })).toBeEnabled();
  const initialRequests = [...requests];
  await page.getByLabel("Filter", { exact: true }).fill("blue cylinder");
  await expect(page.locator(".object-list > li")).toHaveCount(2);
  const object = page.getByRole("button", { name: "Blue column west" });
  await object.focus();
  await page.keyboard.press("Space");
  await expect(object).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText("-4, 2, 5", { exact: true })).toBeVisible();
  expect(requests).toEqual(initialRequests);
});

test("object inspector remains usable without WebGL", async ({ page }) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...args: unknown[]) {
      if (type.includes("webgl")) return null;
      return Reflect.apply(original, this, [type, ...args]);
    } as typeof original;
  });
  await page.goto("/");
  await expect(page.getByText("WebGL is unavailable.", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Amber block" }).click();
  await expect(page.getByText("-4, 1, -3", { exact: true })).toBeVisible();
});

test("empty object search offers a recovery without losing selection", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("button", { name: "New scene" })).toBeEnabled();
  await page.getByRole("button", { name: "Amber block" }).click();
  await page.getByLabel("Filter", { exact: true }).fill("missing-object");
  await expect(page.locator(".object-list > li")).toHaveCount(0);
  await expect(page.getByText("No matching objects", { exact: true })).toBeVisible();
  await expect(page.locator(".properties")).toContainText("#F59E0B");
  await page.getByRole("button", { name: "Clear filter", exact: true }).last().click();
  await expect(page.locator(".object-list > li")).toHaveCount(12);
  await expect(page.getByRole("button", { name: "Amber block" })).toHaveAttribute("aria-pressed", "true");
});

test("small screens switch between usable scene and native assistant views", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.getByRole("button", { name: "New scene" })).toBeEnabled();
  await expect(page.getByRole("region", { name: "Scene viewport" })).toBeVisible();
  await expect(page.getByRole("complementary", { name: "Agent conversation" })).not.toBeVisible();
  const views = page.getByRole("navigation", { name: "Workspace view" });
  await views.getByRole("button", { name: "Assistant", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Type a message..." })).toBeVisible();
  await views.getByRole("button", { name: "Scene", exact: true }).click();
  await expect(page.getByRole("region", { name: "Scene viewport" })).toBeVisible();
  await page.getByRole("button", { name: "Amber block" }).click();
  await expect(page.locator(".properties")).toContainText("#F59E0B");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("composer text is not clipped at desktop, narrow-panel and mobile widths", async ({ page }) => {
  for (const width of [1280, 958, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/");
    await expect(page.getByRole("button", { name: "New scene" })).toBeEnabled();
    if (width === 390) {
      await page.getByRole("navigation", { name: "Workspace view" }).getByRole("button", { name: "Assistant", exact: true }).click();
    }
    const input = page.getByRole("textbox", { name: "Type a message..." });
    const send = page.getByRole("button", { name: "Send message", exact: true });
    await expect(page.locator(".assistant-input button")).toHaveCount(1);
    await expect(send).toBeDisabled();
    for (const text of ["", "Inspect the scene", "Inspect the scene\nList its objects\nKeep everything unchanged"]) {
      await input.fill(text);
      if (text) await expect(send).toBeEnabled();
      await expect.poll(() => input.evaluate((element) => element.scrollHeight <= element.clientHeight + 1)).toBe(true);
      await expect.poll(() => page.locator(".assistant-input").evaluate((element) => {
        const panel = element.closest(".chat-column");
        if (!panel) throw new Error("Chat panel is missing.");
        return panel.getBoundingClientRect().bottom - element.getBoundingClientRect().bottom;
      })).toBeGreaterThanOrEqual(11);
    }
  }
});

test("inspector follows the current selection", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("button", { name: "New scene" })).toBeEnabled();
  await expect(page.getByRole("region", { name: "Object inspector" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Cancel run", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Amber block" }).click();
  await expect(page.getByRole("region", { name: "Object inspector" })).toBeVisible();
  await expect(page.locator(".properties")).toContainText("#F59E0B");
  await page.getByRole("button", { name: "Amber block" }).click();
  await expect(page.getByRole("region", { name: "Object inspector" })).toHaveCount(0);
});

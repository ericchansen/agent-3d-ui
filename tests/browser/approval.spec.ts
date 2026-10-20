import { test, expect, type Page, type Response as BrowserResponse } from "@playwright/test";
import { runHttpRequest, transformHttpEventStream } from "@ag-ui/client";
import { isRecord } from "../../src/approval";

test.skip(process.env.LIVE_AGENT !== "1", "Set LIVE_AGENT=1 to run model-backed edit approval checks.");
const modelWait = 120000;

async function finalScene(response: BrowserResponse) {
  const body = await response.text();
  const snapshot = await new Promise<unknown>((resolve, reject) => {
    let latest: unknown;
    transformHttpEventStream(runHttpRequest(async () => new Response(body, { status: response.status(), headers: response.headers() }))).subscribe({
      next: (event) => { if (event.type === "STATE_SNAPSHOT" && "snapshot" in event) latest = event.snapshot; },
      error: reject,
      complete: () => resolve(latest),
    });
  });
  if (!isRecord(snapshot) || !isRecord(snapshot.scene)) throw new Error("Native response did not include a scene snapshot.");
  return snapshot.scene;
}

async function requestEdit(page: Page, color: string) {
  const input = page.getByRole("textbox", { name: "Type a message..." });
  await input.fill(`Change only box-01 to color ${color}. Read its current revision and properties, then call edit_objects for native approval.`);
  await input.press("Enter");
  for (let step = 0; step < 6; step++) {
    const approval = page.getByRole("region", { name: "Pending approval" }).last();
    await expect(approval).toBeVisible({ timeout: modelWait });
    const name = await approval.getByRole("heading").innerText();
    if (name === "Review edit_objects") return approval;
    expect(["Review load_skill", "Review get_objects", "Review list_objects"]).toContain(name);
    await approval.getByRole("button", { name: "Approve", exact: true }).click();
    await expect(approval).not.toBeVisible({ timeout: modelWait });
  }
  throw new Error("Agent did not reach a bounded edit approval.");
}

test("native preview, approval, reconnect and rejection preserve backend authority", async ({ page }) => {
  test.setTimeout(360000);
  const opening = page.waitForResponse((response) => response.url().endsWith("/run"));
  await page.goto("/");
  await expect(page.getByRole("button", { name: "New scene" })).toBeEnabled();
  expect((await finalScene(await opening)).revision).toBe(0);
  await page.getByRole("button", { name: "Amber block" }).click();
  const approval = await requestEdit(page, "#16A34A");
  await expect(approval.getByRole("button")).toHaveCount(2);
  await expect(approval.getByRole("cell", { name: /#F59E0B/ })).toBeVisible();
  await expect(approval.getByRole("cell", { name: /#16A34A/ })).toBeVisible();
  await expect(page.locator(".properties")).toContainText("#F59E0B");
  await page.setViewportSize({ width: 390, height: 844 });
  const views = page.getByRole("navigation", { name: "Workspace view" });
  await views.getByRole("button", { name: "Assistant", exact: true }).click();
  await expect(approval.getByRole("button", { name: "Approve", exact: true })).toBeVisible();
  await views.getByRole("button", { name: "Scene", exact: true }).click();
  await expect(page.getByRole("button", { name: "Amber block" })).toHaveAttribute("aria-pressed", "true");
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.reload();
  const recovered = page.getByRole("region", { name: "Pending approval" }).last();
  await expect(recovered.getByRole("heading", { name: "Review edit_objects" })).toBeVisible({ timeout: 15000 });
  const committing = page.waitForResponse((response) => response.url().endsWith("/run"));
  await recovered.getByRole("button", { name: "Approve", exact: true }).click();
  const committed = await finalScene(await committing);
  expect(committed.revision).toBe(1);
  await expect(page.getByRole("button", { name: "New scene" })).toBeEnabled({ timeout: modelWait });
  await expect(page.getByRole("button", { name: "Amber block" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".properties")).toContainText("#16A34A");
  const reconnecting = page.waitForResponse((response) => response.url().endsWith("/connect"));
  await page.reload();
  expect(await finalScene(await reconnecting)).toEqual(committed);
  await expect(page.locator(".properties")).toContainText("#16A34A");
  const denied = await requestEdit(page, "#E11D48");
  const rejecting = page.waitForResponse((response) => response.url().endsWith("/run"));
  await denied.getByRole("button", { name: "Reject", exact: true }).click();
  await expect(page.getByRole("button", { name: "New scene" })).toBeEnabled({ timeout: modelWait });
  expect(await finalScene(await rejecting)).toEqual(committed);
  await expect(page.locator(".properties")).toContainText("#16A34A");
});

import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("qrush-data-mode", "simulation"));
});

test("important copy stays readable and the layout fits desktop, tablet and phone", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/#overview");
  await page.evaluate(() => document.fonts.ready);
  for (const width of [1440, 1024, 768, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    if (width > 900) {
      await expect(page.getByRole("button", { name: "Open navigation" })).toBeHidden();
      await expect(page.getByRole("button", { name: "Close navigation" })).toBeHidden();
    } else {
      await expect(page.getByRole("button", { name: "Open navigation" })).toBeVisible();
    }
    const sizes = await page.locator(".flow-picker strong, .flow-picker small, .section-heading p, .metric-card > div, .micro, .resource-dot, .heading-actions .button, .pool-legend, .fault-options strong, .fault-options small")
      .evaluateAll((elements) => elements.filter((element) => element.getClientRects().length > 0).map((element) => parseFloat(getComputedStyle(element).fontSize)));
    expect(Math.min(...sizes), `Primary interface labels at ${width}px`).toBeGreaterThanOrEqual(13);
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: "artifacts/redesign-overview.png", animations: "disabled" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: "artifacts/redesign-mobile.png", animations: "disabled", fullPage: true });
});

test("spot filters find your saved spot without changing inventory", async ({ page }) => {
  await page.clock.install();
  await page.goto("/#participant");
  await page.getByLabel("What should we call you?").fill("Ada");
  await page.getByRole("button", { name: "Join the waiting room", exact: true }).click();
  await page.clock.runFor(1100);
  await expect(page.getByRole("button", { name: "Confirm registration" })).toBeVisible();
  await page.getByRole("button", { name: "Back to control" }).click();
  const filters = page.getByRole("group", { name: "Show spots" });
  const inventory = page.getByRole("group", { name: "Spot map" });
  await filters.getByRole("button", { name: "My spot", exact: true }).click();
  await expect(inventory.getByRole("button")).toHaveCount(1);
  await inventory.getByRole("button", { name: "Spot 1, your saved spot", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("SAVED FOR YOU");
  await page.getByRole("button", { name: "Close dialog" }).click();
  await filters.getByRole("button", { name: "Available", exact: true }).click();
  await expect(inventory.getByRole("button")).toHaveCount(99);
  await filters.getByRole("button", { name: "Confirmed", exact: true }).click();
  await expect(inventory.getByRole("button")).toHaveCount(0);
  await expect(inventory).toContainText("No spots in this state right now.");
  await filters.getByRole("button", { name: "All spots", exact: true }).click();
  await expect(inventory.getByRole("button")).toHaveCount(100);
  await expect(inventory.getByRole("button", { name: "Spot 1, your saved spot", exact: true })).toBeVisible();
  await filters.getByRole("button", { name: "My spot", exact: true }).click();
  await page.clock.runFor(121000);
  await expect(filters.getByRole("button", { name: "All spots", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(inventory.getByRole("button")).toHaveCount(100);
});

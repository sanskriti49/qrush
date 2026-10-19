import { expect, test, type Page } from "@playwright/test";
import { activityCopy, friendlyProblem } from "../src/uiCopy";

test("internal and unfamiliar activity messages always become public copy", () => {
  expect(activityCopy({ kind: "confirm", text: "Confirmed slot-01 in PostgreSQL" })).toBe("Spot #001 is confirmed. Someone’s in!");
  expect(activityCopy({ kind: "admit", text: "1 participants admitted; configured concurrency cap 10" })).toBe("1 person can now choose a spot.");
  expect(activityCopy({ kind: "info", text: "Redis Lua TTL failure: EVALSHA; PostgreSQL HikariPool timeout" })).not.toMatch(/Redis|Lua|TTL|PostgreSQL|HikariPool/i);
  expect(friendlyProblem({ status: 503, message: "PostgreSQL unavailable" }, "confirm")).toContain("same booking if it already went through");
});

async function centered(page: Page) {
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect.poll(() => dialog.evaluate((element) => {
    const box = element.getBoundingClientRect();
    const x = box.x + box.width / 2;
    return Math.min(Math.abs(x - innerWidth / 2), Math.abs(x - document.documentElement.clientWidth / 2));
  })).toBeLessThan(2);
  await expect.poll(() => dialog.evaluate((element) => {
    const box = element.getBoundingClientRect();
    return Math.abs(box.y + box.height / 2 - innerHeight / 2);
  })).toBeLessThan(2);
  expect(await dialog.evaluate((element) => {
    const box = element.getBoundingClientRect();
    return box.top >= 8 && box.left >= 8 && box.right <= innerWidth - 8 && box.bottom <= innerHeight - 8;
  })).toBe(true);
  expect(await page.evaluate(() => document.body.style.overflow)).toBe("hidden");
}

test("all dialogs stay centered after scrolling, fit small screens, and close predictably", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("qrush-data-mode", "simulation"));
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }, { width: 390, height: 480 }]) {
    await page.setViewportSize(viewport);
    await page.goto("/#overview");
    // Opening from the spot map reproduces the scrolled-page report.
    const spot = page.getByRole("button", { name: "Spot 54, available", exact: true });
    await spot.click();
    await centered(page);
    await expect(page.getByRole("dialog")).toContainText("Nobody yet. This spot is free.");
    await page.getByRole("dialog").click({ position: { x: 6, y: 6 } });
    await expect(page.getByRole("dialog")).toBeVisible();
    if (viewport.height > 480) await page.screenshot({ path: `artifacts/centered-dialog-${viewport.width}.png` });
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(spot).toBeFocused();
    expect(await page.evaluate(() => document.body.style.overflow)).toBe("");

    await page.getByRole("button", { name: "Queue settings", exact: true }).click();
    await centered(page);
    await page.getByRole("button", { name: "Close dialog" }).click();

    if (viewport.width <= 900) await page.getByRole("button", { name: "Open navigation" }).click();
    await page.getByRole("button", { name: "Show me around" }).click();
    await centered(page);
    await page.keyboard.press("Escape");

    await page.getByRole("button", { name: "Reset workspace", exact: true }).click();
    await centered(page);
    await page.mouse.click(4, 4);
    await expect(page.getByRole("dialog")).toHaveCount(0);
  }
});

test("live screens and spot details do not expose implementation language", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const flows = ["hackathon", "product", "workshop"].map((id) => ({ id, name: "Campus opening", resourcePrefix: "slot", totalUnits: 4, policy: { maxConcurrent: 10, admissionRate: 5, holdSeconds: 300, adaptive: true } }));
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/flows") { await route.fulfill({ json: flows }); return; }
    await route.fulfill({ json: {
      ...flows[0], sampledAt: new Date().toISOString(),
      metrics: { activeCheckouts: 0, admissionRatePerSec: 5, observedLatencyMs: 12, queueLength: 0, available: 3, held: 0, confirmed: 1, requests: 1, recycled: 0, admissions: 1, arrivals: 1 },
      inventory: [1, 2, 3, 4].map((id) => ({ unitId: `slot-0${id}`, status: id === 1 ? "CONFIRMED" : "AVAILABLE", leaseRemainingSeconds: 0, heldByYou: false })),
      events: [
        { id: "one", at: new Date().toISOString(), type: "confirmation", message: "Confirmed slot-01 in PostgreSQL" },
        { id: "two", at: new Date().toISOString(), type: "admission", message: "1 participants admitted; configured concurrency cap 10" },
        { id: "three", at: new Date().toISOString(), type: "unknown", message: "Redis Lua TTL failure: PostgreSQL HikariCP EVALSHA snapshot" },
      ], scenario: { mode: "NORMAL" }, load: { running: false, total: 0, completed: 0, failed: 0 },
    } });
  });
  await page.goto("/#overview");
  await expect(page.getByText("Spot #001 is confirmed. Someone’s in!", { exact: true })).toBeVisible();
  const jargon = /\b(?:PostgreSQL|Redis|HikariCP|EVALSHA|TTL|Lua|backend|server|allocation|reconcil\w*|concurrency|admission|SSE|snapshot)\b/i;
  expect(await page.locator("body").innerText()).not.toMatch(jargon);
  await page.getByRole("button", { name: "Spot 2, available", exact: true }).click();
  expect(await page.getByRole("dialog").innerText()).not.toMatch(jargon);
  await page.keyboard.press("Escape");
  for (const name of ["Playground", "What’s happening", "Join the queue"]) {
    await page.getByRole("button", { name, exact: true }).click();
    expect(await page.locator("body").innerText()).not.toMatch(jargon);
  }
});

test("GSAP animates dialog entry and stops when reduced motion is requested", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.addInitScript(() => localStorage.setItem("qrush-data-mode", "simulation"));
  await page.goto("/#overview");
  // Observe the actual opening frames rather than racing the short animation after click returns.
  const sawMotion = page.evaluate(() => new Promise<boolean>((resolve) => {
    const observer = new MutationObserver(() => {
      const dialog = document.querySelector<HTMLDialogElement>("dialog[open]");
      if (dialog?.style.transform && dialog.style.transform !== "none") {
        observer.disconnect();
        clearTimeout(timeout);
        resolve(true);
      }
    });
    const timeout = setTimeout(() => { observer.disconnect(); resolve(false); }, 5000);
    observer.observe(document.body, { subtree: true, attributes: true, attributeFilter: ["style"] });
  }));
  await page.getByRole("button", { name: "Open queue settings" }).click();
  const dialog = page.getByRole("dialog");
  expect(await sawMotion).toBe(true);
  await expect(dialog).toHaveCSS("transform", "none");
  await page.keyboard.press("Escape");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.getByRole("button", { name: "Open queue settings" }).click();
  await expect(dialog).toHaveCSS("transform", "none");
  await expect(dialog).toHaveCSS("opacity", "1");
  await centered(page);
});

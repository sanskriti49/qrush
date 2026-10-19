import { expect, test, type Page } from "@playwright/test";

async function join(page: Page, name = "Ada Lovelace") {
  await page.goto("/#participant");
  await page.getByLabel("What should we call you?").fill(name);
  await page
    .getByRole("button", { name: "Join the waiting room", exact: true })
    .click();
}
async function admit(page: Page) {
  await join(page);
  await page.clock.runFor(1100);
  await expect(
    page.getByRole("button", { name: "Confirm registration" }),
  ).toBeVisible();
}
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("qrush-data-mode", "simulation"));
  await page.route("**/api/health", (route) =>
    route.fulfill({ json: { status: "UP" } }),
  );
});

test("the workspace explains the reusable engine and switching untouched flows changes capacity", async ({
  page,
}) => {
  await page.goto("/#overview");
  await expect(
    page.getByRole("heading", { name: "Who’s next?" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: /Studio \/ 001 Limited product release/ })
    .click();
  await expect(
    page.getByRole("group", { name: "Spot map" }).getByRole("button"),
  ).toHaveCount(60);
  await page
    .getByRole("button", { name: /Make Something Workshop booking/ })
    .click();
  await expect(
    page.getByRole("group", { name: "Spot map" }).getByRole("button"),
  ).toHaveCount(40);
  await page.getByRole("button", { name: "Try the queue" }).click();
  await expect(
    page.getByRole("heading", { name: "Make Something", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Join the waiting room" }),
  ).toBeDisabled();
});

test("slowdown reduces admission, outage stops it, and recovery restores the rate gradually", async ({
  page,
}) => {
  await page.clock.install();
  await page.goto("/#chaos");
  await page
    .getByRole("button", { name: "Start practice run", exact: true })
    .click();
  await page.clock.runFor(3000);
  await page.getByRole("button", { name: "Slow things down" }).click();
  await page.clock.runFor(4000);
  const rate = page
    .locator(".metric-card")
    .filter({ hasText: "Entry speed" })
    .locator("strong");
  await expect(rate).toHaveText("1/ second");
  await page.getByRole("button", { name: "Pause new entries" }).click();
  await expect(rate).toHaveText("0/ second");
  await page.clock.runFor(3000);
  await expect(page.getByRole("log")).toContainText(
    "The line is paused for a test",
  );
  await page.getByRole("button", { name: "Back to normal" }).click();
  await page.clock.runFor(1000);
  await expect(rate).not.toHaveText("4/ second");
  await page.clock.runFor(8000);
  await expect(rate).toHaveText("4/ second");
  const reserved = await page
    .locator(".resource-dot.held,.resource-dot.mine")
    .count();
  expect(reserved).toBeLessThanOrEqual(10);
});

test("participant identity and reservation survive refresh and confirm once with an exported sample", async ({
  page,
}) => {
  await page.clock.install();
  await admit(page);
  const token = await page.locator(".reservation-details").textContent();
  await page.reload();
  await expect(page.locator(".reservation-details")).toHaveText(token);
  await page.getByRole("button", { name: "Confirm registration" }).click();
  await expect(
    page.getByRole("heading", { name: "You’re in. Nice one!" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Confirm registration" }),
  ).toHaveCount(0);
  const download = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Save my practice pass" })
    .click();
  expect((await download).suggestedFilename()).toMatch(/^HSP-.+-sample.svg$/);
  await page.reload();
  await expect(page.getByText("PRACTICE PASS · NOT AN ENTRY TICKET")).toBeVisible();
});

test("lease expiry releases the resource and prevents confirmation after refresh", async ({
  page,
}) => {
  await page.clock.install();
  await page.goto("/#overview");
  await page.getByRole("button", { name: "Open queue settings" }).click();
  await page
    .getByRole("combobox", { name: "Time to claim a spot", exact: true })
    .selectOption("30");
  await page.getByRole("button", { name: "Save settings" }).click();
  await admit(page);
  await page.clock.fastForward(31000);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Time’s up for that spot." }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Confirm registration" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Back to control" }).click();
  await expect(
    page.getByRole("button", { name: "Spot 1, available", exact: true }),
  ).toBeVisible();
});

test("an outage preserves queue identity and simulated reconnect restores the same journey", async ({
  page,
}) => {
  await page.clock.install();
  await page.goto("/#overview");
  await page.getByRole("button", { name: "Pause new entries" }).click();
  await join(page);
  const token = await page.locator(".identity-line strong").innerText();
  await page.clock.runFor(5000);
  await expect(page.getByText("#1", { exact: true })).toBeVisible();
  await expect(
    page.getByText("The time estimate will return when entry starts again"),
  ).toBeVisible();
  await page.getByRole("button", { name: "Try a connection break" }).click();
  await expect(
    page.getByRole("heading", { name: "You’re temporarily offline." }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Reconnect" }).click();
  await expect(page.locator(".identity-line strong")).toHaveText(token);
  await page.getByRole("button", { name: "Back to control" }).click();
  await page.getByRole("button", { name: "Back to normal" }).click();
  await page.clock.runFor(5000);
  await page
    .getByRole("button", { name: "Join the queue", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Confirm registration" }),
  ).toBeEnabled();
});

test("simulation and hold recycling protect the participant resource and expose its owner", async ({
  page,
}) => {
  await page.clock.install();
  await admit(page);
  await page.getByRole("button", { name: "Back to control" }).click();
  await page
    .getByRole("button", { name: "Spot 1, your saved spot", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toContainText("SAVED FOR YOU");
  await page.getByRole("button", { name: "Close dialog" }).click();
  await page.getByRole("button", { name: "Playground", exact: true }).click();
  await page
    .getByRole("button", { name: "Start practice run", exact: true })
    .click();
  await page.clock.runFor(2500);
  await page.getByRole("button", { name: "Bring back unclaimed spots" }).click();
  await expect(page.getByRole("status")).toContainText(
    "Your spot is still saved",
  );
  await expect(page.locator(".resource-dot.mine")).toHaveCount(1);
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export results" }).click();
  expect((await download).suggestedFilename()).toBe(
    "qrush-hackathon-practice-results.json",
  );
  await page.getByRole("button", { name: "Pause test crowd" }).click();
  await page
    .getByRole("button", { name: "Join the queue", exact: true })
    .click();
  await page.getByRole("button", { name: "Confirm registration" }).click();
  await expect(page.getByText("PRACTICE PASS · NOT AN ENTRY TICKET")).toBeVisible();
});

test("flow switching asks before clearing a participant and the activity filter is functional", async ({
  page,
}) => {
  await page.clock.install();
  await admit(page);
  await page.getByRole("button", { name: "Back to control" }).click();
  await page
    .getByRole("button", { name: /Studio \/ 001 Limited product release/ })
    .click();
  await expect(page.getByRole("dialog")).toContainText("current queue");
  await page.getByRole("button", { name: "Keep exploring" }).click();
  await expect(page.locator(".resource-dot.mine")).toHaveCount(1);
  await page
    .getByRole("button", { name: /Studio \/ 001 Limited product release/ })
    .click();
  await page.getByRole("button", { name: "Switch queue" }).click();
  await expect(
    page.getByRole("group", { name: "Spot map" }).getByRole("button"),
  ).toHaveCount(60);
  await page.getByRole("button", { name: "What’s happening", exact: true }).click();
  await page
    .getByRole("button", { name: "Confirmations", exact: true })
    .click();
  await expect(
    page.getByText("Nothing here yet.", { exact: false }),
  ).toBeVisible();
  await page.goBack();
  await expect(
    page.getByRole("heading", { name: "Who’s next?" }),
  ).toBeVisible();
});

test("mobile screens have no page overflow and navigation and dialog dismissal work", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/#overview");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "Open navigation" }).click();
  await page
    .getByRole("button", { name: "Join the queue", exact: true })
    .click();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "Open navigation" }).click();
  await page.getByRole("button", { name: "Playground", exact: true }).click();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "Set up test" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("the explicitly selected browser simulation works without backend requests", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.unroute("**/api/health");
  await page.route("**/api/health", (route) => route.abort());
  await page.goto("/#overview");
  await expect(
    page.getByText("Practice mode · stays in this browser"),
  ).toBeVisible();
  await page.getByRole("button", { name: "Start practice run" }).click();
  await page.getByRole("button", { name: "Slow things down" }).click();
  await expect(page.getByText("The gate is slowing down.")).toBeVisible();
  expect(errors).toEqual([]);
});

test('a complete run allocates only the configured inventory and closes participant entry', async ({ page }) => {
  await page.clock.install();
  await page.goto('/#overview');
  await page.getByRole('button', { name: 'Start practice run', exact: true }).click();
  await page.clock.runFor(100000);
  await expect(page.locator('.resource-dot.confirmed')).toHaveCount(100);
  await expect(page.locator('.resource-dot.held,.resource-dot.mine')).toHaveCount(0);
  await expect(page.locator('.resource-dot.available')).toHaveCount(0);
  await page.getByRole('button', { name: 'Try the queue' }).click();
  await expect(page.getByRole('heading', { name: 'All spots are taken.' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'All spots taken', exact: true })).toBeDisabled();
});

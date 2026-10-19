import { expect, test } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";

const createdIds: string[] = [];
test.afterEach(async ({}, info) => {
  if (!createdIds.length) return;
  await mkdir("artifacts", { recursive: true });
  await writeFile(`artifacts/opening-test-ids-${info.workerIndex}.json`, JSON.stringify(createdIds));
});

test.describe("real opening and registration product", () => {
  test.skip(process.env.QRUSH_LIVE_E2E !== "1", "Requires the local backend, Redis and PostgreSQL.");

  test("create, share, resume, confirm, cancel and reassign the same place", async ({ page, browser }) => {
    test.setTimeout(90000);
    const name = "Design Jam / Browser Check";
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto("/#create");
    await page.getByLabel("Give it a name").fill(name);
    await page.getByLabel("What should people know?").fill("Bring a sketchbook and one wild idea. A friendly Saturday workshop, open to all.");
    await page.getByLabel("How many spots?").fill("1");
    await page.getByRole("button", { name: "Create & get my link" }).click();
    await expect(page.getByRole("heading", { name: "Your opening is ready." })).toBeVisible({ timeout: 15000 });
    const publicLink = await page.getByLabel("Your public registration link").inputValue();
    createdIds.push(publicLink.split("/#r/")[1]);
    expect(publicLink).toMatch(/\/#r\/[a-z0-9-]+$/);
    expect(publicLink).not.toMatch(/claimant|sessionToken/);
    await page.screenshot({ path: "artifacts/opening-created.png", fullPage: true });
    await page.getByRole("link", { name: "View registration page" }).click();
    await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Send test crowd" })).toHaveCount(0);
    await page.getByLabel("What should we call you?").fill("Alice");
    await page.getByRole("button", { name: "Join this opening" }).click();
    const confirm = page.getByRole("button", { name: "Confirm my spot" });
    await expect(confirm).toBeEnabled({ timeout: 20000 });
    const before = await page.getByRole("timer", { name: "Time to confirm" }).innerText();
    await page.getByRole("link", { name: "My registrations", exact: true }).first().click();
    await expect(page.getByText("A spot is waiting for you", { exact: true })).toBeVisible();
    await page.getByRole("link", { name: "Resume registration" }).click();
    await expect(confirm).toBeEnabled({ timeout: 15000 });
    await page.reload();
    await expect(confirm).toBeEnabled({ timeout: 15000 });
    const after = await page.getByRole("timer", { name: "Time to confirm" }).innerText();
    expect(after).not.toBe(""); expect(before).not.toBe("");
    await confirm.click();
    await expect(page.getByRole("heading", { name: "You’re in, Alice." })).toBeVisible({ timeout: 15000 });
    await page.reload();
    await expect(page.getByRole("heading", { name: "You’re in, Alice." })).toBeVisible({ timeout: 15000 });
    await page.getByRole("link", { name: "My registrations", exact: true }).first().click();
    const confirmedCard = page.locator(".p-registration-card.confirmed");
    await expect(confirmedCard).toContainText(name);
    const otherTab = await page.context().newPage();
    await otherTab.goto(publicLink);
    await expect(otherTab.getByRole("heading", { name: "You’re in, Alice." })).toBeVisible({ timeout: 15000 });
    await page.screenshot({ path: "artifacts/my-registrations.png", fullPage: true });
    await confirmedCard.getByRole("button", { name: "Cancel registration", exact: true }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.getByRole("button", { name: "Keep my spot" }).click();
    await expect(confirmedCard).toBeVisible();
    await confirmedCard.getByRole("button", { name: "Cancel registration", exact: true }).click();
    await page.getByRole("button", { name: "Yes, cancel registration", exact: true }).click();
    await expect(page.locator(".p-registration-card.cancelled")).toContainText(name);
    await expect(confirmedCard).toHaveCount(0);
    await expect(otherTab.getByRole("heading", { name: "Another go?" })).toBeVisible({ timeout: 15000 });
    await otherTab.close();
    await page.reload();
    await expect(page.locator(".p-registration-card.cancelled")).toContainText(name);

    // An independent browser gets the returned spot through the public link.
    const other = await browser.newContext();
    try {
      const bob = await other.newPage();
      await bob.goto(publicLink);
      await bob.getByLabel("What should we call you?").fill("Bob");
      await bob.getByRole("button", { name: "Join this opening" }).click();
      await expect(bob.getByRole("button", { name: "Confirm my spot" })).toBeEnabled({ timeout: 20000 });
      await bob.getByRole("button", { name: "Confirm my spot" }).click();
      await expect(bob.getByRole("heading", { name: "You’re in, Bob." })).toBeVisible({ timeout: 15000 });
      // Leave the test-created opening reusable for someone reviewing the local app.
      await bob.getByRole("button", { name: "Cancel my registration" }).click();
      await bob.getByRole("button", { name: "Yes, cancel registration" }).click();
      await expect(bob.getByText("Registration cancelled. Your spot is going back up for grabs.")).toBeVisible();
    } finally { await other.close(); }
    expect(errors).toEqual([]);
  });

  test("a scheduled link explains the opening and counts down without allowing early joins", async ({ page, request }) => {
    const future = new Date(Date.now() + 86400000).toISOString();
    const created = await request.post("/api/openings", { data: { name: "Tomorrow’s Maker Club", description: "A sample opening for tomorrow. Bring your curiosity and a notebook.", capacity: 24, opensAt: future } });
    expect(created.status()).toBe(201);
    const opening = await created.json();
    createdIds.push(opening.id);
    await page.goto(`/#r/${opening.id}`);
    await expect(page.getByRole("timer")).toBeVisible();
    await expect(page.getByRole("button", { name: "Registration opens soon" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Join this opening" })).toHaveCount(0);
    await page.screenshot({ path: "artifacts/public-opening.png", fullPage: true });
    for (const width of [1440, 768, 390]) {
      await page.setViewportSize({ width, height: 900 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      const sizes = await page.locator(".p-opening-description, .p-join-panel > p, .p-full, .p-stock-labels, .p-header nav a").evaluateAll((elements) => elements.map((el) => parseFloat(getComputedStyle(el).fontSize)));
      expect(Math.min(...sizes)).toBeGreaterThanOrEqual(14);
    }
    await page.screenshot({ path: "artifacts/public-opening-mobile.png", fullPage: true });
  });
});

test("the noticeboard is the default and creation stays usable on a phone", async ({ page }) => {
  await page.route("**/api/openings", (route) => route.fulfill({ json: [] }));
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Good things. Limited spots." })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Be the first to open something." })).toBeVisible();
  await page.getByRole("link", { name: "Create an opening", exact: true }).first().click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByLabel("Give it a name").fill("Community Sketch Club");
  await page.getByLabel("What should people know?").fill("A relaxed drawing session for beginners. Meet at the campus studio.");
  await page.getByRole("radio", { name: "Pick a time" }).check();
  await expect(page.getByLabel("Registration opens", { exact: true })).toBeVisible();
  await page.getByLabel("Registration opens", { exact: true }).fill("2020-01-01T12:00");
  await page.getByRole("button", { name: "Create & get my link" }).click();
  await expect(page.getByRole("alert")).toContainText("Pick an opening time in the future.");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.goto("/#registrations");
  await expect(page.getByRole("heading", { name: "Your next plan belongs here." })).toBeVisible();
});

test("an expired browser pass stays visible without inventing a confirmation", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("qrush-session-expired-opening", JSON.stringify({ claimantId: "participant-00000000-0000-0000-0000-000000000000", sessionToken: "expired", openingName: "Saved Workshop" })));
  await page.route("**/api/registrations/lookup", (route) => route.fulfill({ json: [{ flowId: "expired-opening", status: "SESSION_EXPIRED" }] }));
  await page.goto("/#registrations");
  await expect(page.getByRole("heading", { name: "Saved Workshop" })).toBeVisible();
  await expect(page.getByText("Browser pass unavailable", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Cancel registration", exact: true })).toHaveCount(0);
});

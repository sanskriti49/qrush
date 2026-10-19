import { expect, test } from "@playwright/test";

test("real backend participant reservation, SSE and durable confirmation survive refresh", async ({ page, request }) => {
  test.skip(process.env.QRUSH_LIVE_E2E !== "1", "Requires a running QRush backend, Redis and PostgreSQL. Confirms one real local demo allocation.");
  const candidates = ["workshop", "product", "hackathon"];
  let chosen = "";
  for (const id of candidates) {
    const response = await request.get(`/api/flows/${id}`);
    if (!response.ok()) continue;
    const snapshot = await response.json();
    if (snapshot.metrics.available > 0 && snapshot.scenario.mode === "NORMAL") { chosen = id; break; }
  }
  expect(chosen, "At least one default flow needs an available resource and normal service.").not.toBe("");
  await page.addInitScript((id) => {
    localStorage.setItem("qrush-data-mode", "live");
    localStorage.setItem("qrush-live-flow", id);
    if (!sessionStorage.getItem("qrush-live-test-initialized")) {
      localStorage.removeItem(`qrush-session-${id}`);
      sessionStorage.setItem("qrush-live-test-initialized", "1");
    }
  }, chosen);
  await page.goto("/#participant");
  await expect(page.getByText("Live updates are on", { exact: true })).toBeVisible();
  await page.getByLabel("What should we call you?").fill("Backend browser verification");
  await page.getByRole("button", { name: "Join the waiting room", exact: true }).click();
  const confirm = page.locator(".participant-journey button.button.primary.full").filter({ hasText: /^Confirm/ });
  await expect(confirm).toBeEnabled({ timeout: 25000 });
  const details = await page.locator(".reservation-details").textContent();
  await expect(page.locator(".participant-connection")).toContainText("Your place is updating live", { timeout: 10000 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: "artifacts/live-reservation.png", fullPage: true });
  await page.reload();
  await expect(page.locator(".reservation-details")).toHaveText(details!, { timeout: 15000 });
  await confirm.click();
  await expect(page.getByText("DEMO PASS · NOT AN ENTRY TICKET")).toBeVisible({ timeout: 15000 });
  const receipt = await page.locator(".participant-receipt > span").innerText();
  expect(receipt).toMatch(/^[0-9a-f-]{36}$/i);
  await page.reload();
  await expect(page.locator(".participant-receipt")).toContainText(receipt, { timeout: 15000 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: "artifacts/live-confirmation.png", fullPage: true });
});

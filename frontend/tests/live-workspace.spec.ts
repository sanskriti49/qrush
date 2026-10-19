import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";

// Contract-level browser coverage. The backend integration suite exercises real Redis/PostgreSQL.
async function liveService(page: Page) {
  const state = {
    issued: 0, joined: false, held: false, confirmed: false, unavailable: false,
    rejectConfirmation: false, mode: "NORMAL", running: false, waiting: false, soldOut: false,
    policy: { maxConcurrent: 10, admissionRate: 5, holdSeconds: 300, adaptive: true },
    calls: [] as { path: string; method: string; body: Record<string, unknown> | null }[],
  };
  const flow = (id: string) => ({ id, name: id === "hackathon" ? "Campus Hackathon" : id === "product" ? "Studio Release" : "Creative Workshop", resourcePrefix: "slot", totalUnits: id === "hackathon" ? 100 : id === "product" ? 80 : 60, policy: state.policy });
  const status = () => ({ position: state.waiting ? 5 : 0, totalInQueue: state.waiting ? 5 : 0, estimatedWaitSeconds: state.soldOut ? -1 : 0, admitted: state.joined && !state.confirmed && !state.waiting && !state.soldOut, admissionToken: state.joined ? "server-admission-secret" : null, status: state.soldOut ? "SOLD_OUT" : state.confirmed ? "CONFIRMED" : state.joined ? state.waiting ? "WAITING" : "ADMITTED" : "NOT_JOINED", admissionRemainingSeconds: 300, heldUnitId: state.held ? "slot-01" : null, holdRemainingSeconds: state.held ? 290 : 0 });
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();
    const body = request.postData() ? request.postDataJSON() : null;
    state.calls.push({ path, method, body });
    if (path.endsWith("/stream")) { await route.abort(); return; }
    if (state.unavailable) { await route.fulfill({ status: 503, json: { message: "Service unavailable" } }); return; }
    if (path === "/api/flows") { await route.fulfill({ json: ["hackathon", "product", "workshop"].map(flow) }); return; }
    if (path.endsWith("/sessions")) {
      state.issued++;
      await route.fulfill({ json: { claimantId: "server-participant-1", sessionToken: "server-session-secret" } }); return;
    }
    if (/\/api\/flows\/[^/]+$/.test(path)) {
      const definition = flow(path.split("/").at(-1)!);
      await route.fulfill({ json: {
        ...definition,
        metrics: { activeCheckouts: state.held ? 1 : 0, admissionRatePerSec: state.mode === "OUTAGE" ? 0 : 5, observedLatencyMs: 12, queueLength: 0, available: definition.totalUnits - (state.held || state.confirmed ? 1 : 0), held: state.held ? 1 : 0, confirmed: state.confirmed ? 1 : 0, requests: 2, recycled: 0, admissions: state.joined ? 1 : 0, arrivals: state.joined ? 1 : 0 },
        inventory: Array.from({ length: definition.totalUnits }, (_, index) => ({ unitId: `slot-${String(index + 1).padStart(2, "0")}`, status: index === 0 && state.confirmed ? "CONFIRMED" : index === 0 && state.held ? "HELD" : "AVAILABLE", leaseRemainingSeconds: index === 0 && state.held ? 290 : 0, heldByYou: index === 0 && state.held })),
        events: [{ id: "event-1", at: new Date().toISOString(), type: "control", message: "Server snapshot received." }],
        scenario: { mode: state.mode }, load: { running: state.running, total: 0, completed: 0, failed: 0 },
      } }); return;
    }
    if (path.endsWith("/policy")) { state.policy = body; await route.fulfill({ json: flow("hackathon") }); return; }
    if (path.endsWith("/scenario")) { state.mode = body.mode; await route.fulfill({ json: { mode: state.mode } }); return; }
    if (path.endsWith("/load/stop")) { state.running = false; await route.fulfill({ json: {} }); return; }
    if (path.endsWith("/load")) { state.running = true; await route.fulfill({ json: {} }); return; }
    if (url.searchParams.get("sessionToken") !== "server-session-secret") {
      await route.fulfill({ status: 403, json: { message: "Invalid participant credential" } }); return;
    }
    if (path.endsWith("/join")) { state.joined = true; await route.fulfill({ json: status() }); return; }
    if (path.endsWith("/status")) { await route.fulfill({ json: status() }); return; }
    if (path.endsWith("/allocation")) {
      if (state.confirmed) await route.fulfill({ json: { id: "durable-allocation-1", unitId: "slot-01" } });
      else await route.fulfill({ status: 204 });
      return;
    }
    if (path.endsWith("/hold")) {
      expect(body.admissionToken).toBe("server-admission-secret");
      expect(body.claimantId).toBe("server-participant-1");
      state.held = true;
      await route.fulfill({ json: { success: true, unitId: "slot-01", leaseTtlSeconds: 290 } }); return;
    }
    if (path.endsWith("/confirm")) {
      if (state.rejectConfirmation) { await route.fulfill({ status: 503, json: { message: "We couldn’t check your confirmation just now" } }); return; }
      state.held = false; state.confirmed = true;
      await route.fulfill({ json: { success: true, allocationId: "durable-allocation-1", unitId: "slot-01" } }); return;
    }
    if (path.endsWith("/release")) { state.held = false; await route.fulfill({ json: { success: true, unitId: "slot-01" } }); return; }
    if (path.endsWith("/leave")) { state.joined = false; await route.fulfill({ status: 204 }); return; }
    await route.fulfill({ status: 404, json: { message: "Unknown test API" } });
  });
  return state;
}

test("live is the default and the participant journey uses server credentials and durable recovery", async ({ page }) => {
  const service = await liveService(page);
  await page.goto("/#overview");
  await expect(page.getByLabel("Choose mode")).toHaveValue("live");
  await expect(page.getByRole("button", { name: /Studio Release Limited product release/ })).toContainText("80");
  await page.getByRole("button", { name: "Try the queue" }).click();
  await page.getByLabel("What should we call you?").fill("Ada");
  await page.getByRole("button", { name: "Join the waiting room", exact: true }).click();
  await expect(page.getByRole("button", { name: "Confirm registration" })).toBeEnabled();
  await expect(page.locator(".reservation-details")).toContainText("server-participant-1");
  await page.reload();
  await expect(page.getByRole("button", { name: "Confirm registration" })).toBeEnabled();
  expect(service.issued).toBe(1);
  expect(service.calls.filter((call) => call.path.endsWith("/hold"))).toHaveLength(1);
  await page.getByRole("button", { name: "Confirm registration" }).click();
  await expect(page.getByText("DEMO PASS · NOT AN ENTRY TICKET")).toBeVisible();
  await page.reload();
  await expect(page.locator(".participant-receipt")).toContainText("durable-allocation-1");
  expect(service.calls.filter((call) => call.path.endsWith("/confirm"))).toHaveLength(1);
});

test("a failed live confirmation cannot issue a local confirmation", async ({ page }) => {
  const service = await liveService(page);
  service.rejectConfirmation = true;
  await page.goto("/#participant");
  await page.getByLabel("What should we call you?").fill("Grace");
  await page.getByRole("button", { name: "Join the waiting room", exact: true }).click();
  await expect(page.getByRole("button", { name: "Confirm registration" })).toBeEnabled();
  await page.getByRole("button", { name: "Confirm registration" }).click();
  await expect(page.getByRole("status").filter({ hasText: "We couldn’t check your confirmation just now" })).toBeVisible();
  await expect(page.locator(".participant-receipt")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Confirm registration" })).toBeEnabled();
  service.rejectConfirmation = false;
  await page.getByRole("button", { name: "Confirm registration" }).click();
  await expect(page.getByText("DEMO PASS · NOT AN ENTRY TICKET")).toBeVisible();
});

test("server controls are functional and exported observations exclude session credentials", async ({ page }) => {
  const service = await liveService(page);
  await page.goto("/#chaos");
  await expect(page.getByRole("button", { name: "Send test crowd" })).toBeEnabled();
  await page.getByRole("button", { name: "Set up test" }).click();
  await page.getByRole("combobox", { name: "People choosing at once" }).selectOption("20");
  await page.getByRole("combobox", { name: "People let in each second" }).selectOption("10");
  await page.getByRole("button", { name: "Save settings" }).click();
  await expect.poll(() => service.policy.maxConcurrent).toBe(20);
  expect(service.policy.admissionRate).toBe(10);
  await page.getByRole("button", { name: "Pause new entries" }).click();
  await expect(page.locator(".live-status-banner")).toContainText("Your place in line stays saved");
  await expect(page.locator(".page-footer")).toContainText("Connected");
  await page.getByRole("button", { name: "Back to normal" }).click();
  await page.getByRole("button", { name: "Send test crowd" }).click();
  await expect(page.getByRole("button", { name: "Stop test crowd" })).toBeVisible();
  expect(service.calls.find((call) => call.path.endsWith("/load"))?.body).toEqual({ buyers: 500 });
  const downloadEvent = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export results" }).click();
  const download = await downloadEvent;
  expect(download.suggestedFilename()).toBe("qrush-hackathon-test-results.json");
  const contents = await readFile((await download.path())!, "utf8");
  expect(JSON.parse(contents).environment).toBe("Live queue test");
  expect(contents).not.toContain("server-session-secret");
  expect(contents).not.toContain("server-admission-secret");
});

test("a definitive server sold-out status ends the wait without promising future availability", async ({ page }) => {
  const service = await liveService(page);
  service.waiting = true;
  await page.goto("/#participant");
  await page.getByLabel("What should we call you?").fill("Linus");
  await page.getByRole("button", { name: "Join the waiting room", exact: true }).click();
  await expect(page.getByText("#5", { exact: true })).toBeVisible();
  service.soldOut = true;
  await expect(page.getByRole("heading", { name: "This queue has filled up." })).toBeVisible();
  await expect(page.getByText("No spots left to claim")).toBeVisible();
  expect(service.calls.filter((call) => call.path.endsWith("/hold"))).toHaveLength(0);
  await page.getByRole("button", { name: "Leave the queue" }).click();
  await expect(page.getByRole("button", { name: "All spots taken", exact: true })).toBeDisabled();
});

test("backend unavailability keeps live state unavailable until simulation is explicitly selected", async ({ page }) => {
  const service = await liveService(page);
  service.unavailable = true;
  await page.goto("/#overview");
  await expect(page.getByText("The queue can’t be reached", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Send test crowd" })).toBeDisabled();
  await expect(page.getByRole("group", { name: "Spot map" }).getByRole("button")).toHaveCount(0);
  await page.getByLabel("Choose mode").selectOption("simulation");
  await expect(page.getByRole("button", { name: "Start practice run", exact: true })).toBeEnabled();
  await expect(page.getByRole("group", { name: "Spot map" }).getByRole("button")).toHaveCount(100);
});

test("flow switching waits for an in-flight confirmation and preserves flow-scoped receipts", async ({ page }) => {
  await liveService(page);
  let resume!: () => void;
  const gate = new Promise<void>((resolve) => { resume = resolve; });
  let received = false;
  await page.route("**/api/pools/hackathon/confirm?**", async (route) => {
    received = true;
    await gate;
    await route.fallback();
  });
  await page.goto("/#participant");
  await page.getByLabel("What should we call you?").fill("Ada");
  await page.getByRole("button", { name: "Join the waiting room", exact: true }).click();
  await expect(page.getByRole("button", { name: "Confirm registration" })).toBeEnabled();
  await page.getByRole("button", { name: "Confirm registration" }).click();
  await expect.poll(() => received).toBe(true);
  await page.getByRole("button", { name: "Back to control" }).click();
  const workshop = page.getByRole("button", { name: /Creative Workshop Workshop booking/ });
  await expect(workshop).toBeDisabled();
  await expect(page.getByLabel("Choose mode")).toBeDisabled();
  const completed = page.waitForResponse((response) => response.url().includes("/api/pools/hackathon/confirm?"));
  resume();
  await completed;
  await expect(workshop).toBeEnabled();
  await workshop.click();
  await page.getByRole("button", { name: "Try the queue" }).click();
  await expect(page.getByText("Live updates are on", { exact: true })).toBeVisible();
  await expect(page.locator(".participant-receipt")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Join the waiting room", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Back to control" }).click();
  await page.getByRole("button", { name: /Campus Hackathon Hackathon registration/ }).click();
  await page.getByRole("button", { name: "Try the queue" }).click();
  await expect(page.locator(".participant-receipt")).toContainText("durable-allocation-1");
});

import { expect, test } from "@playwright/test";
import { mockChat, sessionIdOf, streams } from "./helpers";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

test("step 1 renders: heading, labeled input, progress, no-website link", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "What’s your website?" })).toBeVisible();
  await expect(page.getByLabel("Website URL")).toBeVisible();
  await expect(page.getByRole("button", { name: "Continue" })).toBeVisible();
  await expect(page.getByRole("button", { name: "I don't have a website yet" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Onboarding progress" }).locator("[aria-current=step]")).toContainText("Your site");
});

test("AC-5: one session per browser; refresh reuses it", async ({ page }) => {
  const creates: string[] = [];
  page.on("request", (r) => r.url().endsWith("/api/sessions") && r.method() === "POST" && creates.push(r.url()));

  await page.goto("/");
  await expect.poll(() => sessionIdOf(page)).toMatch(UUID);
  const first = await sessionIdOf(page);
  expect(creates).toHaveLength(1);

  await page.reload();
  await expect(page.getByLabel("Website URL")).toBeEnabled();
  expect(await sessionIdOf(page)).toBe(first);
  expect(creates).toHaveLength(1); // no new POST after refresh
});

test("AC-6/7/8: 'Reading…' within 1s, then brand card, then summary; sessionId is sent", async ({ page }) => {
  const requests = await mockChat(page, [streams.brandOk()], 3_000);
  await page.goto("/");
  await expect.poll(() => sessionIdOf(page)).toMatch(UUID);
  await expect(page.getByLabel("Website URL")).toBeEnabled();

  await page.getByLabel("Website URL").fill("  starterbakery.com ");
  await page.getByRole("button", { name: "Continue" }).click();

  await expect(page.getByText("Reading starterbakery.com…")).toBeVisible({ timeout: 1_000 });

  const card = page.getByRole("region", { name: "Brand for Starter Bakery" });
  await expect(card).toBeVisible();
  await expect(card).toContainText("Brand saved");
  await expect(card.getByRole("list", { name: "Brand colors" }).getByRole("listitem")).toHaveCount(2);
  await expect(card.getByText("S", { exact: true })).toBeVisible(); // letter avatar (no logo)
  await expect(page.getByText("Starter Bakery is a neighborhood bakery")).toBeVisible();

  // The per-call body reached the server, and the user's input was trimmed.
  expect(requests).toHaveLength(1);
  expect(requests[0].sessionId).toMatch(UUID);
  expect(requests[0].sessionId).toBe(await sessionIdOf(page));
  expect(JSON.stringify(requests[0].messages)).toContain('"starterbakery.com"');
});

test("failed research shows fallback + description box, and the flow continues", async ({ page }) => {
  await mockChat(page, [streams.researchFailed(), streams.describeReply()]);
  await page.goto("/");
  await expect(page.getByLabel("Website URL")).toBeEnabled();

  await page.getByLabel("Website URL").fill("nope.example");
  await page.getByRole("button", { name: "Continue" }).click();

  await expect(page.getByText("We couldn't read your site.")).toBeVisible();
  const box = page.getByLabel("Describe your business in a sentence");
  await expect(box).toBeVisible();

  await box.fill("A bakery in Oakland that does catering");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByText("A bakery in Oakland that sells to local event hosts.")).toBeVisible();
});

test("AC-14 (UI): no-website path sends the description and renders no tool part", async ({ page }) => {
  const requests = await mockChat(page, [streams.describeReply()]);
  await page.goto("/");
  await expect(page.getByLabel("Website URL")).toBeEnabled();

  await page.getByRole("button", { name: "I don't have a website yet" }).click();
  await expect(page.getByLabel("Website URL")).toHaveCount(0);
  await page.getByLabel("Describe your business in a sentence").fill("A bakery in Oakland that does catering");
  await page.getByRole("button", { name: "Continue" }).click();

  await expect(page.getByText("A bakery in Oakland that sells to local event hosts.")).toBeVisible();
  await expect(page.getByText(/Reading /)).toHaveCount(0);
  await expect(page.getByRole("region", { name: /Brand for/ })).toHaveCount(0);
  expect(requests).toHaveLength(1);
});

test("stream error shows the free-tier rate-limit message and a working Retry", async ({ page }) => {
  const msg =
    "Rate limit reached: the free-tier AI model allows only about 5 requests per minute. Wait a minute, then retry.";
  const requests = await mockChat(page, [streams.error(msg), streams.describeReply()]);
  await page.goto("/");
  await expect(page.getByLabel("Website URL")).toBeEnabled();

  await page.getByLabel("Website URL").fill("starterbakery.com");
  await page.getByRole("button", { name: "Continue" }).click();

  // Scoped: Next.js adds its own hidden role="alert" route announcer.
  const alert = page.getByRole("region", { name: "Conversation" }).getByRole("alert");
  await expect(alert).toContainText("free-tier AI model");
  await expect(alert).toContainText("5 requests per minute");

  await alert.getByRole("button", { name: "Retry" }).click();
  await expect(page.getByText("A bakery in Oakland that sells to local event hosts.")).toBeVisible();
  await expect(alert).toHaveCount(0);
  expect(requests).toHaveLength(2);
  expect(requests[1].sessionId).toMatch(UUID); // Retry also carries the session id
});

test("network failure shows an error with Retry, never a blank page", async ({ page }) => {
  await page.route("**/api/chat", (route) => route.abort("failed"));
  await page.goto("/");
  await expect(page.getByLabel("Website URL")).toBeEnabled();

  await page.getByLabel("Website URL").fill("starterbakery.com");
  await page.getByRole("button", { name: "Continue" }).click();

  await expect(page.getByRole("alert").getByRole("button", { name: "Retry" })).toBeVisible();
});

test("session failure shows a retry instead of a dead form", async ({ page }) => {
  let calls = 0;
  await page.route("**/api/sessions", (route) =>
    ++calls === 1 ? route.fulfill({ status: 500, json: { error: "x" } }) : route.continue(),
  );
  await page.goto("/");
  await expect(page.getByText("We couldn't start your session.")).toBeVisible();
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByLabel("Website URL")).toBeEnabled();
  await expect.poll(() => sessionIdOf(page)).toMatch(UUID);
});

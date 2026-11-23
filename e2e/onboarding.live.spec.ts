import { expect, test, type Page } from "@playwright/test";
import { db, sessionIdOf } from "./helpers";

// Real model + Firecrawl + Supabase. Needs .env.local (or E2E_BASE_URL for the deployed app).
// The free model allows ~5 requests/min and one run uses ~2, so pause between tests.
test.afterEach(async () => {
  await new Promise((r) => setTimeout(r, 30_000));
});

const convo = (page: Page) => page.getByRole("region", { name: "Conversation" });
// The assistant's prose (the one-sentence summary / apology) uses these classes.
const prose = (page: Page) => convo(page).locator("p.leading-relaxed");

async function openAndSubmit(page: Page, value: string) {
  await page.goto("/");
  await expect(page.getByLabel("Website URL")).toBeEnabled();
  await page.getByLabel("Website URL").fill(value);
  await page.getByRole("button", { name: "Continue" }).click();
}

async function expectFallback(page: Page) {
  await expect(page.getByText("We couldn't read your site.")).toBeVisible({ timeout: 35_000 });
  await expect(page.getByLabel("Describe your business in a sentence")).toBeVisible();
}

const events = async (page: Page) => {
  const id = await sessionIdOf(page);
  return db<{ name: string; props: Record<string, unknown> }>("events", `session_id=eq.${id}&select=name,props&order=id`);
};

test("AC-5/6/7/8/9/10: starterbakery.com end to end", async ({ page }) => {
  await openAndSubmit(page, "starterbakery.com");
  await expect(page.getByText("Reading starterbakery.com…")).toBeVisible({ timeout: 1_000 });

  const card = convo(page).getByRole("region", { name: /^Brand for / });
  await expect(card).toBeVisible({ timeout: 35_000 });
  await expect(card).toContainText("Brand saved");
  expect(await card.getByRole("list", { name: "Brand colors" }).getByRole("listitem").count()).toBeGreaterThanOrEqual(1);
  await expect(card.locator("img, [aria-hidden=true]").first()).toBeVisible(); // logo or letter avatar

  await expect(prose(page).first()).not.toBeEmpty({ timeout: 35_000 }); // one-sentence summary after the card

  const id = await sessionIdOf(page);
  const [profile] = await db<{
    url: string;
    brand: { colors: string[] };
    content: { digest: string };
    field_sources: Record<string, string>;
  }>("business_profiles", `session_id=eq.${id}&select=url,brand,content,field_sources`);
  expect(profile.url).toContain("starterbakery.com");
  expect(Array.isArray(profile.brand.colors)).toBe(true);
  expect(profile.brand.colors.length).toBeGreaterThan(0);
  expect(profile.content.digest.length).toBeLessThanOrEqual(6000);
  expect(profile.field_sources).toMatchObject({ name: "scraped", brand: "scraped" });

  const ev = await events(page);
  expect(ev.filter((e) => e.name === "ftu_started")).toHaveLength(1);
  const done = ev.find((e) => e.name === "research_done");
  expect(done?.props.ok).toBe(true);
  expect(typeof done?.props.ms).toBe("number");
});

test("AC-11: a different kind of site (cal.com) also produces a brand card", async ({ page }) => {
  await openAndSubmit(page, "cal.com");
  const card = convo(page).getByRole("region", { name: /^Brand for / });
  await expect(card).toBeVisible({ timeout: 35_000 });
  expect(await card.getByRole("list", { name: "Brand colors" }).getByRole("listitem").count()).toBeGreaterThanOrEqual(1);
});

test("AC-12: unreachable domain -> fallback + tool_failed with a reason", async ({ page }) => {
  await openAndSubmit(page, "https://this-domain-does-not-exist-ploy.com");
  await expectFallback(page);

  const failed = (await events(page)).find((e) => e.name === "tool_failed");
  expect(failed?.props.tool).toBe("researchSite");
  expect(["timeout", "blocked", "invalid_url", "empty", "unknown"]).toContain(failed?.props.reason);
});

for (const bad of ["localhost:3000", "ftp://example.com"]) {
  test(`AC-13: ${bad} is rejected as invalid_url`, async ({ page }) => {
    await openAndSubmit(page, bad);
    await expectFallback(page);

    const ev = await events(page);
    expect(ev.find((e) => e.name === "tool_failed")?.props.reason).toBe("invalid_url");
    expect(ev.some((e) => e.name === "research_done")).toBe(false); // Firecrawl never ran
  });
}

test("AC-14: no-website path -> one sentence, no tool call, no research_done", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByLabel("Website URL")).toBeEnabled();
  await page.getByRole("button", { name: "I don't have a website yet" }).click();
  await page.getByLabel("Describe your business in a sentence").fill("A bakery in Oakland that does catering");
  await page.getByRole("button", { name: "Continue" }).click();

  await expect(prose(page).first()).not.toBeEmpty({ timeout: 35_000 });
  await expect(page.getByText(/Reading /)).toHaveCount(0);
  await expect(convo(page).getByRole("region", { name: /^Brand for / })).toHaveCount(0);

  const names = (await events(page)).map((e) => e.name);
  expect(names).toContain("ftu_started");
  expect(names).not.toContain("research_done");
  expect(names).not.toContain("tool_failed");
});

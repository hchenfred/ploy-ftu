import { expect, test, type Page } from "@playwright/test";
import { DEFAULT_GOALS, GOAL_TYPES } from "../src/lib/goals";
import { FAKE_ID, fakeBackend, goals4, mockChat, streams, suggestFailed, suggestOk } from "./helpers";

// Milestone 2, no LLM and no database: the session/goals endpoints are a stateful fake (see helpers.ts).

const step = (page: Page) =>
  page.getByRole("navigation", { name: "Onboarding progress" }).locator("[aria-current=step]");
const radios = (page: Page) => page.getByRole("radiogroup", { name: "Your goal" }).getByRole("radio");
const cont = (page: Page) => page.getByRole("button", { name: "Continue" });
const heading = (page: Page) => page.getByRole("heading", { name: "What do you want your website to do?" });
const saved = (page: Page) => page.getByRole("heading", { name: "Your goal is saved" });
const FALLBACK = "We couldn't tailor suggestions, so here are the common goals.";
const SAVED_GOAL = { goalType: "paid_growth", label: "Label for paid_growth", customText: null } as const;

test.describe("step state", () => {
  for (const [status, label] of [
    ["site", "Your site"],
    ["goal", "Your goal"],
    ["building", "First win"],
  ] as const) {
    test(`AC-20: status "${status}" shows the "${label}" step and a refresh resumes it`, async ({ page }) => {
      await fakeBackend(page, {
        status,
        suggestedGoals: goals4(),
        goal: status === "building" ? { ...SAVED_GOAL } : null,
      });
      await page.goto("/");
      await expect(step(page)).toContainText(label);
      await page.reload();
      await expect(step(page)).toContainText(label);
    });
  }

  test("AC-21: a stale stored session id starts a fresh session and shows step 1", async ({ page }) => {
    const NEW_ID = "22222222-2222-4222-8222-222222222222";
    let posts = 0;
    await page.route("**/api/sessions", (route) => {
      if (route.request().method() !== "POST") return route.fallback();
      posts++;
      return route.fulfill({ json: { sessionId: NEW_ID } });
    });
    await fakeBackend(page, { status: "site", staleFirst: true });
    await page.goto("/");
    await expect(page.getByLabel("Website URL")).toBeVisible();
    await expect(step(page)).toContainText("Your site");
    expect(posts).toBe(1);
    expect(await page.evaluate(() => localStorage.getItem("ftu_session_id"))).toBe(NEW_ID);
  });
});

test.describe("goal step", () => {
  test("AC-25: loading status within 1s, then 4 cards in a radiogroup plus 'Something else'", async ({ page }) => {
    const fake = await fakeBackend(page, {
      status: "goal",
      suggestedGoals: null,
      suggest: [{ delayMs: 2_500, then: suggestOk() }],
    });
    await page.goto("/");
    await expect(page.getByText("Finding the best goals for Starter Bakery…")).toBeVisible({ timeout: 1_500 });
    await expect(radios(page)).toHaveCount(0); // cards are not rendered until the call resolves

    await expect(radios(page)).toHaveCount(5);
    for (const t of GOAL_TYPES) await expect(page.getByRole("radio", { name: new RegExp(`Label for ${t}`) })).toBeVisible();
    await expect(page.getByRole("radio", { name: /Something else/ })).toBeVisible();
    await expect(page.getByText("A San Francisco bakery selling to locals.")).toBeVisible(); // recap
    expect(fake.log.suggest).toBe(1);
  });

  test("AC-27: saved suggestions render with zero /api/goals/suggest requests, also after a refresh", async ({ page }) => {
    const fake = await fakeBackend(page, { status: "goal", suggestedGoals: goals4() });
    await page.goto("/");
    await expect(radios(page)).toHaveCount(5);
    await page.reload();
    await expect(radios(page)).toHaveCount(5);
    expect(fake.log.suggest).toBe(0);
  });

  test("AC-34b (UI): a model + default mix renders as 4 identical cards in stored order", async ({ page }) => {
    await fakeBackend(page, { status: "goal", suggestedGoals: goals4(2) });
    await page.goto("/");
    await expect(radios(page)).toHaveCount(5);
    const expected = ["inbound_leads", "local_customers", "capture_and_follow_up", "paid_growth"];
    for (const [i, t] of expected.entries()) await expect(radios(page).nth(i)).toContainText(`Label for ${t}`);
  });

  test("AC-28/30: select a card, Continue sends no label, end state shows the goal at step 3", async ({ page }) => {
    const fake = await fakeBackend(page, { status: "goal", suggestedGoals: goals4() });
    await page.goto("/");
    await expect(cont(page)).toBeDisabled();
    await page.getByRole("radio", { name: /Label for local_customers/ }).click();
    await expect(cont(page)).toBeEnabled();
    await cont(page).click();

    await expect(saved(page)).toBeVisible();
    await expect(page.getByText("Label for local_customers")).toBeVisible();
    await expect(page.getByText("Next: we'll build your first page. Coming soon.")).toBeVisible();
    await expect(step(page)).toContainText("First win");
    expect(fake.log.choose).toEqual([{ sessionId: FAKE_ID, kind: "suggested", goalType: "local_customers" }]);
  });

  test("keyboard: arrows move and select, Enter submits", async ({ page }) => {
    const fake = await fakeBackend(page, { status: "goal", suggestedGoals: goals4() });
    await page.goto("/");
    await radios(page).first().focus();
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowDown");
    await expect(radios(page).nth(2)).toHaveAttribute("aria-checked", "true");
    await page.keyboard.press("ArrowUp");
    await expect(radios(page).nth(1)).toHaveAttribute("aria-checked", "true");
    await page.keyboard.press("Enter");
    await expect(saved(page)).toBeVisible();
    expect(fake.log.choose[0]).toMatchObject({ kind: "suggested", goalType: "local_customers" });
  });

  test("AC-29: 'Something else' reveals a labeled input; Continue needs 3+ trimmed characters", async ({ page }) => {
    const fake = await fakeBackend(page, { status: "goal", suggestedGoals: goals4() });
    await page.goto("/");
    await page.getByRole("radio", { name: /Something else/ }).click();
    const box = page.getByLabel("Describe your goal");
    await expect(box).toBeVisible();
    await expect(cont(page)).toBeDisabled();
    await box.fill("  ab  ");
    await expect(cont(page)).toBeDisabled();
    await box.fill("  sell more wedding cakes  ");
    await expect(cont(page)).toBeEnabled();
    await cont(page).click();

    await expect(saved(page)).toBeVisible();
    await expect(page.getByText("sell more wedding cakes")).toBeVisible();
    expect(fake.log.choose).toEqual([{ sessionId: FAKE_ID, kind: "custom", customText: "sell more wedding cakes" }]);
  });

  test("a failed save shows an alert and keeps the selection", async ({ page }) => {
    await fakeBackend(page, { status: "goal", suggestedGoals: goals4(), chooseFails: true });
    await page.goto("/");
    await radios(page).first().click();
    await cont(page).click();
    await expect(page.getByText("We couldn't save your goal.")).toBeVisible();
    await expect(radios(page).first()).toHaveAttribute("aria-checked", "true");
    await expect(cont(page)).toBeEnabled();
    await expect(heading(page)).toBeVisible(); // still on step 2
  });
});

test.describe("failures and fallback", () => {
  for (const reason of ["rate_limited", "invalid_output", "timeout", "unknown", "no_profile"] as const) {
    test(`AC-32: suggest returning ok:false "${reason}" shows the fallback with 4 default cards`, async ({ page }) => {
      await fakeBackend(page, { status: "goal", suggestedGoals: null, suggest: [suggestFailed(reason)] });
      await page.goto("/");
      await expect(page.getByText(FALLBACK)).toBeVisible();
      await expect(radios(page)).toHaveCount(5);
      for (const t of GOAL_TYPES) await expect(page.getByText(DEFAULT_GOALS[t].label, { exact: true })).toBeVisible();
      await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
      const rateText = page.getByText(/free-tier AI model/);
      if (reason === "rate_limited") await expect(rateText).toBeVisible();
      else await expect(rateText).toHaveCount(0);
    });
  }

  test("AC-32: a network error on suggest shows the same fallback", async ({ page }) => {
    await fakeBackend(page, { status: "goal", suggestedGoals: null, suggest: ["abort"] });
    await page.goto("/");
    await expect(page.getByText(FALLBACK)).toBeVisible();
    await expect(radios(page)).toHaveCount(5);
  });

  test("AC-32: choosing a default card saves the server's default label", async ({ page }) => {
    const fake = await fakeBackend(page, { status: "goal", suggestedGoals: null, suggest: [suggestFailed("unknown")] });
    await page.goto("/");
    await page.getByRole("radio", { name: new RegExp(DEFAULT_GOALS.local_customers.label) }).click();
    await cont(page).click();
    await expect(saved(page)).toBeVisible();
    await expect(page.getByText(DEFAULT_GOALS.local_customers.label)).toBeVisible();
    expect(fake.log.choose).toEqual([{ sessionId: FAKE_ID, kind: "suggested", goalType: "local_customers" }]);
  });

  test("AC-33: 'Try again' calls suggest again and replaces the defaults with the suggestions", async ({ page }) => {
    const fake = await fakeBackend(page, {
      status: "goal",
      suggestedGoals: null,
      suggest: [suggestFailed("unknown"), suggestOk()],
    });
    await page.goto("/");
    await expect(page.getByText(FALLBACK)).toBeVisible();
    await page.getByRole("button", { name: "Try again" }).click();
    await expect(page.getByText("Label for inbound_leads")).toBeVisible();
    await expect(page.getByText(FALLBACK)).toHaveCount(0);
    expect(fake.log.suggest).toBe(2);
  });
});

test.describe("going back", () => {
  test("AC-31: 'Change my goal' returns to the saved cards with no new suggest request", async ({ page }) => {
    const fake = await fakeBackend(page, { status: "building", suggestedGoals: goals4(), goal: { ...SAVED_GOAL } });
    await page.goto("/");
    await expect(saved(page)).toBeVisible();
    await page.getByRole("button", { name: "Change my goal" }).click();
    await expect(radios(page)).toHaveCount(5);
    await expect(step(page)).toContainText("Your goal");
    expect(fake.log.back).toBe(1);
    expect(fake.log.suggest).toBe(0);
    expect(fake.state.goal).toBeNull();
  });

  test("AC-36: 'Use a different website' from step 2 calls the server and shows the empty form", async ({ page }) => {
    const fake = await fakeBackend(page, { status: "goal", suggestedGoals: goals4() });
    await page.goto("/");
    await expect(radios(page)).toHaveCount(5);
    await page.getByRole("button", { name: "Use a different website" }).click();
    await expect(page.getByLabel("Website URL")).toBeVisible();
    await expect(page.getByLabel("Website URL")).toHaveValue("");
    await expect(step(page)).toContainText("Your site");
    expect(fake.log.back).toBe(1);
    expect(fake.state.profile?.suggestedGoals).toBeNull();
  });

  test("AC-36: if going back fails, the screen stays on step 2 with an alert", async ({ page }) => {
    await fakeBackend(page, { status: "goal", suggestedGoals: goals4(), backFails: true });
    await page.goto("/");
    await expect(radios(page)).toHaveCount(5);
    await page.getByRole("button", { name: "Use a different website" }).click();
    await expect(page.getByText("We couldn't go back.")).toBeVisible();
    await expect(radios(page)).toHaveCount(5);
    await expect(step(page)).toContainText("Your goal");
  });
});

test("AC-37: no dead end: failed research -> describe -> Continue -> step 2", async ({ page }) => {
  const fake = await fakeBackend(page, { status: "site", suggest: [suggestOk()] });
  await mockChat(page, [streams.researchFailed(), streams.describeReply()]);
  await page.goto("/");
  await page.getByLabel("Website URL").fill("nope.example");
  await cont(page).click();

  await expect(page.getByText("We couldn't read your site.")).toBeVisible();
  await page.getByLabel("Describe your business in a sentence").fill("A bakery in Oakland that does catering");
  await cont(page).click();
  await expect(page.getByLabel("Describe your business in a sentence")).toHaveCount(0); // box leaves once saved
  await expect(cont(page)).toHaveCount(1);
  await cont(page).click();

  await expect(heading(page)).toBeVisible();
  await expect(radios(page)).toHaveCount(5);
  expect(fake.log.describe).toEqual([{ sessionId: FAKE_ID, description: "A bakery in Oakland that does catering" }]);
});

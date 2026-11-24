import { expect, test, type Page } from "@playwright/test";
import { DEFAULT_GOALS, GOAL_TYPES } from "../src/lib/goals";
import type { SuggestedGoal } from "../src/lib/goals";
import { FAKE_ID, fakeBackend, goals3, mockChat, streams, suggestFailed, suggestOk } from "./helpers";

// Milestone 3 step 1: the three-goal step. No LLM and no database: the session/goals endpoints are a stateful
// fake (see helpers.ts). Order of goals3(): get_leads (recommended), launch_product, plan_campaign.

const step = (page: Page) =>
  page.getByRole("navigation", { name: "Onboarding progress" }).locator("[aria-current=step]");
const radios = (page: Page) => page.getByRole("radiogroup", { name: "Your goal" }).getByRole("radio");
const cont = (page: Page) => page.getByRole("button", { name: "Continue" });
const heading = (page: Page) => page.getByRole("heading", { name: "What do you want to create first?" });
// After a goal is chosen the build screen (step 3) opens: its intro heading.
const saved = (page: Page) => page.getByRole("heading", { name: /^Let.s make your first / });
const FALLBACK = "We couldn't tailor suggestions, so here are the common goals.";
const SAVED_GOAL = { goalType: "plan_campaign", label: "Label for plan_campaign" } as const;
const badge = (page: Page) => page.getByText("Recommended", { exact: true });

test.describe("step state", () => {
  for (const [status, label] of [
    ["site", "Your site"],
    ["goal", "Your goal"],
    ["building", "First win"],
  ] as const) {
    test(`AC-20: status "${status}" shows the "${label}" step and a refresh resumes it`, async ({ page }) => {
      await fakeBackend(page, {
        status,
        suggestedGoals: goals3(),
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
  test("AC-42: loading status within 1s, then exactly 3 cards in a radiogroup, no custom option", async ({ page }) => {
    const fake = await fakeBackend(page, {
      status: "goal",
      suggestedGoals: null,
      suggest: [{ delayMs: 2_500, then: suggestOk() }],
    });
    await page.goto("/");
    await expect(page.getByText("Finding the best goals for Starter Bakery…")).toBeVisible({ timeout: 1_500 });
    await expect(radios(page)).toHaveCount(0); // cards are not rendered until the call resolves

    await expect(radios(page)).toHaveCount(3);
    for (const t of GOAL_TYPES) await expect(page.getByRole("radio", { name: new RegExp(`Label for ${t}`) })).toBeVisible();
    await expect(page.getByText("Something else")).toHaveCount(0);
    await expect(page.getByText("A San Francisco bakery selling to locals.")).toBeVisible(); // recap
    expect(fake.log.suggest).toBe(1);
  });

  test("AC-42: each card says where Ploy takes the user next", async ({ page }) => {
    await fakeBackend(page, { status: "goal", suggestedGoals: goals3() });
    await page.goto("/");
    await expect(radios(page).filter({ hasText: "Label for launch_product" })).toContainText("Next in Ploy: Ads");
    await expect(radios(page).filter({ hasText: "Label for get_leads" })).toContainText("Next in Ploy: Sites");
    await expect(radios(page).filter({ hasText: "Label for plan_campaign" })).toContainText("Next in Ploy: Ploybooks");
  });

  test("AC-42: the model's first goal is badged Recommended and pre-selected", async ({ page }) => {
    await fakeBackend(page, { status: "goal", suggestedGoals: goals3() });
    await page.goto("/");
    await expect(radios(page)).toHaveCount(3);
    await expect(badge(page)).toHaveCount(1);
    await expect(radios(page).first()).toContainText("Recommended");
    await expect(radios(page).first()).toHaveAttribute("aria-checked", "true");
    await expect(cont(page)).toBeEnabled(); // one click to confirm the recommendation
  });

  test("AC-43: when the first goal is a default there is no recommendation and nothing is pre-selected", async ({ page }) => {
    const firstIsDefault = goals3().map((g): SuggestedGoal => ({ ...g, source: "default" }));
    await fakeBackend(page, { status: "goal", suggestedGoals: firstIsDefault });
    await page.goto("/");
    await expect(radios(page)).toHaveCount(3);
    await expect(badge(page)).toHaveCount(0);
    for (let i = 0; i < 3; i++) await expect(radios(page).nth(i)).toHaveAttribute("aria-checked", "false");
    await expect(cont(page)).toBeDisabled();
  });

  test("AC-27: saved suggestions render with zero /api/goals/suggest requests, also after a refresh", async ({ page }) => {
    const fake = await fakeBackend(page, { status: "goal", suggestedGoals: goals3() });
    await page.goto("/");
    await expect(radios(page)).toHaveCount(3);
    await page.reload();
    await expect(radios(page)).toHaveCount(3);
    expect(fake.log.suggest).toBe(0);
  });

  test("a model + default mix renders as 3 identical cards in stored order; only the model's first is recommended", async ({ page }) => {
    await fakeBackend(page, { status: "goal", suggestedGoals: goals3(2) });
    await page.goto("/");
    await expect(radios(page)).toHaveCount(3);
    for (const [i, t] of ["get_leads", "launch_product", "plan_campaign"].entries()) {
      await expect(radios(page).nth(i)).toContainText(`Label for ${t}`);
    }
    await expect(badge(page)).toHaveCount(1);
  });

  test("AC-44: Continue confirms the recommendation, no label is sent, the end state shows the goal at step 3", async ({ page }) => {
    const fake = await fakeBackend(page, { status: "goal", suggestedGoals: goals3() });
    await page.goto("/");
    await expect(cont(page)).toBeEnabled();
    await cont(page).click();

    await expect(saved(page)).toBeVisible();
    await expect(page.getByText("Label for get_leads")).toBeVisible();
    await expect(step(page)).toContainText("First win");
    expect(fake.log.choose).toEqual([{ sessionId: FAKE_ID, kind: "suggested", goalType: "get_leads" }]);
  });

  test("AC-44: picking a different card overrides the recommendation", async ({ page }) => {
    const fake = await fakeBackend(page, { status: "goal", suggestedGoals: goals3() });
    await page.goto("/");
    await page.getByRole("radio", { name: /Label for plan_campaign/ }).click();
    await expect(radios(page).first()).toHaveAttribute("aria-checked", "false");
    await expect(page.getByRole("radio", { name: /Label for plan_campaign/ })).toHaveAttribute("aria-checked", "true");
    await cont(page).click();
    await expect(saved(page)).toBeVisible();
    await expect(page.getByText("Label for plan_campaign")).toBeVisible();
    expect(fake.log.choose).toEqual([{ sessionId: FAKE_ID, kind: "suggested", goalType: "plan_campaign" }]);
  });

  test("keyboard: arrows move and select, Enter submits", async ({ page }) => {
    const fake = await fakeBackend(page, { status: "goal", suggestedGoals: goals3() });
    await page.goto("/");
    await radios(page).first().focus();
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowDown");
    await expect(radios(page).nth(2)).toHaveAttribute("aria-checked", "true");
    await page.keyboard.press("ArrowDown"); // wraps to the first
    await expect(radios(page).first()).toHaveAttribute("aria-checked", "true");
    await page.keyboard.press("ArrowDown");
    await expect(radios(page).nth(1)).toHaveAttribute("aria-checked", "true");
    await page.keyboard.press("Enter");
    await expect(saved(page)).toBeVisible();
    expect(fake.log.choose[0]).toMatchObject({ kind: "suggested", goalType: "launch_product" });
  });

  test("a failed save shows an alert and keeps the selection", async ({ page }) => {
    await fakeBackend(page, { status: "goal", suggestedGoals: goals3(), chooseFails: true });
    await page.goto("/");
    await radios(page).nth(1).click();
    await cont(page).click();
    await expect(page.getByText("We couldn't save your goal.")).toBeVisible();
    await expect(radios(page).nth(1)).toHaveAttribute("aria-checked", "true");
    await expect(cont(page)).toBeEnabled();
    await expect(heading(page)).toBeVisible(); // still on step 2
  });
});

test.describe("failures and fallback", () => {
  for (const reason of ["rate_limited", "invalid_output", "timeout", "unknown", "no_profile"] as const) {
    test(`AC-43: suggest returning ok:false "${reason}" shows the fallback with the 3 default cards`, async ({ page }) => {
      await fakeBackend(page, { status: "goal", suggestedGoals: null, suggest: [suggestFailed(reason)] });
      await page.goto("/");
      await expect(page.getByText(FALLBACK)).toBeVisible();
      await expect(radios(page)).toHaveCount(3);
      for (const t of GOAL_TYPES) await expect(page.getByText(DEFAULT_GOALS[t].label, { exact: true })).toBeVisible();
      await expect(badge(page)).toHaveCount(0);
      await expect(cont(page)).toBeDisabled();
      await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
      const rateText = page.getByText(/free-tier AI model/);
      if (reason === "rate_limited") await expect(rateText).toBeVisible();
      else await expect(rateText).toHaveCount(0);
    });
  }

  test("AC-43: a network error on suggest shows the same fallback", async ({ page }) => {
    await fakeBackend(page, { status: "goal", suggestedGoals: null, suggest: ["abort"] });
    await page.goto("/");
    await expect(page.getByText(FALLBACK)).toBeVisible();
    await expect(radios(page)).toHaveCount(3);
  });

  test("AC-43: choosing a default card saves the server's default label", async ({ page }) => {
    const fake = await fakeBackend(page, { status: "goal", suggestedGoals: null, suggest: [suggestFailed("unknown")] });
    await page.goto("/");
    await page.getByRole("radio", { name: new RegExp(DEFAULT_GOALS.plan_campaign.label) }).click();
    await cont(page).click();
    await expect(saved(page)).toBeVisible();
    await expect(page.getByText(DEFAULT_GOALS.plan_campaign.label)).toBeVisible();
    expect(fake.log.choose).toEqual([{ sessionId: FAKE_ID, kind: "suggested", goalType: "plan_campaign" }]);
  });

  test("'Try again' calls suggest again and replaces the defaults with the suggestions", async ({ page }) => {
    const fake = await fakeBackend(page, {
      status: "goal",
      suggestedGoals: null,
      suggest: [suggestFailed("unknown"), suggestOk()],
    });
    await page.goto("/");
    await expect(page.getByText(FALLBACK)).toBeVisible();
    await page.getByRole("button", { name: "Try again" }).click();
    await expect(page.getByText("Label for get_leads")).toBeVisible();
    await expect(page.getByText(FALLBACK)).toHaveCount(0);
    await expect(badge(page)).toHaveCount(1); // the model's suggestions bring the recommendation back
    expect(fake.log.suggest).toBe(2);
  });
});

test.describe("going back", () => {
  test("'Change my goal' returns to the saved cards with no new suggest request", async ({ page }) => {
    const fake = await fakeBackend(page, { status: "building", suggestedGoals: goals3(), goal: { ...SAVED_GOAL } });
    await page.goto("/");
    await expect(saved(page)).toBeVisible();
    await page.getByRole("button", { name: "Change my goal" }).click();
    await expect(radios(page)).toHaveCount(3);
    await expect(step(page)).toContainText("Your goal");
    expect(fake.log.back).toBe(1);
    expect(fake.log.suggest).toBe(0);
    expect(fake.state.goal).toBeNull();
  });

  test("'Use a different website' from step 2 calls the server and shows the empty form", async ({ page }) => {
    const fake = await fakeBackend(page, { status: "goal", suggestedGoals: goals3() });
    await page.goto("/");
    await expect(radios(page)).toHaveCount(3);
    await page.getByRole("button", { name: "Use a different website" }).click();
    await expect(page.getByLabel("Website URL")).toBeVisible();
    await expect(page.getByLabel("Website URL")).toHaveValue("");
    await expect(step(page)).toContainText("Your site");
    expect(fake.log.back).toBe(1);
    expect(fake.state.profile?.suggestedGoals).toBeNull();
  });

  test("if going back fails, the screen stays on step 2 with an alert", async ({ page }) => {
    await fakeBackend(page, { status: "goal", suggestedGoals: goals3(), backFails: true });
    await page.goto("/");
    await expect(radios(page)).toHaveCount(3);
    await page.getByRole("button", { name: "Use a different website" }).click();
    await expect(page.getByText("We couldn't go back.")).toBeVisible();
    await expect(radios(page)).toHaveCount(3);
    await expect(step(page)).toContainText("Your goal");
  });
});

test("AC-59: no dead end: failed research -> describe -> Continue -> step 2", async ({ page }) => {
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
  await expect(radios(page)).toHaveCount(3);
  expect(fake.log.describe).toEqual([{ sessionId: FAKE_ID, description: "A bakery in Oakland that does catering" }]);
});

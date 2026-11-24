import { expect, test, type Page } from "@playwright/test";
import { GOAL_TYPES } from "../src/lib/goals";
import { db, goals3, seedSession, sessionIdOf, STARTER_PROFILE } from "./helpers";

// Milestone 2 against the real server, database and (in the last three tests) the real model and Firecrawl.
// The free model allows ~5 requests/min, so only tests tagged "llm" spend any, and each pauses 30 s afterwards.
// Everything else seeds the session in Supabase and spends zero model requests.
test.afterEach(async ({}, testInfo) => {
  if (testInfo.annotations.some((a) => a.type === "llm")) await new Promise((r) => setTimeout(r, 30_000));
});

const step = (page: Page) =>
  page.getByRole("navigation", { name: "Onboarding progress" }).locator("[aria-current=step]");
const radios = (page: Page) => page.getByRole("radiogroup", { name: "Your goal" }).getByRole("radio");
const cont = (page: Page) => page.getByRole("button", { name: "Continue" });
// After a goal is chosen the build screen (step 3) opens: its intro heading.
const saved = (page: Page) => page.getByRole("heading", { name: /^Let.s make your first / });
const countSuggest = (page: Page) => {
  const c = { n: 0 };
  page.on("request", (r) => r.url().endsWith("/api/goals/suggest") && c.n++);
  return c;
};
const one = async <T>(table: string, query: string) => (await db<T>(table, query))[0];
const eventsOf = (id: string) => db<{ name: string; props: Record<string, unknown> }>("events", `session_id=eq.${id}&select=name,props&order=id`);

test("AC-21/35: status codes and guards, through the real routes", async ({ request }) => {
  expect((await request.get("/api/sessions/not-a-uuid")).status()).toBe(400);
  expect((await request.get("/api/sessions/00000000-0000-4000-8000-000000000000")).status()).toBe(404);

  // suggest outside the goal step -> 409
  const created = await (await request.post("/api/sessions")).json();
  const id = created.sessionId as string;
  expect((await request.post("/api/goals/suggest", { data: { sessionId: id } })).status()).toBe(409);
  expect((await request.post("/api/goals/choose", { data: { sessionId: id, kind: "suggested", goalType: "get_leads" } })).status()).toBe(409);
  const state = await (await request.get(`/api/sessions/${id}`)).json();
  expect(state).toEqual({ status: "site", profile: null, goal: null, photo: null, artifact: null }); // M3 added photo and artifact
  expect(JSON.stringify(state)).not.toContain("digest");
});

test("AC-20/27/28/30: saved suggestions show with no model request; choosing saves the server's label", async ({ page }) => {
  const suggestions = goals3();
  const id = await seedSession(page, { status: "goal", profile: { ...STARTER_PROFILE, summary: "A bakery." }, suggestedGoals: suggestions });
  const suggest = countSuggest(page);

  await page.goto("/");
  await expect(radios(page)).toHaveCount(3);
  await expect(step(page)).toContainText("Your goal");
  await page.reload();
  await expect(radios(page)).toHaveCount(3);
  expect(suggest.n).toBe(0);
  expect((await eventsOf(id)).some((e) => e.name === "goals_suggested")).toBe(false);

  await expect(radios(page).first()).toHaveAttribute("aria-checked", "true"); // the recommendation is pre-selected
  await page.getByRole("radio", { name: /Label for plan_campaign/ }).click();
  await cont(page).click();
  await expect(saved(page)).toBeVisible();
  await expect(step(page)).toContainText("First win");
  await expect(page.getByRole("button", { name: "Generate" })).toBeVisible(); // the build screen waits for the user to start it

  const row = await one<Record<string, unknown>>("sessions", `id=eq.${id}&select=status,goal_type,goal_label,goal_custom_text`);
  expect(row).toEqual({ status: "building", goal_type: "plan_campaign", goal_label: "Label for plan_campaign", goal_custom_text: null });
  const ev = await eventsOf(id);
  expect(ev.find((e) => e.name === "goal_chosen")?.props).toMatchObject({ goalType: "plan_campaign", recommended: "get_leads", followed: false, source: "model" });
  expect(ev.some((e) => e.name === "step_changed" && e.props.from === "goal" && e.props.to === "building")).toBe(true);
  expect(await db("artifacts", `session_id=eq.${id}&select=id`)).toHaveLength(0); // M2 builds no page
  await page.reload();
  await expect(saved(page)).toBeVisible(); // refresh at "building" resumes the end screen
});

test("AC-44: confirming the pre-selected recommendation saves it and logs followed: true", async ({ page }) => {
  const id = await seedSession(page, { status: "goal", profile: STARTER_PROFILE, suggestedGoals: goals3() });
  await page.goto("/");
  await expect(radios(page).first()).toHaveAttribute("aria-checked", "true");
  await cont(page).click();
  await expect(saved(page)).toBeVisible();
  expect(await one("sessions", `id=eq.${id}&select=status,goal_type,goal_label`)).toEqual({
    status: "building",
    goal_type: "get_leads",
    goal_label: "Label for get_leads",
  });
  expect((await eventsOf(id)).find((e) => e.name === "goal_chosen")?.props).toMatchObject({
    goalType: "get_leads",
    recommended: "get_leads",
    followed: true,
  });
});

test("AC-31: 'Change my goal' clears the goal, keeps the cards and spends no model request", async ({ page }) => {
  const id = await seedSession(page, {
    status: "building",
    profile: STARTER_PROFILE,
    suggestedGoals: goals3(),
    goal: { goal_type: "plan_campaign", goal_label: "Label for plan_campaign" },
  });
  const suggest = countSuggest(page);
  await page.goto("/");
  await expect(saved(page)).toBeVisible();
  await page.getByRole("button", { name: "Change my goal" }).click();
  await expect(radios(page)).toHaveCount(3);
  expect(suggest.n).toBe(0);
  expect(await one("sessions", `id=eq.${id}&select=status,goal_type,goal_label,goal_custom_text`)).toEqual({
    status: "goal",
    goal_type: null,
    goal_label: null,
    goal_custom_text: null,
  });
  expect((await one<{ suggested_goals: unknown[] }>("business_profiles", `session_id=eq.${id}&select=suggested_goals`)).suggested_goals).toHaveLength(3);
});

test("AC-36: 'Use a different website' from step 2 clears the suggestions on the server", async ({ page }) => {
  const id = await seedSession(page, { status: "goal", profile: { ...STARTER_PROFILE, summary: "A bakery." }, suggestedGoals: goals3() });
  await page.goto("/");
  await expect(radios(page)).toHaveCount(3);
  await page.getByRole("button", { name: "Use a different website" }).click();
  await expect(page.getByLabel("Website URL")).toBeVisible();
  await expect(step(page)).toContainText("Your site");

  expect(await one("sessions", `id=eq.${id}&select=status`)).toEqual({ status: "site" });
  expect(await one("business_profiles", `session_id=eq.${id}&select=suggested_goals,summary`)).toEqual({ suggested_goals: null, summary: null });
  expect((await eventsOf(id)).find((e) => e.name === "step_back")?.props).toEqual({ from: "goal", to: "site" });
});

test("AC-35: choosing a goal that was not offered is rejected and changes nothing", async ({ page, request }) => {
  const id = await seedSession(page, { status: "goal", profile: STARTER_PROFILE, suggestedGoals: goals3().slice(0, 2) }); // only 2 offered
  const res = await request.post("/api/goals/choose", { data: { sessionId: id, kind: "suggested", goalType: "plan_campaign" } });
  expect(res.status()).toBe(400);
  expect(await one("sessions", `id=eq.${id}&select=status,goal_label`)).toEqual({ status: "goal", goal_label: null });
});

test("suggestions saved with a leaked JSON fragment are shown, offered again and saved clean", async ({ page, request }) => {
  const dirty = goals3().map((g) =>
    g.goalType === "launch_product" ? { ...g, reason: "Customers love visual appeal of baked goods.},{goalType:" } : g,
  );
  const id = await seedSession(page, { status: "goal", profile: { ...STARTER_PROFILE, summary: "A bakery.}," }, suggestedGoals: dirty });
  const state = (await (await request.get(`/api/sessions/${id}`)).json()) as { profile: { summary: string; suggestedGoals: { goalType: string; reason: string }[] } };
  expect(state.profile.summary).toBe("A bakery.");
  expect(state.profile.suggestedGoals.find((g) => g.goalType === "launch_product")!.reason).toBe("Customers love visual appeal of baked goods.");
  expect(JSON.stringify(state)).not.toContain("goods.},{goalType:"); // the leaked fragment is gone ("},{" alone is just two objects in an array)

  const again = (await (await request.post("/api/goals/suggest", { data: { sessionId: id } })).json()) as { source: string; goals: { reason: string }[] };
  expect(again.source).toBe("saved");
  expect(JSON.stringify(again)).not.toContain("goods.},{goalType:");

  await page.goto("/");
  await expect(page.getByText("Customers love visual appeal of baked goods.", { exact: true })).toBeVisible();
  await expect(page.getByText(/goalType/)).toHaveCount(0); // what the user sees in the card
});

// --- model tests (each spends real requests) -------------------------------------------------------------

test("AC-26: a seeded starterbakery.com profile gets exactly 3 goals from the real model (or the labeled fallback)", async ({ page }) => {
  test.info().annotations.push({ type: "llm", description: "1 model request" });
  const id = await seedSession(page, { status: "goal", profile: STARTER_PROFILE });
  await page.goto("/");
  await expect(page.getByText(/Finding the best goals for Starter Bakery/)).toBeVisible({ timeout: 2_000 });
  await expect(radios(page)).toHaveCount(3, { timeout: 35_000 });

  const failed = await page.getByText("We couldn't tailor suggestions").isVisible();
  test.info().annotations.push({ type: "result", description: failed ? "fallback (model failed)" : "model goals" });
  const ev = await eventsOf(id);
  const suggested = ev.find((e) => e.name === "goals_suggested");
  expect(suggested).toBeTruthy();
  if (failed) {
    expect(suggested!.props.ok).toBe(false);
    expect(ev.some((e) => e.name === "tool_failed")).toBe(true);
    return;
  }
  expect(suggested!.props).toMatchObject({ ok: true, source: "model" });
  expect(typeof suggested!.props.ms).toBe("number");
  expect(suggested!.props).toHaveProperty("filled");
  const row = await one<{ summary: string; suggested_goals: { goalType: string; source: string }[] }>(
    "business_profiles",
    `session_id=eq.${id}&select=summary,suggested_goals`,
  );
  expect(row.summary.length).toBeGreaterThan(10);
  expect(row.suggested_goals.map((g) => g.goalType).sort()).toEqual([...GOAL_TYPES].sort());
  expect(row.suggested_goals.every((g) => g.source === "model" || g.source === "default")).toBe(true);
});

test("AC-23: the no-website description is saved on the server", async ({ page }) => {
  test.info().annotations.push({ type: "llm", description: "1 model request" });
  const id = await seedSession(page); // empty session at step 1
  await page.goto("/");
  await expect(page.getByLabel("Website URL")).toBeEnabled();
  await page.getByRole("button", { name: "I don't have a website yet" }).click();
  await page.getByLabel("Describe your business in a sentence").fill("A bakery in Oakland that does catering");
  await cont(page).click();
  await expect(page.getByLabel("Describe your business in a sentence")).toHaveCount(0);
  await expect(cont(page)).toBeVisible({ timeout: 35_000 }); // reply streamed and description saved

  expect(await one("business_profiles", `session_id=eq.${id}&select=url,name,content,field_sources`)).toMatchObject({
    url: null,
    name: null,
    content: { description: "A bakery in Oakland that does catering" },
    field_sources: { description: "user" },
  });
  expect(await one("sessions", `id=eq.${id}&select=status`)).toEqual({ status: "goal" });
  expect((await eventsOf(id)).some((e) => e.name === "description_saved")).toBe(true);
});

test("AC-22: full run: research -> Continue -> goals -> choose -> end state", async ({ page }) => {
  test.info().annotations.push({ type: "llm", description: "2 requests for research + 1 for goals" });
  await page.goto("/");
  await expect(page.getByLabel("Website URL")).toBeEnabled();
  await page.getByLabel("Website URL").fill("starterbakery.com");
  await cont(page).click();
  await expect(page.getByRole("region", { name: /^Brand for / })).toBeVisible({ timeout: 35_000 });
  await expect(cont(page)).toBeVisible({ timeout: 35_000 }); // chat turn finished

  const id = (await sessionIdOf(page))!;
  expect(await one("sessions", `id=eq.${id}&select=status`)).toEqual({ status: "goal" }); // the server moved on...
  await expect(step(page)).toContainText("Your site"); // ...but the page waits for Continue
  expect((await eventsOf(id)).some((e) => e.name === "step_changed" && e.props.from === "site" && e.props.to === "goal")).toBe(true);

  await new Promise((r) => setTimeout(r, 20_000)); // keep both calls inside the free model's rate limit
  await cont(page).click();
  await expect(step(page)).toContainText("Your goal");
  await expect(radios(page)).toHaveCount(3, { timeout: 35_000 });

  await radios(page).first().click();
  await cont(page).click();
  await expect(saved(page)).toBeVisible();
  expect(await one("sessions", `id=eq.${id}&select=status`)).toEqual({ status: "building" });
});

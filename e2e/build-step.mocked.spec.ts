import { expect, test, type Page } from "@playwright/test";
import { PAGE, PLAYBOOK, TINY_PNG } from "../src/lib/artifact/fixtures";
import type { SessionState } from "../src/lib/goals";
import { FAKE_ID, fakeBackend, goals3, makePng } from "./helpers";

// Milestone 3 step 6: the build screen (step 3) for each goal. No LLM, no fal, no database: the session, generate, save, hand-off
// and upload endpoints are a stateful fake (see helpers.ts).
type Artifact = NonNullable<SessionState["artifact"]>;
const GET_LEADS = { goalType: "get_leads", label: "Get leads for my service" } as const;
const PLAN = { goalType: "plan_campaign", label: "Plan a marketing campaign" } as const;
const LAUNCH = { goalType: "launch_product", label: "Launch my product with a great ad" } as const;

const art = (type: Artifact["type"], content: unknown, over: Partial<Artifact> = {}): Artifact => ({
  id: "art1",
  type,
  source: "model",
  reason: null,
  content: content as Artifact["content"],
  imageUrl: null,
  saved: false,
  generations: 1,
  ...over,
});
const pageArt = (over: Partial<Artifact> = {}) => art("page", PAGE, over);
const playbookArt = (over: Partial<Artifact> = {}) => art("playbook", PLAYBOOK, over);
const AD_CARD = { kind: "ad_creative", source: "card", headline: "Fresh bread daily", accent: "#01468b" };
const adArt = (over: Partial<Artifact> = {}) => art("ad_creative", AD_CARD, { source: "card", ...over });

const open = (page: Page, goal: typeof GET_LEADS | typeof PLAN | typeof LAUNCH, extra: Parameters<typeof fakeBackend>[1] = {}) =>
  fakeBackend(page, { status: "building", goal, suggestedGoals: goals3(), ...extra });
const h1 = (page: Page, name: string | RegExp, exact = false) => page.getByRole("heading", { level: 1, name, exact });
const generate = (page: Page) => page.getByRole("button", { name: "Generate" });
const save = (page: Page) => page.getByRole("button", { name: "Save" });
const link = (page: Page) => page.getByRole("link", { name: "Continue in Ploy" });

test.describe("landing page (get_leads)", () => {
  test("intro, progress within 1s, preview, regenerate count, save, then the hand-off link", async ({ page, context }) => {
    const fake = await open(page, GET_LEADS, { generate: [{ artifact: pageArt(), delayMs: 1_500 }] });
    await context.route("https://example.com/**", (route) => route.fulfill({ body: "ok" }));
    await page.goto("/");

    await expect(h1(page, "Let's make your first landing page")).toBeVisible();
    await expect(page.getByText("Your goal: Get leads for my service")).toBeVisible();
    await generate(page).click();
    await expect(page.getByRole("status", { name: "Progress" })).toBeVisible({ timeout: 1_000 }); // feedback within a second
    await expect(page.getByText("These steps are a guide, not exact progress.")).toBeVisible();
    expect(fake.log.generate).toEqual([{ sessionId: FAKE_ID }]);

    await expect(h1(page, "Your landing page", true)).toBeVisible();
    await expect(page.getByRole("article", { name: "Landing page preview" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Regenerate (2 left)" })).toBeEnabled();
    await expect(page.getByRole("button", { name: "Change my goal" })).toBeVisible(); // still allowed before saving

    await save(page).click();
    await expect(h1(page, "Your landing page is saved")).toBeVisible();
    await expect(page.getByRole("button", { name: "Change my goal" })).toHaveCount(0); // no way back after saving
    await expect(page.getByRole("button", { name: "Start over" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Publish it with Ploy Sites" })).toBeVisible();
    await expect(link(page)).toHaveAttribute("href", "https://example.com/ploy/sites");
    await expect(link(page)).toHaveAttribute("target", "_blank");
    await expect(link(page)).toHaveAttribute("rel", /noopener/);
    await expect(link(page)).toHaveAttribute("rel", /noreferrer/);
    expect(fake.log.save).toBe(1);

    const popup = context.waitForEvent("page");
    await link(page).click();
    await (await popup).close();
    expect(fake.log.handoff).toEqual([{ sessionId: FAKE_ID }]);
  });

  test("the hand-off still opens when logging the click fails", async ({ page, context }) => {
    await open(page, GET_LEADS, { artifact: pageArt({ saved: true }) });
    await page.route("**/api/handoff", (route) => route.abort("failed")); // registered after the fake, so it wins
    await context.route("https://example.com/**", (route) => route.fulfill({ body: "ok" }));
    await page.goto("/");
    const popup = context.waitForEvent("page");
    await link(page).click();
    expect((await popup).url()).toContain("example.com/ploy/sites");
  });
});

test.describe("campaign playbook (plan_campaign)", () => {
  test("generate, preview, save, and the Ploybooks hand-off", async ({ page }) => {
    await open(page, PLAN, { generate: [{ artifact: playbookArt() }] });
    await page.goto("/");
    await expect(h1(page, "Let's make your first campaign playbook")).toBeVisible();
    await generate(page).click();
    await expect(h1(page, "Your campaign playbook", true)).toBeVisible();
    await expect(page.getByRole("article", { name: "Campaign playbook" })).toBeVisible();
    await expect(page.getByRole("list", { name: "Tasks" }).getByRole("listitem")).toHaveCount(5);
    await save(page).click();
    await expect(h1(page, "Your campaign playbook is saved")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Save it as a Ploybook" })).toBeVisible();
    await expect(link(page)).toHaveAttribute("href", "https://example.com/ploy/ploybooks");
  });
});

test.describe("progress, tries and notes", () => {
  test("the progress steps are a light time-based guide: they advance and hold on the last one", async ({ page }) => {
    await page.clock.install();
    await open(page, GET_LEADS, { generate: [{ artifact: pageArt(), delayMs: 4_000 }] });
    await page.goto("/");
    await generate(page).click();
    const current = page.getByRole("status", { name: "Progress" }).locator('[aria-current="step"]'); // not the onboarding bar at the top
    await expect(current).toContainText("Reading your site");
    await page.clock.fastForward(15_000);
    await expect(current).toContainText("Writing the copy");
    await page.clock.fastForward(30_000);
    await expect(current).toContainText("Checking the page"); // holds on the last step
  });

  test("Regenerate counts down and is disabled when the three tries are used; Save still works", async ({ page }) => {
    const fake = await open(page, GET_LEADS, { artifact: pageArt({ generations: 1 }), generate: [{ artifact: pageArt() }] });
    await page.goto("/");
    await expect(page.getByRole("button", { name: "Regenerate (2 left)" })).toBeEnabled();
    await page.getByRole("button", { name: "Regenerate (2 left)" }).click();
    await expect(page.getByRole("button", { name: "Regenerate (1 left)" })).toBeVisible();
    expect(fake.log.generate).toHaveLength(1);

    await page.getByRole("button", { name: "Regenerate (1 left)" }).click();
    await expect(page.getByRole("button", { name: "Regenerate (0 left)" })).toBeDisabled();
    await expect(save(page)).toBeEnabled();
  });

  test("a standard version is explained: rate limit, timeout, a text-only card, and nothing when all went well", async ({ page }) => {
    const cases: [Artifact, RegExp | null][] = [
      [pageArt({ source: "fallback", reason: "rate_limited" }), /free-tier AI model/],
      [pageArt({ source: "fallback", reason: "timeout" }), /took too long/],
      [pageArt({ source: "fallback", reason: "invalid_output" }), /couldn't use the AI's answer/],
      [adArt({ reason: "billing" }), /text-only card/],
      [adArt({ reason: "not_configured" }), /isn't set up yet/],
      [pageArt(), null],
      [adArt({ reason: null }), null], // the user simply skipped the photo: nothing went wrong
    ];
    for (const [artifact, note] of cases) {
      const goal = artifact.type === "ad_creative" ? LAUNCH : GET_LEADS;
      const p = await page.context().newPage();
      await open(p, goal, { artifact });
      await p.goto("/");
      await expect(save(p)).toBeVisible();
      if (note) await expect(p.getByRole("status").filter({ hasText: note })).toBeVisible();
      else await expect(p.getByRole("status")).toHaveCount(0);
      await p.close();
    }
  });
});

test.describe("errors never dead-end", () => {
  test("all three tries used: a clear message; a network failure: retry stays available", async ({ page }) => {
    await open(page, GET_LEADS, { generate: [{ status: 409, error: "limit" }, "abort"] });
    await page.goto("/");
    await generate(page).click();
    await expect(page.getByRole("alert").filter({ hasText: "used all three tries" })).toBeVisible();
    await generate(page).click();
    await expect(page.getByRole("alert").filter({ hasText: "couldn't reach the server" })).toBeVisible();
    await expect(generate(page)).toBeEnabled();
  });

  test("another generation is already running (a reload): the screen waits and shows its result", async ({ page }) => {
    const fake = await open(page, GET_LEADS, { generate: [{ status: 409, error: "busy" }] });
    await page.goto("/");
    await generate(page).click();
    await expect(page.getByRole("status", { name: "Progress" })).toBeVisible();
    setTimeout(() => (fake.state.artifact = pageArt()), 500); // the other generation finishes
    await expect(h1(page, "Your landing page", true)).toBeVisible({ timeout: 15_000 }); // found by polling the state
  });

  test("saving can fail and be retried", async ({ page }) => {
    await open(page, GET_LEADS, { artifact: pageArt(), saveFails: true });
    await page.goto("/");
    await save(page).click();
    await expect(page.getByText("We couldn't save it.")).toBeVisible();
    await expect(save(page)).toBeEnabled();
  });
});

test.describe("going back and resuming", () => {
  test("'Change my goal' before saving returns to the goal cards and the server drops the draft and the photo", async ({ page }) => {
    const fake = await open(page, LAUNCH, { artifact: adArt(), photo: { bytes: 40_960 } });
    await page.goto("/");
    await page.getByRole("button", { name: "Change my goal" }).click();
    await expect(page.getByRole("heading", { name: "What do you want to create first?" })).toBeVisible();
    expect(fake.log.back).toBe(1);
    expect(fake.state.artifact).toBeNull();
    expect(fake.state.photo).toBeNull();
  });

  test("a refresh resumes each state: nothing yet, a draft, a saved artifact", async ({ page }) => {
    await open(page, GET_LEADS);
    await page.goto("/");
    await expect(h1(page, "Let's make your first landing page")).toBeVisible();

    const draft = await page.context().newPage();
    await open(draft, GET_LEADS, { artifact: pageArt() });
    await draft.goto("/");
    await expect(h1(draft, "Your landing page", true)).toBeVisible();
    await draft.reload();
    await expect(save(draft)).toBeVisible();

    const done = await page.context().newPage();
    await open(done, GET_LEADS, { artifact: pageArt({ saved: true }) });
    await done.goto("/");
    await expect(h1(done, "Your landing page is saved")).toBeVisible();
    await done.reload();
    await expect(link(done)).toBeVisible();
  });

  test("'Start over' after saving begins a new session", async ({ page }) => {
    const NEW_ID = "33333333-3333-4333-8333-333333333333";
    let posts = 0;
    await page.route("**/api/sessions", (route) => {
      if (route.request().method() !== "POST") return route.fallback();
      posts++;
      return route.fulfill({ json: { sessionId: NEW_ID } });
    });
    const fake = await open(page, GET_LEADS, { artifact: pageArt({ saved: true }) });
    await page.goto("/");
    await expect(h1(page, "Your landing page is saved")).toBeVisible();
    Object.assign(fake.state, { status: "site", goal: null, artifact: null, photo: null }); // what the new session looks like
    await page.getByRole("button", { name: "Start over" }).click();
    await expect(page.getByLabel("Website URL")).toBeVisible();
    expect(posts).toBe(1);
    expect(await page.evaluate(() => localStorage.getItem("ftu_session_id"))).toBe(NEW_ID);
  });
});

test.describe("ad (launch_product)", () => {
  test("the intro asks for a photo and an optional headline, and Generate waits for a photo", async ({ page }) => {
    await open(page, LAUNCH);
    await page.goto("/");
    await expect(h1(page, "Let's make your first ad")).toBeVisible();
    await expect(page.getByLabel("Product photo")).toBeVisible();
    await expect(page.getByText("Your photo is sent to an image service (fal) to make the ad.")).toBeVisible();
    await expect(page.getByLabel("Headline (optional)")).toBeVisible();
    await expect(page.getByText("We never add an offer you didn't write.")).toBeVisible();
    await expect(generate(page)).toBeDisabled();
    await expect(page.getByRole("button", { name: "Skip the photo" })).toBeEnabled();
  });

  test("a photo is shrunk and uploaded, then the ad is made with the user's own headline", async ({ page }) => {
    const fake = await open(page, LAUNCH, {
      generate: [{ artifact: adArt({ source: "fal", imageUrl: TINY_PNG, content: { ...AD_CARD, source: "fal", headline: "Holiday   sale" } as Artifact["content"] }) }],
    });
    await page.goto("/");
    await page.getByLabel("Product photo").setInputFiles({ name: "product.png", mimeType: "image/png", buffer: makePng(64) });
    await expect(page.getByText("Photo uploaded")).toBeVisible();
    await expect(page.getByRole("img", { name: "Your product photo" })).toBeVisible();
    expect(fake.log.upload).toBe(1);
    await expect(page.getByRole("button", { name: "Skip the photo" })).toHaveCount(0); // a photo is there now
    await expect(generate(page)).toBeEnabled();

    await page.getByLabel("Headline (optional)").fill("  Holiday   sale ");
    await generate(page).click();
    await expect(h1(page, "Your ad", true)).toBeVisible();
    expect(fake.log.generate).toEqual([{ sessionId: FAKE_ID, headline: "Holiday   sale" }]); // trimmed, otherwise as typed
    await expect(page.getByRole("img", { name: /Ad for / })).toBeVisible(); // the generated image
    await expect(page.getByRole("status")).toHaveCount(0); // nothing went wrong
  });

  test("'Skip the photo' makes the text-only card, with no photo and no headline sent", async ({ page }) => {
    const fake = await open(page, LAUNCH, { generate: [{ artifact: adArt() }] });
    await page.goto("/");
    await page.getByRole("button", { name: "Skip the photo" }).click();
    await expect(h1(page, "Your ad", true)).toBeVisible();
    expect(fake.log.generate).toEqual([{ sessionId: FAKE_ID }]);
    expect(fake.log.upload).toBe(0);
    await expect(page.getByTestId("ad-card-text")).toContainText("Fresh bread daily");
  });

  test("an unreadable file is refused in the browser; the server's refusals show plain messages", async ({ page }) => {
    const fake = await open(page, LAUNCH);
    await page.goto("/");
    await page.getByLabel("Product photo").setInputFiles({ name: "a.jpg", mimeType: "image/jpeg", buffer: Buffer.from("this is not an image") });
    await expect(page.getByRole("alert").filter({ hasText: "JPEG, PNG or WebP" })).toBeVisible();
    expect(fake.log.upload).toBe(0); // never sent
    await expect(generate(page)).toBeDisabled();

    const big = await page.context().newPage();
    await open(big, LAUNCH, { uploadFails: { status: 413, error: "too_large" } });
    await big.goto("/");
    await big.getByLabel("Product photo").setInputFiles({ name: "p.png", mimeType: "image/png", buffer: makePng(32) });
    await expect(big.getByRole("alert").filter({ hasText: "too large" })).toBeVisible();

    const odd = await page.context().newPage();
    await open(odd, LAUNCH, { uploadFails: { status: 400, error: "unsupported_type" } });
    await odd.goto("/");
    await odd.getByLabel("Product photo").setInputFiles({ name: "p.png", mimeType: "image/png", buffer: makePng(32) });
    await expect(odd.getByRole("alert").filter({ hasText: "JPEG, PNG or WebP" })).toBeVisible();
  });
});

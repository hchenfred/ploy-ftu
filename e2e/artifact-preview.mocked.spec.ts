import { expect, test, type Page } from "@playwright/test";
import { HOSTILE, LONG_WORD } from "../src/lib/artifact/fixtures";

// Milestone 3 step 3: the three preview components, rendered on a development-only fixtures page (no backend, no model).
// That page is a 404 in a production build, so these tests only run against the local dev server.
test.skip(!!process.env.E2E_BASE_URL, "the fixtures page exists only in development");

const open = async (page: Page, id: string) => {
  const errors: string[] = [];
  const dialogs: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("dialog", (d) => {
    dialogs.push(d.message());
    void d.dismiss();
  });
  await page.goto("/dev/artifact-fixtures");
  const box = page.getByTestId(id);
  await expect(box).toBeVisible();
  return { box, errors, dialogs };
};
const pwned = (page: Page) => page.evaluate(() => (window as unknown as { __pwned?: unknown }).__pwned);

test.describe("landing page preview", () => {
  test("shows hero, three benefits, about and the quote section, with an inert call to action", async ({ page }) => {
    const { box } = await open(page, "page-normal");
    const preview = box.getByRole("article", { name: "Landing page preview" });
    await expect(preview.getByRole("heading", { name: "Fresh sourdough for East Bay cafes" })).toBeVisible();
    await expect(preview.getByText("Baked every morning and delivered before you open.")).toBeVisible();
    await expect(preview.getByRole("list", { name: "Benefits" }).getByRole("listitem")).toHaveCount(3);
    await expect(preview.getByRole("heading", { name: "About Starter Bakery" })).toBeVisible();
    await expect(preview.getByRole("heading", { name: "Request a wholesale quote" })).toBeVisible();
    await expect(preview.getByText("Request a quote", { exact: true })).toBeVisible(); // the call to action text
    await expect(preview.getByText("Preview only. Nothing is sent.")).toBeVisible();
    // inert: nothing in the preview is a link, a button, a form or an input
    await expect(preview.locator("a, button, form, input, textarea, select")).toHaveCount(0);
    // no logo, so the letter avatar is shown
    await expect(preview.getByTestId("brand-letter")).toHaveText("S");
  });

  test("the call to action uses the brand accent color", async ({ page }) => {
    const { box } = await open(page, "page-normal");
    const cta = box.getByText("Request a quote", { exact: true });
    await expect(cta).toHaveCSS("background-color", "rgb(1, 70, 139)"); // #01468b
    await expect(cta).toHaveCSS("color", "rgb(255, 255, 255)");
  });

  test("a partial object (a stream mid-way) renders only what has arrived, never 'undefined'", async ({ page }) => {
    const { box } = await open(page, "page-partial");
    await expect(box.getByRole("heading", { name: "Fresh sourdough for East Bay" })).toBeVisible();
    await expect(box.getByRole("list", { name: "Benefits" }).getByRole("listitem")).toHaveCount(1);
    await expect(box.getByRole("heading", { name: "Baked daily" })).toBeVisible();
    await expect(box.getByLabel("About")).toHaveCount(0);
    await expect(box.getByLabel("Quote request")).toHaveCount(0);
    expect(await box.innerText()).not.toMatch(/undefined|null|NaN/);
  });

  test("an empty object shows a skeleton inside the frame, not a blank page", async ({ page }) => {
    const { box } = await open(page, "page-empty");
    await expect(box.getByRole("article", { name: "Landing page preview" })).toBeVisible();
    await expect(box.getByTestId("skeleton")).toBeVisible();
    await expect(box.getByTestId("brand-letter")).toHaveText("E"); // no name: the domain's first letter
    expect(await box.innerText()).not.toMatch(/undefined|null|NaN/);
  });
});

test.describe("campaign playbook", () => {
  test("shows the title, objective, audience, five ordered tasks and the success metric", async ({ page }) => {
    const { box } = await open(page, "playbook-normal");
    await expect(box.getByRole("heading", { name: "Spring wholesale launch" })).toBeVisible();
    await expect(box.getByText("Get 20 new wholesale cafes talking to us.")).toBeVisible();
    await expect(box.getByText("Cafe owners in the Bay Area")).toBeVisible();
    const tasks = box.getByRole("list", { name: "Tasks" }).getByRole("listitem");
    await expect(tasks).toHaveCount(5);
    await expect(tasks.first()).toContainText("List 50 cafes");
    await expect(tasks.first()).toContainText("Week 1");
    await expect(box.getByLabel("Success metric")).toContainText("Qualified replies");
    await expect(box.getByLabel("Success metric")).toContainText("Aim for 20 replies");
    await expect(box.locator("a, button, form, input")).toHaveCount(0);
  });

  test("a partial object renders only what has arrived; an empty one shows a skeleton", async ({ page }) => {
    const partial = await open(page, "playbook-partial");
    await expect(partial.box.getByRole("heading", { name: "Spring wholesale launch" })).toBeVisible();
    await expect(partial.box.getByRole("list", { name: "Tasks" }).getByRole("listitem")).toHaveCount(1);
    await expect(partial.box.getByLabel("Success metric")).toHaveCount(0);
    expect(await partial.box.innerText()).not.toMatch(/undefined|null|NaN/);

    const empty = page.getByTestId("playbook-empty");
    await expect(empty.getByRole("article", { name: "Campaign playbook" })).toBeVisible();
    await expect(empty.getByTestId("skeleton")).toBeVisible();
  });
});

test.describe("ad creative", () => {
  test("the text-only card shows the headline and business name on the brand accent", async ({ page }) => {
    const { box } = await open(page, "ad-card-normal");
    const card = box.getByTestId("ad-card-text");
    await expect(card).toContainText("Fresh bread daily");
    await expect(card).toContainText("Starter Bakery");
    await expect(card).toHaveCSS("background-color", "rgb(1, 70, 139)");
    await expect(card.getByTestId("brand-letter")).toHaveText("S");
  });

  test("no headline falls back to the business name, never a blank card", async ({ page }) => {
    const { box } = await open(page, "ad-card-no-headline");
    await expect(box.getByTestId("ad-card-text").getByText("Starter Bakery", { exact: true }).first()).toBeVisible();
    expect((await box.innerText()).trim().length).toBeGreaterThan(0);
  });

  test("an invalid accent never reaches a style: the card uses the ink color", async ({ page }) => {
    const { box } = await open(page, "ad-card-bad-accent");
    await expect(box.getByTestId("ad-card-text")).toHaveCSS("background-color", "rgb(20, 20, 20)"); // #141414
    const style = await box.getByTestId("ad-card-text").getAttribute("style");
    expect(style ?? "").not.toMatch(/evil|url\(/i);
  });

  test("a generated image is shown with descriptive alt text; a broken image falls back to the text card", async ({ page }) => {
    const ok = await open(page, "ad-image");
    const img = ok.box.getByRole("img", { name: /Ad for Starter Bakery: Fresh bread daily/ });
    await expect(img).toBeVisible();
    await expect(ok.box.getByTestId("ad-card-text")).toHaveCount(0);

    const broken = page.getByTestId("ad-image-broken");
    await expect(broken.getByTestId("ad-card-text")).toBeVisible(); // the image failed, the card replaced it
    await expect(broken.getByRole("img")).toHaveCount(0);
  });
});

test.describe("hostile and oversized content is inert", () => {
  for (const id of ["page-hostile", "playbook-hostile", "ad-card-hostile"]) {
    test(`${id}: shown as plain text, nothing executes, no markup or links appear`, async ({ page }) => {
      const { box, errors, dialogs } = await open(page, id);
      // the markup is on screen as literal text
      await expect(box).toContainText("<script>window.__pwned=2</script>");
      await expect(box).toContainText('<img src=x onerror="window.__pwned=1">');
      await expect(box).toContainText("javascript:window.__pwned=3");
      // and none of it became an element, a handler, a link or a script
      await expect(box.locator("script, iframe, object, embed, style, link")).toHaveCount(0);
      await expect(box.locator("[onerror], [onclick], [onload]")).toHaveCount(0);
      await expect(box.locator("a")).toHaveCount(0);
      await expect(box.locator("img[src='x']")).toHaveCount(0);
      await page.waitForTimeout(300); // give any injected handler a chance to fire
      expect(await pwned(page)).toBeUndefined();
      expect(dialogs).toEqual([]);
      expect(errors).toEqual([]);
    });
  }

  test("a scraped logo that is not an https URL is ignored: the letter avatar is used", async ({ page }) => {
    const { box } = await open(page, "ad-card-hostile");
    await expect(box.locator("img")).toHaveCount(0); // `javascript:` logo never becomes an <img>
    await expect(box.getByTestId("brand-letter")).toBeVisible();
    const hostilePage = page.getByTestId("page-hostile");
    await expect(hostilePage.locator("img")).toHaveCount(0);
  });

  test("a 240-character word wraps instead of widening the layout", async ({ page }) => {
    await open(page, "page-hostile");
    for (const id of ["page-hostile", "playbook-hostile", "ad-card-hostile"]) {
      const el = page.getByTestId(id);
      await expect(el).toContainText(LONG_WORD.slice(0, 40));
      const overflow = await el.evaluate((node) => node.scrollWidth - node.clientWidth);
      expect(overflow, id).toBeLessThanOrEqual(1);
    }
    const doc = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(doc).toBeLessThanOrEqual(1); // no sideways scroll on the page
    void HOSTILE;
  });
});

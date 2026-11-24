import { createServer, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { expect, test, type Page } from "@playwright/test";
import { goals3, fakeBackend } from "./helpers";

// Incremental rendering: a model that streams in small pieces must show each piece as it arrives, not everything at the end.
// The stub server holds the response open and the TEST decides when each piece is written, so there are no timing races.
// (route.fulfill cannot do this: it sends the whole body at once.)
let server: Server;
let port = 0;
let open: ServerResponse | null = null;

// The stub is a plain-http local server, and a browser on an https page cannot be redirected to it: these run against localhost only.
test.skip(!!process.env.E2E_BASE_URL?.startsWith("https:"), "needs a local http stub server");

test.beforeAll(async () => {
  server = createServer((req, res) => {
    const chat = req.url?.includes("/api/chat");
    res.writeHead(200, {
      "content-type": chat ? "text/event-stream" : "text/plain; charset=utf-8",
      ...(chat ? { "x-vercel-ai-ui-message-stream": "v1" } : {}),
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "*",
      "cache-control": "no-cache",
    });
    if (req.method === "OPTIONS") return res.end();
    req.resume();
    open = res;
    res.flushHeaders();
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  port = (server.address() as AddressInfo).port;
});
test.afterAll(() => {
  server.closeAllConnections();
  server.close();
});

const sse = (o: unknown) => open!.write(`data: ${typeof o === "string" ? o : JSON.stringify(o)}\n\n`);
const text = (chunk: string) => open!.write(chunk);
const held = () => expect.poll(() => open !== null).toBe(true); // the request has reached the stub

const via = (page: Page, glob: string, path: string) =>
  page.route(glob, (route) => route.continue({ url: `http://127.0.0.1:${port}${path}` }));

test.beforeEach(() => {
  open = null;
});

test("page generation: the preview fills in piece by piece while the model is still writing", async ({ page }) => {
  await fakeBackend(page, {
    status: "building",
    goal: { goalType: "get_leads", label: "Get leads for my service" },
    suggestedGoals: goals3(),
  });
  await via(page, "**/api/artifact/generate", "/api/artifact/generate"); // registered last, so it wins over the fake
  await page.goto("/");
  await page.getByRole("button", { name: "Generate" }).click();
  await held();

  const preview = page.getByRole("article", { name: "Landing page preview" });
  const progress = page.getByRole("status", { name: "Progress" });
  await expect(progress).toBeVisible();
  await expect(preview).toHaveCount(0); // nothing has arrived yet

  // piece 1: the middle of the first field. A half-finished headline already shows.
  text('{"hero":{"headline":"Fresh sourdough for East');
  await expect(preview.getByRole("heading", { name: "Fresh sourdough for East" })).toBeVisible();

  // piece 2: the hero finishes and the first benefit starts. Later sections are still absent.
  text(' Bay cafes","subhead":"Baked every morning.","cta":"Request a quote"},"benefits":[{"title":"Baked daily","text":"Every loaf');
  await expect(preview.getByRole("heading", { name: "Fresh sourdough for East Bay cafes" })).toBeVisible();
  await expect(preview.getByText("Baked every morning.")).toBeVisible();
  await expect(preview.getByRole("heading", { name: "Baked daily" })).toBeVisible();
  await expect(preview.getByText("Reliable delivery")).toHaveCount(0);
  await expect(preview.getByText("About Starter Bakery")).toHaveCount(0);

  // piece 3: the second benefit arrives; the first one is still there (nothing flickers away).
  text(' is baked fresh."},{"title":"Reliable delivery","text":"Before opening."}');
  await expect(preview.getByRole("heading", { name: "Reliable delivery" })).toBeVisible();
  await expect(preview.getByRole("heading", { name: "Baked daily" })).toBeVisible();

  // all along it was one request that never finished: the progress card stayed up
  await expect(progress).toBeVisible();
});

test("step 1 text: the summary shows as it arrives, and Continue waits for the end of the reply", async ({ page }) => {
  await fakeBackend(page, { status: "site" });
  await via(page, "**/api/chat", "/api/chat");
  await page.goto("/");
  await page.getByRole("button", { name: "I don't have a website yet" }).click();
  await page.getByLabel("Describe your business in a sentence").fill("A bakery in Oakland that does catering");
  await page.getByRole("button", { name: "Continue" }).click();
  await held();

  sse({ type: "start" });
  sse({ type: "start-step" });
  sse({ type: "text-start", id: "t" });
  sse({ type: "text-delta", id: "t", delta: "A bakery in " });
  await expect(page.getByText("A bakery in Oakland that does catering.", { exact: false })).toHaveCount(0);
  await expect(page.getByText(/^A bakery in\s*$/)).toBeVisible(); // the first piece is on screen
  await expect(page.getByText("Thinking…")).toHaveCount(0); // text has started, so the loading line is gone
  await expect(page.getByRole("button", { name: "Continue" })).toHaveCount(0); // still streaming

  sse({ type: "text-delta", id: "t", delta: "Oakland that does catering." });
  await expect(page.getByText("A bakery in Oakland that does catering.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Continue" })).toHaveCount(0); // the reply is not finished yet

  sse({ type: "text-end", id: "t" });
  sse({ type: "finish-step" });
  sse({ type: "finish", finishReason: "stop" });
  sse("[DONE]");
  open!.end();
  await expect(page.getByRole("button", { name: "Continue" })).toBeVisible();
});

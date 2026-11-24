import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { expect, test, type Page } from "@playwright/test";
import { fakeBackend } from "./helpers";

// Step 1 with a REASONING model: it thinks silently (the chat request is "streaming" but nothing visible has arrived) before it
// calls the research tool and again before it writes its summary. A stub server that streams slowly reproduces that, because a
// normal route.fulfill sends the whole body at once. There must be a loading line during both pauses.
let server: Server;
let port = 0;
let script: (send: (o: unknown) => void, later: (ms: number, fn: () => void) => void, end: () => void) => void;

// The stub is a plain-http local server, and a browser on an https page cannot be redirected to it: these run against localhost only.
test.skip(!!process.env.E2E_BASE_URL?.startsWith("https:"), "needs a local http stub server");

test.beforeAll(async () => {
  server = createServer((req, res) => {
    res.writeHead(200, {
      "content-type": "text/event-stream",
      "x-vercel-ai-ui-message-stream": "v1",
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "*",
      "cache-control": "no-cache",
    });
    if (req.method === "OPTIONS") return res.end();
    req.resume();
    const send = (o: unknown) => res.write(`data: ${typeof o === "string" ? o : JSON.stringify(o)}\n\n`);
    script(send, (ms, fn) => void setTimeout(fn, ms), () => {
      send("[DONE]");
      res.end();
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  port = (server.address() as AddressInfo).port;
});
test.afterAll(() => {
  server.closeAllConnections();
  server.close();
});

const useStub = async (page: Page) => {
  await fakeBackend(page, { status: "site" });
  await page.route("**/api/onboarding", (route) => route.continue({ url: `http://127.0.0.1:${port}/api/onboarding` }));
};
const thinking = (send: (o: unknown) => void, id: string) => {
  send({ type: "reasoning-start", id });
  send({ type: "reasoning-delta", id, delta: "Let me think about this..." });
};

test("a website: 'Reading…' stays up while the model thinks, then 'Summarizing…' while it thinks again, then the summary", async ({ page }) => {
  script = (send, later, end) => {
    send({ type: "start" });
    send({ type: "start-step" });
    thinking(send, "r1"); // silent reasoning: the request is streaming but nothing is visible
    later(2_000, () => {
      send({ type: "reasoning-end", id: "r1" });
      send({ type: "tool-input-available", toolCallId: "c1", toolName: "researchSite", input: { url: "starterbakery.com" } });
      send({
        type: "tool-output-available",
        toolCallId: "c1",
        output: { ok: true, domain: "starterbakery.com", brand: { name: "Starter Bakery", logoUrl: null, colors: ["#01468B"], fonts: [] }, contentDigest: "x" },
      });
      send({ type: "finish-step" });
      send({ type: "start-step" });
      thinking(send, "r2"); // silent again, before the summary
    });
    later(4_500, () => {
      send({ type: "reasoning-end", id: "r2" });
      send({ type: "text-start", id: "t" });
      send({ type: "text-delta", id: "t", delta: "Starter Bakery is a neighborhood bakery." });
      send({ type: "text-end", id: "t" });
      send({ type: "finish-step" });
      send({ type: "finish", finishReason: "stop" });
      end();
    });
  };
  await useStub(page);
  await page.goto("/");
  await page.getByLabel("Website URL").fill("starterbakery.com");
  await page.getByRole("button", { name: "Continue" }).click();

  // first pause: the model is reasoning, nothing visible has arrived, yet there is a loading line
  await expect(page.getByText("Reading starterbakery.com…")).toBeVisible();
  await page.waitForTimeout(1_200); // well into the silent period (the request has long left "submitted")
  await expect(page.getByText("Reading starterbakery.com…")).toBeVisible();
  await expect(page.getByRole("region", { name: /^Brand for / })).toHaveCount(0);

  // the research result arrives: the card appears, and a new loading line covers the second pause
  await expect(page.getByRole("region", { name: "Brand for Starter Bakery" })).toBeVisible({ timeout: 5_000 });
  await expect(page.getByText("Summarizing what we found…")).toBeVisible();
  await expect(page.getByText("Reading starterbakery.com…")).toHaveCount(0);
  await expect(page.getByText("Starter Bakery is a neighborhood bakery.")).toHaveCount(0);

  // the summary arrives: the loading line goes and Continue is offered
  await expect(page.getByText("Starter Bakery is a neighborhood bakery.")).toBeVisible({ timeout: 6_000 });
  await expect(page.getByText("Summarizing what we found…")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Continue" })).toBeVisible();
});

test("no website: 'Thinking…' stays up while the model thinks before its reply", async ({ page }) => {
  script = (send, later, end) => {
    send({ type: "start" });
    send({ type: "start-step" });
    thinking(send, "r1");
    later(2_500, () => {
      send({ type: "reasoning-end", id: "r1" });
      send({ type: "text-start", id: "t" });
      send({ type: "text-delta", id: "t", delta: "A bakery in Oakland that does catering." });
      send({ type: "text-end", id: "t" });
      send({ type: "finish-step" });
      send({ type: "finish", finishReason: "stop" });
      end();
    });
  };
  await useStub(page);
  await page.goto("/");
  await page.getByRole("button", { name: "I don't have a website yet" }).click();
  await page.getByLabel("Describe your business in a sentence").fill("A bakery in Oakland that does catering");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByText("Thinking…")).toBeVisible();
  await page.waitForTimeout(1_200);
  await expect(page.getByText("Thinking…")).toBeVisible(); // still shown, although the request is streaming
  await expect(page.getByText("A bakery in Oakland that does catering.")).toBeVisible({ timeout: 6_000 });
  await expect(page.getByText("Thinking…")).toHaveCount(0);
});

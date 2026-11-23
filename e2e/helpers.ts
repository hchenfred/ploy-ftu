import type { Page } from "@playwright/test";

// --- Mocked /api/chat: UI message stream (SSE) in the AI SDK v7 wire format -------------------

type Chunk = Record<string, unknown>;

function sse(chunks: Chunk[]): string {
  return [...chunks, "[DONE]"]
    .map((c) => `data: ${typeof c === "string" ? c : JSON.stringify(c)}\n\n`)
    .join("");
}

const HEADERS = { "content-type": "text/event-stream", "x-vercel-ai-ui-message-stream": "v1" };

const text = (id: string, t: string): Chunk[] => [
  { type: "text-start", id },
  { type: "text-delta", id, delta: t },
  { type: "text-end", id },
];

export const streams = {
  brandOk: (domain = "starterbakery.com") =>
    sse([
      { type: "start" },
      { type: "start-step" },
      { type: "tool-input-available", toolCallId: "c1", toolName: "researchSite", input: { url: domain } },
      {
        type: "tool-output-available",
        toolCallId: "c1",
        output: {
          ok: true,
          domain,
          brand: { name: "Starter Bakery", logoUrl: null, colors: ["#01468B", "#D02E2E"], fonts: ["Helvetica"] },
          contentDigest: "…",
        },
      },
      { type: "finish-step" },
      { type: "start-step" },
      ...text("t1", "Starter Bakery is a neighborhood bakery selling bread to local customers."),
      { type: "finish-step" },
      { type: "finish", finishReason: "stop" },
    ]),
  researchFailed: () =>
    sse([
      { type: "start" },
      { type: "start-step" },
      { type: "tool-input-available", toolCallId: "c2", toolName: "researchSite", input: { url: "nope.example" } },
      { type: "tool-output-available", toolCallId: "c2", output: { ok: false, reason: "unknown" } },
      { type: "finish-step" },
      { type: "start-step" },
      ...text("t2", "Sorry about that. Could you describe your business in one sentence?"),
      { type: "finish-step" },
      { type: "finish", finishReason: "stop" },
    ]),
  describeReply: () =>
    sse([
      { type: "start" },
      { type: "start-step" },
      ...text("t3", "A bakery in Oakland that sells to local event hosts."),
      { type: "finish-step" },
      { type: "finish", finishReason: "stop" },
    ]),
  error: (message: string) => sse([{ type: "start" }, { type: "error", errorText: message }]),
};

/** Mock /api/chat. Each call returns the next body; every request body is recorded. */
export async function mockChat(page: Page, bodies: string[], delayMs = 0) {
  const requests: Record<string, unknown>[] = [];
  let i = 0;
  await page.route("**/api/chat", async (route) => {
    requests.push(route.request().postDataJSON());
    if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
    await route.fulfill({ status: 200, headers: HEADERS, body: bodies[Math.min(i++, bodies.length - 1)] });
  });
  return requests;
}

// --- Supabase REST (live tests): read rows with the service role key ---------------------------

export async function db<T = Record<string, unknown>>(table: string, query: string): Promise<T[]> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing (.env.local)");
  const res = await fetch(`${url}/rest/v1/${table}?${query}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  if (!res.ok) throw new Error(`Supabase ${table}: ${res.status} ${await res.text()}`);
  return res.json();
}

export const sessionIdOf = (page: Page) => page.evaluate(() => localStorage.getItem("ftu_session_id"));

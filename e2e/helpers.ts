import { crc32, deflateSync } from "node:zlib";
import type { Page } from "@playwright/test";
import { DEFAULT_GOALS } from "../src/lib/goals";
import type { GoalType, SessionState, SuggestedGoal, SuggestGoalsResponse } from "../src/lib/goals";

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

// --- Milestone 2: a small stateful fake of the session/goals endpoints (mocked suite, no LLM) -----------------
// It mirrors the server's rules (labels looked up server-side, back clears downstream, 409s) so a flow like
// "choose -> refresh state -> end screen" behaves as it does for real, within one test. The real server rules
// are covered by the live suite.


export const FAKE_ID = "11111111-1111-4111-8111-111111111111";

/** Three goals, one per type, best fit first (the first is the recommendation). The last `filled` are default-filled. */
export function goals3(filled = 0): SuggestedGoal[] {
  const order: GoalType[] = ["get_leads", "launch_product", "plan_campaign"];
  return order.map((goalType, i) => ({
    goalType,
    label: `Label for ${goalType}`,
    reason: `Reason for ${goalType}.`,
    source: i >= order.length - filled ? "default" : "model",
  }));
}

export const suggestOk = (goals = goals3()): SuggestGoalsResponse => ({
  ok: true,
  source: "model",
  summary: "A San Francisco bakery selling to locals.",
  goals,
});
export const suggestFailed = (reason: "no_profile" | "invalid_output" | "rate_limited" | "timeout" | "unknown") =>
  ({ ok: false, reason }) as const;

/** One scripted answer for POST /api/goals/suggest. */
export type SuggestStep = SuggestGoalsResponse | { delayMs: number; then: SuggestGoalsResponse } | "abort";

export type FakeInit = {
  status?: SessionState["status"];
  suggestedGoals?: SuggestedGoal[] | null;
  goal?: SessionState["goal"];
  /** Answers for successive /api/goals/suggest calls (the last one repeats). */
  suggest?: SuggestStep[];
  /** The first GET /api/sessions/[id] answers 404 (a stale stored id). */
  staleFirst?: boolean;
  backFails?: boolean;
  chooseFails?: boolean;
  sessionId?: string;
};

export async function fakeBackend(page: Page, init: FakeInit = {}) {
  const sid = init.sessionId ?? FAKE_ID;
  await page.addInitScript((id) => localStorage.setItem("ftu_session_id", id), sid);

  const state: SessionState = {
    status: init.status ?? "goal",
    profile: {
      name: "Starter Bakery",
      domain: "starterbakery.com",
      summary: init.suggestedGoals ? "A San Francisco bakery selling to locals." : null,
      brand: {},
      description: null,
      suggestedGoals: init.suggestedGoals === undefined ? null : init.suggestedGoals,
    },
    goal: init.goal ?? null,
    photo: null,
    artifact: null,
  };
  const log = { getState: 0, suggest: 0, choose: [] as Record<string, unknown>[], back: 0, describe: [] as Record<string, unknown>[] };
  let stale = !!init.staleFirst;
  let suggestCall = 0;

  await page.route("**/api/sessions/*", async (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    log.getState++;
    if (stale) {
      stale = false;
      return route.fulfill({ status: 404, json: { error: "Session not found" } });
    }
    return route.fulfill({ json: state });
  });

  await page.route("**/api/goals/suggest", async (route) => {
    log.suggest++;
    const script = init.suggest ?? [suggestOk()];
    const step = script[Math.min(suggestCall++, script.length - 1)];
    if (step === "abort") return route.abort("failed");
    const body = "delayMs" in step ? (await new Promise((r) => setTimeout(r, step.delayMs)), step.then) : step;
    if (body.ok) {
      state.profile!.suggestedGoals = body.goals; // the server saves what it returns
      state.profile!.summary = body.summary;
    }
    return route.fulfill({ json: body });
  });

  await page.route("**/api/goals/choose", async (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    log.choose.push(body);
    if (init.chooseFails) return route.fulfill({ status: 500, json: { error: "x" } });
    if (state.status !== "goal") return route.fulfill({ status: 409, json: { error: "wrong_step" } });
    const goalType = body.goalType as GoalType;
    const saved = state.profile?.suggestedGoals;
    const label = saved ? saved.find((g) => g.goalType === goalType)?.label : DEFAULT_GOALS[goalType].label; // never from the client
    if (!label) return route.fulfill({ status: 400, json: { error: "Unknown goal" } });
    state.goal = { goalType, label };
    state.status = "building";
    return route.fulfill({ json: { ok: true, goal: state.goal } });
  });

  await page.route("**/api/step/back", async (route) => {
    log.back++;
    if (init.backFails) return route.fulfill({ status: 500, json: { error: "x" } });
    if (state.status === "building") {
      state.status = "goal";
      state.goal = null; // suggestions are kept
    } else if (state.status === "goal") {
      state.status = "site";
      state.goal = null;
      state.profile = state.profile && { ...state.profile, suggestedGoals: null, summary: null };
    }
    return route.fulfill({ json: { status: state.status } });
  });

  await page.route("**/api/profile/describe", async (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    log.describe.push(body);
    state.profile = { name: null, domain: null, summary: null, brand: {}, description: String(body.description).trim(), suggestedGoals: null };
    state.status = "goal";
    return route.fulfill({ json: { ok: true, status: "goal" } });
  });

  return { state, log, sessionId: sid };
}


// --- Milestone 2 live tests: seed a session straight into Supabase (service role), so goal-step tests do not
// spend model requests on step 1. ----------------------------------------------------------------------------

export async function dbWrite<T = Record<string, unknown>>(method: "POST" | "PATCH" | "DELETE", path: string, body?: unknown): Promise<T[]> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing (.env.local)");
  const res = await fetch(`${url}/rest/v1/${path}`, {
    method,
    headers: { apikey: key, Authorization: `Bearer ${key}`, "content-type": "application/json", Prefer: "return=representation" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Supabase ${method} ${path}: ${res.status} ${await res.text()}`);
  return method === "DELETE" ? [] : res.json();
}

/** Create a session (and its profile) directly in the database and make `page` use it. Returns the id. */
export async function seedSession(
  page: Page,
  opts: {
    status?: "site" | "goal" | "building";
    profile?: { name?: string | null; url?: string | null; content?: Record<string, unknown>; summary?: string | null; brand?: Record<string, unknown> };
    suggestedGoals?: SuggestedGoal[] | null;
    goal?: { goal_type: string; goal_label: string };
  } = {},
): Promise<string> {
  const [s] = await dbWrite<{ id: string }>("POST", "sessions", {});
  if (opts.status && opts.status !== "site") {
    await dbWrite("PATCH", `sessions?id=eq.${s.id}`, { status: opts.status, ...(opts.goal ?? {}) });
  }
  if (opts.profile) {
    await dbWrite("POST", "business_profiles", {
      session_id: s.id,
      name: opts.profile.name ?? null,
      url: opts.profile.url ?? null,
      brand: opts.profile.brand ?? {},
      content: opts.profile.content ?? {},
      summary: opts.profile.summary ?? null,
      suggested_goals: opts.suggestedGoals ?? null,
    });
  }
  await page.addInitScript((id) => localStorage.setItem("ftu_session_id", id), s.id);
  return s.id;
}

export const STARTER_PROFILE = {
  name: "Starter Bakery",
  url: "https://starterbakery.com/",
  brand: { name: "Starter Bakery", colors: ["#01468B"] },
  content: {
    digest:
      "Starter Bakery. Fresh sourdough, pastries and coffee baked every morning in San Francisco. Shops in the Mission and the Marina. Catering and wholesale for cafes and offices. Order online for pickup. Open daily 7am to 6pm.",
  },
};

// --- Milestone 3 step 5: photo upload fixtures ---------------------------------------------------------------------


/** A valid PNG of a simple gradient, size x size pixels (a real image fal can take, no files needed). */
export function makePng(size = 256): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type), data])));
    return Buffer.concat([len, Buffer.from(type), data, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  const rows: Buffer[] = [];
  for (let y = 0; y < size; y++) {
    const row = Buffer.alloc(1 + size * 3);
    for (let x = 0; x < size; x++) row.set([(x * 255) / size, (y * 255) / size, 160], 1 + x * 3);
    rows.push(row);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(Buffer.concat(rows))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** JPEG magic bytes with filler: enough to pass the type check (it is not a displayable picture). */
export const fakeJpeg = (bytes = 2_000) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(bytes, 7)]);

/** 200 if the stored file exists in the private bucket (checked through a signed URL), else the failing status. */
export async function assetStatus(path: string): Promise<number> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const sign = await fetch(`${url}/storage/v1/object/sign/assets/${path}`, {
    method: "POST",
    headers: { apikey: key!, Authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({ expiresIn: 60 }),
  });
  if (!sign.ok) return sign.status;
  const { signedURL } = (await sign.json()) as { signedURL: string };
  return (await fetch(`${url}/storage/v1${signedURL}`)).status;
}

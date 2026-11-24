import { expect, test } from "@playwright/test";
import { db, dbWrite, seedSession, STARTER_PROFILE } from "./helpers";

// Milestone 3 step 4: POST /api/artifact/generate against the real routes and database. The first group spends no model
// request (guards, the text-only card, the cap of 3, the claim, saved artifacts). The last two tests each spend one model
// request and pause 30 s afterwards (the free model allows about 5 requests a minute).
test.afterEach(async ({}, testInfo) => {
  if (testInfo.annotations.some((a) => a.type === "llm")) await new Promise((r) => setTimeout(r, 30_000));
});

const PROFILE = { ...STARTER_PROFILE, summary: "A San Francisco bakery selling to locals and cafes." };
const building = (goal: { goal_type: string; goal_label: string }) => ({ status: "building" as const, profile: PROFILE, goal });
const LAUNCH = { goal_type: "launch_product", goal_label: "Launch my product with a great ad" };

type State = { artifact: null | { type: string; source: string; reason: string | null; content: Record<string, unknown>; saved: boolean; generations: number } };

test("AC-46..52: guards on generate", async ({ page, request }) => {
  expect((await request.post("/api/artifact/generate", { data: { sessionId: "nope" } })).status()).toBe(400);
  expect((await request.post("/api/artifact/generate", { data: { sessionId: "00000000-0000-4000-8000-000000000000" } })).status()).toBe(404);
  const goalStep = await seedSession(page, { status: "goal", profile: PROFILE }); // not building yet
  const res = await request.post("/api/artifact/generate", { data: { sessionId: goalStep } });
  expect(res.status()).toBe(409);
  expect(await res.json()).toEqual({ error: "wrong_step" });
  const longHeadline = await request.post("/api/artifact/generate", { data: { sessionId: goalStep, headline: "x".repeat(61) } });
  expect(longHeadline.status()).toBe(400);
});

test("launch_product saves the text-only card with the user's headline, the brand accent and no model request", async ({ page, request }) => {
  const id = await seedSession(page, { ...building(LAUNCH) });
  const res = await request.post("/api/artifact/generate", { data: { sessionId: id, headline: "  Fresh   bread daily " } });
  expect(res.status()).toBe(200);
  expect(await res.json()).toEqual({ ok: true, source: "card" });

  const state = (await (await request.get(`/api/sessions/${id}`)).json()) as State;
  expect(state.artifact).toMatchObject({ type: "ad_creative", source: "card", reason: null, saved: false, generations: 1 });
  expect(state.artifact!.content).toEqual({ kind: "ad_creative", source: "card", headline: "Fresh bread daily", accent: "#01468b" });
  expect(JSON.stringify(state)).not.toContain("digest");

  const rows = await db<{ data: { meta: { claimedAt: string | null } } }>("artifacts", `session_id=eq.${id}&select=data`);
  expect(rows).toHaveLength(1);
  expect(rows[0].data.meta.claimedAt).toBeNull(); // the claim was released
  const ev = await db<{ name: string; props: Record<string, unknown> }>("events", `session_id=eq.${id}&select=name,props&order=id`);
  expect(ev.find((e) => e.name === "artifact_generated")?.props).toMatchObject({ goalType: "launch_product", source: "card", saved: true });
  expect(ev.some((e) => e.name === "tool_failed")).toBe(false);

  // no headline: the business name; the 4th generation is refused
  const second = await request.post("/api/artifact/generate", { data: { sessionId: id } });
  expect(second.status()).toBe(200);
  expect(((await (await request.get(`/api/sessions/${id}`)).json()) as State).artifact!.content.headline).toBe("Starter Bakery");
  await request.post("/api/artifact/generate", { data: { sessionId: id } });
  const fourth = await request.post("/api/artifact/generate", { data: { sessionId: id } });
  expect(fourth.status()).toBe(409);
  expect(await fourth.json()).toEqual({ error: "limit" });
  expect(((await (await request.get(`/api/sessions/${id}`)).json()) as State).artifact!.generations).toBe(3);
});

test("a saved artifact cannot be regenerated", async ({ page, request }) => {
  const id = await seedSession(page, { ...building(LAUNCH) });
  await request.post("/api/artifact/generate", { data: { sessionId: id } });
  await dbWrite("PATCH", `artifacts?session_id=eq.${id}`, { saved_at: "2026-11-23T00:00:00Z" });
  const res = await request.post("/api/artifact/generate", { data: { sessionId: id } });
  expect(res.status()).toBe(409);
  expect(await res.json()).toEqual({ error: "saved" });
  expect(((await (await request.get(`/api/sessions/${id}`)).json()) as State).artifact!.saved).toBe(true);
});

test("parallel requests: one generation at a time, and never more than the recorded count (cap 3)", async ({ page, request }) => {
  const id = await seedSession(page, { ...building(LAUNCH) });
  const statuses = await Promise.all(
    Array.from({ length: 6 }, async () => (await request.post("/api/artifact/generate", { data: { sessionId: id } })).status()),
  );
  expect(statuses.every((s) => s === 200 || s === 409)).toBe(true);
  const won = statuses.filter((s) => s === 200).length;
  expect(won).toBeGreaterThanOrEqual(1);
  const state = (await (await request.get(`/api/sessions/${id}`)).json()) as State;
  expect(state.artifact!.generations).toBe(won); // every success was counted exactly once
  expect(won).toBeLessThanOrEqual(3);
});

test("a leftover draft for a different goal is hidden from the state", async ({ page, request }) => {
  const id = await seedSession(page, { ...building(LAUNCH) });
  await request.post("/api/artifact/generate", { data: { sessionId: id } });
  await dbWrite("PATCH", `sessions?id=eq.${id}`, { goal_type: "get_leads", goal_label: "Get leads for my service" });
  expect(((await (await request.get(`/api/sessions/${id}`)).json()) as State).artifact).toBeNull();
});

// ---------- model tests: one request each ----------
for (const [goal, label, type] of [
  [{ goal_type: "plan_campaign", goal_label: "Plan a marketing campaign" }, "playbook", "playbook"],
  [{ goal_type: "get_leads", goal_label: "Get leads for my service" }, "page", "page"],
] as const) {
  test(`${label}: one real model request saves a draft (model-written, or the labeled fallback) before the response closes`, async ({ page, request }) => {
    test.info().annotations.push({ type: "llm", description: "1 model request" });
    const id = await seedSession(page, { ...building(goal) });
    const res = await request.post("/api/artifact/generate", { data: { sessionId: id }, timeout: 70_000 });
    expect(res.status()).toBe(200);
    const body = await res.text();
    expect(() => JSON.parse(body)).not.toThrow(); // the streamed text is one JSON object the client can parse

    const state = (await (await request.get(`/api/sessions/${id}`)).json()) as State;
    expect(state.artifact, "the draft must exist as soon as the stream closes").not.toBeNull();
    expect(state.artifact).toMatchObject({ type, saved: false, generations: 1 });
    test.info().annotations.push({ type: "result", description: `${state.artifact!.source} ${state.artifact!.reason ?? ""}` });
    if (state.artifact!.source === "fallback") expect(state.artifact!.reason).toBeTruthy(); // a fallback always says why
    const content = JSON.stringify(state.artifact!.content);
    expect(content).not.toMatch(/undefined|null/);
    if (type === "page") expect((state.artifact!.content as { benefits: unknown[] }).benefits).toHaveLength(3);
    else expect((state.artifact!.content as { tasks: unknown[] }).tasks.length).toBeGreaterThanOrEqual(3);

    const ev = await db<{ name: string; props: Record<string, unknown> }>("events", `session_id=eq.${id}&select=name,props&order=id`);
    expect(ev.find((e) => e.name === "artifact_generated")?.props).toMatchObject({ artifactType: type, saved: true });
    const rows = await db<{ data: { meta: { claimedAt: string | null } } }>("artifacts", `session_id=eq.${id}&select=data`);
    expect(rows[0].data.meta.claimedAt).toBeNull();
  });
}

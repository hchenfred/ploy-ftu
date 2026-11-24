import { expect, test } from "@playwright/test";
import { assetStatus, db, dbWrite, fakeJpeg, makePng, seedSession, STARTER_PROFILE } from "./helpers";

// Milestone 3 step 4: POST /api/artifact/generate against the real routes and database. The first group spends no model
// request (guards, the text-only card, the cap of 3, the claim, saved artifacts). The last two tests each spend one model
// request and pause 30 s afterwards (the free model allows about 5 requests a minute). Tests tagged "fal" make one real fal call
// (a few cents) and accept either a generated image or the labeled text-only card, so they pass without credit too.
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
  expect(await res.json()).toEqual({ ok: true, source: "card", reason: null }); // no photo: a plain card, nothing failed

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

// ---------- the product photo upload and the fal ad ----------
const upload = (request: import("@playwright/test").APIRequestContext, sessionId: string, file: { name: string; mimeType: string; buffer: Buffer } | null, fields: Record<string, string> = { sessionId }) =>
  request.post("/api/uploads/photo", { multipart: file ? { ...fields, file } : fields });

test("photo upload: wrong files and wrong steps are refused and nothing is stored", async ({ page, request }) => {
  const id = await seedSession(page, { ...building(LAUNCH) });
  expect((await upload(request, id, null)).status()).toBe(400);
  expect((await upload(request, id, { name: "a.jpg", mimeType: "image/jpeg", buffer: fakeJpeg() }, { sessionId: "nope" })).status()).toBe(400);
  for (const [name, mimeType, buffer] of [
    ["photo.jpg", "image/jpeg", Buffer.from("this is plain text, not an image ".repeat(30))], // the name and type lie
    ["a.gif", "image/gif", Buffer.concat([Buffer.from("GIF89a"), Buffer.alloc(200)])],
    ["a.svg", "image/svg+xml", Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'.repeat(10))],
    ["empty.jpg", "image/jpeg", Buffer.alloc(0)],
  ] as const) {
    const res = await upload(request, id, { name, mimeType, buffer });
    expect(res.status(), name).toBe(400);
    expect(await res.json()).toEqual({ error: "unsupported_type" });
  }
  const tooBig = await upload(request, id, { name: "big.jpg", mimeType: "image/jpeg", buffer: Buffer.concat([fakeJpeg(), Buffer.alloc(5 * 1024 * 1024)]) });
  expect(tooBig.status()).toBe(413);
  expect(await tooBig.json()).toEqual({ error: "too_large" });

  const leads = await seedSession(page, { ...building({ goal_type: "get_leads", goal_label: "Get leads for my service" }) });
  expect((await upload(request, leads, { name: "a.jpg", mimeType: "image/jpeg", buffer: fakeJpeg() })).status()).toBe(409); // only the ad takes a photo
  const early = await seedSession(page, { status: "goal", profile: PROFILE });
  expect((await upload(request, early, { name: "a.jpg", mimeType: "image/jpeg", buffer: fakeJpeg() })).status()).toBe(409);
  expect(((await (await request.get(`/api/sessions/${id}`)).json()) as { photo: unknown }).photo).toBeNull();
});

test("photo upload: the real type decides the name; a new photo replaces the old file; only the size is exposed", async ({ page, request }) => {
  const id = await seedSession(page, { ...building(LAUNCH) });
  const jpeg = fakeJpeg();
  const first = await upload(request, id, { name: "photo.jpg", mimeType: "image/jpeg", buffer: jpeg });
  expect(first.status()).toBe(200);
  expect(await first.json()).toEqual({ ok: true, bytes: jpeg.length });
  expect(await assetStatus(`${id}/ad/reference.jpg`)).toBe(200);
  const state = (await (await request.get(`/api/sessions/${id}`)).json()) as { photo: unknown };
  expect(state.photo).toEqual({ bytes: jpeg.length });
  expect(JSON.stringify(state)).not.toContain("assets");
  const profile = await db<{ content: { photo: { path: string }; digest?: string } }>("business_profiles", `session_id=eq.${id}&select=content`);
  expect(profile[0].content.photo.path).toBe(`${id}/ad/reference.jpg`);
  expect(profile[0].content.digest).toBeTruthy(); // the scraped text was kept
  const ev = await db<{ name: string; props: Record<string, unknown> }>("events", `session_id=eq.${id}&select=name,props&order=id`);
  expect(ev.find((e) => e.name === "photo_uploaded")?.props).toEqual({ bytes: jpeg.length, type: "jpeg" });

  // a PNG that is named .jpg is stored as .png, and the old JPEG file is removed
  const png = makePng(64);
  expect((await upload(request, id, { name: "really.jpg", mimeType: "image/jpeg", buffer: png })).status()).toBe(200);
  expect(await assetStatus(`${id}/ad/reference.png`)).toBe(200);
  expect(await assetStatus(`${id}/ad/reference.jpg`)).not.toBe(200);
});

test("ad with a photo: fal makes the image, we copy it into our storage (or the labeled card if fal cannot)", async ({ page, request }) => {
  test.info().annotations.push({ type: "fal", description: "1 real fal call (a few cents)" });
  const id = await seedSession(page, { ...building(LAUNCH) });
  expect((await upload(request, id, { name: "product.png", mimeType: "image/png", buffer: makePng(256) })).status()).toBe(200);
  const res = await request.post("/api/artifact/generate", { data: { sessionId: id, headline: "Fresh bread daily" }, timeout: 70_000 });
  expect(res.status()).toBe(200);
  const body = (await res.json()) as { ok: boolean; source: string; reason?: string | null };
  const state = (await (await request.get(`/api/sessions/${id}`)).json()) as State & { artifact: { imageUrl: string | null } };
  test.info().annotations.push({ type: "result", description: `${body.source} ${body.reason ?? ""}` });
  expect(state.artifact).toMatchObject({ type: "ad_creative", saved: false, generations: 1 });
  expect(state.artifact!.content.headline).toBe("Fresh bread daily");
  expect(JSON.stringify(state)).not.toContain("fal.media"); // a fal URL is never stored or shown

  const rows = await db<{ image_paths: string[] }>("artifacts", `session_id=eq.${id}&select=image_paths`);
  const ev = await db<{ name: string; props: Record<string, unknown> }>("events", `session_id=eq.${id}&select=name,props&order=id`);
  if (body.source === "fal") {
    expect(rows[0].image_paths).toEqual([`${id}/ad/output-1.jpg`]);
    expect(await assetStatus(`${id}/ad/output-1.jpg`)).toBe(200); // copied into our private bucket
    expect(state.artifact!.imageUrl).toContain("supabase"); // a signed URL of OUR storage
    const img = await fetch(state.artifact!.imageUrl!);
    expect(img.headers.get("content-type")).toBe("image/jpeg");
    expect(ev.some((e) => e.name === "tool_failed")).toBe(false);
  } else {
    expect(body.source).toBe("card"); // fal could not make it: a branded card is saved, with the reason
    expect(body.reason).toBeTruthy();
    expect(rows[0].image_paths).toEqual([]);
    expect(state.artifact!.imageUrl).toBeNull();
    expect(ev.find((e) => e.name === "tool_failed")?.props).toMatchObject({ tool: "fal", reason: body.reason });
  }
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

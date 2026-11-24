import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { CLAIM_TTL_MS, CLIENT_GIVE_UP_SECONDS, MODEL_TIMEOUT_MS, ROUTE_MAX_DURATION_SECONDS } from "../../src/lib/artifact/limits.ts";

test("the route's literal maxDuration matches limits.ts", () => {
  const src = readFileSync("src/app/api/artifact/generate/route.ts", "utf8");
  const match = src.match(/export const maxDuration = (\d+);/);
  assert.ok(match, "route must export a literal maxDuration");
  assert.equal(Number(match[1]), ROUTE_MAX_DURATION_SECONDS);
});

test("limits are ordered: model wait < function limit < claim expiry < browser give-up", () => {
  const SAVE_MARGIN_MS = 5_000; // time to save the fallback after the model gives up
  assert.ok(MODEL_TIMEOUT_MS + SAVE_MARGIN_MS <= ROUTE_MAX_DURATION_SECONDS * 1000);
  assert.ok(CLAIM_TTL_MS > ROUTE_MAX_DURATION_SECONDS * 1000);
  assert.ok(CLIENT_GIVE_UP_SECONDS * 1000 > CLAIM_TTL_MS);
});

test("the route and the page use the shared constants, not their own numbers", () => {
  const route = readFileSync("src/app/api/artifact/generate/route.ts", "utf8");
  assert.match(route, /AbortSignal\.timeout\(MODEL_TIMEOUT_MS\)/);
  assert.match(readFileSync("src/lib/artifact-store.ts", "utf8"), /CLAIM_TTL_MS.*from "@\/lib\/artifact\/limits"/);
});

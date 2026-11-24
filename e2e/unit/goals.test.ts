import assert from "node:assert/strict";
import { test } from "node:test";
// Pure module, no server-only code: imported with its .ts extension so Node's test runner can load it.
import {
  ALL_DEFAULT_GOALS,
  chooseGoalBody,
  clip,
  DEFAULT_GOALS,
  GOAL_CATALOG,
  GOAL_TYPES,
  normalizeGoals,
  recommendedGoal,
  suggestGoalsInput,
  type SuggestedGoal,
} from "../../src/lib/goals.ts";

const g = (goalType: string, label = "A decent label", reason = "A decent reason for this one.") => ({
  goalType,
  label,
  reason,
});
const types = (r: { goals: SuggestedGoal[] }) => r.goals.map((x) => x.goalType);
const ID = "6f0f2c1e-5f64-4e0a-9d2b-5a1f3a0f7c11";

test("the three goals and the catalog agree", () => {
  assert.deepEqual([...GOAL_TYPES], ["launch_product", "get_leads", "plan_campaign"]);
  assert.deepEqual(Object.keys(DEFAULT_GOALS).sort(), [...GOAL_TYPES].sort());
  assert.deepEqual(Object.keys(GOAL_CATALOG).sort(), [...GOAL_TYPES].sort());
  assert.equal(ALL_DEFAULT_GOALS.length, 3);
  assert.ok(ALL_DEFAULT_GOALS.every((x) => x.source === "default"));
  assert.deepEqual(
    GOAL_TYPES.map((t) => [GOAL_CATALOG[t].artifactType, GOAL_CATALOG[t].handoff.primitive]),
    [
      ["ad_creative", "ads"],
      ["page", "sites"],
      ["playbook", "ploybooks"],
    ],
  );
  for (const t of GOAL_TYPES) assert.match(GOAL_CATALOG[t].handoff.href, /^https:\/\//);
});

test("normalizeGoals: three distinct goals keep the model's order and are all 'model'", () => {
  const r = normalizeGoals([g("plan_campaign"), g("launch_product"), g("get_leads")])!;
  assert.deepEqual(types(r), ["plan_campaign", "launch_product", "get_leads"]);
  assert.equal(r.filled, 0);
  assert.ok(r.goals.every((x) => x.source === "model"));
});

test("normalizeGoals: missing types are filled from defaults in GOAL_TYPES order", () => {
  const r = normalizeGoals([g("get_leads")])!;
  assert.deepEqual(types(r), ["get_leads", "launch_product", "plan_campaign"]);
  assert.equal(r.filled, 2);
  assert.deepEqual(r.goals.map((x) => x.source), ["model", "default", "default"]);
  assert.equal(r.goals[1].label, DEFAULT_GOALS.launch_product.label);
});

test("normalizeGoals: duplicates keep the first, unknown and blank entries are dropped, text is trimmed", () => {
  const dup = normalizeGoals([g("get_leads", "First one"), g("get_leads", "Second one"), g("plan_campaign")])!;
  assert.equal(dup.goals.length, 3);
  assert.equal(new Set(types(dup)).size, 3);
  assert.equal(dup.goals[0].label, "First one");

  const messy = normalizeGoals([g("paid_growth"), g("get_leads", "   "), g("plan_campaign", "  Trim me  ", "  and me too  ")])!;
  assert.equal(messy.goals[0].goalType, "plan_campaign");
  assert.equal(messy.goals[0].label, "Trim me");
  assert.equal(messy.goals[0].reason, "and me too");
  assert.equal(messy.goals.length, 3);
});

test("normalizeGoals: nothing usable returns null (the caller reports invalid_output)", () => {
  assert.equal(normalizeGoals([]), null);
  assert.equal(normalizeGoals([g("local_customers"), g("plan_campaign", "", "")]), null);
});

test("recommendedGoal: the model's first goal, never a default", () => {
  const model = normalizeGoals([g("plan_campaign"), g("get_leads")])!.goals;
  assert.equal(recommendedGoal(model), "plan_campaign");
  assert.equal(recommendedGoal(ALL_DEFAULT_GOALS), null); // fallback: no recommendation
  assert.equal(recommendedGoal([]), null);
  assert.equal(recommendedGoal(null), null);
  assert.equal(recommendedGoal(undefined), null);
  // a default-filled first card (model returned nothing usable would be null, but be defensive)
  assert.equal(recommendedGoal([{ ...model[0], source: "default" }]), null);
});

test("clip: trims at a word boundary and never leaves a dangling word", () => {
  assert.equal(clip("  Get more   local customers ", 60), "Get more local customers");
  const out = clip("Receive catering and wholesale inquiries from cafes and offices around the city", 55);
  assert.ok(out.length <= 55);
  assert.ok(!/\s(and|or|for|from|to|of|with|the|a)$/i.test(out), out);
  assert.equal(clip("Collect online orders and customer contacts for repeat business", 50), "Collect online orders and customer contacts");
  assert.equal(clip("x".repeat(100), 60).length, 60);
});

test("chooseGoalBody: only the three suggested goals; the client cannot send a label or a custom goal", () => {
  assert.ok(chooseGoalBody.safeParse({ sessionId: ID, kind: "suggested", goalType: "get_leads" }).success);
  assert.ok(!chooseGoalBody.safeParse({ sessionId: ID, kind: "suggested", goalType: "paid_growth" }).success); // old type
  assert.ok(!chooseGoalBody.safeParse({ sessionId: ID, kind: "custom", customText: "sell more cakes" }).success);
  assert.ok(!chooseGoalBody.safeParse({ sessionId: "nope", kind: "suggested", goalType: "get_leads" }).success);
  const parsed = chooseGoalBody.parse({ sessionId: ID, kind: "suggested", goalType: "get_leads", label: "HACKED" });
  assert.ok(!("label" in parsed));
});

test("suggestGoalsInput: accepts a partial answer (rescued by normalizeGoals), rejects more than three and bad types", () => {
  const base = { summary: "A neighborhood bakery selling bread to locals." };
  assert.ok(suggestGoalsInput.safeParse({ ...base, goals: [g("get_leads")] }).success);
  assert.ok(!suggestGoalsInput.safeParse({ ...base, goals: [] }).success);
  assert.ok(!suggestGoalsInput.safeParse({ ...base, goals: [g("get_leads"), g("get_leads"), g("get_leads"), g("get_leads")] }).success);
  assert.ok(!suggestGoalsInput.safeParse({ ...base, goals: [g("paid_growth")] }).success);
  // no hard length limit in the model-facing schema (clip handles it)
  assert.ok(suggestGoalsInput.safeParse({ ...base, goals: [g("get_leads", "x".repeat(200), "y".repeat(400))] }).success);
});

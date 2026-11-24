// Shared goal types and helpers. No secrets and no "server-only": the client imports the types and
// DEFAULT_GOALS from here, and server files (routes, tools) import the same definitions.
import { z } from "zod";
import type { BrandProfile } from "@/lib/tools/research-site"; // type-only: erased, never loads the server module

export const SESSION_STATUSES = ["site", "goal", "building", "live"] as const;
export type SessionStatus = (typeof SESSION_STATUSES)[number];

export const GOAL_TYPES = [
  "local_customers",
  "capture_and_follow_up",
  "inbound_leads",
  "paid_growth",
] as const;
export type GoalType = (typeof GOAL_TYPES)[number];

// `source` is set by the server, never by the model:
// "model" = written by the LLM, "default" = filled in from DEFAULT_GOALS.
export type SuggestedGoal = {
  goalType: GoalType;
  label: string;
  reason: string;
  source: "model" | "default";
};

// Fallback and label source for default goals (and the filler when the model returns fewer than 4 types).
export const DEFAULT_GOALS: Record<GoalType, { label: string; reason: string }> = {
  local_customers: {
    label: "Get more local customers",
    reason: "Helps people nearby find you and visit, call or book.",
  },
  capture_and_follow_up: {
    label: "Capture and follow up with visitors",
    reason: "Collects visitors' contact details so you can follow up with them.",
  },
  inbound_leads: {
    label: "Get more inbound leads",
    reason: "Makes it easy for people to ask for a quote or a consultation.",
  },
  paid_growth: {
    label: "Grow with paid ads",
    reason: "Gives paid ad traffic a page built to convert.",
  },
};

export function defaultGoal(goalType: GoalType): SuggestedGoal {
  return { goalType, ...DEFAULT_GOALS[goalType], source: "default" };
}

export const ALL_DEFAULT_GOALS: SuggestedGoal[] = GOAL_TYPES.map(defaultGoal);

// Length limits for the saved text. They are enforced on the server by clip(), NOT in the schema below.
// A hard maxLength in the schema sent to the model made it squeeze its text to fit and stop mid-phrase
// ("...inquiries from cafes and"), and a Zod max() would reject the whole answer. Instead the field
// descriptions and the prompt ask for short, complete text, and clip() is only a safety net.
export const LIMITS = { summary: 200, label: 60, reason: 140 } as const;

// Words that read as cut off when a sentence ends on them.
const DANGLING = /\s+(and|or|but|for|to|of|with|from|the|a|an|in|on|at|by|as|your|their|our)$/i;

/** Trim to at most `max` characters at a word boundary (never mid-word), without a dangling "and"/"for". */
export function clip(text: string, max: number): string {
  let t = text.trim().replace(/\s+/g, " ");
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  // Back up to the last space unless that would throw away most of the text.
  t = lastSpace >= max * 0.5 ? cut.slice(0, lastSpace) : cut;
  let prev: string;
  do {
    prev = t;
    t = t.replace(/[\s,;:\-–—(]+$/, "").replace(DANGLING, "");
  } while (t !== prev);
  return t;
}

// The suggestGoals tool's input schema doubles as the structured output the model fills in.
// The array is min(1), not min(4), on purpose: a partial answer from a weak model is rescued by
// normalizeGoals instead of failing validation and discarding a good summary.
export const suggestGoalsInput = z.object({
  summary: z.string().min(10).describe("One short sentence: who they are and who they sell to"),
  goals: z
    .array(
      z.object({
        goalType: z.enum(GOAL_TYPES),
        label: z
          .string()
          .min(5)
          .describe("The outcome as a short, complete phrase of about 5 to 8 words, e.g. 'Fill your lunch rush with local customers'"),
        reason: z
          .string()
          .min(10)
          .describe("Why this fits this business: one short, complete sentence that names something specific about it"),
      }),
    )
    .min(1)
    .max(4)
    .describe("All four goal types, one each, most relevant first"),
});
export type SuggestGoalsInput = z.infer<typeof suggestGoalsInput>;

// Body of POST /api/goals/choose. The client never sends a label: the server reads it from the DB.
export const chooseGoalBody = z.discriminatedUnion("kind", [
  z.object({ sessionId: z.uuid(), kind: z.literal("suggested"), goalType: z.enum(GOAL_TYPES) }),
  z.object({ sessionId: z.uuid(), kind: z.literal("custom"), customText: z.string().trim().min(3).max(300) }),
]);

/**
 * Turn the model's goals into exactly four: one per goal type.
 * - trim strings, drop unknown types and empty entries
 * - dedupe by goalType, keeping the first (preserves the model's relevance order), tagged "model"
 * - fill every missing type from DEFAULT_GOALS, appended in GOAL_TYPES order, tagged "default"
 * Returns null when no usable model goal remains (the caller reports invalid_output).
 */
export function normalizeGoals(
  modelGoals: ReadonlyArray<{ goalType: string; label: string; reason: string }>,
): { goals: SuggestedGoal[]; filled: number } | null {
  const seen = new Set<GoalType>();
  const goals: SuggestedGoal[] = [];

  for (const g of modelGoals) {
    const type = GOAL_TYPES.find((t) => t === g.goalType);
    const label = g.label ? clip(g.label, LIMITS.label) : "";
    const reason = g.reason ? clip(g.reason, LIMITS.reason) : "";
    if (!type || !label || !reason || seen.has(type)) continue;
    seen.add(type);
    goals.push({ goalType: type, label, reason, source: "model" });
  }
  if (goals.length === 0) return null;

  let filled = 0;
  for (const type of GOAL_TYPES) {
    if (seen.has(type)) continue;
    goals.push(defaultGoal(type));
    filled++;
  }
  return { goals, filled };
}

// What POST /api/goals/suggest returns after its guards (always HTTP 200; a failure is { ok: false }).
export type SuggestGoalsReason = "no_profile" | "invalid_output" | "rate_limited" | "timeout" | "unknown";
export type SuggestGoalsResponse =
  | { ok: true; source: "model" | "saved"; summary: string; goals: SuggestedGoal[] }
  | { ok: false; reason: SuggestGoalsReason };

// What GET /api/sessions/[id] returns: everything the UI needs to know which step to show.
// Never contains the scraped page digest (the UI doesn't need it).
export type SessionState = {
  status: SessionStatus;
  profile: null | {
    name: string | null;
    domain: string | null;
    summary: string | null;
    brand: Partial<BrandProfile>; // {} for the describe path
    description: string | null; // content.description (describe path)
    suggestedGoals: SuggestedGoal[] | null;
  };
  goal: null | { goalType: GoalType | null; label: string; customText: string | null };
};

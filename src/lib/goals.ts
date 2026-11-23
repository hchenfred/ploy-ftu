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

// The suggestGoals tool's input schema doubles as the structured output the model fills in.
// The array is min(1), not min(4), on purpose: a partial answer from a weak model is rescued by
// normalizeGoals instead of failing validation and discarding a good category and summary.
export const suggestGoalsInput = z.object({
  category: z.string().min(2).max(40).describe("Business category, e.g. 'neighborhood bakery'"),
  summary: z.string().min(10).max(200).describe("One sentence: who they are and who they sell to"),
  goals: z
    .array(
      z.object({
        goalType: z.enum(GOAL_TYPES),
        label: z.string().min(5).max(60),
        reason: z.string().min(10).max(140).describe("Why this fits this business, one sentence"),
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
    const label = g.label?.trim();
    const reason = g.reason?.trim();
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

// What GET /api/sessions/[id] returns: everything the UI needs to know which step to show.
// Never contains the scraped page digest (the UI doesn't need it).
export type SessionState = {
  status: SessionStatus;
  profile: null | {
    name: string | null;
    domain: string | null;
    category: string | null;
    summary: string | null;
    brand: Partial<BrandProfile>; // {} for the describe path
    description: string | null; // content.description (describe path)
    suggestedGoals: SuggestedGoal[] | null;
  };
  goal: null | { goalType: GoalType | null; label: string; customText: string | null };
};

// Shared goal types and helpers. No secrets and no "server-only": the client imports the types and
// DEFAULT_GOALS from here, and server files (routes, tools) import the same definitions.
import { z } from "zod";
import type { BrandProfile } from "@/lib/tools/research-site"; // type-only: erased, never loads the server module
import type { AdCreative } from "./artifact/ad.ts";
import type { PageDefinition } from "./artifact/page.ts";
import type { Playbook } from "./artifact/playbook.ts";

export const SESSION_STATUSES = ["site", "goal", "building", "live"] as const;
export type SessionStatus = (typeof SESSION_STATUSES)[number];

// The three starting goals, one per persona. Each ends in one saved artifact (see GOAL_CATALOG).
export const GOAL_TYPES = ["launch_product", "get_leads", "plan_campaign"] as const;
export type GoalType = (typeof GOAL_TYPES)[number];

// `source` is set by the server, never by the model:
// "model" = written by the LLM, "default" = filled in from DEFAULT_GOALS.
export type SuggestedGoal = {
  goalType: GoalType;
  label: string;
  reason: string;
  source: "model" | "default";
};

// Fallback and label source for default goals (and the filler when the model returns fewer than 3 types).
export const DEFAULT_GOALS: Record<GoalType, { label: string; reason: string }> = {
  launch_product: {
    label: "Launch my product with a great ad",
    reason: "Turns a photo of your product into a branded ad you can run.",
  },
  get_leads: {
    label: "Get leads for my service",
    reason: "A landing page with a clear quote-request button.",
  },
  plan_campaign: {
    label: "Plan a marketing campaign",
    reason: "A step-by-step plan with tasks and a success metric.",
  },
};

// The Ploy primitives a goal hands the user to. Our data: the model never decides it.
export type Primitive = "ads" | "sites" | "ploybooks";
export const PRIMITIVE_LABELS: Record<Primitive, string> = { ads: "Ads", sites: "Sites", ploybooks: "Ploybooks" };

// What each goal produces and where Ploy takes the user next. The hrefs are PLACEHOLDERS (fake links, not
// real Ploy URLs), kept in this one table so they are easy to replace.
export const GOAL_CATALOG: Record<
  GoalType,
  {
    artifactType: "ad_creative" | "page" | "playbook";
    handoff: { primitive: Primitive; title: string; text: string; href: string };
  }
> = {
  launch_product: {
    artifactType: "ad_creative",
    handoff: {
      primitive: "ads",
      title: "Run it in Ploy Ads",
      text: "Take this creative to Ploy Ads and test it with real traffic.",
      href: "https://example.com/ploy/ads",
    },
  },
  get_leads: {
    artifactType: "page",
    handoff: {
      primitive: "sites",
      title: "Publish it with Ploy Sites",
      text: "Publish this page on your own domain and start collecting requests.",
      href: "https://example.com/ploy/sites",
    },
  },
  plan_campaign: {
    artifactType: "playbook",
    handoff: {
      primitive: "ploybooks",
      title: "Save it as a Ploybook",
      text: "Turn this plan into a repeatable Ploybook and track its metric in analytics.",
      href: "https://example.com/ploy/ploybooks",
    },
  },
};

export function defaultGoal(goalType: GoalType): SuggestedGoal {
  return { goalType, ...DEFAULT_GOALS[goalType], source: "default" };
}

export const ALL_DEFAULT_GOALS: SuggestedGoal[] = GOAL_TYPES.map(defaultGoal);

/**
 * The recommended goal is the model's first (best-fit) suggestion. There is no recommendation when the first goal
 * is a default (the model failed or returned nothing usable), so a fallback never pretends to recommend.
 */
export function recommendedGoal(goals: ReadonlyArray<SuggestedGoal> | null | undefined): GoalType | null {
  const first = goals?.[0];
  return first && first.source === "model" ? first.goalType : null;
}

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
// The array is min(1), not min(3), on purpose: a partial answer from a weak model is rescued by
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
    .max(3)
    .describe("All three goal types, one each, the best fit for this business first"),
});
export type SuggestGoalsInput = z.infer<typeof suggestGoalsInput>;

// Body of POST /api/goals/choose. The client never sends a label: the server reads it from the DB.
// (Only suggested goals can be chosen in the MVP; there is no custom goal.)
export const chooseGoalBody = z.object({
  sessionId: z.uuid(),
  kind: z.literal("suggested"),
  goalType: z.enum(GOAL_TYPES),
});

/**
 * Turn the model's goals into exactly three: one per goal type.
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
  goal: null | { goalType: GoalType; label: string };
  // The draft or saved artifact for the chosen goal (null until the first generation). Never includes the digest.
  artifact: null | {
    id: string;
    type: "ad_creative" | "page" | "playbook";
    source: "model" | "fallback" | "card" | "fal";
    /** Why a model or fal call fell back, so the UI can say so (for example "rate_limited"), otherwise null. */
    reason: string | null;
    content: PageDefinition | Playbook | AdCreative;
    imageUrl: string | null; // a signed URL of our stored copy of a generated image (added with the fal step)
    saved: boolean;
    generations: number;
  };
};

import { z } from "zod";
import { clip } from "../goals.ts";
import {
  asArray,
  asObject,
  asString,
  displayName,
  type ArtifactProfile,
  type DeepPartial,
  type Validated,
} from "./types.ts";

export type Playbook = {
  title: string;
  objective: string;
  audience: string;
  tasks: { title: string; detail: string; when: string }[];
  successMetric: { name: string; target: string; howToMeasure: string };
};
export type PartialPlaybook = DeepPartial<Playbook>;

// Limits for the saved text. Enforced on the server by clip(), NOT in the model-facing schema: a hard maxLength there
// made the model squeeze its text and stop mid-phrase, and a Zod max() would reject the whole answer.
export const PLAYBOOK_LIMITS = { title: 80, objective: 200, audience: 120, taskTitle: 80, taskDetail: 200, when: 30, metric: 80, target: 100, howTo: 160 } as const;
export const PLAYBOOK_MIN_TASKS = 3;
export const PLAYBOOK_MAX_TASKS = 7;

/** The loose schema the model fills in (and `useObject` streams): short, complete text, no max(). */
export const playbookModelSchema = z.object({
  title: z.string().describe("A short title for the campaign plan"),
  objective: z.string().describe("One short sentence: what the campaign should achieve"),
  audience: z.string().describe("One short phrase: who the campaign is for"),
  tasks: z
    .array(
      z.object({
        title: z.string().describe("The task, as a short imperative phrase"),
        detail: z.string().describe("One short, complete sentence on how to do it"),
        when: z.string().describe("When to do it, for example 'Week 1'"),
      }),
    )
    .describe("5 to 7 concrete tasks a small team can do, in order"),
  successMetric: z.object({
    name: z.string().describe("The one number that shows the campaign worked"),
    target: z.string().describe("A suggested target phrased as a goal, for example 'aim for 20 qualified replies'"),
    howToMeasure: z.string().describe("One short sentence on how to count it"),
  }),
});

/** A deterministic, generic playbook: used when the model fails, and to fill any part the model left out. */
export function fallbackPlaybook(profile: ArtifactProfile): Playbook {
  const name = displayName(profile);
  return {
    title: clip(`${name} campaign plan`, PLAYBOOK_LIMITS.title),
    objective: clip(`Get more of the right people to know about ${name} and take a first step.`, PLAYBOOK_LIMITS.objective),
    audience: clip(profile.summary ? `People who would buy from ${name}` : `The people ${name} wants to reach`, PLAYBOOK_LIMITS.audience),
    tasks: [
      { title: "Define the goal and the audience", detail: "Write one sentence on who you want to reach and what you want them to do.", when: "Week 1" },
      { title: "Pick one main message", detail: `Choose the one thing about ${name} that makes people choose you.`, when: "Week 1" },
      { title: "Choose two channels", detail: "Pick the two places your audience already spends time, such as email and social.", when: "Week 1" },
      { title: "Create the first assets", detail: "Draft a short post, an email and a simple page that carry the message.", when: "Week 2" },
      { title: "Launch and keep a log", detail: "Publish, then note replies, clicks and questions every day.", when: "Week 3" },
      { title: "Review and adjust", detail: "Compare results with the target and change one thing for the next round.", when: "Week 4" },
    ],
    successMetric: {
      name: "Qualified replies",
      target: "Aim for 20 replies in four weeks",
      howToMeasure: "Count the replies and enquiries that mention the campaign.",
    },
  };
}

/**
 * Turn whatever the model produced into a valid playbook: trim and clip every field, drop broken tasks, keep at most 7,
 * and fill anything missing (fewer than 3 tasks, a missing metric or title) from the deterministic fallback.
 * Returns null only when the model gave nothing usable at all (no title and no task), so the caller saves the full
 * fallback instead. `filled` counts the parts that came from the fallback.
 */
export function validatePlaybook(input: unknown, profile: ArtifactProfile): Validated<Playbook> | null {
  const o = asObject(input);
  if (!o) return null;
  const fb = fallbackPlaybook(profile);
  const L = PLAYBOOK_LIMITS;
  let filled = 0;
  const pick = (v: unknown, max: number, fallback: string) => {
    const t = clip(asString(v), max);
    if (t) return t;
    filled++;
    return fallback;
  };

  const modelTitle = clip(asString(o.title), L.title);
  const tasks = asArray(o.tasks)
    .map((raw) => {
      const t = asObject(raw);
      return {
        title: clip(asString(t?.title), L.taskTitle),
        detail: clip(asString(t?.detail), L.taskDetail),
        when: clip(asString(t?.when), L.when),
      };
    })
    .filter((t) => t.title && t.detail)
    .slice(0, PLAYBOOK_MAX_TASKS);
  if (!modelTitle && tasks.length === 0) return null; // nothing usable

  for (const f of fb.tasks) {
    if (tasks.length >= PLAYBOOK_MIN_TASKS) break;
    tasks.push(f);
    filled++;
  }
  const m = asObject(o.successMetric);
  return {
    value: {
      title: modelTitle || (filled++, fb.title),
      objective: pick(o.objective, L.objective, fb.objective),
      audience: pick(o.audience, L.audience, fb.audience),
      tasks,
      successMetric: {
        name: pick(m?.name, L.metric, fb.successMetric.name),
        target: pick(m?.target, L.target, fb.successMetric.target),
        howToMeasure: pick(m?.howToMeasure, L.howTo, fb.successMetric.howToMeasure),
      },
    },
    filled,
  };
}

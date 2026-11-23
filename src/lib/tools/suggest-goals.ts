import "server-only";
import { tool } from "ai";
import { supabaseAdmin } from "@/lib/supabase-server";
import { logEvent } from "@/lib/events";
import { clip, LIMITS, normalizeGoals, suggestGoalsInput, type SuggestedGoal } from "@/lib/goals";

const DIGEST_CHARS = 3_000;

export type SuggestGoalsFailureReason = "no_profile" | "invalid_output" | "unknown";

export type SuggestGoalsOutput =
  | { ok: true; summary: string; goals: SuggestedGoal[]; filled: number }
  | { ok: false; reason: SuggestGoalsFailureReason };

type ProfileRow = {
  url: string | null;
  name: string | null;
  brand: { name?: string | null } | null;
  content: { digest?: string; description?: string } | null;
  field_sources: Record<string, string> | null;
};

async function loadProfile(sessionId: string): Promise<ProfileRow | null> {
  const { data, error } = await supabaseAdmin()
    .from("business_profiles")
    .select("url, name, brand, content, field_sources")
    .eq("session_id", sessionId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data as ProfileRow | null;
}

/**
 * The prompt for the goals call, built on the server from what we saved (never from the browser).
 * Everything the user's site said goes inside <business_data>, which the prompt treats as data.
 * Returns null when there is nothing usable to base suggestions on.
 */
export async function buildGoalsInput(sessionId: string): Promise<string | null> {
  const profile = await loadProfile(sessionId);
  const description = profile?.content?.description?.trim();
  const digest = profile?.content?.digest?.trim();
  if (!profile || (!description && !digest)) return null;

  const domain = profile.url ? new URL(profile.url).hostname.replace(/^www\./, "") : null;
  const lines = [
    profile.name ? `Name: ${profile.name}` : null,
    domain ? `Website: ${domain}` : null,
    profile.brand?.name && profile.brand.name !== profile.name ? `Brand name: ${profile.brand.name}` : null,
    description ? `Description written by the user: ${description}` : null,
    digest ? `Website content (excerpt):\n${digest.slice(0, DIGEST_CHARS)}` : null,
  ].filter(Boolean);
  return `Suggest goals for this business.\n\n<business_data>\n${lines.join("\n")}\n</business_data>`;
}

// The tool's input schema is the structured output: the model fills in the summary and goals,
// and `execute` validates, normalizes (always 4 goals) and saves them. The session id comes from the
// route, never from the model.
export function suggestGoalsTool(sessionId: string) {
  return tool({
    description:
      "Save your suggestions for what this business's website should achieve: a one-sentence summary and one goal per goal type, most relevant first.",
    inputSchema: suggestGoalsInput,
    // Never throws: every failure becomes { ok: false, reason } and a tool_failed event.
    execute: async ({ summary, goals: modelGoals }): Promise<SuggestGoalsOutput> => {
      const fail = async (reason: SuggestGoalsFailureReason, detail?: string) => {
        await logEvent(sessionId, "tool_failed", { tool: "suggestGoals", reason, detail });
        return { ok: false as const, reason };
      };

      try {
        const profile = await loadProfile(sessionId);
        if (!profile || (!profile.content?.description && !profile.content?.digest)) return fail("no_profile");

        const normalized = normalizeGoals(modelGoals);
        if (!normalized) return fail("invalid_output");

        const cleanSummary = clip(summary, LIMITS.summary);
        const { error } = await supabaseAdmin()
          .from("business_profiles")
          .update({
            summary: cleanSummary,
            suggested_goals: normalized.goals,
            field_sources: {
              ...(profile.field_sources ?? {}),
              summary: "inferred",
              suggested_goals: "inferred",
            },
            updated_at: new Date().toISOString(),
          })
          .eq("session_id", sessionId);
        if (error) return fail("unknown", error.message);

        return { ok: true, summary: cleanSummary, goals: normalized.goals, filled: normalized.filled };
      } catch (err) {
        return fail("unknown", err instanceof Error ? err.message : String(err));
      }
    },
  });
}

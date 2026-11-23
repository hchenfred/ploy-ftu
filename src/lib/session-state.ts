import "server-only";
import { supabaseAdmin } from "@/lib/supabase-server";
import { logEvent } from "@/lib/events";
import type { SessionState, SessionStatus, SuggestedGoal } from "@/lib/goals";

/**
 * Move a session from one step to another. The server decides every transition; the client and the
 * model never do. It is a conditional update (`where status = :from`), so repeating it is safe:
 * a second call finds the status already changed and does nothing.
 *
 * Returns true only if a row changed. Logs `step_changed` only in that case. Never throws.
 */
export async function advanceStatus(
  sessionId: string,
  from: SessionStatus,
  to: SessionStatus,
): Promise<boolean> {
  try {
    const { data, error } = await supabaseAdmin()
      .from("sessions")
      .update({ status: to })
      .eq("id", sessionId)
      .eq("status", from)
      .select("id");
    if (error) {
      console.error(`[session-state] ${from} -> ${to} failed:`, error.message);
      return false;
    }
    if (!data || data.length === 0) return false;
    await logEvent(sessionId, "step_changed", { from, to });
    return true;
  } catch (err) {
    console.error(`[session-state] ${from} -> ${to} failed:`, err);
    return false;
  }
}

type LoadResult = { ok: true; state: SessionState } | { ok: false; reason: "not_found" | "error" };

/** Read a session and its profile as the shape the UI needs. Never returns content.digest. */
export async function loadSessionState(sessionId: string): Promise<LoadResult> {
  try {
    const db = supabaseAdmin();
    const { data: session, error } = await db
      .from("sessions")
      .select("status, goal_type, goal_label, goal_custom_text")
      .eq("id", sessionId)
      .maybeSingle();
    if (error) {
      console.error("[session-state] load session failed:", error.message);
      return { ok: false, reason: "error" };
    }
    if (!session) return { ok: false, reason: "not_found" };

    const { data: profile, error: profileError } = await db
      .from("business_profiles")
      .select("url, name, summary, brand, content, suggested_goals")
      .eq("session_id", sessionId)
      .maybeSingle();
    if (profileError) {
      console.error("[session-state] load profile failed:", profileError.message);
      return { ok: false, reason: "error" };
    }

    return {
      ok: true,
      state: {
        status: session.status,
        profile: profile
          ? {
              name: profile.name ?? null,
              domain: domainOf(profile.url),
              summary: profile.summary ?? null,
              brand: profile.brand ?? {},
              description: profile.content?.description ?? null,
              suggestedGoals: (profile.suggested_goals as SuggestedGoal[] | null) ?? null,
            }
          : null,
        goal: session.goal_label
          ? {
              goalType: session.goal_type ?? null,
              label: session.goal_label,
              customText: session.goal_custom_text ?? null,
            }
          : null,
      },
    };
  } catch (err) {
    console.error("[session-state] load failed:", err);
    return { ok: false, reason: "error" };
  }
}

function domainOf(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

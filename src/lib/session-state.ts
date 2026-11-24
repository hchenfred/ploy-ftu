import "server-only";
import { supabaseAdmin } from "@/lib/supabase-server";
import { logEvent } from "@/lib/events";
import { getArtifact } from "@/lib/artifact-store";
import { signedAssetUrl } from "@/lib/artifact-storage";
import { cleanModelText, cleanStoredGoal, type SessionState, type SessionStatus, type SuggestedGoal } from "@/lib/goals";

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
      .select("status, goal_type, goal_label")
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

    const goal: SessionState["goal"] =
      session.goal_label && session.goal_type ? { goalType: session.goal_type, label: session.goal_label } : null;

    // The draft or saved artifact, only if it belongs to the goal that is chosen now (a leftover from another goal is hidden).
    const row = goal ? await getArtifact(sessionId) : null;
    const artifact: SessionState["artifact"] =
      goal && row && row.goal_type === goal.goalType && row.data?.content
        ? {
            id: row.id,
            type: row.type,
            source: row.data.meta?.source ?? "fallback",
            reason: row.data.meta?.reason ?? null,
            content: row.data.content as NonNullable<SessionState["artifact"]>["content"],
            imageUrl: row.data.meta?.source === "fal" && row.image_paths?.[0] ? await signedAssetUrl(row.image_paths[0], 3600) : null,
            saved: !!row.saved_at,
            generations: row.data.meta?.generations ?? 0,
          }
        : null;

    return {
      ok: true,
      state: {
        status: session.status,
        profile: profile
          ? {
              name: profile.name ?? null,
              domain: domainOf(profile.url),
              summary: profile.summary ? cleanModelText(profile.summary) || null : null,
              brand: profile.brand ?? {},
              description: profile.content?.description ?? null,
              // suggestions saved before the leak was fixed are cleaned on the way out
              suggestedGoals: (profile.suggested_goals as SuggestedGoal[] | null)?.map(cleanStoredGoal) ?? null,
            }
          : null,
        goal,
        photo: typeof (profile?.content as { photo?: { bytes?: number } } | null)?.photo?.bytes === "number"
          ? { bytes: (profile!.content as { photo: { bytes: number } }).photo.bytes }
          : null,
        artifact,
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

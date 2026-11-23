import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase-server";
import { logEvent } from "@/lib/events";
import { loadSessionState } from "@/lib/session-state";
import type { SessionStatus } from "@/lib/goals";

const Body = z.object({ sessionId: z.uuid() });

// POST /api/step/back: move one step back and clean up what the later step saved.
// The step lives in sessions.status, so going back has to change it on the server: a screen-only
// "back" would jump forward again on refresh.
export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid request" }, { status: 400 });
  const { sessionId } = parsed.data;

  const current = await loadSessionState(sessionId);
  if (!current.ok) {
    return current.reason === "not_found"
      ? Response.json({ error: "Session not found" }, { status: 404 })
      : Response.json({ error: "Could not go back" }, { status: 500 });
  }
  const from = current.state.status;
  if (from === "site") return Response.json({ status: "site" }); // nothing before step 1: no-op
  if (from === "live") return Response.json({ error: "wrong_step" }, { status: 409 }); // not used in M2

  const db = supabaseAdmin();
  const clearGoal = { goal_type: null, goal_label: null, goal_custom_text: null };
  let to: SessionStatus;

  if (from === "building") {
    // Keep suggested_goals so the cards come back without another model call.
    to = "goal";
  } else {
    // goal -> site: drop everything the goal step produced. The profile row itself stays; the next
    // research or description replaces it.
    to = "site";
    const { error } = await db
      .from("business_profiles")
      .update({ suggested_goals: null, category: null, summary: null })
      .eq("session_id", sessionId);
    if (error) {
      console.error("[step/back] clearing profile failed:", error.message);
      return Response.json({ error: "Could not go back" }, { status: 500 });
    }
  }

  // One conditional update: status and goal_* change together, and only if nothing moved meanwhile.
  const { data, error } = await db
    .from("sessions")
    .update({ status: to, ...clearGoal })
    .eq("id", sessionId)
    .eq("status", from)
    .select("id");
  if (error) {
    console.error("[step/back] update failed:", error.message);
    return Response.json({ error: "Could not go back" }, { status: 500 });
  }
  if (data && data.length > 0) {
    await logEvent(sessionId, "step_back", { from, to });
    return Response.json({ status: to });
  }
  // Someone else moved the session first: report where it is now.
  const now = await loadSessionState(sessionId);
  return Response.json({ status: now.ok ? now.state.status : from });
}

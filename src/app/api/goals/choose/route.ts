import { supabaseAdmin } from "@/lib/supabase-server";
import { logEvent } from "@/lib/events";
import { chooseGoalBody, DEFAULT_GOALS, recommendedGoal } from "@/lib/goals";
import { advanceStatus, loadSessionState } from "@/lib/session-state";

// POST /api/goals/choose: save the goal the user picked and move the session to "building".
// A route and not an agent tool: choosing is a user click, not an agent decision, so the model can neither
// skip nor invent it. The label is never taken from the browser: the server looks it up.
export async function POST(req: Request) {
  const parsed = chooseGoalBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid request" }, { status: 400 });
  const { sessionId, goalType } = parsed.data;

  const current = await loadSessionState(sessionId);
  if (!current.ok) {
    return current.reason === "not_found"
      ? Response.json({ error: "Session not found" }, { status: 404 })
      : Response.json({ error: "Could not save your goal" }, { status: 500 });
  }
  // Only while choosing. Once saved ("building") the user has to go back first.
  if (current.state.status !== "goal") return Response.json({ error: "wrong_step" }, { status: 409 });

  const saved = current.state.profile?.suggestedGoals;
  let label: string;
  let source: "model" | "default";
  if (saved && saved.length > 0) {
    const match = saved.find((g) => g.goalType === goalType);
    if (!match) return Response.json({ error: "Unknown goal" }, { status: 400 }); // not one we offered
    label = match.label;
    source = match.source;
  } else {
    // The user took the fallback defaults (suggestions were never saved).
    label = DEFAULT_GOALS[goalType].label;
    source = "default";
  }

  // Conditional on status = 'goal', so a stale tab cannot overwrite a saved goal after the user moved on.
  const { data, error } = await supabaseAdmin()
    .from("sessions")
    .update({ goal_type: goalType, goal_label: label, goal_custom_text: null })
    .eq("id", sessionId)
    .eq("status", "goal")
    .select("id");
  if (error) {
    console.error("[goals/choose] save failed:", error.message);
    return Response.json({ error: "Could not save your goal" }, { status: 500 });
  }
  if (!data || data.length === 0) return Response.json({ error: "wrong_step" }, { status: 409 });

  await advanceStatus(sessionId, "goal", "building");
  // Which goal the model recommended vs which one the user picked: how often the model is right is a usage signal.
  const recommended = recommendedGoal(saved);
  await logEvent(sessionId, "goal_chosen", { goalType, recommended, followed: recommended === goalType, source });
  return Response.json({ ok: true, goal: { goalType, label } });
}

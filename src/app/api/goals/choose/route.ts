import { supabaseAdmin } from "@/lib/supabase-server";
import { logEvent } from "@/lib/events";
import { chooseGoalBody, DEFAULT_GOALS, type GoalType } from "@/lib/goals";
import { advanceStatus, loadSessionState } from "@/lib/session-state";

// POST /api/goals/choose: save the goal the user picked and move the session to "building".
// A route and not an agent tool: choosing is a user click, not an agent decision, so the model can neither
// skip nor invent it. The label is never taken from the browser: the server looks it up.
export async function POST(req: Request) {
  const parsed = chooseGoalBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid request" }, { status: 400 });
  const body = parsed.data;
  const sessionId = body.sessionId;

  const current = await loadSessionState(sessionId);
  if (!current.ok) {
    return current.reason === "not_found"
      ? Response.json({ error: "Session not found" }, { status: 404 })
      : Response.json({ error: "Could not save your goal" }, { status: 500 });
  }
  // Only while choosing. Once saved ("building") the user has to go back first.
  if (current.state.status !== "goal") return Response.json({ error: "wrong_step" }, { status: 409 });

  let goalType: GoalType | null;
  let label: string;
  let customText: string | null;
  let source: "model" | "default" | "custom";

  if (body.kind === "custom") {
    // Classifying free text into one of the four types is left to a later milestone.
    goalType = null;
    label = "Custom goal";
    customText = body.customText;
    source = "custom";
  } else {
    goalType = body.goalType;
    customText = null;
    const saved = current.state.profile?.suggestedGoals;
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
  }

  // Conditional on status = 'goal', so a stale tab cannot overwrite a goal after the user moved on.
  const { data, error } = await supabaseAdmin()
    .from("sessions")
    .update({ goal_type: goalType, goal_label: label, goal_custom_text: customText })
    .eq("id", sessionId)
    .eq("status", "goal")
    .select("id");
  if (error) {
    console.error("[goals/choose] save failed:", error.message);
    return Response.json({ error: "Could not save your goal" }, { status: 500 });
  }
  if (!data || data.length === 0) return Response.json({ error: "wrong_step" }, { status: 409 });

  await advanceStatus(sessionId, "goal", "building");
  await logEvent(sessionId, "goal_chosen", { goalType, custom: body.kind === "custom", source });
  return Response.json({ ok: true, goal: { goalType, label, customText } });
}

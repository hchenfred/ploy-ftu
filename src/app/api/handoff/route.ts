import { z } from "zod";
import { logEvent } from "@/lib/events";
import { GOAL_CATALOG } from "@/lib/goals";
import { loadSessionState } from "@/lib/session-state";

const Body = z.object({ sessionId: z.uuid() });

// POST /api/handoff: the user clicked the "Continue in Ploy" link. This click is the conversion signal, tracked separately from
// activation. The link itself never waits for this call, and a failure here never blocks it.
export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid request" }, { status: 400 });
  const { sessionId } = parsed.data;

  const current = await loadSessionState(sessionId);
  if (!current.ok) {
    return current.reason === "not_found"
      ? Response.json({ error: "Session not found" }, { status: 404 })
      : Response.json({ error: "Could not log the click" }, { status: 500 });
  }
  const { goal, artifact } = current.state;
  if (!goal || !artifact?.saved) return Response.json({ error: "not_saved" }, { status: 409 });

  await logEvent(sessionId, "handoff_clicked", { goalType: goal.goalType, primitive: GOAL_CATALOG[goal.goalType].handoff.primitive });
  return Response.json({ ok: true });
}

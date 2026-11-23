import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase-server";
import { logEvent } from "@/lib/events";
import { advanceStatus, loadSessionState } from "@/lib/session-state";

const Body = z.object({
  sessionId: z.uuid(),
  description: z.string().trim().min(1).max(500),
});

// POST /api/profile/describe: the "I don't have a website" path. The description is typed by the user,
// so the server saves it directly (the model is not involved). It replaces the whole profile row, so a
// site researched earlier never leaves its brand or goals behind.
export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid request" }, { status: 400 });
  const { sessionId, description } = parsed.data;

  const current = await loadSessionState(sessionId);
  if (!current.ok) {
    return current.reason === "not_found"
      ? Response.json({ error: "Session not found" }, { status: 404 })
      : Response.json({ error: "Could not save your description" }, { status: 500 });
  }
  // Replacing the profile after the user moved on would leave a saved goal pointing at a different business.
  if (current.state.status !== "site") {
    return Response.json({ error: "wrong_step" }, { status: 409 });
  }

  const { error } = await supabaseAdmin()
    .from("business_profiles")
    .upsert({
      session_id: sessionId,
      url: null,
      name: null,
      brand: {},
      content: { description },
      field_sources: { description: "user" },
      summary: null,
      suggested_goals: null,
      updated_at: new Date().toISOString(),
    });
  if (error) {
    console.error("[profile/describe] save failed:", error.message);
    return Response.json({ error: "Could not save your description" }, { status: 500 });
  }

  await advanceStatus(sessionId, "site", "goal");
  await logEvent(sessionId, "description_saved", { chars: description.length });
  return Response.json({ ok: true, status: "goal" });
}

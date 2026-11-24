import { z } from "zod";
import { getArtifact, isClaimActive } from "@/lib/artifact-store";
import { logEvent } from "@/lib/events";
import { loadSessionState } from "@/lib/session-state";
import { supabaseAdmin } from "@/lib/supabase-server";

const Body = z.object({ sessionId: z.uuid() });

// POST /api/artifact/save: the user clicks Save. The draft becomes the saved artifact and the activation event is logged.
// Repeating the call changes nothing (the event is logged once, when the row actually changes).
export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid request" }, { status: 400 });
  const { sessionId } = parsed.data;

  const current = await loadSessionState(sessionId);
  if (!current.ok) {
    return current.reason === "not_found"
      ? Response.json({ error: "Session not found" }, { status: 404 })
      : Response.json({ error: "Could not save" }, { status: 500 });
  }
  const { status, goal, artifact } = current.state;
  if (status !== "building" || !goal || !artifact) return Response.json({ error: "wrong_step" }, { status: 409 });
  if (artifact.saved) return Response.json({ ok: true, saved: true }); // already saved: nothing to do

  const row = await getArtifact(sessionId);
  if (isClaimActive(row)) return Response.json({ error: "busy" }, { status: 409 }); // still generating: do not save a half-made draft

  const db = supabaseAdmin();
  const savedAt = new Date().toISOString();
  const { data, error } = await db
    .from("artifacts")
    .update({ saved_at: savedAt })
    .eq("id", artifact.id)
    .is("saved_at", null)
    .select("id");
  if (error) {
    console.error("[artifact/save] failed:", error.message);
    return Response.json({ error: "Could not save" }, { status: 500 });
  }
  if (data && data.length > 0) {
    // The activation metric: seconds from the start of onboarding to the first saved artifact, computed on the server.
    const { data: session } = await db.from("sessions").select("created_at").eq("id", sessionId).maybeSingle();
    const secondsSinceStart = session?.created_at ? Math.round((Date.parse(savedAt) - Date.parse(session.created_at)) / 1000) : null;
    await logEvent(sessionId, "artifact_saved", {
      goalType: goal.goalType,
      artifactType: artifact.type,
      source: artifact.source,
      secondsSinceStart,
    });
  }
  return Response.json({ ok: true, saved: true });
}

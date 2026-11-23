import { supabaseAdmin } from "@/lib/supabase-server";
import { logEvent } from "@/lib/events";

// POST /api/sessions: start one onboarding run.
export async function POST() {
  const { data, error } = await supabaseAdmin()
    .from("sessions")
    .insert({ status: "site" })
    .select("id")
    .single();

  if (error || !data) {
    console.error("[sessions] create failed:", error?.message);
    return Response.json({ error: "Could not start a session" }, { status: 500 });
  }

  await logEvent(data.id, "ftu_started");
  return Response.json({ sessionId: data.id });
}

import "server-only";
import { supabaseAdmin } from "@/lib/supabase-server";

// Funnel events. Written by server code (routes and tool execute functions),
// never by the LLM, so the numbers on /metrics can be trusted.
export type EventName = "ftu_started" | "research_done" | "tool_failed";

export async function logEvent(
  sessionId: string | null,
  name: EventName,
  props: Record<string, unknown> = {},
): Promise<void> {
  try {
    const { error } = await supabaseAdmin()
      .from("events")
      .insert({ session_id: sessionId, name, props });
    if (error) console.error(`[events] failed to log ${name}:`, error.message);
  } catch (err) {
    // Logging must never break the user's flow.
    console.error(`[events] failed to log ${name}:`, err);
  }
}

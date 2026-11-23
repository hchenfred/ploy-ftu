import "server-only";
import { supabaseAdmin } from "@/lib/supabase-server";
import { logEvent } from "@/lib/events";
import type { SessionStatus } from "@/lib/goals";

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

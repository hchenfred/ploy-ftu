import { z } from "zod";
import { loadSessionState } from "@/lib/session-state";

// GET /api/sessions/[id]: which step the user is on, plus what the UI needs to render it.
// The step comes from sessions.status on the server; the client only re-reads it.
export async function GET(_req: Request, ctx: RouteContext<"/api/sessions/[id]">) {
  const { id } = await ctx.params; // params is a Promise in this Next.js version
  if (!z.uuid().safeParse(id).success) {
    return Response.json({ error: "Invalid session id" }, { status: 400 });
  }

  const result = await loadSessionState(id);
  if (!result.ok) {
    return result.reason === "not_found"
      ? Response.json({ error: "Session not found" }, { status: 404 })
      : Response.json({ error: "Could not load the session" }, { status: 500 });
  }
  return Response.json(result.state, { headers: { "Cache-Control": "no-store" } });
}
